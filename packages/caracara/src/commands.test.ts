import { describe, expect, it } from "vitest"

import { resolveCheckReference, resolvePhaseReference } from "./commands.js"

const scenario = {
  id: "scenario-1",
  name: "Checkout",
  slug: "checkout",
  status: "active" as const,
  instructions: "Complete checkout.",
  evaluationChecks: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Receipt",
      expectation: "The receipt is visible.",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Receipt",
      expectation: "The receipt contains VAT.",
    },
  ],
  phaseId: "phase-1",
  phaseName: "Purchase",
  phaseOrder: 1,
  dependencyIds: [],
}

const phases = [
  { id: "phase-1", name: "Purchase", order: 1, scenarios: [scenario] },
  { id: "phase-2", name: "Review", order: 2, scenarios: [] },
]

describe("authoring references", () => {
  it("resolves phases by ID, order, or exact name", () => {
    expect(resolvePhaseReference(phases, "phase-1").id).toBe("phase-1")
    expect(resolvePhaseReference(phases, "2").id).toBe("phase-2")
    expect(resolvePhaseReference(phases, "Purchase").id).toBe("phase-1")
    expect(() => resolvePhaseReference(phases, "Missing")).toThrow(/not found/)
  })

  it("requires an ID when check names are ambiguous", () => {
    expect(
      resolveCheckReference(scenario, "00000000-0000-4000-8000-000000000002")
        .expectation
    ).toContain("VAT")
    expect(() => resolveCheckReference(scenario, "Receipt")).toThrow(
      /ambiguous/
    )
  })
})
