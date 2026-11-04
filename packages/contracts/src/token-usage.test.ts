import { describe, expect, it } from "vitest"

import {
  getTokenTotals,
  scenarioResultSchema,
  submitScenarioResultRequestSchema,
  sumRunTokenUsage,
  type TokenUsage,
} from "./index.js"

const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 1_000,
  cachedInputTokens: 600,
  cacheWriteInputTokens: 100,
  outputTokens: 200,
  reasoningOutputTokens: 50,
  complete: true,
  ...overrides,
})

describe("token usage", () => {
  it("derives totals and uncached input", () => {
    expect(getTokenTotals(usage())).toEqual({
      total: 1_200,
      input: 1_000,
      uncachedInput: 300,
      cachedInput: 600,
      cacheWriteInput: 100,
      output: 200,
      reasoningOutput: 50,
      complete: true,
    })
    expect(
      getTokenTotals(usage({ inputTokens: 10, cachedInputTokens: 20 }))
        .uncachedInput
    ).toBe(0)
  })

  it("adds up scenario usage for a finished run", () => {
    expect(
      sumRunTokenUsage({
        runStatus: "failed",
        results: [
          { status: "completed", tokenUsage: usage() },
          { status: "runner_failed", tokenUsage: usage({ outputTokens: 0 }) },
          { status: "dependency_failed" },
        ],
      })
    ).toEqual({
      inputTokens: 2_000,
      cachedInputTokens: 1_200,
      cacheWriteInputTokens: 200,
      outputTokens: 200,
      reasoningOutputTokens: 100,
      complete: true,
    })
  })

  it("returns null for runs without recorded usage", () => {
    expect(
      sumRunTokenUsage({
        runStatus: "completed",
        results: [
          { status: "completed", tokenUsage: null },
          { status: "completed" },
        ],
      })
    ).toBeNull()
  })

  it.each([
    [
      "the run is still going",
      "running",
      [{ status: "completed", tokenUsage: usage() }],
    ],
    [
      "a scenario is running",
      "completed",
      [{ status: "completed", tokenUsage: usage() }, { status: "running" }],
    ],
    [
      "an executed scenario has no usage",
      "failed",
      [
        { status: "completed", tokenUsage: usage() },
        { status: "runner_failed" },
      ],
    ],
    [
      "a scenario reported partial usage",
      "completed",
      [{ status: "completed", tokenUsage: usage({ complete: false }) }],
    ],
  ] as const)("marks the total incomplete when %s", (_, runStatus, results) => {
    expect(sumRunTokenUsage({ runStatus, results })?.complete).toBe(false)
  })

  it("keeps old results and submissions without usage valid", () => {
    const result = {
      id: "result_1",
      runId: "run_1",
      scenarioId: "scenario_1",
      scenarioSlug: "sign-in",
      scenarioName: "Sign in",
      executionInstructions: "Sign in.",
      evaluationChecks: [],
      checkResults: [],
      sequenceIndex: 0,
      status: "completed",
      runnerType: "codex",
      executionSummary: null,
      failureDetail: null,
      startedAt: 1,
      finishedAt: 2,
      submittedAt: 3,
    }
    expect(scenarioResultSchema.parse(result).tokenUsage).toBeUndefined()
    expect(
      scenarioResultSchema.parse({ ...result, tokenUsage: usage() }).tokenUsage
    ).toEqual(usage())

    const submission = {
      runId: "run_1",
      result: {
        scenarioId: "scenario_1",
        status: "completed",
        checkResults: [],
        executionSummary: null,
        failureDetail: null,
        finishedAt: 2,
      },
    }
    expect(
      submitScenarioResultRequestSchema.parse(submission).result.tokenUsage
    ).toBeUndefined()
    expect(() =>
      submitScenarioResultRequestSchema.parse({
        ...submission,
        result: {
          ...submission.result,
          tokenUsage: usage({ outputTokens: -1 }),
        },
      })
    ).toThrow()
    expect(() =>
      submitScenarioResultRequestSchema.parse({
        ...submission,
        result: {
          ...submission.result,
          tokenUsage: usage({ inputTokens: 1.5 }),
        },
      })
    ).toThrow()
  })
})
