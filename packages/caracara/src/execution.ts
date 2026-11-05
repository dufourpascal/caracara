import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

import {
  BLOCKED_REASONS,
  EVIDENCE_UNAVAILABLE_REASON_MAX_LENGTH,
} from "@workspace/contracts"
import type {
  BlockedReason,
  CheckResult,
  Fixture,
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
import { buildProtectedFixturesSection } from "./fixture-prompts.js"
import {
  buildWindowsTaskkillArgs,
  terminateChildProcess,
} from "./process-control.js"
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
  /** Definitions of the fixtures the scenario requires. */
  fixtures?: Fixture[]
  signal?: AbortSignal
  /** Called for agent steps when the runner can report them live. */
  onActivity?: (activity: RunnerActivity) => void
}

/** A single agent turn with a custom prompt, such as a fixture task. */
export type RunnerTaskInput = {
  cwd: string
  prompt: string
  checks: Array<{ id: string }>
  signal?: AbortSignal
}

export type RunnerTaskResult = {
  executionSummary: string
  checkResults: CheckResult[]
  usage?: RunnerUsageReport
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
  /** One turn, no blocked retry and no screenshots. */
  runTask(input: RunnerTaskInput): Promise<RunnerTaskResult>
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
  fixtures?: Fixture[]
  secretNames?: string[]
  evidenceDirectory?: string
  downloadsDirectory?: string
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
    "",
    `Scenario: ${input.scenario.name} (${input.scenario.slug})`,
    "",
    "Task instructions:",
    input.scenario.instructions.trim(),
    ...buildProtectedFixturesSection(
      input.scenario.fixtureRequirements,
      input.fixtures
    ),
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
    ...(input.downloadsDirectory
      ? [buildDownloadsInstruction(input.downloadsDirectory)]
      : []),
    "Where a canvas or image viewer has no element to target, click by viewport coordinates with click_at, taking the coordinates from a screenshot or the element's bounding box.",
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
          nativeDialogEvidence,
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
  fixtures?: Fixture[]
  blockedResults: CheckResult[]
  secretNames?: string[]
  evidenceDirectory?: string
  downloadsDirectory?: string
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
    "",
    "Task instructions:",
    input.scenario.instructions.trim(),
    ...buildProtectedFixturesSection(
      input.scenario.fixtureRequirements,
      input.fixtures
    ),
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
    ...(input.downloadsDirectory
      ? [buildDownloadsInstruction(input.downloadsDirectory)]
      : []),
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
          nativeDialogEvidence,
        ]
      : []),
    'For failed evidence use: "Attempted: <specific action and expected result>. Failed: <exact observed behavior>."',
    'For blocked evidence use: "Attempted: <specific action and expected state>. Blocked: <exact reason the state or evidence still could not be reached>."',
    "This is the only retry. Report the final observed result for each listed check.",
  ].join("\n")
}

/** Native dialogs block chrome-devtools screenshots, so a failure shown in one needs a nearby capture instead. */
const nativeDialogEvidence =
  "Browser-native alert, confirm and prompt dialogs block screenshots and never appear in them. If one is open, close it with chrome-devtools handle_dialog (dismiss unless the scenario needs it accepted). If the failure is the dialog itself, record its exact text in the evidence and capture the page with the control that opened it in view; otherwise capture the failure region as usual."

/** Correction turns only save screenshots, so they skip the instruction to record the dialog text. */
const nativeDialogCorrection =
  "Browser-native alert, confirm and prompt dialogs block screenshots. If one is open, close it with chrome-devtools handle_dialog (dismiss unless the scenario needs it accepted). If the failure is the dialog itself, capture the page with the control that opened it in view; otherwise capture the failure region as usual."

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
    nativeDialogCorrection,
    ...checks.map(
      (check) =>
        `- ${check.name} [${check.id}]: ${join(input.evidenceDirectory, `${check.id}.webp`)}`
    ),
    "Use screenshotUnavailableReason only as a last resort, when no screenshot can show the failure or where it appeared, for example because the screenshot tool keeps failing. Then save nothing for that check and set a short, specific reason. For every check whose screenshot you saved, set it to null.",
    "Return JSON with exactly one checks entry per listed check ID.",
    "Do not include secret values, screenshot paths, or image bytes in your response.",
  ].join("\n")
}

export function buildMissingScreenshotResultSchema(missingCheckIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["checks"],
    properties: {
      checks: {
        type: "array",
        minItems: missingCheckIds.length,
        maxItems: missingCheckIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["checkId", "screenshotUnavailableReason"],
          properties: {
            checkId: { type: "string", enum: missingCheckIds },
            screenshotUnavailableReason: {
              anyOf: [
                {
                  type: "string",
                  minLength: 1,
                  maxLength: EVIDENCE_UNAVAILABLE_REASON_MAX_LENGTH,
                },
                { type: "null" },
              ],
            },
          },
        },
      },
    },
  } as const
}

/** Written by the CLI when Codex saved no screenshot and gave no reason of its own. */
export const MISSING_SCREENSHOT_FALLBACK_REASON =
  "Caracara: no screenshot was saved and Codex gave no reason."

/** Written by the CLI when the screenshot follow-up turn itself failed. */
export const SCREENSHOT_CORRECTION_FAILED_REASON =
  "Caracara: the screenshot follow-up turn failed before a screenshot was saved."

/** Reads the reasons from a correction turn; an unreadable response yields none. */
export function parseScreenshotUnavailableReasons(finalResponse: string) {
  const reasons = new Map<string, string>()
  let parsed: unknown
  try {
    parsed = JSON.parse(finalResponse)
  } catch {
    return reasons
  }
  const checks = (parsed as { checks?: unknown } | null)?.checks
  if (!Array.isArray(checks)) {
    return reasons
  }
  for (const check of checks as Array<Record<string, unknown> | null>) {
    const checkId = check?.checkId
    const reason = check?.screenshotUnavailableReason
    if (typeof checkId === "string" && typeof reason === "string") {
      const trimmed = reason.trim()
      if (trimmed !== "") {
        reasons.set(checkId, trimmed)
      }
    }
  }
  return reasons
}

/**
 * Records failed checks that still have no screenshot as evidence unavailable,
 * so the scenario completes with its verdicts instead of failing the runner.
 */
export function applyEvidenceUnavailableReasons(
  execution: RunnerExecution,
  missingCheckIds: string[],
  reasons: Map<string, string>,
  fallbackReason = MISSING_SCREENSHOT_FALLBACK_REASON
): RunnerExecution {
  const missing = new Set(missingCheckIds)
  return {
    ...execution,
    checkResults: execution.checkResults.map((result) => {
      const { evidenceUnavailableReason: _ignored, ...rest } = result
      void _ignored
      return result.verdict === "failed" && missing.has(result.checkId)
        ? {
            ...rest,
            evidenceUnavailableReason:
              reasons.get(result.checkId) ?? fallbackReason,
          }
        : rest
    }),
  }
}

/** Limits UTF-16 length like the server, without leaving half a surrogate pair. */
export function limitEvidenceUnavailableReason(reason: string) {
  if (reason.length <= EVIDENCE_UNAVAILABLE_REASON_MAX_LENGTH) {
    return reason
  }
  let end = EVIDENCE_UNAVAILABLE_REASON_MAX_LENGTH - 1
  const last = reason.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1
  }
  return `${reason.slice(0, end)}…`
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
      // Redaction can lengthen the reason, so the limit is applied afterwards.
      ...(result.evidenceUnavailableReason
        ? {
            evidenceUnavailableReason: limitEvidenceUnavailableReason(
              redactSecretValues(result.evidenceUnavailableReason, secrets)
            ),
          }
        : {}),
    })),
  }
}

/** Replaces a local directory path in summaries and evidence before results leave the machine. */
export function redactLocalDirectory(
  execution: RunnerExecution,
  directory: string,
  placeholder: string
) {
  return {
    executionSummary: execution.executionSummary
      .split(directory)
      .join(placeholder),
    checkResults: execution.checkResults.map((result) => ({
      ...result,
      evidence: result.evidence.split(directory).join(placeholder),
      ...(result.evidenceUnavailableReason
        ? {
            evidenceUnavailableReason: result.evidenceUnavailableReason
              .split(directory)
              .join(placeholder),
          }
        : {}),
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
    // Enables click_at, so canvas viewers (atlas landmarks, image viewers) can be
    // clicked by coordinate where no element uid exists.
    "--experimentalVision=true",
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

/** Tells the agent where the shared browser saves downloads. */
export function buildDownloadsInstruction(downloadsDirectory: string) {
  return `Files the application downloads are saved to ${downloadsDirectory}. It is emptied before each scenario. To check a download, list or read that directory with a shell command; chrome:// pages cannot be opened.`
}

/** Empties the run's downloads directory so one scenario's files never satisfy the next scenario's checks. */
export async function resetDownloadsDirectory(downloadsDirectory: string) {
  await rm(downloadsDirectory, { recursive: true, force: true })
  await mkdir(downloadsDirectory, { recursive: true })
}

/**
 * Points the fresh profile's downloads at a run-scoped directory, so agents can
 * verify downloaded files (chrome://downloads is not reachable over DevTools)
 * and nothing lands in the user's own Downloads folder.
 */
export async function writeChromiumDownloadPreferences(input: {
  userDataDir: string
  downloadsDirectory: string
}) {
  const profileDir = join(input.userDataDir, "Default")
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, "Preferences"),
    JSON.stringify({
      download: {
        default_directory: input.downloadsDirectory,
        prompt_for_download: false,
        directory_upgrade: true,
      },
      savefile: { default_directory: input.downloadsDirectory },
    }),
    "utf8"
  )
}

async function launchSharedChromium(input: {
  cwd: string
  initialUrl: string
  signal?: AbortSignal
}) {
  const runDir = await mkdtemp(join(tmpdir(), "caracara-codex-run-"))
  const userDataDir = join(runDir, "chrome-profile")
  const chromeDevtoolsLogPath = join(runDir, "chrome-devtools-mcp.log")
  const downloadsDirectory = join(runDir, "downloads")
  await mkdir(downloadsDirectory, { recursive: true })
  await writeChromiumDownloadPreferences({ userDataDir, downloadsDirectory })
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
      downloadsDirectory,
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
        await resetDownloadsDirectory(sharedBrowser.downloadsDirectory)
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
                downloadsDirectory: sharedBrowser.downloadsDirectory,
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
                  downloadsDirectory: sharedBrowser.downloadsDirectory,
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
              let reasons = new Map<string, string>()
              let fallbackReason = MISSING_SCREENSHOT_FALLBACK_REASON
              try {
                waitingForUsage = true
                const correction = await thread.run(
                  buildMissingScreenshotPrompt({
                    scenario: scenarioInput.scenario,
                    evidenceDirectory,
                    missingCheckIds: screenshots.missingCheckIds,
                  }),
                  {
                    outputSchema: buildMissingScreenshotResultSchema(
                      screenshots.missingCheckIds
                    ),
                    signal: scenarioInput.signal,
                    onItemEvent,
                  }
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
                reasons = parseScreenshotUnavailableReasons(
                  correction.finalResponse
                )
              } catch (error) {
                // The verdicts already stand; only cancellation ends the scenario here.
                if (scenarioInput.signal?.aborted) {
                  throw error
                }
                const message = (
                  error instanceof Error ? error.message : "Codex failed."
                )
                  .split(evidenceDirectory)
                  .join("[LOCAL_EVIDENCE_DIR]")
                writeDiagnostic(
                  `Warning: screenshot follow-up turn failed: ${redactSecretValues(message, input.secrets)}\n`
                )
                waitingForUsage = false
                usage = { ...usage, complete: false }
                fallbackReason = SCREENSHOT_CORRECTION_FAILED_REASON
              }
              screenshots = await readScreenshotEvidence({
                evidenceDirectory,
                checkIds: failedCheckIds,
              })
              validated = applyEvidenceUnavailableReasons(
                validated,
                screenshots.missingCheckIds,
                reasons,
                fallbackReason
              )
            }

            return {
              ...redactRunnerExecution(
                redactLocalDirectory(
                  redactLocalDirectory(
                    validated,
                    evidenceDirectory,
                    "[LOCAL_EVIDENCE_DIR]"
                  ),
                  sharedBrowser.downloadsDirectory,
                  "[RUN_DOWNLOADS_DIR]"
                ),
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
      async runTask(task: RunnerTaskInput) {
        const checkIds = task.checks.map((check) => check.id)
        let usage: RunnerUsageReport = { complete: false }
        try {
          const thread = codex.startThread(
            buildCodexThreadOptions({
              cwd: task.cwd,
              model: input.model,
              modelReasoningEffort: input.modelReasoningEffort,
            })
          )
          const turn = await thread.run(task.prompt, {
            outputSchema: buildResultSchema(checkIds),
            signal: task.signal,
          })
          const turnUsage = toCodexRunnerUsage(turn.usage, input.model)
          usage = { usage: turnUsage, complete: turnUsage !== undefined }
          const validated = validateExecution(
            checkIds,
            JSON.parse(turn.finalResponse) as RunnerExecution
          )
          return { ...redactRunnerExecution(validated, input.secrets), usage }
        } catch (error) {
          throw new RunnerExecutionError(
            redactSecretValues(
              error instanceof Error ? error.message : "Codex failed.",
              input.secrets
            ),
            usage
          )
        }
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
    const writeMcpConfig = async (dir: string) => {
      const mcpConfigPath = join(dir, "mcp.json")
      await writeFile(
        mcpConfigPath,
        JSON.stringify({
          mcpServers: {
            "chrome-devtools": {
              command: "npx",
              args: buildCodexChromeMcpArgs({
                logFilePath: sharedBrowser.chromeDevtoolsLogPath,
                wsEndpoint: sharedBrowser.wsEndpoint,
                workspaceRoot: runInput.cwd,
              }),
            },
          },
        }),
        "utf8"
      )
      return mcpConfigPath
    }
    return {
      async executeScenario(scenarioInput: RunnerScenarioInput) {
        await resetDownloadsDirectory(sharedBrowser.downloadsDirectory)
        return await withTempFiles(async (dir) => {
          const mcpConfigPath = await writeMcpConfig(dir)
          let usage: RunnerUsageReport = { complete: false }
          try {
            const execution = await runChildCommand({
              command: "claude",
              cwd: scenarioInput.cwd,
              env: runnerEnv,
              secrets: runInput.secrets,
              signal: scenarioInput.signal,
              commandArgs: [
                "-p",
                "--permission-mode",
                process.env.CARACARA_CLAUDE_PERMISSION_MODE ??
                  "bypassPermissions",
                "--output-format",
                "json",
                "--mcp-config",
                mcpConfigPath,
                "--strict-mcp-config",
                "--json-schema",
                JSON.stringify(
                  buildExecutionResultSchema(scenarioInput.scenario)
                ),
                buildRunnerPrompt({
                  ...scenarioInput,
                  secretNames,
                  downloadsDirectory: sharedBrowser.downloadsDirectory,
                }),
              ],
            })
            const parsed = parseClaudeJsonResult(execution.stdout)
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
              const retry = await runChildCommand({
                command: "claude",
                cwd: scenarioInput.cwd,
                env: runnerEnv,
                secrets: runInput.secrets,
                signal: scenarioInput.signal,
                commandArgs: [
                  "-p",
                  "--permission-mode",
                  process.env.CARACARA_CLAUDE_PERMISSION_MODE ??
                    "bypassPermissions",
                  "--output-format",
                  "json",
                  "--mcp-config",
                  mcpConfigPath,
                  "--strict-mcp-config",
                  "--json-schema",
                  JSON.stringify(
                    buildBlockedRetryResultSchema(blockedCheckIds)
                  ),
                  buildBlockedRetryPrompt({
                    environment: scenarioInput.environment,
                    targetUrl: scenarioInput.targetUrl,
                    projectPrompt: scenarioInput.projectPrompt,
                    scenario: scenarioInput.scenario,
                    fixtures: scenarioInput.fixtures,
                    blockedResults,
                    secretNames,
                    downloadsDirectory: sharedBrowser.downloadsDirectory,
                  }),
                ],
              })
              const parsedRetry = parseClaudeJsonResult(retry.stdout)
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
              ...redactRunnerExecution(
                redactLocalDirectory(
                  validated,
                  sharedBrowser.downloadsDirectory,
                  "[RUN_DOWNLOADS_DIR]"
                ),
                runInput.secrets
              ),
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
      async runTask(task: RunnerTaskInput) {
        const checkIds = task.checks.map((check) => check.id)
        return await withTempFiles(async (dir) => {
          let usage: RunnerUsageReport = { complete: false }
          try {
            const result = await runChildCommand({
              command: "claude",
              cwd: task.cwd,
              env: runnerEnv,
              secrets: runInput.secrets,
              signal: task.signal,
              commandArgs: [
                "-p",
                "--permission-mode",
                process.env.CARACARA_CLAUDE_PERMISSION_MODE ??
                  "bypassPermissions",
                "--output-format",
                "json",
                "--mcp-config",
                await writeMcpConfig(dir),
                "--strict-mcp-config",
                "--json-schema",
                JSON.stringify(buildResultSchema(checkIds)),
                task.prompt,
              ],
            })
            const parsed = parseClaudeJsonResult(result.stdout)
            usage = {
              usage: parsed.usage,
              complete: parsed.usage !== undefined,
            }
            const validated = validateExecution(checkIds, parsed.execution)
            return {
              ...redactRunnerExecution(validated, runInput.secrets),
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
