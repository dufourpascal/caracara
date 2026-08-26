import { describe, expect, it } from "vitest"

import { clearRunEnvironmentSummaries } from "./migrations"

describe("evaluation data reset", () => {
  it("clears run environment summaries on every project", async () => {
    const patches: Array<{ id: string; value: unknown }> = []
    const ctx = {
      db: {
        query(tableName: string) {
          expect(tableName).toBe("projects")
          return {
            async collect() {
              return [
                { _id: "project-1", runEnvironmentNames: ["preview"] },
                { _id: "project-2" },
              ]
            },
          }
        },
        async patch(id: string, value: unknown) {
          patches.push({ id, value })
        },
      },
    } as never

    await clearRunEnvironmentSummaries(ctx)

    expect(patches).toEqual([
      { id: "project-1", value: { runEnvironmentNames: [] } },
      { id: "project-2", value: { runEnvironmentNames: [] } },
    ])
  })
})
