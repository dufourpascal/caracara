import { describe, expect, it } from "vitest"

import {
  computeRunCheckCounts,
  deriveScenarioNavigationMetadata,
  toRun,
  toScenarioResult,
  validateCompletedCheckResults,
  validateFailedCheckEvidence,
  validateRunnerMatch,
} from "./lib"

describe("convex response mappers", () => {
  it("retains completed check counts when a later scenario fails", async () => {
    const ctx = {
      db: {
        query() {
          return {
            withIndex() {
              return {
                async collect() {
                  return [
                    {
                      status: "completed",
                      evaluationChecks: [{ id: "a" }, { id: "b" }],
                      checkResults: [
                        { checkId: "a", verdict: "passed" },
                        { checkId: "b", verdict: "failed" },
                      ],
                    },
                    {
                      status: "runner_failed",
                      evaluationChecks: [{ id: "c" }],
                      checkResults: [],
                    },
                  ]
                },
              }
            },
          }
        },
      },
    } as never

    await expect(computeRunCheckCounts(ctx, "run-id" as never)).resolves.toEqual(
      {
        passedCheckCount: 1,
        totalCheckCount: 2,
      }
    )
  })

  it("requires one evidenced result for every snapshotted check", () => {
    expect(() =>
      validateCompletedCheckResults(
        [{ id: "a" }, { id: "b" }],
        [
          { checkId: "a", evidence: "Visible" },
          { checkId: "a", evidence: "Visible twice" },
        ]
      )
    ).toThrow(/match the scenario snapshot/i)
    expect(() =>
      validateCompletedCheckResults(
        [{ id: "a" }],
        [{ checkId: "a", evidence: "Visible" }]
      )
    ).not.toThrow()
  })

  it("requires exactly one screenshot for every failed check", () => {
    expect(() =>
      validateFailedCheckEvidence(
        [
          { checkId: "failed", verdict: "failed" },
          { checkId: "passed", verdict: "passed" },
        ],
        [{ checkId: "failed" }]
      )
    ).not.toThrow()
    expect(() =>
      validateFailedCheckEvidence(
        [{ checkId: "failed", verdict: "failed" }],
        []
      )
    ).toThrow(/requires exactly one screenshot/i)
    expect(() =>
      validateFailedCheckEvidence(
        [{ checkId: "failed", verdict: "failed" }],
        [{ checkId: "failed" }, { checkId: "failed" }]
      )
    ).toThrow(/requires exactly one screenshot/i)
  })

  it("rejects a scenario runner that differs from its run", () => {
    expect(() => validateRunnerMatch("codex", "claude-code")).toThrow(
      /must match the run runner/i
    )
    expect(() => validateRunnerMatch("codex", "codex")).not.toThrow()
  })

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
      passedCheckCount: 0,
      totalCheckCount: 0,
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
      evaluationChecks: [],
      checkResults: [],
      sequenceIndex: 0,
      status: "completed",
      runnerType: "codex",
      executionSummary: "Output",
      failureDetail: null,
      startedAt: 1000,
      finishedAt: 1100,
    } as never)

    expect(run.createdAt).toBe(1234)
    expect(Number.isInteger(run.createdAt)).toBe(true)
    expect(result.submittedAt).toBe(2345)
    expect(Number.isInteger(result.submittedAt)).toBe(true)
    expect(result.status).toBe("completed")
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
      evaluationChecks: [],
      checkResults: [],
      sequenceIndex: 0,
      status: "running",
      runnerType: "codex",
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
          evaluationChecks: [],
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
          evaluationChecks: [],
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
          evaluationChecks: [],
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
          evaluationChecks: [],
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
