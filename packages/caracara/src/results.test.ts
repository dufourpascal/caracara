import { describe, expect, it } from "vitest"

import type { RunResultsResponse } from "@workspace/contracts"

import {
  buildRunResultsReport,
  formatRunResultsTable,
  readRunString,
  toTokenUsage,
} from "./results.js"

const CHECK_A = "00000000-0000-4000-8000-00000000000a"
const CHECK_B = "00000000-0000-4000-8000-00000000000b"
const CHECK_C = "00000000-0000-4000-8000-00000000000c"
const START = Date.UTC(2026, 10, 4, 12, 0, 0)

function usage(input: number, cached: number, output: number, complete = true) {
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: 0,
    complete,
  }
}

function scenarioResult(
  overrides: Partial<RunResultsResponse["results"][number]>
): RunResultsResponse["results"][number] {
  return {
    id: "result-1",
    runId: "run-1",
    scenarioId: "scenario-1",
    scenarioSlug: "sign-in",
    scenarioName: "Sign in",
    evaluationChecks: [
      { id: CHECK_A, name: "Dashboard", expectation: "Dashboard opens." },
    ],
    checkResults: [],
    phaseId: "phase-1",
    phaseName: "Setup",
    phaseOrder: 1,
    sequenceIndex: 0,
    status: "completed",
    runnerType: "codex",
    executionSummary: null,
    failureDetail: null,
    tokenUsage: null,
    startedAt: START,
    finishedAt: START + 35_000,
    submittedAt: START,
    ...overrides,
  }
}

const response: RunResultsResponse = {
  run: {
    id: "run-1",
    projectId: "project-1",
    name: "brave-heron-20261104-120000",
    status: "failed",
    mode: "all",
    requestedScenarioSlug: null,
    requestedPhaseOrder: null,
    requestedSuiteSlug: null,
    requestedSuiteName: null,
    requestedSuitePhases: [],
    runnerType: "codex",
    evidencePolicy: "failed_check_screenshot",
    environment: "development",
    targetUrl: "http://localhost:3000/",
    passedCheckCount: 2,
    totalCheckCount: 4,
    passRate: null,
    startedAt: START,
    finishedAt: START + 134_000,
    createdAt: START,
    updatedAt: START,
  },
  results: [
    scenarioResult({
      checkResults: [
        { checkId: CHECK_A, verdict: "passed", evidence: "Heading visible." },
      ],
      tokenUsage: usage(40_000, 30_000, 2_000),
    }),
    scenarioResult({
      id: "result-2",
      scenarioId: "scenario-2",
      scenarioSlug: "checkout",
      scenarioName: "Checkout",
      sequenceIndex: 1,
      phaseId: null,
      phaseName: null,
      phaseOrder: null,
      evaluationChecks: [
        { id: CHECK_B, name: "Receipt", expectation: "Receipt shows VAT." },
        { id: CHECK_C, name: "Email", expectation: "Email arrives." },
      ],
      checkResults: [
        {
          checkId: CHECK_B,
          verdict: "failed",
          evidence: "The receipt\nhas no VAT line.",
        },
        {
          checkId: CHECK_C,
          verdict: "blocked",
          evidence: "Inbox unavailable.",
          blockedReason: "environment_failure",
        },
      ],
      startedAt: START + 40_000,
      finishedAt: START + 102_000,
      tokenUsage: usage(80_000, 50_000, 3_333, false),
    }),
    scenarioResult({
      id: "result-3",
      scenarioId: "scenario-3",
      scenarioSlug: "logout",
      scenarioName: "Logout",
      sequenceIndex: 2,
      status: "runner_failed",
      failureDetail: "Codex exited with code 1",
      startedAt: START + 102_000,
      finishedAt: START + 104_000,
      tokenUsage: usage(1_000, 0, 10),
    }),
  ],
}

describe("run results report", () => {
  it("builds the export JSON with tokens and every authored check", () => {
    const report = buildRunResultsReport(response)

    expect(report.formatVersion).toBe(1)
    expect(report.run).toEqual(
      expect.objectContaining({
        id: "run-1",
        name: "brave-heron-20261104-120000",
        status: "failed",
        environment: "development",
        model: null,
        startedAt: "2026-11-04T12:00:00.000Z",
        finishedAt: "2026-11-04T12:02:14.000Z",
        durationMs: 134_000,
        tokens: {
          total: 126_343,
          input: 121_000,
          uncachedInput: 41_000,
          cachedInput: 80_000,
          cacheWriteInput: 0,
          output: 5_343,
          reasoningOutput: 0,
          complete: false,
        },
      })
    )
    expect(report.scenarios[0]).toEqual(
      expect.objectContaining({
        slug: "sign-in",
        phase: { id: "phase-1", order: 1, name: "Setup" },
        durationMs: 35_000,
        passedCheckCount: 1,
        totalCheckCount: 1,
        checks: [
          {
            id: CHECK_A,
            name: "Dashboard",
            verdict: "passed",
            reason: "Heading visible.",
            blockedReason: null,
          },
        ],
      })
    )
    expect(report.scenarios[0]?.tokens?.total).toBe(42_000)
    expect(report.scenarios[1]?.phase).toBeNull()
    expect(report.scenarios[1]?.checks[1]).toEqual({
      id: CHECK_C,
      name: "Email",
      verdict: "blocked",
      reason: "Inbox unavailable.",
      blockedReason: "environment_failure",
    })
    // Scenarios that ended early still list their checks, unevaluated.
    expect(report.scenarios[2]?.checks).toEqual([
      {
        id: CHECK_A,
        name: "Dashboard",
        verdict: null,
        reason: null,
        blockedReason: null,
      },
    ])
  })

  it("handles older runs without usage and runs in progress", () => {
    const report = buildRunResultsReport({
      run: { ...response.run, status: "running", finishedAt: null },
      results: [
        scenarioResult({
          tokenUsage: undefined,
          finishedAt: null,
          status: "running",
        }),
      ],
    })

    expect(report.run.tokens).toBeNull()
    expect(report.run.durationMs).toBeNull()
    expect(report.run.finishedAt).toBeNull()
    expect(report.scenarios[0]?.tokens).toBeNull()
    expect(report.scenarios[0]?.durationMs).toBeNull()
    expect(formatRunResultsTable(report)).toContain("Checks    in progress")
  })

  it("reads a recorded model and reasoning effort once the API sends them", () => {
    expect(readRunString(response.run, "model")).toBeNull()
    expect(readRunString(response.run, "reasoningEffort")).toBeNull()
    const report = buildRunResultsReport({
      ...response,
      run: {
        ...response.run,
        model: "gpt-6.1-sol",
        reasoningEffort: "high",
      } as RunResultsResponse["run"],
    })
    expect(report.run.model).toBe("gpt-6.1-sol")
    expect(report.run.reasoningEffort).toBe("high")
    expect(formatRunResultsTable(report)).toContain("model gpt-6.1-sol (high)")
    expect(readRunString({ model: "" }, "model")).toBeNull()
  })

  it("prints a compact table with the checks that did not pass", () => {
    expect(formatRunResultsTable(buildRunResultsReport(response)))
      .toMatchInlineSnapshot(`
        "Run       brave-heron-20261104-120000 (run-1)
        Status    failed · environment development · runner codex · model n/a
        Time      2026-11-04T12:00:00Z → 2026-11-04T12:02:14Z (2m 14s)
        Checks    2/4 passed
        Tokens    126,343+ total (41,000 uncached input, 80,000 cached input, 5,343 output)

        #  Phase    Scenario  Status         Checks  Duration  Tokens
        1  1 Setup  sign-in   completed      1/1     35s       42,000
        2  -        checkout  completed      0/2     1m 2s     83,333+
        3  1 Setup  logout    runner_failed  0/1     2s        1,010

        Not passed:
          checkout › Receipt: failed: The receipt has no VAT line.
          checkout › Email: blocked (environment_failure): Inbox unavailable.
          logout: runner_failed (Codex exited with code 1)

        + token usage is incomplete; the count is a lower bound.
        "
      `)
  })
})

describe("runner usage mapping", () => {
  it("maps reported usage and drops the cost estimate", () => {
    expect(
      toTokenUsage({
        complete: false,
        usage: {
          inputTokens: 10.4,
          cachedInputTokens: 4,
          cacheWriteInputTokens: 0,
          outputTokens: 3,
          reasoningOutputTokens: 1,
          estimatedCostUsd: 0.5,
        },
      })
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      cacheWriteInputTokens: 0,
      outputTokens: 3,
      reasoningOutputTokens: 1,
      complete: false,
    })
  })

  it("distinguishes no usage from unknown usage", () => {
    expect(toTokenUsage(null)).toBeUndefined()
    expect(toTokenUsage({ complete: false })).toBeUndefined()
    expect(toTokenUsage({ complete: true })).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      complete: true,
    })
  })
})
