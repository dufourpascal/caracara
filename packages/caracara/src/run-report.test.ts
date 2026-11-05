import type { OrderedScenario } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import {
  buildRunReport,
  buildScenarioReport,
  formatCompactSummary,
  formatDuration,
  formatRunSummary,
  formatTokenCount,
  parseFailOn,
  resolveRunExitCode,
  type RunReportScenario,
} from "./run-report.js"

const checkIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
]

function scenario(slug: string, phaseOrder: number): OrderedScenario {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    status: "active",
    instructions: "Do it.",
    evaluationChecks: checkIds.map((id, index) => ({
      id,
      name: `Check ${index + 1}`,
      expectation: "Works.",
    })),
    phaseId: `phase-${phaseOrder}`,
    phaseName: phaseOrder === 1 ? "Setup" : "Export",
    phaseOrder,
    dependencyIds: [],
    fixtureRequirements: [],
  }
}

const usage = {
  complete: true,
  usage: {
    inputTokens: 1_000_000,
    cachedInputTokens: 900_000,
    cacheWriteInputTokens: 0,
    outputTokens: 5000,
    reasoningOutputTokens: 100,
    estimatedCostUsd: null,
  },
}

function report(
  slug: string,
  sequenceIndex: number,
  phaseOrder: number,
  status: RunReportScenario["status"],
  verdicts: Array<"passed" | "failed" | "blocked"> = []
) {
  const source = scenario(slug, phaseOrder)
  return buildScenarioReport({
    sequenceIndex,
    scenario: source,
    phase: {
      id: `phase-${phaseOrder}`,
      order: phaseOrder,
      name: source.phaseName!,
    },
    status,
    startedAt: Date.UTC(2026, 10, 4, 7, 0, sequenceIndex * 60),
    finishedAt: Date.UTC(2026, 10, 4, 7, 0, sequenceIndex * 60 + 42),
    checkResults: verdicts.map((verdict, index) => ({
      checkId: checkIds[index]!,
      verdict,
      evidence: `Evidence for check ${index + 1}.`,
      blockedReason: verdict === "blocked" ? "tool_limit" : null,
    })),
    usage: status === "dependency_failed" ? null : usage,
    failureDetail:
      status === "runner_failed"
        ? "Codex did not capture required screenshot evidence."
        : status === "dependency_failed"
          ? "Skipped after an execution error earlier in this phase."
          : null,
  })
}

const scenarios = [
  report("login", 0, 1, "completed", ["passed", "passed", "passed"]),
  report("review-options", 1, 2, "completed", ["passed", "failed", "blocked"]),
  report("full-export", 2, 2, "runner_failed"),
  report("history", 3, 2, "dependency_failed"),
]
const queue = [1, 2, 2, 2, 2].map((order) => ({
  phase: {
    id: `phase-${order}`,
    order,
    name: order === 1 ? "Setup" : "Export",
  },
}))

function buildReport(
  exitCode = 2,
  fixturePreflight?: Parameters<typeof buildRunReport>[0]["fixturePreflight"]
) {
  return buildRunReport({
    fixturePreflight,
    run: {
      id: "run-1",
      name: "orderly-falcon-20261104-082151",
      url: "https://caracara.example.com/projects/demo/runs/run-1",
      status: "failed",
      mode: "phases",
      selection: "phases 1, 2",
      environment: "dev",
      targetUrl: "https://localhost:3010/",
      runnerType: "codex",
      model: "gpt-5.5",
      modelReasoningEffort: "high",
      startedAt: Date.UTC(2026, 10, 4, 7, 0, 0),
      finishedAt: Date.UTC(2026, 10, 4, 8, 31, 0),
      exitCode,
    },
    queue,
    scenarios,
  })
}

describe("run report", () => {
  it("adds up checks, scenarios, phases and tokens", () => {
    const { run, phases } = buildReport()

    expect(run).toMatchObject({
      passedCheckCount: 4,
      failedCheckCount: 1,
      blockedCheckCount: 1,
      totalCheckCount: 6,
      passRate: null,
      durationMs: 91 * 60_000,
      scenarioCounts: {
        total: 5,
        completed: 2,
        runnerFailed: 1,
        skipped: 1,
        interrupted: 0,
        notRun: 1,
      },
    })
    expect(run.tokens?.total).toBe(3_015_000)
    expect(run.tokens?.cachedInput).toBe(2_700_000)
    expect(phases).toEqual([
      expect.objectContaining({
        order: 1,
        scenarioCount: 1,
        passedCheckCount: 3,
        totalCheckCount: 3,
      }),
      expect.objectContaining({
        order: 2,
        scenarioCount: 4,
        passedCheckCount: 1,
        failedCheckCount: 1,
        blockedCheckCount: 1,
        runnerFailedCount: 1,
        skippedCount: 1,
        notRunCount: 1,
      }),
    ])
  })

  it("reports a pass rate only for completed runs", () => {
    const completed = buildRunReport({
      run: {
        ...buildReport().run,
        status: "completed",
        startedAt: 0,
        finishedAt: 1,
        exitCode: 0,
      },
      queue: queue.slice(0, 1),
      scenarios: scenarios.slice(0, 1),
    })
    expect(completed.run.passRate).toBe(100)
  })
})

describe("token completeness", () => {
  it("marks run totals incomplete when a scenario ran without usage", () => {
    const withUsage = scenarios[0]!
    const noUsage = buildScenarioReport({
      sequenceIndex: 1,
      scenario: scenario("no-usage", 1),
      phase: null,
      status: "runner_failed",
      startedAt: 0,
      finishedAt: 1,
      checkResults: [],
      usage: { complete: false },
      failureDetail: "Codex crashed.",
    })
    const result = buildRunReport({
      run: { ...buildReport().run, startedAt: 0, finishedAt: 1, exitCode: 2 },
      queue: [{ phase: null }, { phase: null }],
      scenarios: [withUsage, noUsage],
    })
    expect(noUsage.tokens).toMatchObject({ total: 0, complete: false })
    expect(result.run.tokens).toMatchObject({
      total: withUsage.tokens!.total,
      complete: false,
    })
    expect(formatCompactSummary(result)).toContain("1.0M+ tok")
  })
})

describe("exit codes", () => {
  it("returns 2 for runner failures or skipped scenarios", () => {
    expect(resolveRunExitCode({ scenarios, failOn: [] })).toBe(2)
    expect(resolveRunExitCode({ scenarios: [scenarios[3]!], failOn: [] })).toBe(
      2
    )
  })

  it("returns 3 only when --fail-on matches", () => {
    const completed = scenarios.slice(0, 2)
    expect(resolveRunExitCode({ scenarios: completed, failOn: [] })).toBe(0)
    expect(
      resolveRunExitCode({ scenarios: completed, failOn: ["failed"] })
    ).toBe(3)
    expect(
      resolveRunExitCode({ scenarios: completed, failOn: ["blocked"] })
    ).toBe(3)
    expect(
      resolveRunExitCode({
        scenarios: completed.slice(0, 1),
        failOn: ["failed", "blocked"],
      })
    ).toBe(0)
  })

  it("parses --fail-on", () => {
    expect(parseFailOn(undefined)).toEqual([])
    expect(parseFailOn("failed,blocked")).toEqual(["failed", "blocked"])
    expect(() => parseFailOn("passed")).toThrow(/failed and blocked/)
    expect(() => parseFailOn(",")).toThrow(/--fail-on/)
  })
})

describe("summary", () => {
  it("lists only problem scenarios, failed and blocked checks and errors", () => {
    const text = formatRunSummary(buildReport(), { width: 100 })

    expect(text).toContain("FAILED")
    expect(text).toContain(
      "Web        https://caracara.example.com/projects/demo/runs/run-1"
    )
    expect(text).toContain("Runner     codex · gpt-5.5 · high")
    expect(text).toContain("Checks     4 passed · 1 failed · 1 blocked of 6")
    expect(text).toContain(
      "Scenarios  2 completed · 1 error · 1 skipped · 1 not run"
    )
    // Phase table
    expect(text).toMatch(/1 Setup\s+1\s+3\/3/)
    // Scenario table lists only scenarios with failed or blocked checks
    expect(text).toMatch(/review-options\s+1\/3\s+1\s+1/)
    expect(text).not.toMatch(/^login\s/m)
    expect(text).toContain(
      "Failed checks (1)\n  review-options › Check 2\n      Evidence for check 2."
    )
    expect(text).toContain("Blocked checks (1: 1 tool_limit)")
    expect(text).toContain("  review-options › Check 3  [tool_limit]")
    expect(text).toContain("Execution errors (1)")
    expect(text).toContain(
      "full-export   Codex did not capture required screenshot evidence."
    )
    expect(text).toContain("  ↳ skipped history")
    expect(text).toContain(
      "Rerun: caracara run --environment dev --scenario full-export"
    )
  })

  it("shows the fixture preflight", () => {
    const fixturePreflight = [
      {
        fixtureId: "fixture-1",
        fixtureSlug: "demo-user",
        fixtureName: "Demo user",
        access: "read" as const,
        outcome: "healthy" as const,
        executor: "hook" as const,
      },
      {
        fixtureId: "fixture-2",
        fixtureSlug: "catalog",
        fixtureName: "Catalog",
        access: "mutates" as const,
        outcome: "skipped" as const,
        executor: null,
      },
    ]
    const report = buildReport(2, fixturePreflight)

    expect(report.run.fixturePreflight).toEqual(fixturePreflight)
    expect(buildReport().run.fixturePreflight).toEqual([])
    expect(formatRunSummary(report)).toContain(
      "Fixtures   demo-user healthy (hook) · catalog skipped"
    )
    expect(formatRunSummary(buildReport())).not.toContain("Fixtures")
  })

  it("keeps the compact summary short", () => {
    const text = formatCompactSummary(buildReport())
    expect(text.trimEnd().split("\n")).toEqual([
      "✗ orderly-falcon-20261104-082151 failed · 1h31m · codex · gpt-5.5 · high · 3.0M tok",
      "  checks 4/6 passed (1 failed, 1 blocked) · 5 scenarios, 1 error, 1 skipped",
      "  error full-export: Codex did not capture required screenshot evidence.",
      "  https://caracara.example.com/projects/demo/runs/run-1",
    ])
  })

  it("formats durations and token counts", () => {
    expect(formatDuration(38_000)).toBe("38s")
    expect(formatDuration(372_000)).toBe("6m12s")
    expect(formatDuration(5_460_000)).toBe("1h31m")
    expect(formatTokenCount(947)).toBe("947")
    expect(formatTokenCount(1900)).toBe("1.9k")
    expect(formatTokenCount(160_400)).toBe("160k")
    expect(formatTokenCount(98_912_000)).toBe("98.9M")
  })
})
