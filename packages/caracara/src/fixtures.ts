import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  slugSchema,
  type Fixture,
  type FixtureAccess,
  type FixturePreflightEntry,
  type OrderedScenario,
} from "@workspace/contracts"
import { z } from "zod"

import { cliPaths, findLocalConfigPath } from "./config.js"
import type { RunnerSecrets, RunnerSession } from "./execution.js"
import {
  buildFixtureTaskPrompt,
  fixtureTaskChecks,
  type FixtureTaskKind,
} from "./fixture-prompts.js"
import { terminateChildProcess } from "./process-control.js"

export const FIXTURE_HOOKS_FILE_NAME = "fixtures.json"

// Zod 4 records drop an own "__proto__" key (which JSON.parse creates)
// without validating it, so reject it explicitly, as config.ts does.
const withoutProtoKey = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value, ctx) => {
    if (
      typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, "__proto__")
    ) {
      ctx.addIssue({
        code: "custom",
        message: '"__proto__" is not a valid key.',
        path: ["__proto__"],
        input: value,
      })
    }
    return value
  }, schema)

const fixtureHookSchema = z.strictObject({
  verify: z.string().trim().min(1).optional(),
  converge: z.string().trim().min(1).optional(),
})

/** `{ "<projectSlug>": { "<fixtureSlug>": { "verify"?, "converge"? } } }` */
export const fixtureHooksFileSchema = withoutProtoKey(
  z.record(slugSchema, withoutProtoKey(z.record(slugSchema, fixtureHookSchema)))
)

export type FixtureHooks = Record<string, z.infer<typeof fixtureHookSchema>>

export function parseFixtureHooksFile(raw: string, path: string) {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : "parse error"}`
    )
  }
  const parsed = fixtureHooksFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`${path} is invalid:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/**
 * Reads the hooks for one project from `.caracara/fixtures.json`, next to the
 * nearest `.caracara/config.json`. Hooks run in the directory that contains
 * `.caracara`. The file is optional.
 */
export async function readFixtureHooks(
  projectSlug: string,
  startDir = process.cwd()
): Promise<{ cwd: string; hooks: FixtureHooks }> {
  const configPath = await findLocalConfigPath(startDir)
  if (!configPath) {
    return { cwd: startDir, hooks: {} }
  }
  const configDir = dirname(configPath)
  const path = join(configDir, FIXTURE_HOOKS_FILE_NAME)
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { cwd: dirname(configDir), hooks: {} }
    }
    throw error
  }
  const file = parseFixtureHooksFile(
    raw,
    join(cliPaths.localConfigDirName, FIXTURE_HOOKS_FILE_NAME)
  )
  return {
    cwd: dirname(configDir),
    hooks: Object.hasOwn(file, projectSlug) ? file[projectSlug]! : {},
  }
}

type TextOutput = { write(chunk: string | Uint8Array): unknown }

/**
 * Runs a hook command through the shell and returns its exit code. Its stdout
 * and stderr both go to `output` (the CLI's stderr), so JSON output on stdout
 * stays valid. On abort the whole process group is killed.
 */
export async function runHook(input: {
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  output?: TextOutput
}) {
  input.signal?.throwIfAborted()
  const output = input.output ?? process.stderr
  const detached = process.platform !== "win32"
  const child = spawn(input.command, {
    cwd: input.cwd,
    env: input.env,
    shell: true,
    detached,
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (chunk: Buffer) => output.write(chunk))
  child.stderr.on("data", (chunk: Buffer) => output.write(chunk))
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve(code))
  })
  let terminating: Promise<void> = Promise.resolve()
  const onAbort = () => {
    terminating = terminateChildProcess(
      child,
      detached,
      closed.then(
        () => undefined,
        () => undefined
      )
    )
  }
  input.signal?.addEventListener("abort", onAbort, { once: true })
  try {
    const code = await closed
    await terminating.catch(() => undefined)
    input.signal?.throwIfAborted()
    return code
  } finally {
    input.signal?.removeEventListener("abort", onAbort)
  }
}

export type FixtureExecutor = "hook" | "agent"

export type FixtureOperationResult = {
  ok: boolean
  /** Null when neither a hook nor an agent task could run the operation. */
  executor: FixtureExecutor | null
  /** Failed checks or the reason the operation failed. */
  problems: string[]
}

export type FixtureContext = {
  projectSlug: string
  environment: { name: string; targetUrl: string }
  projectPrompt: string
  secrets: RunnerSecrets
  hooks: FixtureHooks
  /** Directory that contains `.caracara`. */
  hookCwd: string
  /** Working directory for agent tasks. */
  agentCwd: string
  signal: AbortSignal
  /** Receives hook output; the CLI's stderr. */
  hookOutput?: TextOutput
  /** Starts the runner session on first use. */
  getSession: () => Promise<RunnerSession>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function runFixtureOperation(
  context: FixtureContext,
  fixture: Fixture,
  kind: FixtureTaskKind
): Promise<FixtureOperationResult> {
  context.signal.throwIfAborted()
  const hook = context.hooks[fixture.slug]?.[kind]
  if (hook) {
    try {
      const code = await runHook({
        command: hook,
        cwd: context.hookCwd,
        env: {
          ...process.env,
          ...context.secrets,
          CARACARA_ENVIRONMENT: context.environment.name,
          CARACARA_TARGET_URL: context.environment.targetUrl,
          CARACARA_PROJECT: context.projectSlug,
          CARACARA_FIXTURE: fixture.slug,
        },
        signal: context.signal,
        output: context.hookOutput,
      })
      return code === 0
        ? { ok: true, executor: "hook", problems: [] }
        : {
            ok: false,
            executor: "hook",
            problems: [`The ${kind} hook exited with code ${code}.`],
          }
    } catch (error) {
      if (context.signal.aborted) {
        throw error
      }
      return {
        ok: false,
        executor: "hook",
        problems: [`The ${kind} hook failed: ${errorMessage(error)}`],
      }
    }
  }

  const checks = fixtureTaskChecks(fixture, kind)
  if (checks.length === 0) {
    return {
      ok: false,
      executor: null,
      problems: [
        kind === "verify"
          ? `No way to verify it: add a "verify" hook for "${fixture.slug}" in .caracara/${FIXTURE_HOOKS_FILE_NAME}, or add health checks to the fixture.`
          : `No way to converge it: add a "converge" hook for "${fixture.slug}" in .caracara/${FIXTURE_HOOKS_FILE_NAME}, or add converge steps to the fixture.`,
      ],
    }
  }

  try {
    const session = await context.getSession()
    const result = await session.runTask({
      cwd: context.agentCwd,
      prompt: buildFixtureTaskPrompt({
        kind,
        environment: context.environment.name,
        targetUrl: context.environment.targetUrl,
        projectPrompt: context.projectPrompt,
        secretNames: Object.keys(context.secrets),
        fixture,
      }),
      checks,
      signal: context.signal,
    })
    const names = new Map(checks.map((check) => [check.id, check.name]))
    const problems = result.checkResults
      .filter((check) => check.verdict !== "passed")
      .map(
        (check) =>
          `${names.get(check.checkId) ?? check.checkId}: ${check.verdict}. ${check.evidence}`
      )
    return { ok: problems.length === 0, executor: "agent", problems }
  } catch (error) {
    if (context.signal.aborted) {
      throw error
    }
    return {
      ok: false,
      executor: "agent",
      problems: [`The agent ${kind} task failed: ${errorMessage(error)}`],
    }
  }
}

/** Verify: the hook if configured, else an inspect-only agent task. */
export function verifyFixture(context: FixtureContext, fixture: Fixture) {
  return runFixtureOperation(context, fixture, "verify")
}

/**
 * Converge (hook, else one agent task over the steps), then always verify.
 * Healthy only when the final verify passes. The executor is converge's.
 */
export async function convergeFixture(
  context: FixtureContext,
  fixture: Fixture
): Promise<FixtureOperationResult> {
  const converge = await runFixtureOperation(context, fixture, "converge")
  if (converge.executor === null) {
    return converge
  }
  const verify = await verifyFixture(context, fixture)
  return {
    ok: verify.ok,
    executor: converge.executor,
    problems: [
      ...(converge.ok
        ? []
        : converge.problems.map((problem) => `Converge: ${problem}`)),
      ...verify.problems,
    ],
  }
}

export type FixturePreflightMode = "check" | "repair" | "skip"

export function parseFixturePreflightMode(
  value: string | undefined
): FixturePreflightMode {
  if (value === undefined) {
    return "check"
  }
  if (value === "check" || value === "repair" || value === "skip") {
    return value
  }
  throw new Error(`--fixtures must be check, repair or skip, not "${value}".`)
}

export type RequiredFixture = { fixture: Fixture; access: FixtureAccess }

/** The fixtures any scenario of the queue requires; mutating access wins. */
export function collectRequiredFixtures(
  queue: ReadonlyArray<{ scenario: OrderedScenario }>,
  fixtures: Fixture[] | undefined
): RequiredFixture[] {
  const byId = new Map((fixtures ?? []).map((fixture) => [fixture.id, fixture]))
  const required = new Map<string, RequiredFixture>()
  for (const { scenario } of queue) {
    for (const requirement of scenario.fixtureRequirements ?? []) {
      const fixture = byId.get(requirement.fixtureId)
      if (!fixture) {
        throw new Error(
          `Scenario ${scenario.slug} requires fixture ${requirement.fixtureId}, but the server did not send its definition.`
        )
      }
      const current = required.get(fixture.id)
      required.set(fixture.id, {
        fixture,
        access: current?.access === "mutates" ? "mutates" : requirement.access,
      })
    }
  }
  return [...required.values()]
}

export function formatFixtureResult(
  fixture: Fixture,
  label: string,
  result: Pick<FixtureOperationResult, "executor" | "problems">
) {
  return [
    `Fixture ${fixture.slug}: ${label}${result.executor ? ` (${result.executor})` : ""}\n`,
    ...result.problems.map((problem) => `  ${problem.replace(/\s+/g, " ")}\n`),
  ].join("")
}

/**
 * Checks, repairs or skips the required fixtures before a run is created.
 * `log` receives one block per fixture; `problem` marks unhealthy ones.
 */
export async function runFixturePreflight(input: {
  mode: FixturePreflightMode
  required: RequiredFixture[]
  context: FixtureContext
  log: (text: string, problem: boolean) => void
}) {
  const entries: FixturePreflightEntry[] = []
  let healthy = true
  for (const { fixture, access } of input.required) {
    const base = {
      fixtureId: fixture.id,
      fixtureSlug: fixture.slug,
      fixtureName: fixture.name,
      access,
    }
    if (input.mode === "skip") {
      entries.push({ ...base, outcome: "skipped", executor: null })
      input.log(
        formatFixtureResult(fixture, "skipped", {
          executor: null,
          problems: [],
        }),
        false
      )
      continue
    }
    // Repair converges only fixtures that fail their verify.
    const verified = await verifyFixture(input.context, fixture)
    const repairing = !verified.ok && input.mode === "repair"
    const result = repairing
      ? await convergeFixture(input.context, fixture)
      : verified
    if (result.ok) {
      const outcome = repairing ? "repaired" : "healthy"
      entries.push({ ...base, outcome, executor: result.executor })
      input.log(formatFixtureResult(fixture, outcome, result), false)
    } else {
      healthy = false
      input.log(formatFixtureResult(fixture, "unhealthy", result), true)
    }
  }
  return { entries, healthy }
}
