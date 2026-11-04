import { afterEach, describe, expect, it, vi } from "vitest"

import {
  formatFixtureList,
  formatUnknownHookWarning,
  requireFixtureCommand,
  resolveFixtureCheckReference,
  resolveFixtureReference,
  resolveFixtureStepReference,
  unrequireFixtureCommand,
  updateFixtureCheckCommand,
  updateFixtureCommand,
  updateFixtureStepCommand,
  validateRequireFixtureOptions,
  validateUnrequireFixtureOptions,
  validateUpdateFixtureOptions,
} from "./fixture-commands.js"

const STEP = "00000000-0000-4000-8000-000000000101"
const CHECK_1 = "00000000-0000-4000-8000-00000000000a"
const CHECK_2 = "00000000-0000-4000-8000-00000000000b"

const fixture = {
  id: "fixture-1",
  projectId: "project-1",
  name: "HET vs HOMO",
  slug: "het-vs-homo",
  description: "",
  locator: "",
  protection: "",
  convergeSteps: [
    { id: STEP, name: "Import", instructions: "Import.", doneWhen: "Done." },
  ],
  healthChecks: [
    { id: CHECK_1, name: "Animals", expectation: "Nine animals." },
    { id: CHECK_2, name: "Animals", expectation: "All genotyped." },
  ],
  resetInstructions: null,
  createdAt: 1,
  updatedAt: 1,
  requirements: [],
  health: [
    {
      environment: "production",
      status: "unknown" as const,
      operationId: null,
      checkedAt: null,
      busy: false,
    },
    {
      environment: "development",
      status: "healthy" as const,
      operationId: "op-1",
      checkedAt: 2,
      busy: true,
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("fixture authoring arguments", () => {
  it("requires exactly one requirement target", () => {
    expect(() => validateUnrequireFixtureOptions({})).toThrow(
      /exactly one of `--phase` or `--scenario`/
    )
    expect(() =>
      validateUnrequireFixtureOptions({ phase: "1", scenario: "checkout" })
    ).toThrow(/exactly one/)
    expect(() => validateUnrequireFixtureOptions({ phase: "1" })).not.toThrow()
  })

  it("validates access and mutation scope", () => {
    expect(
      validateRequireFixtureOptions({ fixture: "fx", phase: "1" })
    ).toBe("read")
    expect(() =>
      validateRequireFixtureOptions({
        fixture: "fx",
        phase: "1",
        access: "write",
      })
    ).toThrow(/read or mutates/)
    expect(() =>
      validateRequireFixtureOptions({
        fixture: "fx",
        scenario: "checkout",
        access: "mutates",
      })
    ).toThrow(/requires `--mutation-scope`/)
    expect(() =>
      validateRequireFixtureOptions({
        fixture: "fx",
        scenario: "checkout",
        mutationScope: "results",
      })
    ).toThrow(/requires `--access mutates`/)
    expect(
      validateRequireFixtureOptions({
        fixture: "fx",
        scenario: "checkout",
        access: "mutates",
        mutationScope: "results",
      })
    ).toBe("mutates")
  })

  it("validates fixture updates", () => {
    expect(() => validateUpdateFixtureOptions({ fixture: "fx" })).toThrow(
      /at least one change/
    )
    expect(() =>
      validateUpdateFixtureOptions({
        fixture: "fx",
        resetInstructions: "Reset it.",
        clearReset: true,
      })
    ).toThrow(/cannot be combined/)
    expect(() =>
      validateUpdateFixtureOptions({ fixture: "fx", clearReset: true })
    ).not.toThrow()
  })

  it.each([
    ["requireFixture", () => requireFixtureCommand({ fixture: "fx" })],
    ["unrequireFixture", () => unrequireFixtureCommand({ fixture: "fx" })],
    ["updateFixture", () => updateFixtureCommand({ fixture: "fx" })],
    [
      "updateFixtureStep",
      () => updateFixtureStepCommand({ fixture: "fx", step: "Import" }),
    ],
    [
      "updateFixtureCheck",
      () => updateFixtureCheckCommand({ fixture: "fx", check: "Animals" }),
    ],
  ])("%s rejects invalid arguments before any request", async (_name, run) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await expect(run()).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("fixture references", () => {
  it("resolves fixtures by slug or ID", () => {
    expect(resolveFixtureReference([fixture], "het-vs-homo").id).toBe(
      "fixture-1"
    )
    expect(resolveFixtureReference([fixture], "fixture-1").slug).toBe(
      "het-vs-homo"
    )
    expect(() => resolveFixtureReference([fixture], "missing")).toThrow(
      /not found/
    )
  })

  it("resolves steps and checks by ID or exact name", () => {
    expect(resolveFixtureStepReference(fixture, "Import").id).toBe(STEP)
    expect(resolveFixtureStepReference(fixture, STEP).name).toBe("Import")
    expect(() => resolveFixtureStepReference(fixture, "import")).toThrow(
      /Step "import" was not found/
    )
    expect(resolveFixtureCheckReference(fixture, CHECK_2).expectation).toBe(
      "All genotyped."
    )
    expect(() => resolveFixtureCheckReference(fixture, "Animals")).toThrow(
      /ambiguous. Use its check ID/
    )
  })
})

describe("fixtures:list output", () => {
  it("prints health per environment and configured hooks", () => {
    expect(
      formatFixtureList([fixture], {
        "het-vs-homo": { verify: "./v.sh", reset: "./r.sh" },
      })
    ).toBe(
      "het-vs-homo\tHET vs HOMO\trequirements: 0\thealth: development=healthy (busy), production=unknown\thooks: verify, reset\n"
    )
    expect(formatFixtureList([fixture], {}, "staging")).toBe(
      "het-vs-homo\tHET vs HOMO\trequirements: 0\thealth: staging=unknown\thooks: none\n"
    )
  })

  it("warns about hook keys that match no fixture", () => {
    expect(
      formatUnknownHookWarning(
        { "het-vs-homo": {}, "het-vs-homoo": {} },
        ["het-vs-homo"],
        "/p/.caracara/fixtures.json",
        "demo"
      )
    ).toBe(
      "Warning: /p/.caracara/fixtures.json configures hooks for het-vs-homoo, which is not a fixture of project demo.\n"
    )
    expect(
      formatUnknownHookWarning({ "het-vs-homo": {} }, ["het-vs-homo"], null, "demo")
    ).toBeNull()
  })
})
