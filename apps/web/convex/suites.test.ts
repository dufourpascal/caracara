import { convexToJson } from "convex/values"
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

  it("returns field-specific errors as serializable string arrays", () => {
    let error: unknown
    try {
      parseSuiteInput({
        name: " ",
        slug: "s".repeat(121),
        phaseIds: ["phase-1", "phase-1"],
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      data: {
        code: "validation_error",
        message: "Check the highlighted suite fields.",
      },
    })
    const { fieldErrors } = (error as { data: { fieldErrors: unknown } }).data
    expect(fieldErrors).toEqual({
      name: ["Suite name is required."],
      slug: ["Slug must be 120 characters or fewer."],
      phaseIds: ["Suite phase IDs must be unique."],
    })
    expect(convexToJson(fieldErrors as never)).toEqual(fieldErrors)
  })

  it("bounds suite names in UTF-16 code units", () => {
    // 60 emoji are 120 UTF-16 units; 61 are 122 and must not be stored.
    expect(
      parseSuiteInput({ name: "😀".repeat(60), phaseIds: [] }).name
    ).toHaveLength(120)

    let error: unknown
    try {
      parseSuiteInput({ name: "😀".repeat(61), phaseIds: [] })
    } catch (caught) {
      error = caught
    }
    expect(
      (error as { data: { fieldErrors: unknown } }).data.fieldErrors
    ).toEqual({ name: ["Suite name must be 120 characters or fewer."] })
  })
})
