import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

import {
  BLOCKED_REASONS,
  FIXTURE_OPERATION_SUMMARY_MAX_LENGTH,
} from "@workspace/contracts"
import type {
  BlockedReason,
  CheckResult,
  EvaluationCheck,
  FixtureOperationCheckResult,
  OrderedScenario,
  RunnerType,
} from "@workspace/contracts"

import {
  checkCodexVersion,
  CodexClient,
  getCodexVersion,
  resolveCodexExecutable,
  type CodexClientOptions,
  type CodexItemEvent,
  type CodexSandboxMode,
  type CodexThreadOptions,
  type CodexUsage,
} from "./codex-exec.js"
import { startCdpWindowProxy } from "./cdp-proxy.js"
import type { ModelReasoningEffort } from "./config.js"
import { writeDiagnostic } from "./diagnostics.js"
import {
  buildProtectedFixturesSection,
  type ProtectedFixture,
} from "./fixture-prompts.js"
import {
  buildWindowsTaskkillArgs,
  terminateChildProcess,
} from "./process-control.js"
import { collectSecretValues, redactValues } from "./redaction.js"
import { toSingleLine, truncateToWidth } from "./terminal-text.js"

export { buildWindowsTaskkillArgs, terminateChildProcess }

export type RunnerExecution = {
  executionSummary: string
  checkResults: CheckResult[]
  screenshotEvidence?: ScreenshotEvidence[]
  usage?: RunnerUsageReport
}

export type RunnerUsage = {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  estimatedCostUsd: number | null
}

export type RunnerUsageReport = {
  usage?: RunnerUsage
  complete: boolean
}

export class RunnerExecutionError extends Error {
  constructor(
    message: string,
    readonly usage: RunnerUsageReport
  ) {
    super(message)
    this.name = "RunnerExecutionError"
  }
}

export type ScreenshotEvidence = {
  checkId: string
  bytes: Uint8Array
  byteSize: number
  sha256: string
}

/** One step of the agent's work, reduced to a short, redacted label. */
export type RunnerActivity = {
  /** Runner item ID, so a step that starts and completes counts once. */
  id: string | null
  label: string
  /** Commands, MCP tools, web searches and file edits. */
  toolCall: boolean
  status: "started" | "completed"
}

export type RunnerScenarioInput = {
  cwd: string
  environment: string
  targetUrl: string
  projectPrompt: string
  scenario: OrderedScenario
  /** Fixtures the scenario requires, shown as protected in the prompt. */
  fixtures?: ProtectedFixture[]
  signal?: AbortSignal
  /** Called for agent steps when the runner can report them live. */
  onActivity?: (activity: RunnerActivity) => void
}

/** One single-turn fixture maintenance task (verify, a converge step, or reset). */
export type FixtureTaskInput = {
  cwd: string
  prompt: string
  checks: EvaluationCheck[]
  signal?: AbortSignal
}

export type FixtureTaskExecution = {
  summary: string
  checkResults: FixtureOperationCheckResult[]
  usage: RunnerUsageReport
}

export type RunnerSecrets = Record<string, string>

type RunnerStartInput = {
  cwd: string
  secrets: RunnerSecrets
  targetUrl: string
  model?: string
  modelReasoningEffort?: ModelReasoningEffort
  signal?: AbortSignal
}

export interface RunnerAdapter {
  type: RunnerType
  /** Checks local prerequisites before the run is created on the server. */
  preflight?(): Promise<void>
  startRun(input: RunnerStartInput): Promise<RunnerSession>
}

export interface RunnerSession {
  executeScenario(input: RunnerScenarioInput): Promise<RunnerExecution>
  /** Runs one fixture maintenance turn: no blocked retry and no screenshots. */
  executeFixtureTask(input: FixtureTaskInput): Promise<FixtureTaskExecution>
  /** False once the session can no longer run scenarios (browser exited). */
  isHealthy?(): boolean
  close(): Promise<void>
}

function buildResultSchema(checkIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["executionSummary", "checkResults"],
    properties: {
      executionSummary: { type: "string", minLength: 1 },
      checkResults: {
        type: "array",
        minItems: checkIds.length,
        maxItems: checkIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["checkId", "verdict", "evidence", "blockedReason"],
          properties: {
            checkId: {
              type: "string",
              enum: checkIds,
            },
            verdict: {
              type: "string",
              enum: ["passed", "failed", "blocked"],
            },
            evidence: { type: "string", minLength: 1, maxLength: 2_000 },
            blockedReason: {
              anyOf: [
                { type: "string", enum: BLOCKED_REASONS },
                { type: "null" },
              ],
            },
          },
        },
      },
    },
  } as const
}

export function buildExecutionResultSchema(scenario: OrderedScenario) {
  return buildResultSchema(scenario.evaluationChecks.map((check) => check.id))
}

export function buildBlockedRetryResultSchema(blockedCheckIds: string[]) {
  return buildResultSchema(blockedCheckIds)
}

function validateExecution(expectedIds: string[], execution: RunnerExecution) {
  const returnedIds = execution.checkResults.map((result) => result.checkId)
  const hasInvalidVerdict = execution.checkResults.some(
    (result) =>
      !["passed", "failed", "blocked"].includes(result.verdict) ||
      (result.verdict === "blocked"
        ? !BLOCKED_REASONS.includes(result.blockedReason as BlockedReason)
        : result.blockedReason !== null)
  )
  if (
    execution.executionSummary.trim() === "" ||
    returnedIds.length !== expectedIds.length ||
    new Set(returnedIds).size !== returnedIds.length ||
    expectedIds.some((id) => !returnedIds.includes(id)) ||
    execution.checkResults.some((result) => result.evidence.trim() === "") ||
    hasInvalidVerdict
  ) {
    throw new Error("Runner output did not account for every evaluation check.")
  }

  return {
    executionSummary: execution.executionSummary.trim(),
    checkResults: execution.checkResults.map((result) => ({
      ...result,
      evidence: result.evidence.trim(),
    })),
  }
}

export function validateRunnerExecution(
  scenario: OrderedScenario,
  execution: RunnerExecution
) {
  const expectedIds = scenario.evaluationChecks.map((check) => check.id)
  return validateExecution(expectedIds, execution)
}

export function validateBlockedRetryExecution(
  blockedCheckIds: string[],
  execution: RunnerExecution
) {
  return validateExecution(blockedCheckIds, execution)
}

export function mergeBlockedRetryExecution(
  initial: RunnerExecution,
  retry: RunnerExecution
): RunnerExecution {
  const retryResults = new Map(
    retry.checkResults.map((result) => [result.checkId, result])
  )
  return {
    executionSummary: `${initial.executionSummary}\nBlocked-check retry: ${retry.executionSummary}`,
    checkResults: initial.checkResults.map(
      (result) => retryResults.get(result.checkId) ?? result
    ),
  }
}

export function buildFixtureTaskResultSchema(checkIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "checkResults"],
    properties: {
      summary: { type: "string", minLength: 1 },
      checkResults: {
        type: "array",
        minItems: checkIds.length,
        maxItems: checkIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["checkId", "verdict", "evidence"],
          properties: {
            // An empty enum is not a valid schema; a task without checks
            // returns an empty array anyway.
            checkId:
              checkIds.length > 0
                ? { type: "string", enum: checkIds }
                : { type: "string" },
            verdict: {
              type: "string",
              enum: ["passed", "failed", "blocked"],
            },
            evidence: { type: "string", minLength: 1, maxLength: 2_000 },
          },
        },
      },
    },
  } as const
}

type FixtureTaskOutput = {
  summary: string
  checkResults: Array<{ checkId: string; verdict: string; evidence: string }>
}

function clipEnd(text: string, limit: number) {
  return text.length <= limit ? text : text.slice(0, limit)
}

/**
 * Validates one fixture task's output and redacts it. `secretValues` must
 * include inherited CARACARA_SECRET_* values, not only secrets.env.
 */
export function validateFixtureTaskOutput(
  checks: EvaluationCheck[],
  output: unknown,
  secretValues: readonly string[]
): Omit<FixtureTaskExecution, "usage"> {
  const candidate = output as Partial<FixtureTaskOutput> | null
  const results = Array.isArray(candidate?.checkResults)
    ? candidate.checkResults
    : null
  const returnedIds = results?.map((result) => result?.checkId) ?? []
  if (
    typeof candidate?.summary !== "string" ||
    candidate.summary.trim() === "" ||
    !results ||
    returnedIds.length !== checks.length ||
    new Set(returnedIds).size !== returnedIds.length ||
    checks.some((check) => !returnedIds.includes(check.id)) ||
    results.some(
      (result) =>
        typeof result?.evidence !== "string" ||
        result.evidence.trim() === "" ||
        !["passed", "failed", "blocked"].includes(result.verdict)
    )
  ) {
    throw new Error("Runner output did not account for every fixture check.")
  }

  const byId = new Map(results.map((result) => [result.checkId, result]))
  return {
    summary: clipEnd(
      redactValues(candidate.summary.trim(), secretValues),
      FIXTURE_OPERATION_SUMMARY_MAX_LENGTH
    ),
    checkResults: checks.map((check) => {
      const result = byId.get(check.id)!
      return {
        checkId: check.id,
        name: check.name,
        verdict: result.verdict as FixtureOperationCheckResult["verdict"],
        evidence: clipEnd(
          redactValues(result.evidence.trim(), secretValues),
          2_000
        ),
      }
    }),
  }
}

/** Runs one structured turn and returns its parsed output and usage. */
type FixtureTurn = (input: {
  cwd: string
  prompt: string
  outputSchema: ReturnType<typeof buildFixtureTaskResultSchema>
  signal?: AbortSignal
}) => Promise<{ output: unknown; usage: RunnerUsageReport }>

/**
 * The runner-independent part of a fixture task. Each runner supplies only
 * how a single structured turn is invoked.
 */
export async function executeFixtureTaskWithTurn(
  turn: FixtureTurn,
  input: FixtureTaskInput,
  secrets: RunnerSecrets,
  env: NodeJS.ProcessEnv = process.env
): Promise<FixtureTaskExecution> {
  const secretValues = collectSecretValues(secrets, env)
  let usage: RunnerUsageReport = { complete: false }
  try {
    const result = await turn({
      cwd: input.cwd,
      prompt: input.prompt,
      outputSchema: buildFixtureTaskResultSchema(
        input.checks.map((check) => check.id)
      ),
      signal: input.signal,
    })
    usage = result.usage
    return {
      ...validateFixtureTaskOutput(input.checks, result.output, secretValues),
      usage,
    }
  } catch (error) {
    throw new RunnerExecutionError(
      redactValues(
        error instanceof Error ? error.message : "Fixture task failed.",
        secretValues
      ),
      usage
    )
  }
}

const defaultCodexSandbox = "read-only"
const defaultChromeExecutablePath = "/usr/bin/chromium"
const defaultChromiumStartupTimeoutMs = 15_000

const codexPricingPerMillionTokens: Record<
  string,
  {
    input: number
    cachedInput: number
    cacheWriteInput: number
    output: number
  }
> = {
  "gpt-5.6": { input: 4, cachedInput: 0.4, cacheWriteInput: 5, output: 20 },
  "gpt-5.6-sol": {
    input: 4,
    cachedInput: 0.4,
    cacheWriteInput: 5,
    output: 20,
  },
  "gpt-5.6-terra": {
    input: 2,
    cachedInput: 0.2,
    cacheWriteInput: 2.5,
    output: 12,
  },
  "gpt-5.6-luna": {
    input: 0.2,
    cachedInput: 0.02,
    cacheWriteInput: 0.25,
    output: 1.2,
  },
}

export function toCodexRunnerUsage(
  usage: CodexUsage | null,
  model?: string
): RunnerUsage | undefined {
  if (!usage) {
    return undefined
  }

  const pricing = model ? codexPricingPerMillionTokens[model] : undefined
  const uncachedInputTokens = Math.max(
    0,
    usage.input_tokens -
      usage.cached_input_tokens -
      usage.cache_write_input_tokens
  )
  const estimatedCostUsd = pricing
    ? (uncachedInputTokens * pricing.input +
        usage.cached_input_tokens * pricing.cachedInput +
        usage.cache_write_input_tokens * pricing.cacheWriteInput +
        usage.output_tokens * pricing.output) /
      1_000_000
    : null

  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    estimatedCostUsd,
  }
}

export function mergeRunnerUsage(
  current: RunnerUsageReport,
  next: RunnerUsageReport
): RunnerUsageReport {
  const currentUsage = current.usage
  const nextUsage = next.usage

  if (!currentUsage || !nextUsage) {
    return {
      usage: currentUsage ?? nextUsage,
      complete: current.complete && next.complete,
    }
  }

  return {
    usage: {
      inputTokens: currentUsage.inputTokens + nextUsage.inputTokens,
      cachedInputTokens:
        currentUsage.cachedInputTokens + nextUsage.cachedInputTokens,
      cacheWriteInputTokens:
        currentUsage.cacheWriteInputTokens + nextUsage.cacheWriteInputTokens,
      outputTokens: currentUsage.outputTokens + nextUsage.outputTokens,
      reasoningOutputTokens:
        currentUsage.reasoningOutputTokens + nextUsage.reasoningOutputTokens,
      estimatedCostUsd:
        currentUsage.estimatedCostUsd === null ||
        nextUsage.estimatedCostUsd === null
          ? null
          : currentUsage.estimatedCostUsd + nextUsage.estimatedCostUsd,
    },
    complete: current.complete && next.complete,
  }
}

const tokenNumber = new Intl.NumberFormat("en-US")

export function formatRunnerUsage(report: RunnerUsageReport) {
  const usage = report.usage
  if (!usage) {
    return "Tokens: unavailable (runner usage incomplete)\nEstimated API-equivalent cost: unavailable"
  }

  const inputDetails = [
    `${tokenNumber.format(usage.cachedInputTokens)} cached`,
    ...(usage.cacheWriteInputTokens > 0
      ? [`${tokenNumber.format(usage.cacheWriteInputTokens)} cache write`]
      : []),
  ].join(", ")
  const outputDetails =
    usage.reasoningOutputTokens > 0
      ? `, ${tokenNumber.format(usage.reasoningOutputTokens)} reasoning`
      : ""
  const totalTokens = usage.inputTokens + usage.outputTokens
  const tokens = `Tokens: ${tokenNumber.format(totalTokens)} total${report.complete ? "" : " (partial)"} (${tokenNumber.format(usage.inputTokens)} input, ${inputDetails}; ${tokenNumber.format(usage.outputTokens)} output${outputDetails})`
  const cost = !report.complete
    ? "Estimated API-equivalent cost: unavailable because token usage is incomplete"
    : usage.estimatedCostUsd === null
      ? "Estimated API-equivalent cost: unavailable for this model"
      : `Estimated API-equivalent cost: $${usage.estimatedCostUsd.toFixed(4)}`

  return `${tokens}\n${cost}`
}

type ClaudeJsonResult = {
  structured_output?: unknown
  result?: unknown
  total_cost_usd?: unknown
  usage?: {
    input_tokens?: unknown
    cache_read_input_tokens?: unknown
    cache_creation_input_tokens?: unknown
    output_tokens?: unknown
  }
}

function nonnegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

export function parseClaudeJsonResult(stdout: string) {
  const result = JSON.parse(stdout) as ClaudeJsonResult
  let execution: unknown = result.structured_output ?? result
  if (execution === result && typeof result.result === "string") {
    try {
      execution = JSON.parse(result.result) as unknown
    } catch {
      // The validation error below is more useful than a nested JSON parse error.
    }
  }

  const usage = result.usage
  const cachedInputTokens = nonnegativeNumber(usage?.cache_read_input_tokens)
  const cacheWriteInputTokens = nonnegativeNumber(
    usage?.cache_creation_input_tokens
  )
  const uncachedInputTokens = nonnegativeNumber(usage?.input_tokens)
  const outputTokens = nonnegativeNumber(usage?.output_tokens)
  const estimatedCostUsd =
    typeof result.total_cost_usd === "number" &&
    Number.isFinite(result.total_cost_usd) &&
    result.total_cost_usd >= 0
      ? result.total_cost_usd
      : null

  return {
    execution: execution as RunnerExecution,
    usage: usage
      ? {
          inputTokens:
            uncachedInputTokens + cachedInputTokens + cacheWriteInputTokens,
          cachedInputTokens,
          cacheWriteInputTokens,
          outputTokens,
          reasoningOutputTokens: 0,
          estimatedCostUsd,
        }
      : undefined,
  }
}

export function buildRunnerPrompt(input: {
  environment: string
  targetUrl: string
  projectPrompt: string
  scenario: OrderedScenario
  fixtures?: ProtectedFixture[]
  secretNames?: string[]
  evidenceDirectory?: string
}) {
  const secretNames = [...(input.secretNames ?? [])].sort()

  return [
    "You are executing a Caracara evaluation scenario against an application.",
    "",
    `Target environment: ${input.environment}`,
    `Application URL: ${input.targetUrl}`,
    "Use this URL as the application origin. If project or scenario text names another origin, keep its path but use the URL above.",
    "",
    "Project context:",
    input.projectPrompt.trim(),
    ...buildProtectedFixturesSection(input.fixtures),
    "",
    `Scenario: ${input.scenario.name} (${input.scenario.slug})`,
    "",
    "Task instructions:",
    input.scenario.instructions.trim(),
    "",
    "Evaluation checks:",
    ...input.scenario.evaluationChecks.flatMap((check) => [
      `- ${check.name} [${check.id}]`,
      `  Expected: ${check.expectation}`,
      ...(input.evidenceDirectory
        ? [
            `  Failure screenshot: ${join(input.evidenceDirectory, `${check.id}.webp`)}`,
          ]
        : []),
    ]),
    ...(secretNames.length > 0
      ? [
          "",
          "Local secret environment variables available to this run:",
          ...secretNames.map((name) => `- ${name}`),
          "Read a secret only when the task requires it. Never repeat secret values in the execution summary, evidence, or other user-facing output.",
        ]
      : []),
    "",
    "Use the Chrome DevTools browser tools to perform the task once and inspect the actual frontend.",
    "Before interacting, review every evaluation check and plan the browser states and actions needed to observe each one. Preserve or revisit relevant states so later checks are not skipped.",
    "Return JSON with a concise executionSummary and exactly one checkResults entry per check ID.",
    'Use verdict "passed" when browser evidence confirms the expectation, "failed" when observed behavior contradicts it, and "blocked" when you could not reach or inspect it.',
    'For "blocked", set blockedReason to exactly one of: "blocked_by_check", "setup_incomplete", "environment_failure", or "tool_limit". Set blockedReason to null for passed and failed checks.',
    'Do not use "blocked" when the behavior you saw contradicts the expectation. If an earlier failed check prevents a later check from being observed, use "blocked" with "blocked_by_check" and identify the blocking check or behavior.',
    ...(input.evidenceDirectory
      ? [
          "For every failed check, put the browser in the state that demonstrates the failure. Scroll to the relevant region and remove unrelated overlays.",
          "Call chrome-devtools take_screenshot without a filePath, with format webp, quality 80, and fullPage false, so you can visually inspect the returned image. Capture the visible viewport without a uid.",
          "Inspect the image itself. Confirm that the failed behavior is clearly visible and that enough surrounding UI is shown to understand the problem. For a missing element, show the region where it should appear.",
          "If the image does not clearly show the defect, adjust the browser and repeat the preview screenshot. Do not save an unrelated, overly broad, obscured, or unreadable screenshot.",
          "Only after visually confirming the image, call take_screenshot again with the exact failure screenshot path listed for that check, using the same visible viewport without a uid, format webp, quality 80, and fullPage false.",
          "A failed check is incomplete without its screenshot. Do not capture screenshots for passed or blocked checks. Never include screenshot paths or image bytes in the JSON response.",
        ]
      : []),
    'For every failed check, write the evidence as: "Attempted: <specific action and expected result>. Failed: <exact observed behavior, including the relevant page, control, value, or visible message>."',
    'For every blocked check, write the evidence as: "Attempted: <specific action and expected state>. Blocked: <exact reason the state or evidence could not be reached, including any earlier failed check or browser-tool limitation>."',
    'Do not merely restate the check or use vague phrases such as "did not work", "unexpected behavior", or "the check failed".',
    "Every verdict needs concise, concrete browser evidence. Do not calculate or return a score.",
  ].join("\n")
}

export function buildBlockedRetryPrompt(input: {
  environment: string
  targetUrl: string
  projectPrompt: string
  scenario: OrderedScenario
  blockedResults: CheckResult[]
  fixtures?: ProtectedFixture[]
  secretNames?: string[]
  evidenceDirectory?: string
}) {
  const secretNames = [...(input.secretNames ?? [])].sort()
  const blockedById = new Map(
    input.blockedResults.map((result) => [result.checkId, result])
  )
  const checks = input.scenario.evaluationChecks.filter((check) =>
    blockedById.has(check.id)
  )

  return [
    "Retry only the blocked evaluation checks below exactly once.",
    "",
    `Target environment: ${input.environment}`,
    `Application URL: ${input.targetUrl}`,
    "Use this URL as the application origin. If project or scenario text names another origin, keep its path but use the URL above.",
    "",
    "Project context:",
    input.projectPrompt.trim(),
    ...buildProtectedFixturesSection(input.fixtures),
    "",
    "Task instructions:",
    input.scenario.instructions.trim(),
    ...(secretNames.length > 0
      ? [
          "",
          "Local secret environment variables available to this retry:",
          ...secretNames.map((name) => `- ${name}`),
          "Read a secret only when the retry requires it. Never repeat secret values in the execution summary, evidence, or other user-facing output.",
        ]
      : []),
    "",
    "Use the current browser state. Make one reasonable, safe recovery attempt appropriate to the structured reason, such as navigating back, reloading, reopening the relevant control, or retrying the inspection.",
    "Do not repeat destructive state-changing actions and do not rerun checks that already passed or failed.",
    "Return JSON with a concise executionSummary and exactly one checkResults entry for each listed check ID.",
    'Use only "passed", "failed", or "blocked". Set blockedReason to null for passed and failed; for blocked, set it to "blocked_by_check", "setup_incomplete", "environment_failure", or "tool_limit".',
    ...checks.flatMap((check) => {
      const result = blockedById.get(check.id)!
      return [
        `- ${check.name} [${check.id}]`,
        `  Expected: ${check.expectation}`,
        `  Previous reason: ${result.blockedReason}`,
        `  Previous evidence: ${result.evidence}`,
        ...(input.evidenceDirectory
          ? [
              `  Failure screenshot if the retry observes a failure: ${join(input.evidenceDirectory, `${check.id}.webp`)}`,
            ]
          : []),
      ]
    }),
    ...(input.evidenceDirectory
      ? [
          "If a retry changes a check to failed, put the browser in the state that demonstrates the failure and capture the visible viewport only.",
          "First call chrome-devtools take_screenshot without a filePath, with format webp, quality 80, and fullPage false. Inspect the image itself and adjust the browser until the defect and enough surrounding context are clearly visible.",
          "Only then call take_screenshot again with the listed failure screenshot path, using the same visible viewport without a uid, format webp, quality 80, and fullPage false.",
        ]
      : []),
    'For failed evidence use: "Attempted: <specific action and expected result>. Failed: <exact observed behavior>."',
    'For blocked evidence use: "Attempted: <specific action and expected state>. Blocked: <exact reason the state or evidence still could not be reached>."',
    "This is the only retry. Report the final observed result for each listed check.",
  ].join("\n")
}

export function buildMissingScreenshotPrompt(input: {
  scenario: OrderedScenario
  evidenceDirectory: string
  missingCheckIds: string[]
}) {
  const checks = input.scenario.evaluationChecks.filter((check) =>
    input.missingCheckIds.includes(check.id)
  )
  return [
    "Required screenshot evidence is missing for the failed checks below.",
    "Do not repeat the scenario. Use the current browser state and put the relevant failure region in view.",
    "For each check, call chrome-devtools take_screenshot without a filePath, with format webp, quality 80, and fullPage false, and visually inspect the returned image. Capture the visible viewport without a uid.",
    "If the image does not clearly show the defect and enough surrounding context, adjust the browser and repeat the preview screenshot.",
    "Only after visually confirming the image, call take_screenshot again with the listed path, using the same visible viewport without a uid, format webp, quality 80, and fullPage false.",
    ...checks.map(
      (check) =>
        `- ${check.name} [${check.id}]: ${join(input.evidenceDirectory, `${check.id}.webp`)}`
    ),
    "Do not include secret values, screenshot paths, or image bytes in your response.",
  ].join("\n")
}

const maxScreenshotBytes = 3 * 1024 * 1024

export function hasWebpSignature(bytes: Uint8Array) {
  return (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  )
}

async function readScreenshotEvidence(input: {
  evidenceDirectory: string
  checkIds: string[]
}) {
  const evidence: ScreenshotEvidence[] = []
  const missingCheckIds: string[] = []

  for (const checkId of input.checkIds) {
    const path = join(input.evidenceDirectory, `${checkId}.webp`)
    try {
      const bytes = await readFile(path)
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > maxScreenshotBytes ||
        !hasWebpSignature(bytes)
      ) {
        await rm(path, { force: true })
        missingCheckIds.push(checkId)
        continue
      }
      evidence.push({
        checkId,
        bytes,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
      missingCheckIds.push(checkId)
    }
  }

  return { evidence, missingCheckIds }
}

export function redactSecretValues(text: string, secrets: RunnerSecrets) {
  return [...new Set(Object.values(secrets))]
    .filter((secret) => secret !== "")
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
      text
    )
}

const COMMAND_LABEL_WIDTH = 80
const SHELL_WRAPPER =
  /^(?:\S*\/)?(?:bash|sh|zsh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$/

function redactForDisplay(text: string, secrets: RunnerSecrets) {
  const encoded = Object.fromEntries(
    Object.entries(secrets).map(([name, value]) => [
      `${name}__encoded`,
      encodeURIComponent(value),
    ])
  )
  return redactSecretValues(text, { ...secrets, ...encoded })
}

/**
 * Short label for a shell command. The whole command is redacted before it
 * is unwrapped or cut, so a secret is never split by truncation.
 */
export function formatCommandLabel(command: string, secrets: RunnerSecrets) {
  const redacted = redactForDisplay(command, secrets)
  const unwrapped = SHELL_WRAPPER.exec(redacted.trim())?.[2] ?? redacted
  const firstLine =
    unwrapped
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  return `$ ${truncateToWidth(toSingleLine(firstLine), COMMAND_LABEL_WIDTH)}`
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() !== ""
    ? toSingleLine(value)
    : null
}

/**
 * Maps a Codex item event to a runner activity. Only the item type and, for
 * tools, the tool name or redacted command are used; arguments, outputs and
 * reasoning text never leave this function.
 */
export function describeCodexItemEvent(
  event: CodexItemEvent,
  secrets: RunnerSecrets
): RunnerActivity | null {
  const { item } = event
  const status = event.type === "item.completed" ? "completed" : "started"
  const id = typeof item.id === "string" ? item.id : null
  const activity = (label: string, toolCall: boolean): RunnerActivity => ({
    id,
    label: truncateToWidth(label, COMMAND_LABEL_WIDTH + 2),
    toolCall,
    status,
  })

  switch (item.type) {
    case "mcp_tool_call": {
      const server = readString(item.server)
      const tool = readString(item.tool)
      return activity(
        server && tool ? `${server}.${tool}` : (tool ?? "tool call"),
        true
      )
    }
    case "command_execution": {
      const command = typeof item.command === "string" ? item.command : ""
      return activity(formatCommandLabel(command, secrets), true)
    }
    case "web_search":
      return activity("web search", true)
    case "file_change":
      return activity("editing files", true)
    case "reasoning":
      return activity("thinking", false)
    case "agent_message":
      return activity("writing result", false)
    default:
      return null
  }
}

export function redactRunnerExecution(
  execution: RunnerExecution,
  secrets: RunnerSecrets
) {
  return {
    executionSummary: redactSecretValues(execution.executionSummary, secrets),
    checkResults: execution.checkResults.map((result) => ({
      ...result,
      evidence: redactSecretValues(result.evidence, secrets),
    })),
  }
}

function redactEvidenceDirectory(
  execution: RunnerExecution,
  evidenceDirectory: string
) {
  return {
    executionSummary: execution.executionSummary
      .split(evidenceDirectory)
      .join("[LOCAL_EVIDENCE_DIR]"),
    checkResults: execution.checkResults.map((result) => ({
      ...result,
      evidence: result.evidence
        .split(evidenceDirectory)
        .join("[LOCAL_EVIDENCE_DIR]"),
    })),
  }
}

function getCodexSandboxMode(): CodexSandboxMode {
  const sandboxMode = process.env.CARACARA_CODEX_SANDBOX ?? defaultCodexSandbox

  if (
    sandboxMode !== "read-only" &&
    sandboxMode !== "workspace-write" &&
    sandboxMode !== "danger-full-access"
  ) {
    throw new Error(`Invalid CARACARA_CODEX_SANDBOX value: ${sandboxMode}.`)
  }

  return sandboxMode
}

function getChromeExecutablePath() {
  return (
    process.env.CARACARA_CODEX_CHROME_EXECUTABLE_PATH ??
    process.env.CHROME_EXECUTABLE_PATH ??
    defaultChromeExecutablePath
  )
}

export function buildCodexChromeMcpArgs(input: {
  logFilePath: string
  wsEndpoint: string
  workspaceRoot: string
}) {
  return [
    "-y",
    "chrome-devtools-mcp@latest",
    "--wsEndpoint",
    input.wsEndpoint,
    "--logFile",
    input.logFilePath,
    // Codex does not send MCP roots, so without this chrome-devtools-mcp only
    // lets file tools such as upload_file read from the OS temp directory.
    "--workspace",
    input.workspaceRoot,
  ]
}

function compactEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
}

export function buildCodexClientOptions(input: {
  env: NodeJS.ProcessEnv
  logFilePath: string
  wsEndpoint: string
  workspaceRoot: string
  modelReasoningEffort?: ModelReasoningEffort
}): CodexClientOptions {
  return {
    env: compactEnvironment(input.env),
    config: {
      mcp_servers: {
        "chrome-devtools": {
          command: "npx",
          args: buildCodexChromeMcpArgs({
            logFilePath: input.logFilePath,
            wsEndpoint: input.wsEndpoint,
            workspaceRoot: input.workspaceRoot,
          }),
          required: true,
          default_tools_approval_mode: "approve",
        },
        node_repl: {
          enabled: false,
        },
      },
      ...(input.modelReasoningEffort === "none"
        ? { model_reasoning_effort: "none" }
        : {}),
    },
  }
}

export function buildCodexThreadOptions(input: {
  cwd: string
  model?: string
  modelReasoningEffort?: ModelReasoningEffort
}): CodexThreadOptions {
  return {
    workingDirectory: input.cwd,
    skipGitRepoCheck: true,
    sandboxMode: getCodexSandboxMode(),
    approvalPolicy: "never",
    threadSource: "caracara",
    model: input.model,
    modelReasoningEffort:
      input.modelReasoningEffort === "none"
        ? undefined
        : input.modelReasoningEffort,
  }
}

export async function runChildCommand(args: {
  command: string
  commandArgs: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  secrets?: RunnerSecrets
  signal?: AbortSignal
}) {
  args.signal?.throwIfAborted()

  return await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      const detached = process.platform !== "win32"
      const child = spawn(args.command, args.commandArgs, {
        cwd: args.cwd,
        env: args.env,
        detached,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const childClosed = new Promise<void>((resolve) => {
        child.once("close", () => resolve())
      })

      let stdout = ""
      let stderr = ""
      let aborting = false
      let settled = false

      const finish = (complete: () => void) => {
        if (settled) {
          return
        }
        settled = true
        args.signal?.removeEventListener("abort", onAbort)
        complete()
      }
      const onAbort = () => {
        if (settled || aborting) {
          return
        }
        aborting = true
        void terminateChildProcess(child, detached, childClosed).then(
          () =>
            finish(() =>
              reject(args.signal?.reason ?? new Error("Command interrupted."))
            ),
          (error) => finish(() => reject(error))
        )
      }

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      child.on("error", (error) => finish(() => reject(error)))
      child.on("close", (code) => {
        if (aborting) {
          return
        }
        if (code === 0) {
          finish(() => resolve({ stdout, stderr }))
          return
        }

        finish(() =>
          reject(
            new Error(
              redactSecretValues(
                `${args.command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
                args.secrets ?? {}
              )
            )
          )
        )
      })

      args.signal?.addEventListener("abort", onAbort, { once: true })
      if (args.signal?.aborted) {
        onAbort()
      }
    }
  )
}

async function withTempFiles<T>(work: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "caracara-"))

  try {
    return await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function buildChromiumArgs(input: {
  userDataDir: string
  initialUrl?: string
}) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--ignore-certificate-errors",
    "--remote-debugging-port=0",
    `--user-data-dir=${input.userDataDir}`,
    input.initialUrl ?? "about:blank",
  ]
}

async function waitForDevToolsActivePort(input: {
  userDataDir: string
  browser: ChildProcess
  timeoutMs?: number
  signal?: AbortSignal
}) {
  const devToolsActivePortPath = join(input.userDataDir, "DevToolsActivePort")
  const timeoutMs = input.timeoutMs ?? defaultChromiumStartupTimeoutMs
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    input.signal?.throwIfAborted()
    if (input.browser.exitCode !== null) {
      throw new Error(
        `Chromium exited before DevTools became available (exit code ${input.browser.exitCode}).`
      )
    }

    try {
      const raw = await readFile(devToolsActivePortPath, "utf8")
      const [port, path] = raw.trim().split(/\r?\n/)

      if (port && path) {
        return {
          port,
          wsPath: path,
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    await delay(100, undefined, { signal: input.signal })
  }

  throw new Error(
    `Timed out waiting ${timeoutMs}ms for Chromium DevTools at ${devToolsActivePortPath}.`
  )
}

async function terminateBrowserProcess(browser: ChildProcess) {
  await terminateChildProcess(browser, process.platform !== "win32")
}

async function launchSharedChromium(input: {
  cwd: string
  initialUrl: string
  signal?: AbortSignal
}) {
  const runDir = await mkdtemp(join(tmpdir(), "caracara-codex-run-"))
  const userDataDir = join(runDir, "chrome-profile")
  const chromeDevtoolsLogPath = join(runDir, "chrome-devtools-mcp.log")
  await mkdir(userDataDir, { recursive: true })
  if (input.signal?.aborted) {
    await rm(runDir, { recursive: true, force: true })
    input.signal.throwIfAborted()
  }

  const browser = spawn(
    getChromeExecutablePath(),
    buildChromiumArgs({
      userDataDir,
      initialUrl: input.initialUrl,
    }),
    {
      cwd: input.cwd,
      detached: process.platform !== "win32",
      stdio: "ignore",
    }
  )

  const browserStartupError = new Promise<never>((_, reject) => {
    browser.once("error", reject)
  })

  try {
    const { port, wsPath } = await Promise.race([
      waitForDevToolsActivePort({
        userDataDir,
        browser,
        signal: input.signal,
      }),
      browserStartupError,
    ])
    const proxy = await startCdpWindowProxy(`ws://127.0.0.1:${port}${wsPath}`)

    return {
      wsEndpoint: proxy.wsEndpoint,
      chromeDevtoolsLogPath,
      isRunning() {
        return browser.exitCode === null && browser.signalCode === null
      },
      async close() {
        await proxy.close()
        await terminateBrowserProcess(browser)
        if (process.env.CARACARA_KEEP_RUN_DIR === "1") {
          // The profile holds the run's session cookies; delete it when done.
          writeDiagnostic(`Kept browser run directory: ${runDir}\n`)
          return
        }
        await rm(runDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await terminateBrowserProcess(browser).catch(() => undefined)
    await rm(runDir, { recursive: true, force: true })
    throw error
  }
}

class CodexRunner implements RunnerAdapter {
  readonly type = "codex" as const

  async preflight() {
    const executablePath = resolveCodexExecutable()
    const problem = checkCodexVersion(await getCodexVersion(executablePath))
    if (problem?.severity === "error") {
      throw new Error(problem.message)
    }
    if (problem) {
      writeDiagnostic(`Warning: ${problem.message}\n`)
    }
  }

  async startRun(input: RunnerStartInput) {
    // Resolve Codex before launching Chromium so a missing CLI fails fast.
    const executablePath = resolveCodexExecutable()
    const sharedBrowser = await launchSharedChromium({
      cwd: input.cwd,
      initialUrl: input.targetUrl,
      signal: input.signal,
    })
    const runnerEnv = { ...process.env, ...input.secrets }
    const secretNames = Object.keys(input.secrets)
    let codex: CodexClient
    try {
      codex = new CodexClient({
        ...buildCodexClientOptions({
          env: runnerEnv,
          logFilePath: sharedBrowser.chromeDevtoolsLogPath,
          wsEndpoint: sharedBrowser.wsEndpoint,
          workspaceRoot: input.cwd,
          modelReasoningEffort: input.modelReasoningEffort,
        }),
        executablePath,
      })
    } catch (error) {
      await sharedBrowser.close().catch(() => undefined)
      throw error
    }

    return {
      async executeScenario(scenarioInput: RunnerScenarioInput) {
        return await withTempFiles(async (dir) => {
          const evidenceDirectory = join(dir, "evidence")
          await mkdir(evidenceDirectory)
          let usage: RunnerUsageReport = { complete: true }
          let waitingForUsage = false
          const { onActivity } = scenarioInput
          const onItemEvent = onActivity
            ? (event: CodexItemEvent) => {
                const activity = describeCodexItemEvent(event, input.secrets)
                if (activity) {
                  onActivity(activity)
                }
              }
            : undefined
          try {
            const thread = codex.startThread(
              buildCodexThreadOptions({
                cwd: scenarioInput.cwd,
                model: input.model,
                modelReasoningEffort: input.modelReasoningEffort,
              })
            )
            waitingForUsage = true
            const turn = await thread.run(
              buildRunnerPrompt({
                ...scenarioInput,
                secretNames,
                evidenceDirectory,
              }),
              {
                outputSchema: buildExecutionResultSchema(
                  scenarioInput.scenario
                ),
                signal: scenarioInput.signal,
                onItemEvent,
              }
            )
            waitingForUsage = false
            const turnUsage = toCodexRunnerUsage(turn.usage, input.model)
            usage = mergeRunnerUsage(usage, {
              usage: turnUsage,
              complete: turnUsage !== undefined,
            })

            let validated = validateRunnerExecution(
              scenarioInput.scenario,
              JSON.parse(turn.finalResponse) as RunnerExecution
            )
            const blockedResults = validated.checkResults.filter(
              (result) => result.verdict === "blocked"
            )
            if (blockedResults.length > 0) {
              const blockedCheckIds = blockedResults.map(
                (result) => result.checkId
              )
              waitingForUsage = true
              const retry = await thread.run(
                buildBlockedRetryPrompt({
                  environment: scenarioInput.environment,
                  targetUrl: scenarioInput.targetUrl,
                  projectPrompt: scenarioInput.projectPrompt,
                  scenario: scenarioInput.scenario,
                  fixtures: scenarioInput.fixtures,
                  blockedResults,
                  secretNames,
                  evidenceDirectory,
                }),
                {
                  outputSchema: buildBlockedRetryResultSchema(blockedCheckIds),
                  signal: scenarioInput.signal,
                  onItemEvent,
                }
              )
              waitingForUsage = false
              const retryUsage = toCodexRunnerUsage(retry.usage, input.model)
              usage = mergeRunnerUsage(usage, {
                usage: retryUsage,
                complete: retryUsage !== undefined,
              })
              validated = mergeBlockedRetryExecution(
                validated,
                validateBlockedRetryExecution(
                  blockedCheckIds,
                  JSON.parse(retry.finalResponse) as RunnerExecution
                )
              )
            }
            const failedCheckIds = validated.checkResults
              .filter((result) => result.verdict === "failed")
              .map((result) => result.checkId)
            let screenshots = await readScreenshotEvidence({
              evidenceDirectory,
              checkIds: failedCheckIds,
            })

            if (screenshots.missingCheckIds.length > 0) {
              waitingForUsage = true
              const correction = await thread.run(
                buildMissingScreenshotPrompt({
                  scenario: scenarioInput.scenario,
                  evidenceDirectory,
                  missingCheckIds: screenshots.missingCheckIds,
                }),
                { signal: scenarioInput.signal, onItemEvent }
              )
              waitingForUsage = false
              const correctionUsage = toCodexRunnerUsage(
                correction.usage,
                input.model
              )
              usage = mergeRunnerUsage(usage, {
                usage: correctionUsage,
                complete: correctionUsage !== undefined,
              })
              screenshots = await readScreenshotEvidence({
                evidenceDirectory,
                checkIds: failedCheckIds,
              })
            }

            if (screenshots.missingCheckIds.length > 0) {
              throw new Error(
                `Codex did not capture required screenshot evidence for ${screenshots.missingCheckIds.length} failed check${screenshots.missingCheckIds.length === 1 ? "" : "s"}.`
              )
            }

            return {
              ...redactRunnerExecution(
                redactEvidenceDirectory(validated, evidenceDirectory),
                input.secrets
              ),
              screenshotEvidence: screenshots.evidence,
              usage,
            }
          } catch (error) {
            if (waitingForUsage) {
              usage = { ...usage, complete: false }
            }
            const message = (
              error instanceof Error ? error.message : "Codex failed."
            )
              .split(evidenceDirectory)
              .join("[LOCAL_EVIDENCE_DIR]")
            throw new RunnerExecutionError(
              redactSecretValues(message, input.secrets),
              usage
            )
          }
        })
      },
      async executeFixtureTask(taskInput: FixtureTaskInput) {
        return await executeFixtureTaskWithTurn(
          async (turnInput) => {
            const thread = codex.startThread(
              buildCodexThreadOptions({
                cwd: turnInput.cwd,
                model: input.model,
                modelReasoningEffort: input.modelReasoningEffort,
              })
            )
            const turn = await thread.run(turnInput.prompt, {
              outputSchema: turnInput.outputSchema,
              signal: turnInput.signal,
            })
            const turnUsage = toCodexRunnerUsage(turn.usage, input.model)
            return {
              output: JSON.parse(turn.finalResponse) as unknown,
              usage: { usage: turnUsage, complete: turnUsage !== undefined },
            }
          },
          taskInput,
          input.secrets
        )
      },
      isHealthy() {
        return sharedBrowser.isRunning()
      },
      async close() {
        await sharedBrowser.close()
      },
    }
  }
}

async function writeClaudeMcpConfig(input: {
  dir: string
  chromeDevtoolsLogPath: string
  wsEndpoint: string
  workspaceRoot: string
}) {
  const mcpConfigPath = join(input.dir, "mcp.json")
  await writeFile(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        "chrome-devtools": {
          command: "npx",
          args: buildCodexChromeMcpArgs({
            logFilePath: input.chromeDevtoolsLogPath,
            wsEndpoint: input.wsEndpoint,
            workspaceRoot: input.workspaceRoot,
          }),
        },
      },
    }),
    "utf8"
  )
  return mcpConfigPath
}

/** One `claude -p` invocation with structured output and the shared browser. */
async function runClaudeTurn(input: {
  cwd: string
  env: NodeJS.ProcessEnv
  secrets: RunnerSecrets
  mcpConfigPath: string
  outputSchema: unknown
  prompt: string
  signal?: AbortSignal
}) {
  const result = await runChildCommand({
    command: "claude",
    cwd: input.cwd,
    env: input.env,
    secrets: input.secrets,
    signal: input.signal,
    commandArgs: [
      "-p",
      "--permission-mode",
      process.env.CARACARA_CLAUDE_PERMISSION_MODE ?? "bypassPermissions",
      "--output-format",
      "json",
      "--mcp-config",
      input.mcpConfigPath,
      "--strict-mcp-config",
      "--json-schema",
      JSON.stringify(input.outputSchema),
      input.prompt,
    ],
  })
  return parseClaudeJsonResult(result.stdout)
}

class ClaudeRunner implements RunnerAdapter {
  readonly type = "claude-code" as const

  async startRun(runInput: RunnerStartInput) {
    const sharedBrowser = await launchSharedChromium({
      cwd: runInput.cwd,
      initialUrl: runInput.targetUrl,
      signal: runInput.signal,
    })
    const runnerEnv = { ...process.env, ...runInput.secrets }
    const secretNames = Object.keys(runInput.secrets)
    const withMcpConfig = <T>(work: (mcpConfigPath: string) => Promise<T>) =>
      withTempFiles(async (dir) =>
        work(
          await writeClaudeMcpConfig({
            dir,
            chromeDevtoolsLogPath: sharedBrowser.chromeDevtoolsLogPath,
            wsEndpoint: sharedBrowser.wsEndpoint,
            workspaceRoot: runInput.cwd,
          })
        )
      )
    return {
      async executeScenario(scenarioInput: RunnerScenarioInput) {
        return await withMcpConfig(async (mcpConfigPath) => {
          const turn = (outputSchema: unknown, prompt: string) =>
            runClaudeTurn({
              cwd: scenarioInput.cwd,
              env: runnerEnv,
              secrets: runInput.secrets,
              mcpConfigPath,
              outputSchema,
              prompt,
              signal: scenarioInput.signal,
            })
          let usage: RunnerUsageReport = { complete: false }
          try {
            const parsed = await turn(
              buildExecutionResultSchema(scenarioInput.scenario),
              buildRunnerPrompt({ ...scenarioInput, secretNames })
            )
            usage = {
              usage: parsed.usage,
              complete: parsed.usage !== undefined,
            }
            let validated = validateRunnerExecution(
              scenarioInput.scenario,
              parsed.execution
            )
            const blockedResults = validated.checkResults.filter(
              (result) => result.verdict === "blocked"
            )
            if (blockedResults.length > 0) {
              const blockedCheckIds = blockedResults.map(
                (result) => result.checkId
              )
              const usageBeforeRetry = usage
              usage = { ...usage, complete: false }
              const parsedRetry = await turn(
                buildBlockedRetryResultSchema(blockedCheckIds),
                buildBlockedRetryPrompt({
                  environment: scenarioInput.environment,
                  targetUrl: scenarioInput.targetUrl,
                  projectPrompt: scenarioInput.projectPrompt,
                  scenario: scenarioInput.scenario,
                  fixtures: scenarioInput.fixtures,
                  blockedResults,
                  secretNames,
                })
              )
              usage = mergeRunnerUsage(usageBeforeRetry, {
                usage: parsedRetry.usage,
                complete: parsedRetry.usage !== undefined,
              })
              validated = mergeBlockedRetryExecution(
                validated,
                validateBlockedRetryExecution(
                  blockedCheckIds,
                  parsedRetry.execution
                )
              )
            }
            return {
              ...redactRunnerExecution(validated, runInput.secrets),
              screenshotEvidence: [],
              usage,
            }
          } catch (error) {
            throw new RunnerExecutionError(
              redactSecretValues(
                error instanceof Error ? error.message : "Claude Code failed.",
                runInput.secrets
              ),
              usage
            )
          }
        })
      },
      async executeFixtureTask(taskInput: FixtureTaskInput) {
        return await withMcpConfig((mcpConfigPath) =>
          executeFixtureTaskWithTurn(
            async (turnInput) => {
              const parsed = await runClaudeTurn({
                cwd: turnInput.cwd,
                env: runnerEnv,
                secrets: runInput.secrets,
                mcpConfigPath,
                outputSchema: turnInput.outputSchema,
                prompt: turnInput.prompt,
                signal: turnInput.signal,
              })
              return {
                output: parsed.execution,
                usage: {
                  usage: parsed.usage,
                  complete: parsed.usage !== undefined,
                },
              }
            },
            taskInput,
            runInput.secrets
          )
        )
      },
      isHealthy() {
        return sharedBrowser.isRunning()
      },
      async close() {
        await sharedBrowser.close()
      },
    }
  }
}

export function getRunnerAdapter(type: RunnerType): RunnerAdapter {
  return type === "codex" ? new CodexRunner() : new ClaudeRunner()
}
