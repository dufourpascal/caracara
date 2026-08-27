import { describe, expect, it } from "vitest"

import {
  deleteRunAndResults,
  interruptRunningScenarioResults,
} from "./lib"
import {
  addRunEnvironmentName,
  canCorrectScenarioInterruption,
  matchesTerminalRun,
  parseRunEnvironment,
  removeRunEnvironmentName,
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

describe("run finalization", () => {
  it("recognizes only an exact terminal retry", () => {
    const run = { status: "interrupted", finishedAt: 123 }

    expect(matchesTerminalRun(run, run)).toBe(true)
    expect(matchesTerminalRun(run, { status: "failed", finishedAt: 123 })).toBe(
      false
    )
    expect(
      matchesTerminalRun(run, { status: "interrupted", finishedAt: 456 })
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
              buildQuery({ eq: () => null })
              return {
                async collect() {
                  return table === "scenarioResults"
                    ? [
                        { _id: "running-1", status: "running" },
                        { _id: "completed-1", status: "completed" },
                      ]
                    : [{ _id: "evidence-1", storageId: "storage-1" }]
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
      interruptRunningScenarioResults(ctx, "run-1" as never, 123)
    ).resolves.toBe(1)
    expect(deletedStorageIds).toEqual(["storage-1"])
    expect(deletedIds).toEqual(["evidence-1"])
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
    ])
  })
})

describe("scenario result correction", () => {
  it("allows terminal results to become interrupted", () => {
    expect(canCorrectScenarioInterruption("completed", "interrupted")).toBe(
      true
    )
    expect(
      canCorrectScenarioInterruption("runner_failed", "interrupted")
    ).toBe(true)
    expect(
      canCorrectScenarioInterruption("dependency_failed", "interrupted")
    ).toBe(true)
    expect(canCorrectScenarioInterruption("completed", "runner_failed")).toBe(
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
