import type { RunStatus, ScenarioResultStatus, TokenUsage } from "./domain.js"

export type TokenTotals = {
  total: number
  input: number
  uncachedInput: number
  cachedInput: number
  cacheWriteInput: number
  output: number
  reasoningOutput: number
  complete: boolean
}

export function getTokenTotals(usage: TokenUsage): TokenTotals {
  return {
    total: usage.inputTokens + usage.outputTokens,
    input: usage.inputTokens,
    uncachedInput: Math.max(
      0,
      usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens
    ),
    cachedInput: usage.cachedInputTokens,
    cacheWriteInput: usage.cacheWriteInputTokens,
    output: usage.outputTokens,
    reasoningOutput: usage.reasoningOutputTokens,
    complete: usage.complete,
  }
}

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "interrupted",
])

/**
 * Adds up scenario token usage for a run. Returns null when no scenario has
 * recorded usage (runs from older CLIs). The total is incomplete while the
 * run is still going, or when a scenario that reached the runner has no or
 * partial usage. Dependency-failed scenarios never run, so they count as zero.
 */
export function sumRunTokenUsage(input: {
  runStatus: RunStatus
  results: ReadonlyArray<{
    status: ScenarioResultStatus
    tokenUsage?: TokenUsage | null
  }>
}): TokenUsage | null {
  const total: TokenUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    complete: TERMINAL_RUN_STATUSES.has(input.runStatus),
  }
  let hasUsage = false

  for (const result of input.results) {
    if (result.status === "running") {
      total.complete = false
    }
    const usage = result.tokenUsage
    if (!usage) {
      if (result.status !== "dependency_failed") {
        total.complete = false
      }
      continue
    }
    hasUsage = true
    total.inputTokens += usage.inputTokens
    total.cachedInputTokens += usage.cachedInputTokens
    total.cacheWriteInputTokens += usage.cacheWriteInputTokens
    total.outputTokens += usage.outputTokens
    total.reasoningOutputTokens += usage.reasoningOutputTokens
    total.complete &&= usage.complete
  }

  return hasUsage ? total : null
}
