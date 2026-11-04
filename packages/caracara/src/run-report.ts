import type {
  CheckResult,
  CheckVerdict,
  OrderedScenario,
} from "@workspace/contracts"

import type { RunnerUsage, RunnerUsageReport } from "./execution.js"
import { toSingleLine, truncateToWidth } from "./terminal-text.js"

/**
 * Field names follow the `caracara results --json` report where they overlap,
 * so a later change can serve both from one builder.
 */
export const RUN_REPORT_FORMAT_VERSION = 1

export type ScenarioOutcome =
  "completed" | "runner_failed" | "dependency_failed" | "interrupted"

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

export type RunReportCheck = {
  id: string
  name: string
  verdict: CheckVerdict | null
  reason: string | null
  blockedReason: string | null
}

export type RunReportPhase = {
  id: string | null
  order: number
  name: string
}

export type RunReportScenario = {
  sequenceIndex: number
  id: string
  slug: string
  name: string
  phase: RunReportPhase | null
  status: ScenarioOutcome
  startedAt: string
  finishedAt: string
  durationMs: number
  passedCheckCount: number
  failedCheckCount: number
  blockedCheckCount: number
  totalCheckCount: number
  tokens: TokenTotals | null
  estimatedCostUsd: number | null
  failureDetail: string | null
  checks: RunReportCheck[]
}

export type RunReportPhaseRow = RunReportPhase & {
  scenarioCount: number
  passedCheckCount: number
  failedCheckCount: number
  blockedCheckCount: number
  totalCheckCount: number
  durationMs: number
  tokens: TokenTotals | null
  runnerFailedCount: number
  skippedCount: number
  notRunCount: number
}

export type RunReportStatus = "completed" | "failed" | "interrupted"

export type RunReport = {
  formatVersion: typeof RUN_REPORT_FORMAT_VERSION
  run: {
    id: string
    name: string
    url: string | null
    status: RunReportStatus
    mode: string
    selection: string
    environment: string | null
    targetUrl: string | null
    runnerType: string
    model: string | null
    modelReasoningEffort: string | null
    startedAt: string
    finishedAt: string
    durationMs: number
    passedCheckCount: number
    failedCheckCount: number
    blockedCheckCount: number
    totalCheckCount: number
    /** Only for completed runs, as in the web app. */
    passRate: number | null
    scenarioCounts: {
      total: number
      completed: number
      runnerFailed: number
      skipped: number
      interrupted: number
      notRun: number
    }
    tokens: TokenTotals | null
    estimatedCostUsd: number | null
    exitCode: number
  }
  phases: RunReportPhaseRow[]
  scenarios: RunReportScenario[]
}

/**
 * Token totals for one scenario. A runner that ran without reporting usage
 * gives zero totals marked incomplete, so run totals show they are a lower
 * bound; scenarios that never reached the runner have no totals.
 */
export function toTokenTotals(
  report: RunnerUsageReport | null | undefined
): TokenTotals | null {
  if (!report) {
    return null
  }
  if (!report.usage) {
    return {
      total: 0,
      input: 0,
      uncachedInput: 0,
      cachedInput: 0,
      cacheWriteInput: 0,
      output: 0,
      reasoningOutput: 0,
      complete: report.complete,
    }
  }
  const usage: RunnerUsage = report.usage
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
    complete: report.complete,
  } satisfies TokenTotals
}

function addTokenTotals(
  left: TokenTotals | null,
  right: TokenTotals | null
): TokenTotals | null {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  return {
    total: left.total + right.total,
    input: left.input + right.input,
    uncachedInput: left.uncachedInput + right.uncachedInput,
    cachedInput: left.cachedInput + right.cachedInput,
    cacheWriteInput: left.cacheWriteInput + right.cacheWriteInput,
    output: left.output + right.output,
    reasoningOutput: left.reasoningOutput + right.reasoningOutput,
    complete: left.complete && right.complete,
  }
}

export function sumTokenTotals(
  items: ReadonlyArray<{ tokens: TokenTotals | null }>
) {
  return items.reduce<TokenTotals | null>(
    (total, item) => addTokenTotals(total, item.tokens),
    null
  )
}

export function buildScenarioReport(input: {
  sequenceIndex: number
  scenario: OrderedScenario
  phase: RunReportPhase | null
  status: ScenarioOutcome
  startedAt: number
  finishedAt: number
  checkResults: CheckResult[]
  usage: RunnerUsageReport | null
  failureDetail: string | null
}): RunReportScenario {
  const verdicts = new Map(
    input.checkResults.map((result) => [result.checkId, result])
  )
  const checks = input.scenario.evaluationChecks.map((check) => {
    const result = verdicts.get(check.id)
    return {
      id: check.id,
      name: check.name,
      verdict: result?.verdict ?? null,
      reason: result?.evidence ?? null,
      blockedReason: result?.blockedReason ?? null,
    }
  })
  const count = (verdict: CheckVerdict) =>
    checks.filter((check) => check.verdict === verdict).length
  return {
    sequenceIndex: input.sequenceIndex,
    id: input.scenario.id,
    slug: input.scenario.slug,
    name: input.scenario.name,
    phase: input.phase,
    status: input.status,
    startedAt: new Date(input.startedAt).toISOString(),
    finishedAt: new Date(input.finishedAt).toISOString(),
    durationMs: Math.max(0, input.finishedAt - input.startedAt),
    passedCheckCount: count("passed"),
    failedCheckCount: count("failed"),
    blockedCheckCount: count("blocked"),
    totalCheckCount: input.status === "completed" ? checks.length : 0,
    tokens: toTokenTotals(input.usage),
    estimatedCostUsd: input.usage?.usage?.estimatedCostUsd ?? null,
    failureDetail: input.failureDetail,
    checks,
  }
}

type QueueEntry = { phase: RunReportPhase | null }

export function buildPhaseRows(
  queue: ReadonlyArray<QueueEntry>,
  scenarios: ReadonlyArray<RunReportScenario>
): RunReportPhaseRow[] {
  const rows = new Map<string, RunReportPhaseRow>()
  queue.forEach((entry, index) => {
    if (!entry.phase) {
      return
    }
    const key = entry.phase.id ?? `order:${entry.phase.order}`
    let row = rows.get(key)
    if (!row) {
      row = {
        ...entry.phase,
        scenarioCount: 0,
        passedCheckCount: 0,
        failedCheckCount: 0,
        blockedCheckCount: 0,
        totalCheckCount: 0,
        durationMs: 0,
        tokens: null,
        runnerFailedCount: 0,
        skippedCount: 0,
        notRunCount: 0,
      }
      rows.set(key, row)
    }
    row.scenarioCount += 1
    const scenario = scenarios.find((item) => item.sequenceIndex === index)
    if (!scenario) {
      row.notRunCount += 1
      return
    }
    row.passedCheckCount += scenario.passedCheckCount
    row.failedCheckCount += scenario.failedCheckCount
    row.blockedCheckCount += scenario.blockedCheckCount
    row.totalCheckCount += scenario.totalCheckCount
    row.durationMs += scenario.durationMs
    row.tokens = addTokenTotals(row.tokens, scenario.tokens)
    if (scenario.status === "runner_failed") {
      row.runnerFailedCount += 1
    } else if (scenario.status === "dependency_failed") {
      row.skippedCount += 1
    }
  })
  return [...rows.values()]
}

export function buildRunReport(input: {
  run: {
    id: string
    name: string
    url: string | null
    status: RunReportStatus
    mode: string
    selection: string
    environment: string | null
    targetUrl: string | null
    runnerType: string
    model: string | null
    modelReasoningEffort: string | null
    startedAt: number
    finishedAt: number
    exitCode: number
  }
  queue: ReadonlyArray<QueueEntry>
  scenarios: ReadonlyArray<RunReportScenario>
}): RunReport {
  const scenarios = [...input.scenarios].sort(
    (left, right) => left.sequenceIndex - right.sequenceIndex
  )
  const sum = (pick: (scenario: RunReportScenario) => number) =>
    scenarios.reduce((total, scenario) => total + pick(scenario), 0)
  const countStatus = (status: ScenarioOutcome) =>
    scenarios.filter((scenario) => scenario.status === status).length
  const passed = sum((scenario) => scenario.passedCheckCount)
  const total = sum((scenario) => scenario.totalCheckCount)
  const costs = scenarios
    .filter((scenario) => scenario.status !== "dependency_failed")
    .map((scenario) => scenario.estimatedCostUsd)
  const tokens = sumTokenTotals(scenarios)

  return {
    formatVersion: RUN_REPORT_FORMAT_VERSION,
    run: {
      id: input.run.id,
      name: input.run.name,
      url: input.run.url,
      status: input.run.status,
      mode: input.run.mode,
      selection: input.run.selection,
      environment: input.run.environment,
      targetUrl: input.run.targetUrl,
      runnerType: input.run.runnerType,
      model: input.run.model,
      modelReasoningEffort: input.run.modelReasoningEffort,
      startedAt: new Date(input.run.startedAt).toISOString(),
      finishedAt: new Date(input.run.finishedAt).toISOString(),
      durationMs: Math.max(0, input.run.finishedAt - input.run.startedAt),
      passedCheckCount: passed,
      failedCheckCount: sum((scenario) => scenario.failedCheckCount),
      blockedCheckCount: sum((scenario) => scenario.blockedCheckCount),
      totalCheckCount: total,
      passRate:
        input.run.status === "completed" && total > 0
          ? Math.round((100 * passed) / total)
          : null,
      scenarioCounts: {
        total: input.queue.length,
        completed: countStatus("completed"),
        runnerFailed: countStatus("runner_failed"),
        skipped: countStatus("dependency_failed"),
        interrupted: countStatus("interrupted"),
        notRun: Math.max(0, input.queue.length - scenarios.length),
      },
      tokens,
      estimatedCostUsd:
        costs.length > 0 &&
        tokens?.complete &&
        costs.every((cost) => cost !== null)
          ? costs.reduce<number>((totalCost, cost) => totalCost + cost!, 0)
          : null,
      exitCode: input.run.exitCode,
    },
    phases: buildPhaseRows(input.queue, scenarios),
    scenarios,
  }
}

export type FailOnVerdict = "failed" | "blocked"

/**
 * Exit code once the run has been finalized without a thrown error or signal:
 * 2 for runner failures or skipped scenarios, 3 when `--fail-on` matches a
 * check verdict, else 0.
 */
export function resolveRunExitCode(input: {
  scenarios: ReadonlyArray<RunReportScenario>
  failOn: ReadonlyArray<FailOnVerdict>
}) {
  if (
    input.scenarios.some(
      (scenario) =>
        scenario.status === "runner_failed" ||
        scenario.status === "dependency_failed"
    )
  ) {
    return 2
  }
  const failedOn = input.failOn.some((verdict) =>
    input.scenarios.some((scenario) =>
      verdict === "failed"
        ? scenario.failedCheckCount > 0
        : scenario.blockedCheckCount > 0
    )
  )
  return failedOn ? 3 : 0
}

export function parseFailOn(value: string | undefined): FailOnVerdict[] {
  if (value === undefined) {
    return []
  }
  const verdicts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
  if (verdicts.length === 0) {
    throw new Error("--fail-on needs failed, blocked, or failed,blocked.")
  }
  for (const verdict of verdicts) {
    if (verdict !== "failed" && verdict !== "blocked") {
      throw new Error(`--fail-on accepts failed and blocked, not "${verdict}".`)
    }
  }
  return [...new Set(verdicts)] as FailOnVerdict[]
}

// Formatting

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`
  }
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, "0")}s`
  }
  return `${seconds}s`
}

export function formatTokenCount(count: number) {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1000)}k`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`
  }
  return String(count)
}

export function formatTokens(tokens: TokenTotals | null) {
  if (!tokens) {
    return "n/a"
  }
  return `${formatTokenCount(tokens.total)}${tokens.complete ? "" : "+"}`
}

export function cachedShare(tokens: TokenTotals) {
  return tokens.input > 0
    ? Math.round((100 * tokens.cachedInput) / tokens.input)
    : 0
}

export function formatClock(timestamp: string | number) {
  const date = new Date(timestamp)
  return [date.getHours(), date.getMinutes()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function formatCheckBreakdown(scenario: {
  failedCheckCount: number
  blockedCheckCount: number
}) {
  const parts = [
    scenario.failedCheckCount > 0
      ? `${scenario.failedCheckCount} failed`
      : null,
    scenario.blockedCheckCount > 0
      ? `${scenario.blockedCheckCount} blocked`
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? ` (${parts.join(", ")})` : ""
}

export function formatRunner(run: RunReport["run"]) {
  return [
    run.runnerType,
    run.model ?? "default model",
    run.modelReasoningEffort,
  ]
    .filter(Boolean)
    .join(" · ")
}

function table(rows: string[][], alignRight: ReadonlySet<number>) {
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length))
  )
  return rows.map((row) =>
    row
      .map((cell, column) =>
        alignRight.has(column)
          ? cell.padStart(widths[column]!)
          : column === row.length - 1
            ? cell
            : cell.padEnd(widths[column]!)
      )
      .join("  ")
      .trimEnd()
  )
}

function scenarioCountsLine(run: RunReport["run"]) {
  const counts = run.scenarioCounts
  return [
    `${counts.completed} completed`,
    counts.runnerFailed > 0 ? plural(counts.runnerFailed, "error") : null,
    counts.skipped > 0 ? `${counts.skipped} skipped` : null,
    counts.interrupted > 0 ? `${counts.interrupted} interrupted` : null,
    counts.notRun > 0 ? `${counts.notRun} not run` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function checksLine(run: RunReport["run"]) {
  return `${run.passedCheckCount} passed · ${run.failedCheckCount} failed · ${run.blockedCheckCount} blocked of ${run.totalCheckCount}${run.passRate === null ? "" : ` (${run.passRate}%)`}`
}

function tokensLine(run: RunReport["run"]) {
  if (!run.tokens) {
    return "n/a (the runner reported no usage)"
  }
  const cost =
    run.estimatedCostUsd === null
      ? "cost n/a"
      : `~$${run.estimatedCostUsd.toFixed(2)} API-equivalent`
  return `${formatTokens(run.tokens)} (${cachedShare(run.tokens)}% cached) · ${formatTokenCount(run.tokens.output)} out · ${cost}${run.tokens.complete ? "" : " · + means incomplete usage"}`
}

function rerunCommand(run: RunReport["run"], slug: string) {
  return [
    "caracara run",
    run.environment ? `--environment ${run.environment}` : null,
    `--scenario ${slug}`,
  ]
    .filter(Boolean)
    .join(" ")
}

export type SummaryOptions = {
  /** Maximum line width for evidence lines. */
  width?: number
}

/** Full end-of-run summary. Lists only scenarios with problems. */
export function formatRunSummary(
  report: RunReport,
  options: SummaryOptions = {}
) {
  const width = Math.max(60, options.width ?? 100)
  const { run } = report
  const statusLabel = run.status.toUpperCase()
  const title = `━━ Run ${run.name} `
  const lines: string[] = [
    `${title}${"━".repeat(Math.max(2, Math.min(width, 90) - title.length - statusLabel.length - 1))} ${statusLabel}`,
  ]
  if (run.url) {
    lines.push(`Web        ${run.url}`)
  }
  lines.push(
    `Target     ${[run.environment, run.targetUrl].filter(Boolean).join("  ") || "n/a"}`,
    `Runner     ${formatRunner(run)}`,
    `Selection  ${run.selection}`,
    `Time       ${formatClock(run.startedAt)} → ${formatClock(run.finishedAt)} (${formatDuration(run.durationMs)})`,
    `Checks     ${checksLine(run)}`,
    `Scenarios  ${scenarioCountsLine(run)}`,
    `Tokens     ${tokensLine(run)}`
  )

  if (report.phases.length > 1) {
    const rows = [
      ["Phase", "Scen", "Passed", "Failed", "Blocked", "Time", "Tokens", ""],
      ...report.phases.map((phase) => [
        `${phase.order} ${toSingleLine(phase.name)}`,
        String(phase.scenarioCount),
        `${phase.passedCheckCount}/${phase.totalCheckCount}`,
        String(phase.failedCheckCount),
        String(phase.blockedCheckCount),
        formatDuration(phase.durationMs),
        formatTokens(phase.tokens),
        [
          phase.runnerFailedCount > 0
            ? plural(phase.runnerFailedCount, "error")
            : null,
          phase.skippedCount > 0 ? `${phase.skippedCount} skipped` : null,
          phase.notRunCount > 0 ? `${phase.notRunCount} not run` : null,
        ]
          .filter(Boolean)
          .join(", "),
      ]),
    ]
    lines.push("", ...table(rows, new Set([1, 2, 3, 4, 5, 6])))
  }

  const problemScenarios = report.scenarios.filter(
    (scenario) =>
      scenario.status === "completed" &&
      scenario.failedCheckCount + scenario.blockedCheckCount > 0
  )
  if (problemScenarios.length > 0) {
    const rows = [
      ["Scenario", "Passed", "Failed", "Blocked", "Time", "Tokens"],
      ...problemScenarios.map((scenario) => [
        scenario.slug,
        `${scenario.passedCheckCount}/${scenario.totalCheckCount}`,
        String(scenario.failedCheckCount),
        String(scenario.blockedCheckCount),
        formatDuration(scenario.durationMs),
        formatTokens(scenario.tokens),
      ]),
    ]
    lines.push("", ...table(rows, new Set([1, 2, 3, 4, 5])))
  }

  const checkLine = (
    scenario: RunReportScenario,
    check: RunReportCheck,
    tag: string
  ) => {
    const head = `  ${scenario.slug} › ${toSingleLine(check.name)}${tag}`
    const reason = check.reason ? toSingleLine(check.reason) : ""
    if (!reason) {
      return [head]
    }
    return [head, `      ${truncateToWidth(reason, width - 6)}`]
  }

  const failed = report.scenarios.flatMap((scenario) =>
    scenario.checks
      .filter((check) => check.verdict === "failed")
      .map((check) => ({ scenario, check }))
  )
  if (failed.length > 0) {
    lines.push("", `Failed checks (${failed.length})`)
    for (const { scenario, check } of failed) {
      lines.push(...checkLine(scenario, check, ""))
    }
  }

  const blocked = report.scenarios.flatMap((scenario) =>
    scenario.checks
      .filter((check) => check.verdict === "blocked")
      .map((check) => ({ scenario, check }))
  )
  if (blocked.length > 0) {
    const reasons = new Map<string, number>()
    for (const { check } of blocked) {
      const reason = check.blockedReason ?? "unknown"
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
    const reasonCounts = [...reasons.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => `${count} ${reason}`)
      .join(", ")
    lines.push("", `Blocked checks (${blocked.length}: ${reasonCounts})`)
    for (const { scenario, check } of blocked) {
      lines.push(
        ...checkLine(scenario, check, `  [${check.blockedReason ?? "unknown"}]`)
      )
    }
  }

  const errors = report.scenarios.filter(
    (scenario) =>
      scenario.status === "runner_failed" || scenario.status === "interrupted"
  )
  const skipped = report.scenarios.filter(
    (scenario) => scenario.status === "dependency_failed"
  )
  if (errors.length > 0 || skipped.length > 0) {
    lines.push("", `Execution errors (${errors.length})`)
    for (const scenario of errors) {
      lines.push(
        `  ${scenario.slug}${scenario.status === "interrupted" ? " (interrupted)" : ""}   ${truncateToWidth(toSingleLine(scenario.failureDetail ?? "Runner failed"), width - scenario.slug.length - 5)}`
      )
    }
    if (skipped.length > 0) {
      lines.push(
        `  ↳ skipped ${truncateToWidth(skipped.map((scenario) => scenario.slug).join(", "), width - 12)}`
      )
    }
  }

  const rerun = report.scenarios.filter(
    (scenario) => scenario.status === "runner_failed"
  )
  if (rerun.length > 0) {
    lines.push("")
    for (const scenario of rerun) {
      lines.push(`Rerun: ${rerunCommand(run, scenario.slug)}`)
    }
  }

  return `${lines.join("\n")}\n`
}

/** Compact summary for `--quiet`. */
export function formatCompactSummary(report: RunReport) {
  const { run } = report
  const ok = run.status === "completed" && run.exitCode === 0
  const lines = [
    `${ok ? "✓" : "✗"} ${run.name} ${run.status} · ${formatDuration(run.durationMs)} · ${formatRunner(run)} · ${formatTokens(run.tokens)} tok`,
    `  checks ${run.passedCheckCount}/${run.totalCheckCount} passed (${run.failedCheckCount} failed, ${run.blockedCheckCount} blocked) · ${plural(run.scenarioCounts.total, "scenario")}${run.scenarioCounts.runnerFailed > 0 ? `, ${plural(run.scenarioCounts.runnerFailed, "error")}` : ""}${run.scenarioCounts.skipped > 0 ? `, ${run.scenarioCounts.skipped} skipped` : ""}`,
    ...report.scenarios
      .filter((scenario) => scenario.status === "runner_failed")
      .map(
        (scenario) =>
          `  error ${scenario.slug}: ${truncateToWidth(toSingleLine(scenario.failureDetail ?? "Runner failed"), 120)}`
      ),
  ]
  if (run.url) {
    lines.push(`  ${run.url}`)
  }
  return `${lines.join("\n")}\n`
}
