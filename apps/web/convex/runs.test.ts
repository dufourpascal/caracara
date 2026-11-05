import { describe, expect, it } from "vitest"

import {
  deleteRunAndResults,
  interruptRunScenarioResults,
} from "./lib"
import {
  addRunEnvironmentName,
  assertScenarioPhaseInSuiteRun,
  canCorrectRunInterruption,
  canCorrectScenarioInterruption,
  getRunCreationState,
  matchesRunModel,
  matchesScenarioExecutionAttempt,
  matchesTerminalRun,
  parseRequestedPhaseOrders,
  parseRunEnvironment,
  parseRunModel,
  removeRunEnvironmentName,
  validateRunResultsFilter,
} from "./runs"

describe("run environments", () => {
  it("validates snapshots and maintains a distinct project summary", () => {
    expect(
      parseRunEnvironment({
        environment: "preview",
        targetUrl: "https://preview.example.com",
      })
    ).toEqual({
      environment: "preview",
      targetUrl: "https://preview.example.com/",
    })
    expect(() => parseRunEnvironment({ environment: "preview" })).toThrow(
      "provided together"
    )
    let malformedUrlError: unknown
    try {
      parseRunEnvironment({ environment: "preview", targetUrl: "not-a-url" })
    } catch (error) {
      malformedUrlError = error
    }
    expect(malformedUrlError).toMatchObject({
      data: {
        code: "validation_error",
        message: "Target URL must be a valid URL.",
      },
    })
    expect(addRunEnvironmentName(["production"], "preview")).toEqual([
      "preview",
      "production",
    ])
    expect(addRunEnvironmentName(["preview"], "preview")).toEqual(["preview"])
    expect(
      removeRunEnvironmentName(["preview", "production"], "preview")
    ).toEqual(["production"])
  })
})

describe("multi-phase run targets", () => {
  function validationMessage(
    input: Parameters<typeof parseRequestedPhaseOrders>[0]
  ) {
    try {
      parseRequestedPhaseOrders(input)
    } catch (error) {
      return (error as { data?: { code?: string; message?: string } }).data
    }
    return null
  }

  it("requires sorted unique phase orders only for phases runs", () => {
    expect(
      parseRequestedPhaseOrders({
        mode: "phases",
        requestedPhaseOrders: [1, 4],
      })
    ).toEqual([1, 4])
    expect(parseRequestedPhaseOrders({ mode: "all" })).toBeNull()
    expect(
      parseRequestedPhaseOrders({ mode: "phase", requestedPhaseOrders: null })
    ).toBeNull()

    for (const input of [
      { mode: "phases" },
      { mode: "phases", requestedPhaseOrders: null },
      { mode: "all", requestedPhaseOrders: [1, 2] },
      { mode: "suite", requestedPhaseOrders: [1, 2] },
    ]) {
      expect(validationMessage(input)).toEqual({
        code: "validation_error",
        message: "Run mode and requested target do not match.",
      })
    }
    for (const [requestedPhaseOrders, message] of [
      [[2, 1], "Requested phase orders must be sorted and unique."],
      [[1, 1], "Requested phase orders must be sorted and unique."],
      [[1], "A phases run needs at least 2 phases."],
      [
        Array.from({ length: 101 }, (_, i) => i + 1),
        "A phases run can include at most 100 phases.",
      ],
    ] as const) {
      expect(
        validationMessage({
          mode: "phases",
          requestedPhaseOrders: [...requestedPhaseOrders],
        })
      ).toEqual({ code: "validation_error", message })
    }
    for (const requestedPhaseOrders of [
      [0, 1],
      [1, 2.5],
    ]) {
      expect(
        validationMessage({ mode: "phases", requestedPhaseOrders })
      ).toMatchObject({ code: "validation_error" })
    }
  })
})

describe("run model", () => {
  it("stores only validated Codex model settings", () => {
    expect(parseRunModel({ runnerType: "codex" })).toEqual({})
    expect(
      parseRunModel({
        runnerType: "codex",
        model: " gpt-6.1-sol ",
        reasoningEffort: "high",
      })
    ).toEqual({ model: "gpt-6.1-sol", reasoningEffort: "high" })
    expect(
      parseRunModel({ runnerType: "codex", reasoningEffort: "ultra" })
    ).toEqual({ reasoningEffort: "ultra" })
    expect(() =>
      parseRunModel({ runnerType: "claude-code", model: "gpt-6.1-sol" })
    ).toThrow("only supported for Codex")
    let invalidModelError: unknown
    try {
      parseRunModel({ runnerType: "codex", model: "gpt 6" })
    } catch (error) {
      invalidModelError = error
    }
    expect(invalidModelError).toMatchObject({
      data: { code: "validation_error" },
    })
    expect(() =>
      parseRunModel({ runnerType: "codex", reasoningEffort: "HIGH" })
    ).toThrow("lowercase token")
  })

  it("only lets a creation retry reuse the original model settings", () => {
    const stored = { model: "gpt-6.1-sol", reasoningEffort: "high" }
    expect(matchesRunModel(stored, { ...stored })).toBe(true)
    expect(matchesRunModel({}, {})).toBe(true)
    expect(matchesRunModel(stored, { model: "gpt-6.1-terra" })).toBe(false)
    expect(matchesRunModel(stored, {})).toBe(false)
    expect(matchesRunModel({}, { model: "gpt-6.1-sol" })).toBe(true)
  })
})

describe("run finalization", () => {
  it("creates an interrupted run for an aborted recovery request", () => {
    expect(getRunCreationState()).toEqual({
      status: "running",
      finishedAt: null,
    })
    expect(getRunCreationState(123)).toEqual({
      status: "interrupted",
      finishedAt: 123,
    })
  })

  it("recognizes only an exact terminal retry", () => {
    const run = { status: "interrupted", finishedAt: 123 }

    expect(matchesTerminalRun(run, run)).toBe(true)
    expect(matchesTerminalRun(run, { status: "failed", finishedAt: 123 })).toBe(
      false
    )
    expect(
      matchesTerminalRun(run, { status: "interrupted", finishedAt: 456 })
    ).toBe(false)
    expect(
      matchesTerminalRun(
        { status: "completed", finishedAt: 123 },
        { status: "interrupted", finishedAt: 456 }
      )
    ).toBe(false)
  })

  it("corrects an in-flight finalization only for the same attempt", () => {
    const run = {
      status: "completed",
      finalizationAttemptId: "attempt-1",
    }

    expect(
      canCorrectRunInterruption(run, {
        status: "interrupted",
        finalizationAttemptId: "attempt-1",
      })
    ).toBe(true)
    expect(
      canCorrectRunInterruption(run, {
        status: "interrupted",
        finalizationAttemptId: "attempt-2",
      })
    ).toBe(false)
    expect(
      canCorrectRunInterruption(run, { status: "interrupted" })
    ).toBe(false)
    expect(
      canCorrectRunInterruption(run, {
        status: "failed",
        finalizationAttemptId: "attempt-1",
      })
    ).toBe(false)
  })

  it("interrupts running scenarios and removes their evidence", async () => {
    const deletedStorageIds: string[] = []
    const deletedIds: string[] = []
    const patches: Array<{ id: string; value: unknown }> = []
    const ctx = {
      db: {
        query(table: string) {
          return {
            withIndex(
              _indexName: string,
              buildQuery: (query: {
                eq: (field: string, value: string) => null
              }) => null
            ) {
              let indexedValue = ""
              buildQuery({
                eq: (_field, value) => {
                  indexedValue = value
                  return null
                },
              })
              return {
                async collect() {
                  return table === "scenarioResults"
                    ? [
                        { _id: "running-1", status: "running" },
                        {
                          _id: "completed-1",
                          status: "completed",
                          executionAttemptId: "attempt-1",
                        },
                      ]
                    : [
                        {
                          _id: `evidence-${indexedValue}`,
                          storageId: `storage-${indexedValue}`,
                        },
                      ]
                },
              }
            },
          }
        },
        async delete(id: string) {
          deletedIds.push(id)
        },
        async patch(id: string, value: unknown) {
          patches.push({ id, value })
        },
      },
      storage: {
        async delete(id: string) {
          deletedStorageIds.push(id)
        },
      },
    } as never

    await expect(
      interruptRunScenarioResults(
        ctx,
        "run-1" as never,
        123,
        "completed-1" as never,
        "stale-attempt"
      )
    ).resolves.toBe(1)
    expect(patches.map((patch) => patch.id)).toEqual(["running-1"])
    deletedStorageIds.length = 0
    deletedIds.length = 0
    patches.length = 0

    await expect(
      interruptRunScenarioResults(
        ctx,
        "run-1" as never,
        123,
        "completed-1" as never,
        "attempt-1"
      )
    ).resolves.toBe(2)
    expect(deletedStorageIds).toEqual([
      "storage-running-1",
      "storage-completed-1",
    ])
    expect(deletedIds).toEqual([
      "evidence-running-1",
      "evidence-completed-1",
    ])
    expect(patches).toEqual([
      {
        id: "running-1",
        value: {
          status: "interrupted",
          checkResults: [],
          executionSummary: null,
          failureDetail: "Execution interrupted.",
          finishedAt: 123,
        },
      },
      {
        id: "completed-1",
        value: {
          status: "interrupted",
          checkResults: [],
          executionSummary: null,
          failureDetail: "Execution interrupted.",
          finishedAt: 123,
        },
      },
    ])
  })
})

describe("scenario result correction", () => {
  it("allows terminal results to become interrupted only while the run is active", () => {
    expect(
      canCorrectScenarioInterruption("running", "completed", "interrupted")
    ).toBe(true)
    expect(
      canCorrectScenarioInterruption(
        "running",
        "runner_failed",
        "interrupted"
      )
    ).toBe(true)
    expect(
      canCorrectScenarioInterruption(
        "running",
        "dependency_failed",
        "interrupted"
      )
    ).toBe(true)
    expect(
      canCorrectScenarioInterruption("running", "completed", "runner_failed")
    ).toBe(false)
    expect(
      canCorrectScenarioInterruption("completed", "completed", "interrupted")
    ).toBe(false)
  })

  it("requires new scenario executions to use their stored attempt ID", () => {
    expect(matchesScenarioExecutionAttempt(undefined, undefined)).toBe(true)
    expect(matchesScenarioExecutionAttempt("attempt-1", "attempt-1")).toBe(
      true
    )
    expect(matchesScenarioExecutionAttempt("attempt-1", "attempt-2")).toBe(
      false
    )
    expect(matchesScenarioExecutionAttempt("attempt-1", undefined)).toBe(
      false
    )
  })
})

describe("run deletion helpers", () => {
  it("deletes screenshot storage and rows before results and the run", async () => {
    const deletedIds: string[] = []
    const deletedStorageIds: string[] = []
    const ctx = {
      db: {
        query(table: string) {
          return {
            withIndex(
              indexName: string,
              buildQuery: (query: {
                eq: (field: string, value: string) => null
              }) => null
            ) {
              expect(indexName).toBe("by_run")
              buildQuery({
                eq(field, value) {
                  expect(field).toBe("runId")
                  expect(value).toBe("run-1")
                  return null
                },
              })

              return {
                async collect() {
                  return table === "runEvidence"
                    ? [
                        { _id: "evidence-1", storageId: "storage-1" },
                        { _id: "evidence-2", storageId: "storage-2" },
                      ]
                    : [{ _id: "result-1" }, { _id: "result-2" }]
                },
              }
            },
          }
        },
        async delete(id: string) {
          deletedIds.push(id)
        },
      },
      storage: {
        async delete(id: string) {
          deletedStorageIds.push(id)
        },
      },
    } as never

    const result = await deleteRunAndResults(ctx, "run-1" as never)

    expect(result).toEqual({ deletedEvidenceCount: 2, deletedResultCount: 2 })
    expect(deletedStorageIds).toEqual(["storage-1", "storage-2"])
    expect(deletedIds).toEqual([
      "evidence-1",
      "evidence-2",
      "result-1",
      "result-2",
      "run-1",
    ])
  })
})

describe("suite run phase snapshot", () => {
  const suiteRun = {
    mode: "suite",
    requestedSuitePhases: [
      { id: "phase-1", name: "Landing", order: 1 },
      { id: "phase-2", name: "Checkout", order: 2 },
    ],
  }

  it("accepts scenarios from the run's suite phases and non-suite runs", () => {
    expect(() =>
      assertScenarioPhaseInSuiteRun(suiteRun, {
        phaseId: "phase-2",
        phaseName: "Checkout",
        phaseOrder: 2,
      })
    ).not.toThrow()
    expect(() =>
      assertScenarioPhaseInSuiteRun(
        { mode: "all" },
        { phaseId: "phase-9", phaseName: "Other", phaseOrder: 9 }
      )
    ).not.toThrow()
  })

  it.each([
    [
      "a phase added to the suite",
      { phaseId: "phase-3", phaseName: "Pay", phaseOrder: 3 },
    ],
    [
      "a renamed phase",
      { phaseId: "phase-1", phaseName: "Home", phaseOrder: 1 },
    ],
    [
      "a reordered phase",
      { phaseId: "phase-1", phaseName: "Landing", phaseOrder: 2 },
    ],
    [
      "an unassigned scenario",
      { phaseId: null, phaseName: null, phaseOrder: null },
    ],
  ])("rejects a scenario from %s", (_, scenarioPhase) => {
    expect(() => assertScenarioPhaseInSuiteRun(suiteRun, scenarioPhase)).toThrow(
      "The suite changed after this run was created. Start the run again."
    )
  })
})

describe("run results filter", () => {
  const validationError = expect.objectContaining({
    data: expect.objectContaining({ code: "validation_error" }),
  })

  it("allows any reference without an environment filter", () => {
    expect(() => validateRunResultsFilter("latest", undefined)).not.toThrow()
    expect(() =>
      validateRunResultsFilter("brave-heron-20261104-120000", undefined)
    ).not.toThrow()
  })

  it("filters only the latest run by a valid environment", () => {
    expect(() => validateRunResultsFilter("latest", "preview")).not.toThrow()
    expect(() =>
      validateRunResultsFilter("brave-heron-20261104-120000", "preview")
    ).toThrow(validationError)
    expect(() => validateRunResultsFilter("latest", "")).toThrow(
      validationError
    )
    expect(() => validateRunResultsFilter("latest", "Bad_Env")).toThrow(
      validationError
    )
  })
})
