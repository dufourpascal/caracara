import { describe, expect, it } from "vitest"

import { deleteRunAndResults } from "./lib"
import {
  addRunEnvironmentName,
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
