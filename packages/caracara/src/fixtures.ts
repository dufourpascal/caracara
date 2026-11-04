// Fixture operations: executor choice, the start/execute/finish lifecycle,
// run preflight, and post-run maintenance.
import { randomUUID } from "node:crypto"

import {
  FIXTURE_OPERATION_SUMMARY_MAX_LENGTH,
  type EffectiveFixtureRequirement,
  type FinishFixtureOperationRequest,
  type Fixture,
  type FixtureExecutor,
  type FixtureOperation,
  type FixtureOperationCheckResult,
  type FixtureOperationKind,
  type FixturePreflightOutcome,
  type StartFixtureOperationRequest,
} from "@workspace/contracts"

import { finishFixtureOperation, startFixtureOperation } from "./api.js"
import {
  RunnerExecutionError,
  type FixtureTaskExecution,
  type FixtureTaskInput,
  type RunnerSecrets,
  type RunnerSession,
  type RunnerUsageReport,
} from "./execution.js"
import {
  clipText,
  collectSecretValues,
  DEFAULT_HOOK_TIMEOUT_MINUTES,
  getFixtureHook,
  redactValues,
  runFixtureHook,
  type FixtureHook,
  type ProjectFixtureHooks,
} from "./fixture-hooks.js"
import {
  buildFixtureMaintenancePrompt,
  fixtureTaskChecks,
  type FixtureMaintenanceTask,
} from "./fixture-prompts.js"
import { CLI_VERSION } from "./version.js"

/** Agent maintenance operations stop after this long, inside the 4 h lease. */
export const AGENT_OPERATION_DEADLINE_MS = 210 * 60 * 1000
const INTERRUPTED_FINISH_TIMEOUT_MS = 10_000

export const FIXTURE_MODES = ["check", "repair", "skip"] as const
export type FixtureMode = (typeof FIXTURE_MODES)[number]

export function parseFixtureMode(value: string | undefined): FixtureMode {
  if (value === undefined) {
    return "check"
  }
  if ((FIXTURE_MODES as readonly string[]).includes(value)) {
    return value as FixtureMode
  }
  throw new Error("--fixtures must be one of: check, repair, skip.")
}

export type FixtureOperationApi = {
  start(
    payload: StartFixtureOperationRequest,
    signal: AbortSignal
  ): Promise<FixtureOperation>
  finish(
    operationId: string,
    payload: FinishFixtureOperationRequest,
    signal: AbortSignal
  ): Promise<FixtureOperation>
}

export function createFixtureOperationApi(args: {
  apiBaseUrl: string
  accessToken: string
  projectSlug: string
}): FixtureOperationApi {
  return {
    async start(payload, signal) {
      return (
        await startFixtureOperation({
          ...args,
          version: CLI_VERSION,
          payload,
          signal,
        })
      ).operation
    },
    async finish(operationId, payload, signal) {
      return (
        await finishFixtureOperation({
          ...args,
          version: CLI_VERSION,
          operationId,
          payload,
          signal,
        })
      ).operation
    },
  }
}

export type FixtureAgent = {
  cwd: string
  projectPrompt: string
  secretNames: string[]
  executeFixtureTask(input: FixtureTaskInput): Promise<FixtureTaskExecution>
}

export type FixtureRuntime = {
  api: FixtureOperationApi
  projectSlug: string
  environment: { name: string; targetUrl: string }
  hooks: ProjectFixtureHooks
  /** The directory that contains `.caracara`. */
  hookCwd: string
  secrets: RunnerSecrets
  /** Aborted by SIGINT or SIGTERM. */
  signal: AbortSignal
  getAgent(): Promise<FixtureAgent>
  recordUsage(usage: RunnerUsageReport): void
  write(text: string): void
  runHook?: typeof runFixtureHook
}

/** Starts a runner session on first use; later calls reuse it. */
export function createLazyRunnerSession(start: () => Promise<RunnerSession>) {
  let session: Promise<RunnerSession> | null = null
  return {
    get() {
      session ??= start().catch((error: unknown) => {
        session = null
        throw error
      })
      return session
    },
    get started() {
      return session !== null
    },
    async close() {
      const current = session
      session = null
      if (!current) {
        return
      }
      const resolved = await current.catch(() => null)
      await resolved?.close()
    },
  }
}

/**
 * A configured hook wins. Otherwise an agent runs the authored definition
 * when it has one for this operation; null means the operation is unavailable.
 */
export function selectFixtureExecutor(
  fixture: Pick<Fixture, "healthChecks" | "convergeSteps" | "resetInstructions">,
  kind: FixtureOperationKind,
  hook: FixtureHook | undefined
): FixtureExecutor | null {
  if (hook?.[kind]) {
    return "hook"
  }
  const hasDefinition =
    kind === "verify"
      ? fixture.healthChecks.length > 0
      : kind === "converge"
        ? fixture.convergeSteps.length > 0
        : fixture.resetInstructions !== null
  return hasDefinition ? "agent" : null
}

export function unavailableOperationMessage(
  fixture: Pick<Fixture, "slug">,
  kind: FixtureOperationKind,
  hooksPath: string | null
) {
  const definition =
    kind === "verify"
      ? "health checks"
      : kind === "converge"
        ? "converge steps"
        : "reset instructions"
  return `Fixture ${fixture.slug} cannot ${kind}: it has no ${definition} and no local ${kind} hook${hooksPath ? ` in ${hooksPath}` : " in .caracara/fixtures.json"}.`
}

export class FixtureOperationUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FixtureOperationUnavailableError"
  }
}

type ExecutedOperation = {
  status: "succeeded" | "failed"
  checkResults: FixtureOperationCheckResult[]
  summary: string | null
}

export type FixtureOperationOutcome = ExecutedOperation & {
  kind: FixtureOperationKind
  executor: FixtureExecutor
  operation: FixtureOperation
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function clipSummary(text: string) {
  return clipText(text, FIXTURE_OPERATION_SUMMARY_MAX_LENGTH)
}

async function runHookOperation(
  runtime: FixtureRuntime,
  fixture: Fixture,
  kind: FixtureOperationKind,
  hook: FixtureHook
): Promise<ExecutedOperation> {
  const runHook = runtime.runHook ?? runFixtureHook
  return await runHook({
    command: hook[kind]!,
    cwd: runtime.hookCwd,
    kind,
    projectSlug: runtime.projectSlug,
    fixtureSlug: fixture.slug,
    healthChecks: fixture.healthChecks,
    environment: runtime.environment.name,
    targetUrl: runtime.environment.targetUrl,
    secrets: runtime.secrets,
    timeoutMs: (hook.timeoutMinutes ?? DEFAULT_HOOK_TIMEOUT_MINUTES) * 60_000,
    signal: runtime.signal,
    outputPrefix: `  [${fixture.slug} ${kind}] `,
  })
}

async function runAgentOperation(
  runtime: FixtureRuntime,
  fixture: Fixture,
  kind: FixtureOperationKind
): Promise<ExecutedOperation> {
  const deadline = AbortSignal.timeout(AGENT_OPERATION_DEADLINE_MS)
  const signal = AbortSignal.any([runtime.signal, deadline])
  const checkResults: FixtureOperationCheckResult[] = []
  const summaries: string[] = []

  const runTask = async (task: FixtureMaintenanceTask) => {
    const agent = await runtime.getAgent()
    signal.throwIfAborted()
    try {
      const execution = await agent.executeFixtureTask({
        cwd: agent.cwd,
        prompt: buildFixtureMaintenancePrompt({
          environment: runtime.environment.name,
          targetUrl: runtime.environment.targetUrl,
          projectPrompt: agent.projectPrompt,
          secretNames: agent.secretNames,
          fixture,
          task,
        }),
        checks: fixtureTaskChecks(fixture, task),
        signal,
      })
      runtime.recordUsage(execution.usage)
      return execution
    } catch (error) {
      runtime.recordUsage(
        error instanceof RunnerExecutionError
          ? error.usage
          : { complete: false }
      )
      throw error
    }
  }

  try {
    if (kind === "converge") {
      for (const step of fixture.convergeSteps) {
        const execution = await runTask({ kind: "converge", step })
        checkResults.push(...execution.checkResults)
        summaries.push(`${step.name}: ${execution.summary}`)
        if (execution.checkResults.some((r) => r.verdict !== "passed")) {
          summaries.push(`Stopped at step ${JSON.stringify(step.name)}.`)
          break
        }
      }
    } else {
      const execution = await runTask(
        kind === "verify"
          ? { kind: "verify" }
          : { kind: "reset", resetInstructions: fixture.resetInstructions! }
      )
      checkResults.push(...execution.checkResults)
      summaries.push(execution.summary)
    }
  } catch (error) {
    if (runtime.signal.aborted) {
      throw error
    }
    summaries.push(
      deadline.aborted
        ? `Stopped after the ${AGENT_OPERATION_DEADLINE_MS / 60_000}-minute deadline.`
        : `Runner failed: ${errorMessage(error, "unknown error")}`
    )
    return {
      status: "failed",
      checkResults,
      summary: clipSummary(redactValues(summaries.join("\n"), collectSecretValues(runtime.secrets))),
    }
  }

  const completed =
    kind !== "converge" ||
    checkResults.length === fixture.convergeSteps.length
  return {
    status:
      completed && checkResults.every((result) => result.verdict === "passed")
        ? "succeeded"
        : "failed",
    checkResults,
    summary: clipSummary(summaries.join("\n")),
  }
}

/**
 * Starts, executes, and finishes one operation. A signal finishes it as
 * interrupted and rethrows the abort reason; other execution errors finish
 * it as failed.
 */
export async function executeFixtureOperation(
  runtime: FixtureRuntime,
  fixture: Fixture,
  kind: FixtureOperationKind,
  options: { runId?: string | null; hooksPath?: string | null } = {}
): Promise<FixtureOperationOutcome> {
  const hook = getFixtureHook(runtime.hooks, fixture.slug)
  const executor = selectFixtureExecutor(fixture, kind, hook)
  if (!executor) {
    throw new FixtureOperationUnavailableError(
      unavailableOperationMessage(fixture, kind, options.hooksPath ?? null)
    )
  }
  runtime.signal.throwIfAborted()

  const attemptId = randomUUID()
  const startPayload: StartFixtureOperationRequest = {
    fixtureId: fixture.id,
    kind,
    executor,
    environment: runtime.environment.name,
    targetUrl: runtime.environment.targetUrl,
    attemptId,
    ...(options.runId ? { runId: options.runId } : {}),
  }
  const reportCleanupError = (error: unknown) => {
    runtime.write(
      `  Failed to record interrupted ${kind} of ${fixture.slug}: ${errorMessage(error, "unknown error")}\n`
    )
  }

  let operation: FixtureOperation
  try {
    operation = await runtime.api.start(startPayload, runtime.signal)
  } catch (error) {
    if (!runtime.signal.aborted) {
      throw error
    }
    // The start may have landed before the signal; record the attempt as
    // interrupted so it cannot hold the fixture lock.
    try {
      await runtime.api.start(
        { ...startPayload, interruptedAt: Date.now() },
        AbortSignal.timeout(INTERRUPTED_FINISH_TIMEOUT_MS)
      )
    } catch (recoveryError) {
      reportCleanupError(recoveryError)
    }
    throw runtime.signal.reason
  }

  runtime.write(
    `Fixture ${fixture.slug}: ${kind} (${executor}) in ${runtime.environment.name}\n`
  )

  let executed: ExecutedOperation
  try {
    executed =
      executor === "hook"
        ? await runHookOperation(runtime, fixture, kind, hook!)
        : await runAgentOperation(runtime, fixture, kind)
  } catch (error) {
    if (runtime.signal.aborted) {
      try {
        await runtime.api.finish(
          operation.id,
          {
            attemptId,
            status: "interrupted",
            checkResults: [],
            summary: "Interrupted by a signal.",
          },
          AbortSignal.timeout(INTERRUPTED_FINISH_TIMEOUT_MS)
        )
      } catch (finishError) {
        reportCleanupError(finishError)
      }
      throw runtime.signal.reason
    }
    executed = {
      status: "failed",
      checkResults: [],
      summary: clipSummary(
        redactValues(
          errorMessage(error, "Fixture operation failed."),
          collectSecretValues(runtime.secrets)
        )
      ),
    }
  }

  const finishPayload: FinishFixtureOperationRequest = {
    attemptId,
    status: executed.status,
    checkResults: executed.checkResults,
    summary: executed.summary,
  }
  let finished: FixtureOperation
  try {
    finished = await runtime.api.finish(
      operation.id,
      finishPayload,
      runtime.signal
    )
  } catch (error) {
    if (!runtime.signal.aborted) {
      throw error
    }
    // An identical retry is idempotent, so a lost response is harmless.
    try {
      await runtime.api.finish(
        operation.id,
        finishPayload,
        AbortSignal.timeout(INTERRUPTED_FINISH_TIMEOUT_MS)
      )
    } catch (retryError) {
      reportCleanupError(retryError)
    }
    throw runtime.signal.reason
  }

  return { ...executed, kind, executor, operation: finished }
}

export function formatOperationOutcome(
  fixture: Pick<Fixture, "slug">,
  outcome: FixtureOperationOutcome
) {
  const verdict =
    outcome.kind === "verify"
      ? outcome.status === "succeeded"
        ? "healthy"
        : "unhealthy"
      : outcome.status
  const lines = [`  ${fixture.slug} ${outcome.kind}: ${verdict}`]
  if (outcome.status === "failed") {
    const failing = outcome.checkResults.filter(
      (result) => result.verdict !== "passed"
    )
    for (const result of failing) {
      lines.push(`    ${result.verdict}: ${result.name}: ${result.evidence}`)
    }
    if (failing.length === 0 && outcome.summary) {
      lines.push(
        ...clipText(outcome.summary, 600)
          .split("\n")
          .map((line) => `    ${line}`)
      )
    }
  }
  return `${lines.join("\n")}\n`
}

export type MaintenanceResult = {
  fixture: Fixture
  maintenance: FixtureOperationOutcome | null
  verify: FixtureOperationOutcome
  healthy: boolean
}

export async function verifyFixture(
  runtime: FixtureRuntime,
  fixture: Fixture,
  options: { runId?: string | null; hooksPath?: string | null } = {}
) {
  const verify = await executeFixtureOperation(
    runtime,
    fixture,
    "verify",
    options
  )
  runtime.write(formatOperationOutcome(fixture, verify))
  return verify
}

/** Converge or reset, then always verify. */
export async function maintainFixture(
  runtime: FixtureRuntime,
  fixture: Fixture,
  kind: "converge" | "reset",
  options: { runId?: string | null; hooksPath?: string | null } = {}
): Promise<MaintenanceResult> {
  const maintenance = await executeFixtureOperation(
    runtime,
    fixture,
    kind,
    options
  )
  runtime.write(formatOperationOutcome(fixture, maintenance))
  const verify = await verifyFixture(runtime, fixture, options)
  return {
    fixture,
    maintenance,
    verify,
    healthy: verify.status === "succeeded",
  }
}

/** Every fixture the scenarios require, in first-use order. */
export function collectRequiredFixtures(
  scenarios: Array<{ fixtureRequirements: EffectiveFixtureRequirement[] }>,
  fixtures: Fixture[]
): Fixture[] {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  const required = new Map<string, Fixture>()
  for (const scenario of scenarios) {
    for (const requirement of scenario.fixtureRequirements) {
      if (required.has(requirement.fixtureId)) {
        continue
      }
      const fixture = byId.get(requirement.fixtureId)
      if (!fixture) {
        throw new Error(
          `The execution plan does not define required fixture ${requirement.fixtureId}.`
        )
      }
      required.set(fixture.id, fixture)
    }
  }
  return [...required.values()]
}

/** Fixtures that an executed scenario was allowed to change. */
export function selectPostRunResetFixtures(
  executedScenarios: Array<{
    fixtureRequirements: EffectiveFixtureRequirement[]
  }>,
  fixtures: Fixture[]
): Fixture[] {
  return collectRequiredFixtures(
    executedScenarios.map((scenario) => ({
      fixtureRequirements: scenario.fixtureRequirements.filter(
        (requirement) => requirement.access === "mutates"
      ),
    })),
    fixtures
  )
}

export type FixturePreflightEntry = {
  fixtureId: string
  outcome: FixturePreflightOutcome
  operationId: string | null
}

export type FixturePreflightResult =
  | { ok: true; entries: FixturePreflightEntry[] }
  | { ok: false; unhealthy: Fixture[] }

/**
 * Verifies every required fixture before a run is created. `repair`
 * converges an unhealthy fixture and verifies it again; `skip` runs no
 * operations.
 */
export async function runFixturePreflight(
  runtime: FixtureRuntime,
  fixtures: Fixture[],
  mode: FixtureMode,
  options: { hooksPath?: string | null } = {}
): Promise<FixturePreflightResult> {
  if (fixtures.length === 0) {
    return { ok: true, entries: [] }
  }
  runtime.write(
    `\nFixture preflight (${mode}) in ${runtime.environment.name}\n`
  )
  if (mode === "skip") {
    for (const fixture of fixtures) {
      runtime.write(`  ${fixture.slug}: skipped\n`)
    }
    return {
      ok: true,
      entries: fixtures.map((fixture) => ({
        fixtureId: fixture.id,
        outcome: "skipped",
        operationId: null,
      })),
    }
  }

  const unavailable = fixtures.filter(
    (fixture) =>
      selectFixtureExecutor(
        fixture,
        "verify",
        getFixtureHook(runtime.hooks, fixture.slug)
      ) === null
  )
  if (unavailable.length > 0) {
    throw new FixtureOperationUnavailableError(
      unavailable
        .map((fixture) =>
          unavailableOperationMessage(
            fixture,
            "verify",
            options.hooksPath ?? null
          )
        )
        .join("\n")
    )
  }

  const entries: FixturePreflightEntry[] = []
  const unhealthy: Fixture[] = []
  for (const fixture of fixtures) {
    const verify = await verifyFixture(runtime, fixture, options)
    if (verify.status === "succeeded") {
      entries.push({
        fixtureId: fixture.id,
        outcome: "healthy",
        operationId: verify.operation.id,
      })
      continue
    }
    if (mode !== "repair") {
      unhealthy.push(fixture)
      continue
    }
    if (
      selectFixtureExecutor(
        fixture,
        "converge",
        getFixtureHook(runtime.hooks, fixture.slug)
      ) === null
    ) {
      runtime.write(
        `  ${unavailableOperationMessage(fixture, "converge", options.hooksPath ?? null)}\n`
      )
      unhealthy.push(fixture)
      continue
    }
    const repaired = await maintainFixture(
      runtime,
      fixture,
      "converge",
      options
    )
    if (repaired.healthy) {
      entries.push({
        fixtureId: fixture.id,
        outcome: "repaired",
        operationId: repaired.verify.operation.id,
      })
    } else {
      unhealthy.push(fixture)
    }
  }

  return unhealthy.length > 0 ? { ok: false, unhealthy } : { ok: true, entries }
}

export function formatPreflightAbort(
  unhealthy: Fixture[],
  mode: FixtureMode,
  environment: string
) {
  const slugs = unhealthy.map((fixture) => fixture.slug).join(", ")
  const hint =
    mode === "repair"
      ? "Repair did not make them healthy. Inspect them, then run `caracara fixtures:converge <slug>`."
      : "Run `caracara run --fixtures repair` or `caracara fixtures:converge <slug>` to repair them, or pass `--fixtures skip` to run anyway."
  return `Fixture preflight failed in ${environment}: ${slugs} ${unhealthy.length === 1 ? "is" : "are"} unhealthy. No run was created.\n${hint}\n`
}

/**
 * Resets (when available) and verifies each fixture that the run was
 * allowed to change. Failures are reported but never change the run.
 */
export async function runPostRunMaintenance(
  runtime: FixtureRuntime,
  fixtures: Fixture[],
  runId: string,
  options: { hooksPath?: string | null } = {}
) {
  if (fixtures.length === 0) {
    return []
  }
  runtime.write(`\nPost-run fixture maintenance in ${runtime.environment.name}\n`)
  const results: Array<{ fixture: Fixture; healthy: boolean }> = []
  for (const fixture of fixtures) {
    const hook = getFixtureHook(runtime.hooks, fixture.slug)
    try {
      if (selectFixtureExecutor(fixture, "reset", hook)) {
        const result = await maintainFixture(runtime, fixture, "reset", {
          ...options,
          runId,
        })
        results.push({ fixture, healthy: result.healthy })
      } else if (selectFixtureExecutor(fixture, "verify", hook)) {
        runtime.write(
          `  ${fixture.slug}: no reset hook or reset instructions; verifying only.\n`
        )
        const verify = await verifyFixture(runtime, fixture, {
          ...options,
          runId,
        })
        results.push({ fixture, healthy: verify.status === "succeeded" })
      } else {
        runtime.write(
          `  ${fixture.slug}: no reset or verify is available; its state is unknown.\n`
        )
        results.push({ fixture, healthy: false })
      }
    } catch (error) {
      if (runtime.signal.aborted) {
        throw error
      }
      runtime.write(
        `  ${fixture.slug}: maintenance failed: ${errorMessage(error, "unknown error")}\n`
      )
      results.push({ fixture, healthy: false })
    }
  }
  const unhealthy = results.filter((result) => !result.healthy)
  if (unhealthy.length > 0) {
    runtime.write(
      `Warning: ${unhealthy.map((result) => result.fixture.slug).join(", ")} ${unhealthy.length === 1 ? "is" : "are"} not healthy after this run. The next run's preflight will stop until ${unhealthy.length === 1 ? "it is" : "they are"} repaired (\`caracara fixtures:converge <slug>\`). The run result is unchanged.\n`
    )
  }
  return results
}
