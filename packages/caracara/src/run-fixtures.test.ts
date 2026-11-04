import process from "node:process"

import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const fixture = {
    id: "fixture-1",
    projectId: "project-1",
    name: "HET vs HOMO",
    slug: "het-vs-homo",
    description: "",
    locator: "Projects > HET vs HOMO",
    protection: "",
    convergeSteps: [],
    healthChecks: [
      {
        id: "00000000-0000-4000-8000-00000000000a",
        name: "Animals",
        expectation: "Nine animals exist.",
      },
    ],
    resetInstructions: null,
    createdAt: 1,
    updatedAt: 1,
  }
  const makePlan = (access: "read" | "mutates") => ({
    project: { projectPrompt: "Never change fixtures." },
    phases: [
      {
        id: "phase-1",
        name: "Analysis",
        order: 1,
        scenarios: [
          {
            id: "scenario-1",
            name: "Calculate",
            slug: "calculate",
            status: "active",
            instructions: "Calculate results.",
            evaluationChecks: [],
            phaseId: "phase-1",
            phaseName: "Analysis",
            phaseOrder: 1,
            dependencyIds: [],
            fixtureRequirements: [
              {
                fixtureId: "fixture-1",
                access,
                mutationScope: access === "mutates" ? "results" : null,
              },
            ],
          },
        ],
      },
    ],
    suite: null,
    unassignedScenarioCount: 0,
    fixtures: [fixture],
  })
  let operationCounter = 0
  const hookStatuses: Array<"succeeded" | "failed"> = []
  return {
    fixture,
    makePlan,
    hookStatuses,
    resetOperationCounter: () => {
      operationCounter = 0
    },
    createRun: vi.fn(async (args: unknown) => {
      void args
      return {
        run: {
          id: "run-1",
          name: "steady-hawk-20260827-120000",
          evidencePolicy: "text_only",
        },
      }
    }),
    fetchExecutionPlan: vi.fn(async (args: unknown) => {
      void args
      return makePlan("read")
    }),
    finalizeRun: vi.fn(async (args: unknown) => {
      void args
    }),
    startScenarioExecution: vi.fn(async (args: unknown) => {
      void args
      return { result: { id: "result-1" } }
    }),
    submitScenarioResult: vi.fn(async (args: unknown) => {
      void args
    }),
    fetchFixtures: vi.fn(async (args: unknown) => {
      void args
      return { fixtures: [{ ...fixture, requirements: [], health: [] }] }
    }),
    startFixtureOperation: vi.fn(
      async (args: { payload: { kind: string } }) => {
        operationCounter += 1
        return {
          operation: { id: `op-${operationCounter}`, kind: args.payload.kind },
        }
      }
    ),
    finishFixtureOperation: vi.fn(
      async (args: { operationId: string; payload: { status: string } }) => ({
        operation: { id: args.operationId, status: args.payload.status },
      })
    ),
    runFixtureHook: vi.fn(async (input: { kind: string; signal?: AbortSignal }) => {
      void input
      const status = hookStatuses.shift() ?? "succeeded"
      return {
        status,
        checkResults: [],
        summary: `hook ${status}`,
      }
    }),
    executeScenario: vi.fn(async (input: unknown) => {
      void input
      return {
        checkResults: [],
        executionSummary: "Done",
        usage: { complete: true },
      }
    }),
    startRun: vi.fn(async () => ({
      executeScenario: mocks.executeScenario,
      executeFixtureTask: vi.fn(),
      close: vi.fn(async () => undefined),
    })),
  }
})

vi.mock("./api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api.js")>()),
  createRun: mocks.createRun,
  fetchExecutionPlan: mocks.fetchExecutionPlan,
  fetchFixtures: mocks.fetchFixtures,
  finalizeRun: mocks.finalizeRun,
  finishFixtureOperation: mocks.finishFixtureOperation,
  startFixtureOperation: mocks.startFixtureOperation,
  startScenarioExecution: mocks.startScenarioExecution,
  submitScenarioResult: mocks.submitScenarioResult,
}))

vi.mock("./config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config.js")>()),
  readLocalSecrets: vi.fn(async () => ({})),
  readResolvedConfig: vi.fn(async () => ({
    accessToken: "token",
    apiBaseUrl: "https://caracara.example.com",
    defaultEnvironment: "development",
    environments: { development: "http://localhost:3000/" },
    expiresAt: null,
    runner: "codex",
    selectedProjectSlug: "demo",
    userEmail: "test@example.com",
  })),
}))

vi.mock("./fixture-hooks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fixture-hooks.js")>()),
  readFixtureHooks: vi.fn(async () => ({
    path: "/project/.caracara/fixtures.json",
    rootDir: "/project",
    projects: {
      demo: {
        "het-vs-homo": {
          verify: "./verify.sh",
          converge: "./converge.sh",
          reset: "./reset.sh",
        },
      },
    },
  })),
  runFixtureHook: mocks.runFixtureHook,
}))

vi.mock("./execution.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./execution.js")>()),
  getRunnerAdapter: vi.fn(() => ({
    type: "codex",
    startRun: mocks.startRun,
  })),
}))

import { runCommand } from "./commands.js"

type CreateRunCall = [
  { payload: { fixturePreflight?: unknown[]; mode: string } },
]

function kinds() {
  return (
    mocks.startFixtureOperation.mock.calls as unknown as Array<
      [{ payload: { kind: string; runId?: string } }]
    >
  ).map(([args]) => args.payload)
}

afterEach(() => {
  process.exitCode = undefined
  mocks.hookStatuses.length = 0
  mocks.resetOperationCounter()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  mocks.fetchExecutionPlan.mockImplementation(async () =>
    mocks.makePlan("read")
  )
})

describe("run fixture preflight", () => {
  it("verifies required fixtures before creating the run", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    await runCommand({})

    expect(kinds()).toEqual([
      expect.objectContaining({ kind: "verify" }),
    ])
    expect(kinds()[0]).not.toHaveProperty("runId")
    expect(
      mocks.startFixtureOperation.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.createRun.mock.invocationCallOrder[0]!)
    const [createArgs] = mocks.createRun.mock.calls[0] as unknown as CreateRunCall
    expect(createArgs.payload.fixturePreflight).toEqual([
      { fixtureId: "fixture-1", outcome: "healthy", operationId: "op-1" },
    ])
    const executionInput = mocks.executeScenario.mock.calls[0]?.[0] as {
      fixtures: Array<{ access: string; fixture: { slug: string } }>
    }
    expect(executionInput.fixtures).toEqual([
      expect.objectContaining({
        access: "read",
        fixture: expect.objectContaining({ slug: "het-vs-homo" }),
      }),
    ])
    // A read-only requirement needs no post-run reset.
    expect(mocks.startFixtureOperation).toHaveBeenCalledOnce()
    expect(process.exitCode).toBeUndefined()
  })

  it("aborts with exit code 3 and creates no run when a fixture is unhealthy", async () => {
    mocks.hookStatuses.push("failed")
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await runCommand({})

    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.startRun).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(3)
    expect(stdout.mock.calls.map(([text]) => String(text)).join("")).toContain(
      "Fixture preflight failed in development: het-vs-homo is unhealthy. No run was created."
    )
  })

  it("repairs an unhealthy fixture when asked", async () => {
    mocks.hookStatuses.push("failed", "succeeded", "succeeded")
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    await runCommand({ fixtures: "repair" })

    expect(kinds().map((payload) => payload.kind)).toEqual([
      "verify",
      "converge",
      "verify",
    ])
    const [createArgs] = mocks.createRun.mock.calls[0] as unknown as CreateRunCall
    expect(createArgs.payload.fixturePreflight).toEqual([
      { fixtureId: "fixture-1", outcome: "repaired", operationId: "op-3" },
    ])
  })

  it("skips fixture operations entirely with --fixtures skip", async () => {
    mocks.fetchExecutionPlan.mockResolvedValue(mocks.makePlan("mutates"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    await runCommand({ fixtures: "skip" })

    expect(mocks.startFixtureOperation).not.toHaveBeenCalled()
    const [createArgs] = mocks.createRun.mock.calls[0] as unknown as CreateRunCall
    expect(createArgs.payload.fixturePreflight).toEqual([
      { fixtureId: "fixture-1", outcome: "skipped", operationId: null },
    ])
  })

  it("finishes an interrupted preflight operation and creates no run", async () => {
    mocks.runFixtureHook.mockImplementationOnce(
      (input: { kind: string; signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(input.signal?.reason),
            { once: true }
          )
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() => expect(mocks.runFixtureHook).toHaveBeenCalled())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")
    await run

    expect(mocks.finishFixtureOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "op-1",
        payload: expect.objectContaining({ status: "interrupted" }),
      })
    )
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(130)
    expect(
      process
        .listeners("SIGINT")
        .filter((listener) => !existingListeners.has(listener))
    ).toHaveLength(0)
  })

  it("rejects an unknown fixture mode before any request", async () => {
    await expect(runCommand({ fixtures: "force" })).rejects.toThrow(
      /--fixtures must be one of/
    )
    expect(mocks.fetchExecutionPlan).not.toHaveBeenCalled()
  })

  it("runs preflight before creating a suite run", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    await runCommand({ suite: "smoke" })

    expect(mocks.fetchExecutionPlan).toHaveBeenCalledTimes(2)
    const order = [
      mocks.fetchExecutionPlan.mock.invocationCallOrder[0]!,
      mocks.startFixtureOperation.mock.invocationCallOrder[0]!,
      mocks.createRun.mock.invocationCallOrder[0]!,
      mocks.fetchExecutionPlan.mock.invocationCallOrder[1]!,
    ]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const [createArgs] = mocks.createRun.mock.calls[0] as unknown as CreateRunCall
    expect(createArgs.payload).toMatchObject({
      mode: "suite",
      fixturePreflight: [
        { fixtureId: "fixture-1", outcome: "healthy", operationId: "op-1" },
      ],
    })
  })
})

describe("post-run fixture maintenance", () => {
  it("resets and verifies mutated fixtures after finalization, keeping the run result", async () => {
    mocks.fetchExecutionPlan.mockResolvedValue(mocks.makePlan("mutates"))
    // preflight verify, reset, final verify (unhealthy)
    mocks.hookStatuses.push("succeeded", "succeeded", "failed")
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await runCommand({})

    expect(kinds()).toEqual([
      expect.objectContaining({ kind: "verify" }),
      expect.objectContaining({ kind: "reset", runId: "run-1" }),
      expect.objectContaining({ kind: "verify", runId: "run-1" }),
    ])
    expect(
      mocks.finalizeRun.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.startFixtureOperation.mock.invocationCallOrder[1]!)
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: "completed" }),
      })
    )
    expect(process.exitCode).toBeUndefined()
    expect(stdout.mock.calls.map(([text]) => String(text)).join("")).toContain(
      "Warning: het-vs-homo is not healthy after this run."
    )
  })

  it("also resets after a failed run", async () => {
    mocks.fetchExecutionPlan.mockResolvedValue(mocks.makePlan("mutates"))
    mocks.executeScenario.mockRejectedValueOnce(new Error("Runner failed"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    await runCommand({})

    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: "failed" }),
      })
    )
    expect(kinds().map((payload) => payload.kind)).toEqual([
      "verify",
      "reset",
      "verify",
    ])
  })
})
