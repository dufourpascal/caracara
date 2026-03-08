import { describe, expect, it } from "vitest"

import { toRun, toScenarioResult } from "./lib"

describe("convex response mappers", () => {
  it("normalizes Convex creation timestamps to integers", () => {
    const run = toRun({
      _id: "run-id",
      _creationTime: 1234.987,
      projectId: "project-id",
      ownerUserId: "user-id",
      name: "steady-hawk-20260308-120000",
      status: "running",
      mode: "all",
      requestedScenarioSlug: null,
      runnerType: "codex",
      startedAt: 1000,
      finishedAt: null,
      updatedAt: 1200,
    } as never)

    const result = toScenarioResult({
      _id: "result-id",
      _creationTime: 2345.789,
      runId: "run-id",
      scenarioId: "scenario-id",
      scenarioSlug: "demo-scenario",
      scenarioName: "Demo scenario",
      executionInstructions: "Do the thing",
      scoringPrompt: "Score the thing",
      sequenceIndex: 0,
      status: "success",
      runnerType: "codex",
      score: 1,
      rationale: "Worked",
      rawOutput: "Output",
      failureDetail: null,
      startedAt: 1000,
      finishedAt: 1100,
    } as never)

    expect(run.createdAt).toBe(1234)
    expect(Number.isInteger(run.createdAt)).toBe(true)
    expect(result.submittedAt).toBe(2345)
    expect(Number.isInteger(result.submittedAt)).toBe(true)
  })
})
