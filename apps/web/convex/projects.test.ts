import { describe, expect, it } from "vitest"

import { parseProjectInput } from "./projects"
import { deleteProjectCascade } from "./lib"

describe("project input validation", () => {
  it("trims names and omits blank slugs", () => {
    expect(
      parseProjectInput({
        name: "  Blank Slug Derivation  ",
        slug: " \t ",
        description: "Description",
        projectPrompt: "Prompt",
      })
    ).toEqual({
      name: "Blank Slug Derivation",
      slug: undefined,
      description: "Description",
      projectPrompt: "Prompt",
    })
  })

  it("returns field-specific validation errors", () => {
    expect(() =>
      parseProjectInput({
        name: "n".repeat(121),
        slug: "project",
        description: "d".repeat(1_501),
        projectPrompt: "p".repeat(12_001),
      })
    ).toThrow()

    try {
      parseProjectInput({
        name: "   ",
        slug: "project",
        description: "d".repeat(1_501),
        projectPrompt: "p".repeat(12_001),
      })
    } catch (error) {
      expect(error).toMatchObject({
        data: {
          code: "validation_error",
          message: "Check the highlighted project fields.",
          fieldErrors: {
            name: ["Project name is required."],
            description: ["Description must be 1,500 characters or fewer."],
            projectPrompt: [
              "Project prompt must be 12,000 characters or fewer.",
            ],
          },
        },
      })
    }
  })
})

describe("project deletion helpers", () => {
  it("deletes project runs, results, dependencies, and scenarios before the project", async () => {
    const deletedIds: string[] = []
    const deletedStorageIds: string[] = []
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

          if (table === "phases") {
            return {
              withIndex(
                indexName: string,
                buildQuery: (query: {
                  eq: (field: string, value: string) => null
                }) => null
              ) {
                expect(indexName).toBe("by_project_order")
                buildQuery({
                  eq(field, value) {
                    expect(field).toBe("projectId")
                    expect(value).toBe("project-1")
                    return null
                  },
                })

                return {
                  async collect() {
                    return [{ _id: "phase-1" }, { _id: "phase-2" }]
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

          if (table === "suites") {
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
                    return [{ _id: "suite-1" }]
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

          if (table === "runEvidence") {
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
                      ? [{ _id: "evidence-1", storageId: "storage-1" }]
                      : []
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
      storage: {
        async delete(id: string) {
          deletedStorageIds.push(id)
        },
      },
    } as never

    const result = await deleteProjectCascade(ctx, "project-1" as never)

    expect(result).toEqual({
      deletedDependencyCount: 2,
      deletedPhaseCount: 2,
      deletedProjectId: "project-1",
      deletedResultCount: 3,
      deletedRunCount: 2,
      deletedScenarioCount: 2,
      deletedSuiteCount: 1,
    })
    expect(deletedIds).toEqual([
      "evidence-1",
      "result-1",
      "run-1",
      "result-2",
      "result-3",
      "run-2",
      "dependency-1",
      "dependency-2",
      "scenario-1",
      "scenario-2",
      "phase-1",
      "phase-2",
      "suite-1",
      "project-1",
    ])
    expect(deletedStorageIds).toEqual(["storage-1"])
  })
})
