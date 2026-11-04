import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  assertSuitePlanMatchesRun,
  buildRunUrl,
  describeRunSelection,
  formatPhaseList,
  initCommand,
  listEnvironmentsCommand,
  parsePhaseList,
  resolveCheckReference,
  resolvePhaseReference,
  resolveRunMode,
} from "./commands.js"
import { writeLocalConfig } from "./config.js"

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
  fixtureRequirements: [],
}

const phases = [
  { id: "phase-1", name: "Purchase", order: 1, scenarios: [scenario] },
  { id: "phase-2", name: "Review", order: 2, scenarios: [] },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe("environment commands", () => {
  it("lists configured environments and marks the default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-environments-list-"))
    await writeLocalConfig(
      {
        environments: {
          production: "https://app.example.com",
          development: "http://localhost:3000",
        },
        defaultEnvironment: "development",
      },
      dir
    )
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await listEnvironmentsCommand(dir)

    expect(write.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe(
      "development\thttp://localhost:3000/\t(default)\nproduction\thttps://app.example.com/\n"
    )
  })
})

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

describe("run selection", () => {
  it("selects a suite and rejects selector combinations", () => {
    expect(resolveRunMode({ suite: "demo-only" })).toEqual({
      mode: "suite",
      requestedScenarioSlug: null,
      requestedPhaseOrder: null,
      requestedPhaseOrders: null,
      requestedSuiteSlug: "demo-only",
    })
    expect(() => resolveRunMode({ suite: "demo-only", phase: "2" })).toThrow(
      /cannot be combined/i
    )
    expect(() =>
      resolveRunMode({ suite: "demo-only", scenario: "checkout" })
    ).toThrow(/cannot be combined/i)
  })
})

describe("phase lists", () => {
  it("parses numbers and ranges into sorted unique phases", () => {
    expect(parsePhaseList("1-7,9,10")).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10])
    expect(parsePhaseList(" 10, 3,3 ,1-2")).toEqual([1, 2, 3, 10])
  })

  it("rejects malformed, zero, descending and oversized lists", () => {
    expect(() => parsePhaseList("")).toThrow(/comma-separated/)
    expect(() => parsePhaseList("1,,2")).toThrow(/comma-separated/)
    expect(() => parsePhaseList("a")).toThrow(/invalid entry "a"/)
    expect(() => parsePhaseList("0,2")).toThrow(/positive/)
    expect(() => parsePhaseList("7-1")).toThrow(/low to high/)
    expect(() => parsePhaseList("1-100000000")).toThrow(/at most 100/)
    expect(() => parsePhaseList("1-60,100-160")).toThrow(/at most 100/)
    expect(() => parsePhaseList("9007199254740992")).toThrow(/too large/)
    expect(() => parsePhaseList("1-9007199254740993")).toThrow(/too large/)
  })

  it("formats phase lists compactly", () => {
    expect(formatPhaseList([1, 2, 3, 4, 5, 6, 7, 9, 10])).toBe("1-7, 9, 10")
    expect(formatPhaseList([1, 3])).toBe("1, 3")
  })

  it("selects the phases mode for several phases and phase mode for one", () => {
    expect(resolveRunMode({ phases: "1-3" })).toMatchObject({
      mode: "phases",
      requestedPhaseOrder: null,
      requestedPhaseOrders: [1, 2, 3],
    })
    expect(resolveRunMode({ phases: "4" })).toMatchObject({
      mode: "phase",
      requestedPhaseOrder: 4,
      requestedPhaseOrders: null,
    })
    expect(() => resolveRunMode({ phases: "1,2", phase: "1" })).toThrow(
      "--phase, --phases cannot be combined."
    )
    expect(() => resolveRunMode({ phases: "1,2", scenario: "x" })).toThrow(
      /cannot be combined/
    )
  })

  it("describes the selection", () => {
    expect(describeRunSelection(resolveRunMode({ phases: "1-7,9" }))).toBe(
      "phases 1-7, 9"
    )
    expect(describeRunSelection(resolveRunMode({ throughPhase: "3" }))).toBe(
      "phases 1-3"
    )
    expect(describeRunSelection(resolveRunMode({}))).toBe("all phases")
  })
})

describe("run URL", () => {
  it("points at the run page of the web app", () => {
    expect(buildRunUrl("https://caracara.example.com", "demo", "run-1")).toBe(
      "https://caracara.example.com/projects/demo/runs/run-1"
    )
    expect(buildRunUrl("https://x.test/base/", "a b", "r")).toBe(
      "https://x.test/base/projects/a%20b/runs/r"
    )
  })
})

describe("suite run plan check", () => {
  const landing = { id: "phase-1", name: "Landing", order: 1 }
  const checkout = { id: "phase-2", name: "Checkout", order: 2 }

  it("accepts a plan with the run's suite phases", () => {
    expect(() =>
      assertSuitePlanMatchesRun({
        suiteSlug: "smoke",
        runPhases: [landing, checkout],
        planPhases: [landing, checkout],
      })
    ).not.toThrow()
  })

  it.each([
    ["a phase was added", [landing], [landing, checkout]],
    ["a phase was removed", [landing, checkout], [landing]],
    ["a phase was swapped", [landing], [checkout]],
    ["a phase was renamed", [landing], [{ ...landing, name: "Home" }]],
    ["a phase was reordered", [landing], [{ ...landing, order: 2 }]],
  ])("rejects the plan when %s after run creation", (_, run, plan) => {
    expect(() =>
      assertSuitePlanMatchesRun({
        suiteSlug: "smoke",
        runPhases: run,
        planPhases: plan,
      })
    ).toThrow('Suite "smoke" changed while the run was starting. Run it again.')
  })
})

describe("initCommand", () => {
  it("rejects a model that caracara run would refuse", async () => {
    await expect(initCommand({ model: "gpt 6" })).rejects.toThrow(
      'Invalid model "gpt 6"'
    )
  })
})
