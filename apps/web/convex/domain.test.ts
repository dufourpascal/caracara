import { describe, expect, it } from "vitest"

import {
  assertValidDependencies,
  buildExecutionOrder,
  filterDependenciesForPhaseExecution,
  selectSuitePhases,
} from "./domain"

const scenarios = [
  {
    id: "a",
    slug: "alpha",
    name: "Alpha",
    status: "active" as const,
    instructions: "Alpha instructions",
    evaluationChecks: [],
  },
  {
    id: "b",
    slug: "beta",
    name: "Beta",
    status: "active" as const,
    instructions: "Beta instructions",
    evaluationChecks: [],
  },
  {
    id: "c",
    slug: "charlie",
    name: "Charlie",
    status: "draft" as const,
    instructions: "Charlie instructions",
    evaluationChecks: [],
  },
]

describe("convex domain helpers", () => {
  it("orders scenarios deterministically with dependencies first", () => {
    const ordered = buildExecutionOrder(scenarios, [
      { scenarioId: "b", dependsOnScenarioId: "a" },
      { scenarioId: "c", dependsOnScenarioId: "b" },
    ])

    expect(ordered.map((scenario) => scenario.slug)).toEqual([
      "alpha",
      "beta",
      "charlie",
    ])
  })

  it("filters to active scenarios for runnable flows", () => {
    const ordered = buildExecutionOrder(
      scenarios,
      [{ scenarioId: "b", dependsOnScenarioId: "a" }],
      {
        activeOnly: true,
      }
    )

    expect(ordered.map((scenario) => scenario.slug)).toEqual(["alpha", "beta"])
  })

  it("rejects self dependencies and cycles", () => {
    expect(() =>
      assertValidDependencies(scenarios, [
        { scenarioId: "a", dependsOnScenarioId: "a" },
      ])
    ).toThrow(/cannot depend on itself/i)

    expect(() =>
      buildExecutionOrder(scenarios.slice(0, 2), [
        { scenarioId: "a", dependsOnScenarioId: "b" },
        { scenarioId: "b", dependsOnScenarioId: "a" },
      ])
    ).toThrow(/cycle/i)

    expect(() =>
      assertValidDependencies(
        scenarios.slice(0, 2).map((scenario) => ({
          ...scenario,
          phaseId: null,
        })),
        [
          { scenarioId: "a", dependsOnScenarioId: "b" },
          { scenarioId: "b", dependsOnScenarioId: "a" },
        ]
      )
    ).toThrow(/cycle/i)
  })

  it("ignores unassigned dependencies for phase execution", () => {
    const withPhases = scenarios.map((scenario, index) => ({
      ...scenario,
      phaseId: index === 0 ? null : "phase-1",
    }))
    const dependencies = [
      { scenarioId: "b", dependsOnScenarioId: "a" },
      { scenarioId: "c", dependsOnScenarioId: "b" },
    ]

    expect(() =>
      assertValidDependencies(withPhases, dependencies, {
        strictPhaseBoundaries: true,
      })
    ).not.toThrow()
    expect(
      filterDependenciesForPhaseExecution(withPhases, dependencies)
    ).toEqual([{ scenarioId: "c", dependsOnScenarioId: "b" }])
  })

  it("selects suite phases without changing project phase order", () => {
    const phases = [
      { id: "phase-1", order: 1 },
      { id: "phase-2", order: 2 },
      { id: "phase-3", order: 3 },
      { id: "phase-4", order: 4 },
    ]

    expect(
      selectSuitePhases(phases, ["phase-4", "phase-1", "phase-2"]).map(
        (phase) => phase.id
      )
    ).toEqual(["phase-1", "phase-2", "phase-4"])
  })
})
