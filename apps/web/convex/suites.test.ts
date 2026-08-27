import { describe, expect, it } from "vitest"

import { parseSuiteInput } from "./suites"

describe("suite input validation", () => {
  it("trims names and derives a slug from a blank value", () => {
    expect(
      parseSuiteInput({
        name: "  Landing and demo  ",
        slug: "  ",
        phaseIds: ["phase-1", "phase-3"],
      })
    ).toEqual({
      name: "Landing and demo",
      slug: undefined,
      phaseIds: ["phase-1", "phase-3"],
    })
  })

  it("allows empty suites but rejects duplicate phase membership", () => {
    expect(
      parseSuiteInput({ name: "Empty", slug: "empty", phaseIds: [] })
    ).toMatchObject({ phaseIds: [] })
    expect(() =>
      parseSuiteInput({
        name: "Duplicate",
        slug: "duplicate",
        phaseIds: ["phase-1", "phase-1"],
      })
    ).toThrow()
  })
})
