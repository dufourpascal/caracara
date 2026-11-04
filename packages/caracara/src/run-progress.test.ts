import { afterEach, describe, expect, it, vi } from "vitest"

import { writeDiagnostic } from "./diagnostics.js"
import {
  parseHeartbeat,
  resolveOutputMode,
  RunProgress,
  type OutputStream,
  type RunStartInfo,
} from "./run-progress.js"
import { buildRunReport, type RunReportScenario } from "./run-report.js"

type FakeStream = OutputStream & { text: () => string; chunks: string[] }

function stream(tty = false, columns = 100, rows = 40): FakeStream {
  const chunks: string[] = []
  return {
    chunks,
    isTTY: tty,
    columns,
    rows,
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
    on: vi.fn(),
    off: vi.fn(),
    text: () => chunks.join(""),
  }
}

const T0 = new Date(2026, 10, 4, 3, 21, 4).getTime()

function setup(mode: "live" | "plain" | "quiet" | "json", heartbeatMs = 0) {
  let now = T0
  const stdout = stream(mode === "live")
  const stderr = stream(mode === "live")
  const progress = new RunProgress(
    mode,
    { stdout, stderr, env: {}, now: () => now },
    heartbeatMs
  )
  return {
    progress,
    stdout,
    stderr,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
  }
}

const start: RunStartInfo = {
  runId: "run-1",
  runName: "orderly-falcon-20261104-082151",
  runUrl: "https://caracara.example.com/projects/demo/runs/run-1",
  startedAt: T0,
  environment: "dev",
  targetUrl: "https://localhost:3010/",
  runnerType: "codex",
  model: "gpt-5.5",
  modelReasoningEffort: null,
  suite: null,
  selection: "phase 9",
  scenarioCount: 3,
  phaseCount: 1,
  keepGoing: false,
  liveActivity: true,
}

function finished(
  overrides: Partial<RunReportScenario> = {}
): RunReportScenario {
  return {
    sequenceIndex: 0,
    id: "s1",
    slug: "export-review-options",
    name: "Review options",
    phase: { id: "p9", order: 9, name: "Export" },
    status: "completed",
    startedAt: new Date(T0).toISOString(),
    finishedAt: new Date(T0 + 372_000).toISOString(),
    durationMs: 372_000,
    passedCheckCount: 5,
    failedCheckCount: 2,
    blockedCheckCount: 1,
    totalCheckCount: 8,
    tokens: {
      total: 1_900_000,
      input: 1_890_000,
      uncachedInput: 90_000,
      cachedInput: 1_800_000,
      cacheWriteInput: 0,
      output: 10_000,
      reasoningOutput: 0,
      complete: true,
    },
    estimatedCostUsd: null,
    failureDetail: null,
    checks: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("output mode", () => {
  it("uses the live panel only for an interactive stderr outside CI", () => {
    const tty = stream(true)
    expect(resolveOutputMode({ stderr: tty, env: {} })).toBe("live")
    expect(resolveOutputMode({ stderr: tty, env: { CI: "true" } })).toBe(
      "plain"
    )
    expect(resolveOutputMode({ stderr: tty, env: { CI: "false" } })).toBe(
      "live"
    )
    expect(resolveOutputMode({ stderr: tty, env: { TERM: "dumb" } })).toBe(
      "plain"
    )
    expect(resolveOutputMode({ stderr: stream(false), env: {} })).toBe("plain")
    expect(resolveOutputMode({ plain: true, stderr: tty, env: {} })).toBe(
      "plain"
    )
    expect(resolveOutputMode({ quiet: true, stderr: tty, env: {} })).toBe(
      "quiet"
    )
    expect(resolveOutputMode({ json: true, stderr: tty, env: {} })).toBe("json")
    expect(() =>
      resolveOutputMode({ json: true, quiet: true, stderr: tty, env: {} })
    ).toThrow("--json, --quiet cannot be combined.")
  })

  it("parses heartbeat durations", () => {
    expect(parseHeartbeat(undefined)).toBe(300_000)
    expect(parseHeartbeat("0")).toBe(0)
    expect(parseHeartbeat("30s")).toBe(30_000)
    expect(parseHeartbeat("90")).toBe(90_000)
    expect(parseHeartbeat("5m")).toBe(300_000)
    expect(parseHeartbeat("1h")).toBe(3_600_000)
    expect(() => parseHeartbeat("5s")).toThrow(/at least 10s/)
    expect(() => parseHeartbeat("soon")).toThrow(/duration/)
  })
})

describe("plain output", () => {
  it("prints timestamped lines for each step", () => {
    const { progress, stdout, advance } = setup("plain")
    progress.runStarted(start)
    progress.phaseStarted({
      order: 9,
      name: "Export",
      index: 1,
      scenarioCount: 3,
    })
    progress.scenarioStarted({
      index: 1,
      slug: "export-review-options",
      phaseOrder: 9,
    })
    advance(372_000)
    progress.scenarioFinished(finished())
    progress.scenarioStarted({
      index: 2,
      slug: "export-full-project",
      phaseOrder: 9,
    })
    advance(60_000)
    progress.scenarioFinished(
      finished({
        sequenceIndex: 1,
        slug: "export-full-project",
        status: "runner_failed",
        failureDetail: "Codex did not capture\nrequired evidence.",
      })
    )
    progress.scenarioFinished(
      finished({
        sequenceIndex: 2,
        slug: "export-history-reexport",
        status: "dependency_failed",
        tokens: null,
        failureDetail:
          "Skipped after an execution error earlier in this phase.",
      })
    )
    progress.dispose()

    expect(stdout.text().split("\n")).toEqual([
      "03:21:04 run orderly-falcon-20261104-082151 started · dev https://localhost:3010/ · codex gpt-5.5 · phase 9 · 3 scenarios · https://caracara.example.com/projects/demo/runs/run-1",
      "03:21:04 phase 9 Export (3 scenarios)",
      "03:27:16 [1/3] export-review-options 5/8 (2 failed, 1 blocked) 6m12s 1.9M tok",
      "03:28:16 [2/3] export-full-project ERROR Codex did not capture required evidence.",
      "03:28:16 [3/3] export-history-reexport SKIPPED Skipped after an execution error earlier in this phase.",
      "",
    ])
  })

  it("reports a running scenario on each heartbeat", () => {
    vi.useFakeTimers()
    const { progress, stdout, advance } = setup("plain", 300_000)
    progress.runStarted(start)
    progress.scenarioStarted({
      index: 2,
      slug: "export-full-project",
      phaseOrder: 9,
    })
    for (const id of ["a", "b", "b", "c"]) {
      progress.activity({
        id,
        label: "chrome-devtools.click",
        toolCall: true,
        status: "started",
      })
    }
    advance(296_000)
    progress.activity({
      id: null,
      label: "thinking",
      toolCall: false,
      status: "completed",
    })
    advance(4000)
    vi.advanceTimersByTime(300_000)
    progress.scenarioFinished(finished({ sequenceIndex: 1 }))
    vi.advanceTimersByTime(300_000)
    progress.dispose()

    const heartbeats = stdout
      .text()
      .split("\n")
      .filter((line) => line.includes("running"))
    expect(heartbeats).toEqual([
      "03:26:04 [2/3] export-full-project running 5m00s · 3 tool calls · last: thinking 4s ago",
    ])
  })
})

describe("quiet and JSON output", () => {
  it("prints nothing but the compact summary when quiet", () => {
    const { progress, stdout } = setup("quiet")
    progress.runStarted(start)
    progress.scenarioStarted({ index: 1, slug: "a", phaseOrder: 9 })
    progress.scenarioFinished(finished())
    expect(stdout.text()).toBe("")
    progress.runFinished(
      buildRunReport({
        run: {
          id: "run-1",
          name: start.runName,
          url: start.runUrl,
          status: "completed",
          mode: "phase",
          selection: "phase 9",
          environment: "dev",
          targetUrl: start.targetUrl,
          runnerType: "codex",
          model: null,
          modelReasoningEffort: null,
          startedAt: T0,
          finishedAt: T0 + 372_000,
          exitCode: 0,
        },
        queue: [{ phase: { id: "p9", order: 9, name: "Export" } }],
        scenarios: [finished()],
      })
    )
    expect(stdout.text()).toMatch(
      /^✓ orderly-falcon-20261104-082151 completed · 6m12s/
    )
  })

  it("writes one JSON event per line and only on stdout", () => {
    const { progress, stdout, stderr } = setup("json")
    progress.runStarted(start)
    progress.phaseStarted({
      order: 9,
      name: "Export",
      index: 1,
      scenarioCount: 3,
    })
    progress.scenarioStarted({
      index: 1,
      slug: "export-review-options",
      phaseOrder: 9,
    })
    progress.activity({
      id: "i1",
      label: "chrome-devtools.click",
      toolCall: true,
      status: "started",
    })
    progress.activity({
      id: "i1",
      label: "chrome-devtools.click",
      toolCall: true,
      status: "completed",
    })
    progress.activity({
      id: null,
      label: "thinking",
      toolCall: false,
      status: "completed",
    })
    progress.scenarioFinished(finished())
    progress.dispose()

    const events = stdout
      .text()
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "phase.started",
      "scenario.started",
      "agent.action",
      "agent.action",
      "scenario.finished",
    ])
    expect(events.every((event) => event.v === 1)).toBe(true)
    expect(events[3]).toMatchObject({
      action: "chrome-devtools.click",
      toolCalls: 1,
    })
    expect(events[5]).toMatchObject({
      scenario: "export-review-options",
      status: "completed",
      checks: { passed: 5, failed: 2, blocked: 1, total: 8 },
      toolCalls: 1,
      error: null,
    })
    expect(stderr.text()).toBe("")
  })
})

describe("live panel", () => {
  it("draws the panel on stderr and clears it before printing lines", () => {
    vi.useFakeTimers()
    const { progress, stdout, stderr, advance } = setup("live")
    progress.runStarted(start)
    progress.phaseStarted({
      order: 9,
      name: "Export",
      index: 1,
      scenarioCount: 3,
    })
    progress.scenarioStarted({
      index: 1,
      slug: "export-review-options",
      phaseOrder: 9,
    })
    progress.activity({
      id: "i1",
      label: "chrome-devtools.take_screenshot",
      toolCall: true,
      status: "started",
    })
    advance(3000)

    const panel = progress.renderPanel()
    expect(panel).toHaveLength(4)
    expect(panel[1]).toContain(
      "Phase 9 Export (1 of 1) · 1/3 export-review-options"
    )
    expect(panel[1]).toContain("0%")
    expect(panel[2]).toContain("elapsed 3s · ETA —")
    expect(panel[3]).toContain(
      "3s · chrome-devtools.take_screenshot · 1 tool call · last event 3s ago"
    )
    expect(panel.every((line) => line.length <= 100)).toBe(true)

    stderr.chunks.length = 0
    progress.scenarioFinished(finished())
    // The panel is cleared before the line is written, then redrawn.
    expect(stderr.chunks[0]).toBe("\r\u001b[4A\u001b[J")
    expect(stdout.text()).toContain(
      "export-review-options  5/8 (2 failed, 1 blocked)"
    )

    stderr.chunks.length = 0
    writeDiagnostic("Chrome DevTools proxy error: boom\n")
    expect(stderr.chunks[0]).toBe("\r\u001b[4A\u001b[J")
    expect(stderr.chunks[1]).toBe("Chrome DevTools proxy error: boom\n")

    progress.dispose()
    const disposedAt = stderr.chunks.length
    vi.advanceTimersByTime(5000)
    expect(stderr.chunks.length).toBe(disposedAt)
  })

  it("estimates the remaining time from finished scenarios", () => {
    const { progress, advance } = setup("live")
    progress.runStarted(start)
    progress.scenarioStarted({ index: 1, slug: "a", phaseOrder: null })
    advance(600_000)
    progress.scenarioFinished(finished({ durationMs: 600_000 }))
    progress.scenarioStarted({ index: 2, slug: "b", phaseOrder: null })
    advance(120_000)

    expect(progress.renderPanel()[2]).toContain("ETA ~18m00s")
    progress.dispose()
  })

  it("restores plain stderr diagnostics after dispose", () => {
    const { progress, stderr } = setup("live")
    progress.dispose()
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true)
    writeDiagnostic("after\n")
    expect(write).toHaveBeenCalledWith("after\n")
    expect(stderr.text()).toBe("")
  })

  it("skips the panel on terminals that are too short", () => {
    let now = T0
    const stderr = stream(true, 100, 4)
    const stdout = stream(true)
    const progress = new RunProgress(
      "live",
      { stdout, stderr, env: {}, now: () => now },
      0
    )
    progress.runStarted(start)
    progress.scenarioStarted({ index: 1, slug: "a", phaseOrder: null })
    now += 1000
    expect(stderr.text()).toBe("")
    progress.dispose()
  })
})
