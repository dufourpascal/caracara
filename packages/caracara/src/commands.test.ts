import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  listEnvironmentsCommand,
  resolveCheckReference,
  resolvePhaseReference,
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
