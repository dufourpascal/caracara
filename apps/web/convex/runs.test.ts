import { describe, expect, it } from "vitest"

import { deleteRunAndResults } from "./lib"

describe("run deletion helpers", () => {
  it("deletes scenario results before deleting the run", async () => {
    const deletedIds: string[] = []
    const ctx = {
      db: {
        query(table: string) {
          expect(table).toBe("scenarioResults")

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
                  return [{ _id: "result-1" }, { _id: "result-2" }]
                },
              }
            },
          }
        },
        async delete(id: string) {
          deletedIds.push(id)
        },
      },
    } as never

    const result = await deleteRunAndResults(ctx, "run-1" as never)

    expect(result).toEqual({ deletedResultCount: 2 })
    expect(deletedIds).toEqual(["result-1", "result-2", "run-1"])
  })
})
