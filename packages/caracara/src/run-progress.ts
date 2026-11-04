import { setDiagnosticWriter } from "./diagnostics.js"
import type { RunnerActivity } from "./execution.js"
import {
  cachedShare,
  formatCheckBreakdown,
  formatCompactSummary,
  formatDuration,
  formatRunSummary,
  formatTokens,
  sumTokenTotals,
  type RunReport,
  type RunReportScenario,
} from "./run-report.js"
import {
  toSingleLine,
  truncateStyledLine,
  truncateToWidth,
} from "./terminal-text.js"

export type OutputMode = "live" | "plain" | "quiet" | "json"

export type OutputStream = {
  write(chunk: string): unknown
  isTTY?: boolean
  columns?: number
  rows?: number
  on?(event: "resize", listener: () => void): unknown
  off?(event: "resize", listener: () => void): unknown
}

export type ProgressIo = {
  stdout: OutputStream
  stderr: OutputStream
  env: NodeJS.ProcessEnv
  now: () => number
}

export const DEFAULT_HEARTBEAT_MS = 5 * 60_000
const PANEL_REFRESH_MS = 500
const MIN_PANEL_COLUMNS = 40
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * Picks the output mode: explicit flags win, otherwise the live panel when
 * stderr is an interactive terminal outside CI, and plain lines elsewhere.
 */
export function resolveOutputMode(input: {
  json?: boolean
  quiet?: boolean
  plain?: boolean
  stderr: OutputStream
  env: NodeJS.ProcessEnv
}): OutputMode {
  const explicit = [
    input.json ? "--json" : null,
    input.quiet ? "--quiet" : null,
    input.plain ? "--plain" : null,
  ].filter((flag): flag is string => flag !== null)
  if (explicit.length > 1) {
    throw new Error(`${explicit.join(", ")} cannot be combined.`)
  }
  if (input.json) {
    return "json"
  }
  if (input.quiet) {
    return "quiet"
  }
  if (input.plain) {
    return "plain"
  }
  const ci = input.env.CI
  const inCi = ci !== undefined && ci !== "" && ci !== "0" && ci !== "false"
  return input.stderr.isTTY === true && !inCi && input.env.TERM !== "dumb"
    ? "live"
    : "plain"
}

/** Parses `30s`, `5m`, `1h` or bare seconds; `0` disables the heartbeat. */
export function parseHeartbeat(value: string | undefined) {
  if (value === undefined) {
    return DEFAULT_HEARTBEAT_MS
  }
  const match = /^(\d+)(s|m|h)?$/.exec(value.trim())
  if (!match) {
    throw new Error(
      "--heartbeat must be a duration such as 30s, 5m or 1h, or 0 to turn it off."
    )
  }
  const amount = Number.parseInt(match[1]!, 10)
  const unit = match[2] ?? "s"
  const ms = amount * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000)
  if (ms !== 0 && ms < 10_000) {
    throw new Error("--heartbeat must be at least 10s, or 0 to turn it off.")
  }
  return ms
}

export type RunStartInfo = {
  runId: string
  runName: string
  runUrl: string | null
  startedAt: number
  environment: string | null
  targetUrl: string | null
  runnerType: string
  model: string | null
  modelReasoningEffort: string | null
  suite: { name: string; slug: string } | null
  selection: string
  scenarioCount: number
  phaseCount: number
  keepGoing: boolean
  /** False when the runner cannot report agent steps while it works. */
  liveActivity: boolean
}

export type PhaseInfo = {
  order: number
  name: string
  /** 1-based position among the run's phases. */
  index: number
  scenarioCount: number
}

export type ScenarioInfo = {
  /** 1-based position in the run. */
  index: number
  slug: string
  phaseOrder: number | null
}

type ActiveScenario = ScenarioInfo & {
  startedAt: number
  lastEventAt: number
  currentAction: string | null
  toolCallIds: Set<string>
  anonymousToolCalls: number
}

const COLOR = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
}

function timestamp(now: number) {
  const date = new Date(now)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

function toolCallCount(scenario: ActiveScenario) {
  return scenario.toolCallIds.size + scenario.anonymousToolCalls
}

/**
 * Reports run progress in one of four modes. Live mode keeps a three-line
 * panel at the bottom of stderr; every other line goes to stdout above it.
 */
export class RunProgress {
  private start: RunStartInfo | null = null
  private phase: PhaseInfo | null = null
  private active: ActiveScenario | null = null
  private readonly finished: RunReportScenario[] = []
  private panelLines = 0
  private spinnerFrame = 0
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private readonly color: boolean
  private readonly onResize = () => this.redraw()

  constructor(
    readonly mode: OutputMode,
    private readonly io: ProgressIo,
    private readonly heartbeatMs: number = DEFAULT_HEARTBEAT_MS
  ) {
    this.color =
      mode === "live" &&
      (io.env.NO_COLOR === undefined || io.env.NO_COLOR === "")
    if (mode === "live") {
      setDiagnosticWriter((text) => {
        this.clearPanel()
        this.io.stderr.write(text)
        this.drawPanel()
      })
      this.io.stderr.on?.("resize", this.onResize)
      this.refreshTimer = setInterval(() => {
        this.spinnerFrame += 1
        this.redraw()
      }, PANEL_REFRESH_MS)
      this.refreshTimer.unref?.()
    }
  }

  runStarted(info: RunStartInfo) {
    this.start = info
    const now = this.io.now()
    if (this.mode === "json") {
      this.event("run.started", {
        run: { id: info.runId, name: info.runName, url: info.runUrl },
        environment: info.environment,
        targetUrl: info.targetUrl,
        runner: info.runnerType,
        model: info.model,
        modelReasoningEffort: info.modelReasoningEffort,
        suite: info.suite,
        selection: info.selection,
        scenarioCount: info.scenarioCount,
        phaseCount: info.phaseCount,
        keepGoing: info.keepGoing,
      })
      return
    }
    if (this.mode === "quiet") {
      return
    }
    const runner = [info.runnerType, info.model, info.modelReasoningEffort]
      .filter(Boolean)
      .join(" ")
    const target = [info.environment, info.targetUrl].filter(Boolean).join(" ")
    if (this.mode === "plain") {
      this.out(
        `${timestamp(now)} run ${info.runName} started · ${target} · ${runner} · ${info.selection} · ${info.scenarioCount} scenario${info.scenarioCount === 1 ? "" : "s"}${info.runUrl ? ` · ${info.runUrl}` : ""}\n`
      )
      return
    }
    const lines = [`Run ${info.runName} · ${target} · ${runner}`]
    if (info.suite) {
      lines.push(`Suite ${info.suite.name} (${info.suite.slug})`)
    }
    if (info.runUrl) {
      lines.push(this.paint(COLOR.dim, `    ${info.runUrl}`))
    }
    this.out(`${lines.join("\n")}\n`)
  }

  phaseStarted(phase: PhaseInfo) {
    this.phase = phase
    if (this.mode === "json") {
      this.event("phase.started", {
        phase: phase.order,
        name: phase.name,
        index: phase.index,
        scenarioCount: phase.scenarioCount,
      })
    } else if (this.mode === "plain") {
      this.out(
        `${timestamp(this.io.now())} phase ${phase.order} ${toSingleLine(phase.name)} (${phase.scenarioCount} scenario${phase.scenarioCount === 1 ? "" : "s"})\n`
      )
    } else if (this.mode === "live") {
      this.out(`\nPhase ${phase.order}: ${toSingleLine(phase.name)}\n`)
    }
  }

  scenarioStarted(scenario: ScenarioInfo) {
    const now = this.io.now()
    this.active = {
      ...scenario,
      startedAt: now,
      lastEventAt: now,
      currentAction: null,
      toolCallIds: new Set(),
      anonymousToolCalls: 0,
    }
    if (this.mode === "json") {
      this.event("scenario.started", {
        index: scenario.index,
        total: this.start?.scenarioCount ?? null,
        phase: scenario.phaseOrder,
        scenario: scenario.slug,
      })
    }
    if (this.mode === "plain" && this.heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(
        () => this.heartbeat(),
        this.heartbeatMs
      )
      this.heartbeatTimer.unref?.()
    }
    this.redraw()
  }

  activity(activity: RunnerActivity) {
    const active = this.active
    if (!active) {
      return
    }
    active.lastEventAt = this.io.now()
    if (activity.toolCall) {
      if (activity.id) {
        active.toolCallIds.add(activity.id)
      } else if (activity.status === "started") {
        active.anonymousToolCalls += 1
      }
    }
    const label = toSingleLine(activity.label)
    const changed = active.currentAction !== label
    active.currentAction = label
    if (this.mode === "json" && changed) {
      this.event("agent.action", {
        scenario: active.slug,
        action: label,
        toolCall: activity.toolCall,
        status: activity.status,
        toolCalls: toolCallCount(active),
      })
    }
  }

  scenarioFinished(scenario: RunReportScenario) {
    this.stopHeartbeat()
    this.finished.push(scenario)
    const index = scenario.sequenceIndex + 1
    const total = this.start?.scenarioCount ?? index
    const toolCalls = this.active ? toolCallCount(this.active) : 0
    this.active = null
    if (this.mode === "json") {
      this.event("scenario.finished", {
        index,
        total,
        phase: scenario.phase?.order ?? null,
        scenario: scenario.slug,
        status: scenario.status,
        checks: {
          passed: scenario.passedCheckCount,
          failed: scenario.failedCheckCount,
          blocked: scenario.blockedCheckCount,
          total: scenario.totalCheckCount,
        },
        durationMs: scenario.durationMs,
        toolCalls,
        tokens: scenario.tokens,
        error: scenario.status === "completed" ? null : scenario.failureDetail,
      })
      return
    }
    if (this.mode === "quiet") {
      return
    }
    const detail = toSingleLine(scenario.failureDetail ?? "")
    const tokens = scenario.tokens
      ? ` ${formatTokens(scenario.tokens)} tok`
      : ""
    if (this.mode === "plain") {
      const head = `${timestamp(this.io.now())} [${index}/${total}] ${scenario.slug}`
      const body =
        scenario.status === "completed"
          ? `${scenario.passedCheckCount}/${scenario.totalCheckCount}${formatCheckBreakdown(scenario)} ${formatDuration(scenario.durationMs)}${tokens}`
          : scenario.status === "runner_failed"
            ? `ERROR ${detail}`
            : scenario.status === "dependency_failed"
              ? `SKIPPED ${detail}`
              : `INTERRUPTED ${detail}`
      this.out(`${head} ${body}\n`)
      return
    }
    const width = this.width()
    const line =
      scenario.status === "completed"
        ? `  ${this.scenarioGlyph(scenario)} ${scenario.slug}  ${scenario.passedCheckCount}/${scenario.totalCheckCount}${formatCheckBreakdown(scenario)}  ${formatDuration(scenario.durationMs)}${tokens ? ` ${tokens}` : ""}`
        : scenario.status === "runner_failed"
          ? `  ${this.paint(COLOR.red, "!")} ${scenario.slug}  ${this.paint(COLOR.red, "error:")} ${detail}`
          : scenario.status === "dependency_failed"
            ? `  ${this.paint(COLOR.dim, "–")} ${scenario.slug}  ${this.paint(COLOR.dim, `skipped: ${detail}`)}`
            : `  ${this.paint(COLOR.yellow, "■")} ${scenario.slug}  interrupted`
    this.out(`${truncateStyledLine(line, width)}\n`)
  }

  runFinished(report: RunReport) {
    this.stopHeartbeat()
    this.active = null
    if (this.mode === "json") {
      this.event("run.finished", {
        status: report.run.status,
        exitCode: report.run.exitCode,
        runUrl: report.run.url,
        report,
      })
      return
    }
    const summary =
      this.mode === "quiet"
        ? formatCompactSummary(report)
        : formatRunSummary(report, { width: this.width() })
    this.out(this.mode === "quiet" ? summary : `\n${summary}`)
  }

  /** Stops timers, clears the panel and restores stderr diagnostics. */
  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.stopHeartbeat()
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    if (this.mode === "live") {
      this.clearPanel()
      this.io.stderr.off?.("resize", this.onResize)
      setDiagnosticWriter(null)
    }
  }

  // Internals

  private event(type: string, data: Record<string, unknown>) {
    this.io.stdout.write(
      `${JSON.stringify({ v: 1, type, ts: new Date(this.io.now()).toISOString(), ...data })}\n`
    )
  }

  private out(text: string) {
    if (this.mode === "live") {
      this.clearPanel()
      this.io.stdout.write(text)
      this.drawPanel()
      return
    }
    this.io.stdout.write(text)
  }

  private paint(color: string, text: string) {
    return this.color ? `${color}${text}${COLOR.reset}` : text
  }

  private scenarioGlyph(scenario: RunReportScenario) {
    if (scenario.failedCheckCount > 0) {
      return this.paint(COLOR.red, "✗")
    }
    if (scenario.blockedCheckCount > 0) {
      return this.paint(COLOR.yellow, "⊘")
    }
    return this.paint(COLOR.green, "✓")
  }

  private width() {
    const columns = this.io.stderr.columns ?? this.io.stdout.columns
    return columns && columns > 0 ? Math.max(1, columns - 1) : 79
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private heartbeat() {
    const active = this.active
    if (!active || this.disposed) {
      return
    }
    const now = this.io.now()
    const total = this.start?.scenarioCount ?? active.index
    const action = active.currentAction
      ? ` · last: ${active.currentAction} ${formatDuration(now - active.lastEventAt)} ago`
      : this.start?.liveActivity === false
        ? " · no live activity for this runner"
        : ""
    this.out(
      `${timestamp(now)} [${active.index}/${total}] ${active.slug} running ${formatDuration(now - active.startedAt)} · ${toolCallCount(active)} tool calls${action}\n`
    )
  }

  private totals() {
    const sum = (pick: (scenario: RunReportScenario) => number) =>
      this.finished.reduce((total, scenario) => total + pick(scenario), 0)
    return {
      passed: sum((scenario) => scenario.passedCheckCount),
      failed: sum((scenario) => scenario.failedCheckCount),
      blocked: sum((scenario) => scenario.blockedCheckCount),
      errors: this.finished.filter(
        (scenario) => scenario.status === "runner_failed"
      ).length,
      tokens: sumTokenTotals(this.finished),
    }
  }

  /** Remaining time from the mean duration of executed scenarios. */
  private eta(now: number) {
    const total = this.start?.scenarioCount ?? 0
    const executed = this.finished.filter(
      (scenario) =>
        scenario.status === "completed" || scenario.status === "runner_failed"
    )
    if (executed.length === 0 || total === 0) {
      return null
    }
    const mean =
      executed.reduce((sum, scenario) => sum + scenario.durationMs, 0) /
      executed.length
    const remaining = total - this.finished.length
    const currentElapsed = this.active ? now - this.active.startedAt : 0
    return Math.max(0, mean * remaining - currentElapsed)
  }

  /** The three panel lines, already cut to the terminal width. */
  renderPanel(now = this.io.now()) {
    const start = this.start
    if (!start) {
      return []
    }
    const width = this.width()
    const total = start.scenarioCount
    const done = this.finished.length
    const percent = total > 0 ? Math.floor((100 * done) / total) : 0
    const barWidth = 20
    const filled = Math.round((barWidth * done) / Math.max(1, total))
    const bar = `${"█".repeat(filled)}${"░".repeat(barWidth - filled)}`
    const active = this.active
    const position = active
      ? `${active.index}/${total} ${active.slug}`
      : `${done}/${total}`
    const phase =
      this.phase && start.phaseCount > 0
        ? `Phase ${this.phase.order} ${toSingleLine(this.phase.name)} (${this.phase.index} of ${start.phaseCount}) · `
        : ""
    const head = `${phase}${position}`
    const tail = `  ${bar} ${String(percent).padStart(3)}%`
    const line1 = ` ${truncateToWidth(head, Math.max(10, width - tail.length - 1))}${tail}`

    const totals = this.totals()
    const eta = this.eta(now)
    const elapsed = now - start.startedAt
    const etaText =
      eta === null
        ? "ETA —"
        : `ETA ~${formatDuration(eta)} (${new Date(now + eta).toTimeString().slice(0, 5)})`
    const tokens = totals.tokens
      ? `${formatTokens(totals.tokens)} tok (${cachedShare(totals.tokens)}% cached)`
      : "0 tok"
    const checks = `checks ${this.paint(COLOR.green, `✓${totals.passed}`)} ${this.paint(COLOR.red, `✗${totals.failed}`)} ${this.paint(COLOR.yellow, `⊘${totals.blocked}`)}`
    const errors =
      totals.errors > 0
        ? ` · ${this.paint(COLOR.red, `${totals.errors} error${totals.errors === 1 ? "" : "s"}`)}`
        : ""
    const line2 = ` elapsed ${formatDuration(elapsed)} · ${etaText} · ${checks} · ${tokens}${errors}`

    let line3: string
    if (active) {
      const spinner = this.paint(
        COLOR.cyan,
        SPINNER[this.spinnerFrame % SPINNER.length]!
      )
      const action =
        active.currentAction ??
        (start.liveActivity
          ? "starting agent"
          : "no live activity for this runner")
      const calls = toolCallCount(active)
      const lastEvent = start.liveActivity
        ? ` · last event ${formatDuration(now - active.lastEventAt)} ago`
        : ""
      line3 = ` ${spinner} ${formatDuration(now - active.startedAt)} · ${action}${calls > 0 ? ` · ${calls} tool call${calls === 1 ? "" : "s"}` : ""}${lastEvent}`
    } else {
      line3 = this.paint(COLOR.dim, " waiting for the next scenario")
    }
    const rule = this.paint(COLOR.dim, "─".repeat(Math.min(width, 90)))
    return [rule, line1, line2, line3].map((line) =>
      truncateStyledLine(line, width)
    )
  }

  private drawPanel() {
    if (this.mode !== "live" || this.disposed) {
      return
    }
    // Too small for a panel that never wraps: skip it rather than corrupt
    // the scrollback.
    const { rows, columns } = this.io.stderr
    if (
      (rows !== undefined && rows < 6) ||
      (columns !== undefined && columns < MIN_PANEL_COLUMNS)
    ) {
      return
    }
    const lines = this.renderPanel()
    if (lines.length === 0) {
      return
    }
    this.io.stderr.write(`${lines.join("\n")}\n`)
    this.panelLines = lines.length
  }

  private clearPanel() {
    if (this.panelLines > 0) {
      // Back to the first panel line, column 1, then clear to the end.
      this.io.stderr.write(`\r\u001b[${this.panelLines}A\u001b[J`)
      this.panelLines = 0
    }
  }

  private redraw() {
    if (this.mode !== "live" || this.disposed) {
      return
    }
    this.clearPanel()
    this.drawPanel()
  }
}
