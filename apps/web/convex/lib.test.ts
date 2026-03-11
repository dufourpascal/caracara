import { describe, expect, it } from "vitest"

import { deriveScenarioNavigationMetadata, toRun, toScenarioResult } from "./lib"

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
      averageScore: null,
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
      improvementInstruction: "Fix the save flow to preserve the slug.",
      executionSummary: "Output",
      failureDetail: null,
      startedAt: 1000,
      finishedAt: 1100,
    } as never)

    expect(run.createdAt).toBe(1234)
    expect(Number.isInteger(run.createdAt)).toBe(true)
    expect(result.submittedAt).toBe(2345)
    expect(Number.isInteger(result.submittedAt)).toBe(true)
    expect(result.improvementInstruction).toBe(
      "Fix the save flow to preserve the slug."
    )
  })

  it("falls back to legacy rawOutput for older stored results", () => {
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
      rationale: null,
      improvementInstruction: null,
      rawOutput: "Legacy output",
      failureDetail: null,
      startedAt: 1000,
      finishedAt: 1100,
    } as never)

    expect(result.executionSummary).toBe("Legacy output")
  })

  it("preserves running results with no finish time", () => {
    const result = toScenarioResult({
      _id: "result-id",
      _creationTime: 3456.789,
      runId: "run-id",
      scenarioId: "scenario-id",
      scenarioSlug: "demo-scenario",
      scenarioName: "Demo scenario",
      executionInstructions: "Do the thing",
      scoringPrompt: "Score the thing",
      sequenceIndex: 0,
      status: "running",
      runnerType: "codex",
      score: null,
      rationale: null,
      improvementInstruction: null,
      executionSummary: null,
      failureDetail: null,
      startedAt: 1000,
      finishedAt: null,
    } as never)

    expect(result.status).toBe("running")
    expect(result.finishedAt).toBeNull()
  })

  it("derives stable scenario navigation order for project and phase views", () => {
    const metadata = deriveScenarioNavigationMetadata({
      dependencies: [
        {
          _id: "dep-1",
          _creationTime: 0,
          dependsOnScenarioId: "scenario-a",
          projectId: "project-1",
          scenarioId: "scenario-b",
        },
        {
          _id: "dep-2",
          _creationTime: 0,
          dependsOnScenarioId: "scenario-c",
          projectId: "project-1",
          scenarioId: "scenario-d",
        },
      ] as never,
      phases: [
        {
          _id: "phase-1",
          _creationTime: 0,
          createdAt: 0,
          name: "Setup",
          order: 1,
          projectId: "project-1",
          updatedAt: 0,
        },
        {
          _id: "phase-2",
          _creationTime: 0,
          createdAt: 0,
          name: "Flow",
          order: 2,
          projectId: "project-1",
          updatedAt: 0,
        },
      ] as never,
      scenarios: [
        {
          _id: "scenario-a",
          _creationTime: 0,
          dependencyCount: 0,
          instructions: "",
          name: "Boot",
          phaseId: "phase-1",
          projectId: "project-1",
          scoringPrompt: "",
          searchText: "",
          slug: "boot",
          status: "active",
          updatedAt: 0,
        },
        {
          _id: "scenario-b",
          _creationTime: 0,
          dependencyCount: 0,
          instructions: "",
          name: "Login",
          phaseId: "phase-1",
          projectId: "project-1",
          scoringPrompt: "",
          searchText: "",
          slug: "login",
          status: "active",
          updatedAt: 0,
        },
        {
          _id: "scenario-c",
          _creationTime: 0,
          dependencyCount: 0,
          instructions: "",
          name: "Draft",
          phaseId: null,
          projectId: "project-1",
          scoringPrompt: "",
          searchText: "",
          slug: "draft",
          status: "draft",
          updatedAt: 0,
        },
        {
          _id: "scenario-d",
          _creationTime: 0,
          dependencyCount: 0,
          instructions: "",
          name: "Checkout",
          phaseId: "phase-2",
          projectId: "project-1",
          scoringPrompt: "",
          searchText: "",
          slug: "checkout",
          status: "active",
          updatedAt: 0,
        },
      ] as never,
    })

    expect(metadata).toEqual([
      expect.objectContaining({
        dependencyCount: 0,
        navigationOrder: 1,
        phaseFilterKey: "phase-1",
        phaseNavigationOrder: 1,
        scenarioId: "scenario-a",
      }),
      expect.objectContaining({
        dependencyCount: 1,
        navigationOrder: 2,
        phaseFilterKey: "phase-1",
        phaseNavigationOrder: 2,
        scenarioId: "scenario-b",
      }),
      expect.objectContaining({
        dependencyCount: 0,
        navigationOrder: 3,
        phaseFilterKey: "phase-2",
        phaseNavigationOrder: 1,
        scenarioId: "scenario-d",
      }),
      expect.objectContaining({
        dependencyCount: 0,
        navigationOrder: 4,
        phaseFilterKey: "__unassigned__",
        phaseNavigationOrder: 1,
        scenarioId: "scenario-c",
      }),
    ])
  })
})
