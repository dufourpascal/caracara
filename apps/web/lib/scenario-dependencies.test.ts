import { describe, expect, it } from "vitest"

import { wouldCreateDependencyCycle } from "./scenario-dependencies"

const scenarios = [
  { id: "checkout", dependencyIds: ["cart"] },
  { id: "cart", dependencyIds: ["login"] },
  { id: "login", dependencyIds: [] },
  { id: "receipt", dependencyIds: ["checkout"] },
]

describe("scenario dependencies", () => {
  it("detects direct and transitive cycles before selection", () => {
    expect(wouldCreateDependencyCycle(scenarios, "checkout", "receipt")).toBe(
      true
    )
    expect(wouldCreateDependencyCycle(scenarios, "login", "cart")).toBe(true)
    expect(wouldCreateDependencyCycle(scenarios, "login", "receipt")).toBe(true)
    expect(wouldCreateDependencyCycle(scenarios, "receipt", "login")).toBe(
      false
    )
    expect(wouldCreateDependencyCycle(scenarios, undefined, "receipt")).toBe(
      false
    )
  })
})
