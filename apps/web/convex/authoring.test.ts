import { describe, expect, it } from "vitest"

import { assertProjectAuthoringUnlocked } from "./lib"

function contextWithRun(run: { name: string } | null) {
  return {
    db: {
      query(table: string) {
        expect(table).toBe("runs")
        return {
          withIndex(
            indexName: string,
            buildQuery: (query: {
              eq: (field: string, value: string) => unknown
            }) => unknown
          ) {
            expect(indexName).toBe("by_project_status")
            const fields: Array<[string, string]> = []
            const query = {
              eq(field: string, value: string) {
                fields.push([field, value])
                return query
              },
            }
            buildQuery(query)
            expect(fields).toEqual([
              ["projectId", "project-1"],
              ["status", "running"],
            ])
            return {
              async first() {
                return run
              },
            }
          },
        }
      },
    },
  } as never
}

describe("authoring lock", () => {
  it("allows writes without a running project run", async () => {
    await expect(
      assertProjectAuthoringUnlocked(contextWithRun(null), "project-1" as never)
    ).resolves.toBeUndefined()
  })

  it("blocks writes while a project run is running", async () => {
    await expect(
      assertProjectAuthoringUnlocked(
        contextWithRun({ name: "swift-heron-20260825-120000" }),
        "project-1" as never
      )
    ).rejects.toThrow(/swift-heron-20260825-120000/)
  })
})
