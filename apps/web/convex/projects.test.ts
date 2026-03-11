import { describe, expect, it } from "vitest"

import { deleteProjectCascade } from "./lib"

describe("project deletion helpers", () => {
  it("deletes project runs, results, dependencies, and scenarios before the project", async () => {
    const deletedIds: string[] = []
    const ctx = {
      db: {
        query(table: string) {
          if (table === "scenarioDependencies") {
            return {
              withIndex(
                indexName: string,
                buildQuery: (query: {
                  eq: (field: string, value: string) => null
                }) => null
              ) {
                expect(indexName).toBe("by_project")
                buildQuery({
                  eq(field, value) {
                    expect(field).toBe("projectId")
                    expect(value).toBe("project-1")
                    return null
                  },
                })

                return {
                  async collect() {
                    return [{ _id: "dependency-1" }, { _id: "dependency-2" }]
                  },
                }
              },
            }
          }

          if (table === "scenarios") {
            return {
              withIndex(
                indexName: string,
                buildQuery: (query: {
                  eq: (field: string, value: string) => null
                }) => null
              ) {
                expect(indexName).toBe("by_project")
                buildQuery({
                  eq(field, value) {
                    expect(field).toBe("projectId")
                    expect(value).toBe("project-1")
                    return null
                  },
                })

                return {
                  async collect() {
                    return [{ _id: "scenario-1" }, { _id: "scenario-2" }]
                  },
                }
              },
            }
          }

          if (table === "runs") {
            return {
              withIndex(
                indexName: string,
                buildQuery: (query: {
                  eq: (field: string, value: string) => null
                }) => null
              ) {
                expect(indexName).toBe("by_project")
                buildQuery({
                  eq(field, value) {
                    expect(field).toBe("projectId")
                    expect(value).toBe("project-1")
                    return null
                  },
                })

                return {
                  async collect() {
                    return [{ _id: "run-1" }, { _id: "run-2" }]
                  },
                }
              },
            }
          }

          if (table === "scenarioResults") {
            return {
              withIndex(
                indexName: string,
                buildQuery: (query: {
                  eq: (field: string, value: string) => null
                }) => null
              ) {
                expect(indexName).toBe("by_run")
                const runIds: string[] = []

                buildQuery({
                  eq(field, value) {
                    expect(field).toBe("runId")
                    runIds.push(value)
                    return null
                  },
                })

                return {
                  async collect() {
                    return runIds[0] === "run-1"
                      ? [{ _id: "result-1" }]
                      : [{ _id: "result-2" }, { _id: "result-3" }]
                  },
                }
              },
            }
          }

          throw new Error(`Unexpected table ${table}`)
        },
        async delete(id: string) {
          deletedIds.push(id)
        },
      },
    } as never

    const result = await deleteProjectCascade(ctx, "project-1" as never)

    expect(result).toEqual({
      deletedDependencyCount: 2,
      deletedProjectId: "project-1",
      deletedResultCount: 3,
      deletedRunCount: 2,
      deletedScenarioCount: 2,
    })
    expect(deletedIds).toEqual([
      "result-1",
      "run-1",
      "result-2",
      "result-3",
      "run-2",
      "dependency-1",
      "dependency-2",
      "scenario-1",
      "scenario-2",
      "project-1",
    ])
  })
})
