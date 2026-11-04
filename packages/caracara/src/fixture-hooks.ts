// Local fixture hooks: `.caracara/fixtures.json` and the process that runs
// one hook. Hooks are local commands and are never sent to the server.
import { spawn } from "node:child_process"
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  FIXTURE_OPERATION_SUMMARY_MAX_LENGTH,
  slugSchema,
  type EvaluationCheck,
  type FixtureOperationCheckResult,
  type FixtureOperationKind,
} from "@workspace/contracts"
import { z } from "zod"

import { findLocalConfigPath } from "./config.js"
import { terminateChildProcess } from "./process-control.js"
import { collectSecretValues, redactValues } from "./redaction.js"

export { collectSecretValues, redactValues }

const FIXTURE_HOOKS_FILE_NAME = "fixtures.json"
export const DEFAULT_HOOK_TIMEOUT_MINUTES = 60
export const MAX_HOOK_TIMEOUT_MINUTES = 180
const CHECK_EVIDENCE_MAX_LENGTH = 2_000

// Zod 4 records drop an own "__proto__" key (which JSON.parse creates) without
// validating it, so reject it explicitly, as config.ts does for environments.
function rejectProtoKey<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, ctx) => {
    if (
      typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, "__proto__")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid key.",
        path: ["__proto__"],
        input: "__proto__",
      })
    }
    return value
  }, schema)
}

const hookCommandSchema = z.string().trim().min(1)

export const fixtureHookSchema = z.strictObject({
  verify: hookCommandSchema.optional(),
  converge: hookCommandSchema.optional(),
  reset: hookCommandSchema.optional(),
  timeoutMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_HOOK_TIMEOUT_MINUTES)
    .optional(),
})

export const fixtureHooksFileSchema = z.strictObject({
  projects: rejectProtoKey(
    z.record(slugSchema, rejectProtoKey(z.record(slugSchema, fixtureHookSchema)))
  ),
})

export type FixtureHook = z.infer<typeof fixtureHookSchema>
export type ProjectFixtureHooks = Record<string, FixtureHook>

export type FixtureHooksConfig = {
  /** The hooks file, or null when there is no local `.caracara` directory. */
  path: string | null
  /** The directory that contains `.caracara`; hooks run there. */
  rootDir: string
  projects: Record<string, ProjectFixtureHooks>
}

export function parseFixtureHooksFile(raw: string, path: string) {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const parsed = fixtureHooksFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`${path} is invalid:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data.projects
}

export async function readFixtureHooks(
  startDir = process.cwd()
): Promise<FixtureHooksConfig> {
  const configPath = await findLocalConfigPath(startDir)
  if (!configPath) {
    return { path: null, rootDir: startDir, projects: {} }
  }

  const caracaraDir = dirname(configPath)
  const path = join(caracaraDir, FIXTURE_HOOKS_FILE_NAME)
  const rootDir = dirname(caracaraDir)
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, rootDir, projects: {} }
    }
    throw error
  }

  return { path, rootDir, projects: parseFixtureHooksFile(raw, path) }
}

export function getProjectFixtureHooks(
  config: FixtureHooksConfig,
  projectSlug: string
): ProjectFixtureHooks {
  return Object.hasOwn(config.projects, projectSlug)
    ? config.projects[projectSlug]!
    : {}
}

/** Hook keys that name no fixture of the project, usually a typo. */
export function findUnknownHookSlugs(
  hooks: ProjectFixtureHooks,
  fixtureSlugs: Iterable<string>
) {
  const known = new Set(fixtureSlugs)
  return Object.keys(hooks)
    .filter((slug) => !known.has(slug))
    .sort()
}

export function getFixtureHook(hooks: ProjectFixtureHooks, slug: string) {
  return Object.hasOwn(hooks, slug) ? hooks[slug] : undefined
}

const MAX_PENDING_LINE_LENGTH = 8_192

/**
 * Redacts streamed output before it leaves the process. Output is released
 * by complete lines, so a secret is never split across two writes; a very
 * long line is released early except for a tail that could hold a secret's
 * beginning.
 */
export class StreamRedactor {
  private pending = ""
  private readonly maxSecretLength: number
  private readonly multilineSecrets: boolean

  constructor(
    private readonly secretValues: readonly string[],
    private readonly emit: (text: string) => void
  ) {
    this.maxSecretLength = Math.max(0, ...secretValues.map((s) => s.length))
    this.multilineSecrets = secretValues.some(
      (secret) => secret.includes("\n") || secret.includes("\r")
    )
  }

  write(chunk: string) {
    this.pending += chunk
    const redacted = redactValues(this.pending, this.secretValues)
    // A secret can only straddle the end of the buffer if it starts in the
    // last maxSecretLength - 1 characters.
    const safeEnd = Math.max(0, redacted.length - (this.maxSecretLength - 1))
    const lastNewline = redacted.lastIndexOf("\n")
    let boundary = lastNewline + 1
    if (this.multilineSecrets) {
      boundary = Math.min(boundary, safeEnd)
    }
    if (boundary === 0 && redacted.length > MAX_PENDING_LINE_LENGTH) {
      boundary = safeEnd
    }
    if (boundary > 0) {
      this.emit(redacted.slice(0, boundary))
      this.pending = redacted.slice(boundary)
    } else {
      this.pending = redacted
    }
  }

  end() {
    if (this.pending !== "") {
      this.emit(redactValues(this.pending, this.secretValues))
      this.pending = ""
    }
  }
}

/** Keeps the last `limit` characters written to it. */
class TailBuffer {
  private text = ""

  constructor(private readonly limit: number) {}

  append(chunk: string) {
    this.text += chunk
    if (this.text.length > this.limit * 2) {
      this.text = this.text.slice(-this.limit)
    }
  }

  toString() {
    return clipTail(this.text, this.limit)
  }
}

function clipTail(text: string, limit: number) {
  if (text.length <= limit) {
    return text
  }
  let clipped = text.slice(-limit)
  // Do not start with half of a surrogate pair.
  const first = clipped.charCodeAt(0)
  if (first >= 0xdc00 && first <= 0xdfff) {
    clipped = clipped.slice(1)
  }
  return clipped
}

export function clipText(text: string, limit: number) {
  if (text.length <= limit) {
    return text
  }
  let clipped = text.slice(0, limit)
  const last = clipped.charCodeAt(clipped.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) {
    clipped = clipped.slice(0, -1)
  }
  return clipped
}

/** Prefixes every line start with `prefix`, across writes. */
function createLinePrefixer(prefix: string, write: (text: string) => void) {
  let atLineStart = true
  return (text: string) => {
    if (text === "") {
      return
    }
    let output = ""
    for (const part of text.split(/(?<=\n)/)) {
      output += (atLineStart ? prefix : "") + part
      atLineStart = part.endsWith("\n")
    }
    write(output)
  }
}

const hookResultFileSchema = z.strictObject({
  summary: z.string().optional(),
  checks: z
    .array(
      z.strictObject({
        check: z.string().min(1),
        passed: z.boolean(),
        evidence: z.string().trim().min(1),
      })
    )
    .optional(),
})

export type HookResultFile = z.infer<typeof hookResultFileSchema>

export class InvalidHookResultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidHookResultError"
  }
}

/**
 * Maps a hook's reported checks onto the authored health checks. The list
 * must name every authored check exactly once, by ID or exact unique name.
 */
export function mapHookResultChecks(
  reported: NonNullable<HookResultFile["checks"]>,
  healthChecks: EvaluationCheck[],
  secretValues: readonly string[] = []
): FixtureOperationCheckResult[] {
  const byCheckId = new Map<string, FixtureOperationCheckResult>()
  for (const entry of reported) {
    const byId = healthChecks.find((check) => check.id === entry.check)
    const byName = healthChecks.filter((check) => check.name === entry.check)
    if (!byId && byName.length > 1) {
      throw new InvalidHookResultError(
        `check ${JSON.stringify(entry.check)} is ambiguous; use its check ID.`
      )
    }
    const check = byId ?? byName[0]
    if (!check) {
      throw new InvalidHookResultError(
        `check ${JSON.stringify(entry.check)} is not a health check of this fixture.`
      )
    }
    if (byCheckId.has(check.id)) {
      throw new InvalidHookResultError(
        `check ${JSON.stringify(check.name)} is reported more than once.`
      )
    }
    byCheckId.set(check.id, {
      checkId: check.id,
      name: check.name,
      verdict: entry.passed ? "passed" : "failed",
      evidence: clipText(
        redactValues(entry.evidence.trim(), secretValues),
        CHECK_EVIDENCE_MAX_LENGTH
      ),
    })
  }

  const missing = healthChecks.filter((check) => !byCheckId.has(check.id))
  if (missing.length > 0) {
    throw new InvalidHookResultError(
      `missing ${missing.map((check) => JSON.stringify(check.name)).join(", ")}.`
    )
  }

  return healthChecks.map((check) => byCheckId.get(check.id)!)
}

export type FixtureHookInput = {
  command: string
  cwd: string
  kind: FixtureOperationKind
  projectSlug: string
  fixtureSlug: string
  /** The fixture's authored health checks; the result file reports on these. */
  healthChecks: EvaluationCheck[]
  environment: string
  targetUrl: string
  /** Local secrets, added to the hook environment. */
  secrets: Record<string, string>
  baseEnv?: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  outputPrefix?: string
}

export type FixtureHookResult = {
  status: "succeeded" | "failed"
  checkResults: FixtureOperationCheckResult[]
  summary: string
}

function composeSummary(header: string, body: string) {
  const text = body.trim() === "" ? header : `${header}\n${body}`
  return clipTail(text, FIXTURE_OPERATION_SUMMARY_MAX_LENGTH)
}

/**
 * Runs one hook through the shell. Exit 0 succeeds unless the optional
 * result file reports a failed check. A timeout kills the process tree and
 * fails; an abort kills it and rejects with the abort reason.
 */
export async function runFixtureHook(
  input: FixtureHookInput
): Promise<FixtureHookResult> {
  input.signal?.throwIfAborted()
  const baseEnv = input.baseEnv ?? process.env
  const secretValues = collectSecretValues(input.secrets, baseEnv)
  const tempDir = await mkdtemp(join(tmpdir(), "caracara-fixture-"))
  try {
    await chmod(tempDir, 0o700)
    const resultFile = join(tempDir, "result.json")
    const tail = new TailBuffer(FIXTURE_OPERATION_SUMMARY_MAX_LENGTH)
    const prefix = input.outputPrefix ?? ""
    const toStdout = createLinePrefixer(
      prefix,
      input.stdout ?? ((text) => process.stdout.write(text))
    )
    const toStderr = createLinePrefixer(
      prefix,
      input.stderr ?? ((text) => process.stderr.write(text))
    )
    const stdoutRedactor = new StreamRedactor(secretValues, (text) => {
      tail.append(text)
      toStdout(text)
    })
    const stderrRedactor = new StreamRedactor(secretValues, (text) => {
      tail.append(text)
      toStderr(text)
    })

    const detached = process.platform !== "win32"
    // The signal may have fired while the temp directory was being created.
    input.signal?.throwIfAborted()
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      detached,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...baseEnv,
        ...input.secrets,
        CARACARA_ENVIRONMENT: input.environment,
        CARACARA_TARGET_URL: input.targetUrl,
        CARACARA_PROJECT: input.projectSlug,
        CARACARA_FIXTURE: input.fixtureSlug,
        CARACARA_FIXTURE_OPERATION: input.kind,
        CARACARA_RESULT_FILE: resultFile,
      },
    })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => stdoutRedactor.write(chunk))
    child.stderr.on("data", (chunk: string) => stderrRedactor.write(chunk))

    const closed = new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
    }>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, signal) => resolve({ code, signal }))
    })
    const closedVoid = closed.then(
      () => undefined,
      () => undefined
    )

    let stopReason: "timeout" | "abort" | null = null
    let termination: Promise<void> | null = null
    const stop = (reason: "timeout" | "abort") => {
      if (stopReason) {
        return
      }
      stopReason = reason
      termination = terminateChildProcess(child, detached, closedVoid)
    }
    const timer = setTimeout(() => stop("timeout"), input.timeoutMs)
    const onAbort = () => stop("abort")
    input.signal?.addEventListener("abort", onAbort, { once: true })
    if (input.signal?.aborted) {
      onAbort()
    }

    let exit: { code: number | null; signal: NodeJS.Signals | null }
    try {
      exit = await closed
    } finally {
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", onAbort)
      if (termination) {
        await termination
      }
      stdoutRedactor.end()
      stderrRedactor.end()
    }

    if (stopReason === "abort") {
      throw input.signal?.reason ?? new Error("Fixture hook interrupted.")
    }
    if (stopReason === "timeout") {
      return {
        status: "failed",
        checkResults: [],
        summary: composeSummary(
          `Hook timed out after ${Math.round(input.timeoutMs / 60_000)} minute(s) and was stopped.`,
          tail.toString()
        ),
      }
    }

    const header =
      exit.code === 0
        ? "Hook exited with code 0."
        : exit.code === null
          ? `Hook was killed by ${exit.signal ?? "a signal"}.`
          : `Hook exited with code ${exit.code}.`

    let resultFileContents: string | null = null
    try {
      resultFileContents = await readFile(resultFile, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    if (resultFileContents === null) {
      return {
        status: exit.code === 0 ? "succeeded" : "failed",
        checkResults: [],
        summary: composeSummary(header, tail.toString()),
      }
    }

    let checkResults: FixtureOperationCheckResult[] = []
    let result: HookResultFile
    try {
      let json: unknown
      try {
        json = JSON.parse(resultFileContents)
      } catch {
        throw new InvalidHookResultError("it is not valid JSON.")
      }
      const parsed = hookResultFileSchema.safeParse(json)
      if (!parsed.success) {
        throw new InvalidHookResultError(
          parsed.error.issues
            .map((issue) =>
              issue.path.length > 0
                ? `${issue.path.join(".")}: ${issue.message}`
                : issue.message
            )
            .join("; ")
        )
      }
      result = parsed.data
      if (result.checks) {
        checkResults = mapHookResultChecks(
          result.checks,
          input.healthChecks,
          secretValues
        )
      }
    } catch (error) {
      if (!(error instanceof InvalidHookResultError)) {
        throw error
      }
      return {
        status: "failed",
        checkResults: [],
        summary: composeSummary(
          redactValues(
            `Invalid result file: ${error.message} ${header}`,
            secretValues
          ),
          tail.toString()
        ),
      }
    }

    const passed =
      exit.code === 0 &&
      checkResults.every((checkResult) => checkResult.verdict === "passed")
    const reportedSummary =
      result.summary && result.summary.trim() !== ""
        ? redactValues(result.summary.trim(), secretValues)
        : null
    return {
      status: passed ? "succeeded" : "failed",
      checkResults,
      summary: reportedSummary
        ? clipTail(
            exit.code === 0 ? reportedSummary : `${header}\n${reportedSummary}`,
            FIXTURE_OPERATION_SUMMARY_MAX_LENGTH
          )
        : composeSummary(header, tail.toString()),
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
