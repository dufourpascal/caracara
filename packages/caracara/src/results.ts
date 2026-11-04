import {
  getTokenTotals,
  sumRunTokenUsage,
  type CheckVerdict,
  type RunResultsResponse,
  type TokenTotals,
  type TokenUsage,
} from "@workspace/contracts"

import type { RunnerUsageReport } from "./execution.js"

export const RUN_RESULTS_FORMAT_VERSION = 1

function toTokenCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

/**
 * Maps a scenario's runner usage report to the stored token usage. A report
 * without usage means nothing was consumed when it is complete, and unknown
 * usage otherwise.
 */
export function toTokenUsage(
  report: RunnerUsageReport | null
): TokenUsage | undefined {
  if (!report) {
    return undefined
  }
  const usage = report.usage
  if (!usage) {
    return report.complete
      ? {
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          complete: true,
        }
      : undefined
  }
  return {
    inputTokens: toTokenCount(usage.inputTokens),
    cachedInputTokens: toTokenCount(usage.cachedInputTokens),
    cacheWriteInputTokens: toTokenCount(usage.cacheWriteInputTokens),
    outputTokens: toTokenCount(usage.outputTokens),
    reasoningOutputTokens: toTokenCount(usage.reasoningOutputTokens),
    complete: report.complete,
  }
}

export function toTokenUsageField(report: RunnerUsageReport | null) {
  const tokenUsage = toTokenUsage(report)
  return tokenUsage ? { tokenUsage } : {}
}

export type RunResultsCheck = {
  id: string
  name: string
  /** Null when the scenario ended before this check was evaluated. */
  verdict: CheckVerdict | null
  reason: string | null
  blockedReason: string | null
}

export type RunResultsScenario = {
  sequenceIndex: number
  id: string
  slug: string
  name: string
  phase: { id: string | null; order: number; name: string } | null
  status: string
  startedAt: string
  finishedAt: string | null
  /** Null while the scenario is still running. */
  durationMs: number | null
  passedCheckCount: number
  totalCheckCount: number
  tokens: TokenTotals | null
  executionSummary: string | null
  failureDetail: string | null
  checks: RunResultsCheck[]
}

export type RunResultsReport = {
  formatVersion: typeof RUN_RESULTS_FORMAT_VERSION
  run: {
    id: string
    name: string
    status: string
    mode: string
    environment: string | null
    targetUrl: string | null
    runnerType: string | null
    model: string | null
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
    passedCheckCount: number
    totalCheckCount: number
    passRate: number | null
    tokens: TokenTotals | null
  }
  scenarios: RunResultsScenario[]
}

function toIso(value: number) {
  return new Date(value).toISOString()
}

function getDurationMs(startedAt: number, finishedAt: number | null) {
  return finishedAt === null ? null : Math.max(0, finishedAt - startedAt)
}

/** Reads the run's model once the API records one; null until then. */
export function readRunModel(run: object): string | null {
  const model = (run as { model?: unknown }).model
  return typeof model === "string" && model.length > 0 ? model : null
}

export function buildRunResultsReport(
  response: RunResultsResponse
): RunResultsReport {
  const { run, results } = response
  const runTokens = sumRunTokenUsage({ runStatus: run.status, results })

  return {
    formatVersion: RUN_RESULTS_FORMAT_VERSION,
    run: {
      id: run.id,
      name: run.name,
      status: run.status,
      mode: run.mode,
      environment: run.environment ?? null,
      targetUrl: run.targetUrl ?? null,
      runnerType: run.runnerType,
      model: readRunModel(run),
      startedAt: toIso(run.startedAt),
      finishedAt: run.finishedAt === null ? null : toIso(run.finishedAt),
      durationMs: getDurationMs(run.startedAt, run.finishedAt),
      passedCheckCount: run.passedCheckCount,
      totalCheckCount: run.totalCheckCount,
      passRate: run.passRate,
      tokens: runTokens ? getTokenTotals(runTokens) : null,
    },
    scenarios: results.map((result) => {
      const verdicts = new Map(
        result.checkResults.map((check) => [check.checkId, check])
      )
      const checks = result.evaluationChecks.map((check) => {
        const verdict = verdicts.get(check.id)
        return {
          id: check.id,
          name: check.name,
          verdict: verdict?.verdict ?? null,
          reason: verdict?.evidence ?? null,
          blockedReason: verdict?.blockedReason ?? null,
        }
      })
      return {
        sequenceIndex: result.sequenceIndex,
        id: result.scenarioId,
        slug: result.scenarioSlug,
        name: result.scenarioName,
        phase:
          result.phaseOrder != null && result.phaseName != null
            ? {
                id: result.phaseId ?? null,
                order: result.phaseOrder,
                name: result.phaseName,
              }
            : null,
        status: result.status,
        startedAt: toIso(result.startedAt),
        finishedAt:
          result.finishedAt === null ? null : toIso(result.finishedAt),
        durationMs: getDurationMs(result.startedAt, result.finishedAt),
        passedCheckCount: checks.filter((check) => check.verdict === "passed")
          .length,
        totalCheckCount: checks.length,
        tokens: result.tokenUsage ? getTokenTotals(result.tokenUsage) : null,
        executionSummary: result.executionSummary,
        failureDetail: result.failureDetail,
        checks,
      }
    }),
  }
}

const numberFormat = new Intl.NumberFormat("en-US")

export function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "running"
  }
  const totalSeconds = Math.round(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(" ")
}

/** Incomplete totals are a lower bound and get a trailing "+". */
function formatTokenCount(tokens: TokenTotals | null) {
  if (!tokens) {
    return "n/a"
  }
  return `${numberFormat.format(tokens.total)}${tokens.complete ? "" : "+"}`
}

function formatTokenBreakdown(tokens: TokenTotals | null) {
  if (!tokens) {
    return "n/a"
  }
  return `${formatTokenCount(tokens)} total (${numberFormat.format(tokens.uncachedInput)} uncached input, ${numberFormat.format(tokens.cachedInput)} cached input, ${numberFormat.format(tokens.output)} output)`
}

function formatTimestamp(value: string | null) {
  return value === null ? "-" : value.replace(/\.\d{3}Z$/, "Z")
}

function oneLine(text: string, maxLength = 200) {
  const collapsed = text.replace(/\s+/g, " ").trim()
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength - 1)}…`
    : collapsed
}

function formatTable(rows: string[][]) {
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length))
  )
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column]!)
        )
        .join("  ")
        .trimEnd()
    )
    .join("\n")
}

export function formatRunResultsTable(report: RunResultsReport) {
  const { run } = report
  const lines = [
    `Run       ${run.name} (${run.id})`,
    `Status    ${run.status} · environment ${run.environment ?? "untracked"} · runner ${run.runnerType ?? "n/a"} · model ${run.model ?? "n/a"}`,
    `Time      ${formatTimestamp(run.startedAt)} → ${formatTimestamp(run.finishedAt)} (${formatDuration(run.durationMs)})`,
    `Checks    ${run.passedCheckCount}/${run.totalCheckCount} passed${run.passRate === null ? "" : ` (${run.passRate}%)`}`,
    `Tokens    ${formatTokenBreakdown(run.tokens)}`,
  ]

  if (report.scenarios.length === 0) {
    lines.push("", "No scenario results.")
    return `${lines.join("\n")}\n`
  }

  lines.push(
    "",
    formatTable([
      ["#", "Phase", "Scenario", "Status", "Checks", "Duration", "Tokens"],
      ...report.scenarios.map((scenario) => [
        String(scenario.sequenceIndex + 1),
        scenario.phase ? `${scenario.phase.order} ${scenario.phase.name}` : "-",
        scenario.slug,
        scenario.status,
        `${scenario.passedCheckCount}/${scenario.totalCheckCount}`,
        formatDuration(scenario.durationMs),
        formatTokenCount(scenario.tokens),
      ]),
    ])
  )

  const issues: string[] = []
  for (const scenario of report.scenarios) {
    if (scenario.status !== "completed") {
      if (scenario.status !== "running") {
        issues.push(
          `  ${scenario.slug}: ${scenario.status}${scenario.failureDetail ? ` (${oneLine(scenario.failureDetail)})` : ""}`
        )
      }
      continue
    }
    for (const check of scenario.checks) {
      if (check.verdict !== "passed") {
        issues.push(
          `  ${scenario.slug} › ${check.name}: ${check.verdict ?? "not evaluated"}${check.blockedReason ? ` (${check.blockedReason})` : ""}${check.reason ? `: ${oneLine(check.reason)}` : ""}`
        )
      }
    }
  }
  if (issues.length > 0) {
    lines.push("", "Not passed:", ...issues)
  }
  if (
    run.tokens?.complete === false ||
    report.scenarios.some((scenario) => scenario.tokens?.complete === false)
  ) {
    lines.push("", "+ token usage is incomplete; the count is a lower bound.")
  }

  return `${lines.join("\n")}\n`
}
