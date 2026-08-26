import { describe, expect, it } from "vitest"

import {
  assertProjectAuthoringUnlocked,
  ensurePhaseOwnership,
  ensureScenarioDependenciesReusable,
  ensureScenarioOwnership,
  validateProjectDependencyGraph,
} from "./lib"
import { validateEvaluationChecks } from "./scenarios"

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

describe("authoring validation", () => {
  const ownershipContext = {
    auth: {
      async getUserIdentity() {
        return { subject: "user-1" }
      },
    },
    db: {
      async get(id: string) {
        if (id === "scenario-1") {
          return { _id: id, projectId: "project-b" }
        }
        if (id === "phase-1") {
          return { _id: id, projectId: "project-b" }
        }
        if (id === "project-b") {
          return { _id: id, ownerUserId: "user-1" }
        }
        return null
      },
    },
  } as never

  it("rejects scenario and phase IDs from another URL project", async () => {
    await expect(
      ensureScenarioOwnership(
        ownershipContext,
        "scenario-1" as never,
        "project-a" as never
      )
    ).rejects.toThrow(/does not belong to this project/i)
    await expect(
      ensurePhaseOwnership(
        ownershipContext,
        "phase-1" as never,
        "project-a" as never
      )
    ).rejects.toThrow(/does not belong to this project/i)
  })

  it("reports state-dependent check limits as validation errors", () => {
    const checks = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Check ${index}`,
      expectation: "It passes.",
    }))

    try {
      validateEvaluationChecks("draft", checks)
      throw new Error("Expected check validation to fail")
    } catch (error) {
      expect(error).toMatchObject({
        data: {
          code: "validation_error",
          message: expect.stringMatching(/1 to 20 evaluation checks/i),
        },
      })
    }
  })

  it("rejects duplicate dependency IDs before persisting them", async () => {
    try {
      await ensureScenarioDependenciesReusable(
        {} as never,
        "project-1" as never,
        ["scenario-1", "scenario-1"] as never
      )
      throw new Error("Expected duplicate dependency validation to fail")
    } catch (error) {
      expect(error).toMatchObject({
        data: {
          code: "validation_error",
          message: expect.stringMatching(/dependency ids must be unique/i),
        },
      })
    }
  })

  it("reports dependency cycles as validation errors", async () => {
    const documents = {
      phases: [
        {
          _id: "phase-1",
          name: "Checkout",
          order: 1,
          projectId: "project-1",
        },
      ],
      scenarios: [
        {
          _id: "scenario-a",
          name: "A",
          slug: "a",
          status: "draft",
          instructions: "A",
          evaluationChecks: [],
          phaseId: "phase-1",
          projectId: "project-1",
        },
        {
          _id: "scenario-b",
          name: "B",
          slug: "b",
          status: "draft",
          instructions: "B",
          evaluationChecks: [],
          phaseId: "phase-1",
          projectId: "project-1",
        },
      ],
      scenarioDependencies: [
        {
          scenarioId: "scenario-a",
          dependsOnScenarioId: "scenario-b",
          projectId: "project-1",
        },
        {
          scenarioId: "scenario-b",
          dependsOnScenarioId: "scenario-a",
          projectId: "project-1",
        },
      ],
    }
    const graphContext = {
      db: {
        query(table: keyof typeof documents) {
          return {
            withIndex(
              _indexName: string,
              buildQuery: (query: {
                eq: (field: string, value: string) => unknown
              }) => unknown
            ) {
              const query = {
                eq() {
                  return query
                },
              }
              buildQuery(query)
              return {
                async collect() {
                  return documents[table]
                },
              }
            },
          }
        },
      },
    } as never

    try {
      await validateProjectDependencyGraph(graphContext, "project-1" as never)
      throw new Error("Expected dependency validation to fail")
    } catch (error) {
      expect(error).toMatchObject({
        data: {
          code: "validation_error",
          message: expect.stringMatching(/cycle/i),
        },
      })
    }
  })
})
