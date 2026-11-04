import process from "node:process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const STEP_ID = "00000000-0000-4000-8000-0000000000a1"
  const HEALTH_ID = "00000000-0000-4000-8000-0000000000b1"
  const fixture = {
    id: "fixture-1",
    projectId: "project-1",
    name: "Demo user",
    slug: "demo-user",
    description: "",
    locator: "demo@example.com",
    protection: "",
    convergeSteps: [
      {
        id: STEP_ID,
        name: "Create user",
        instructions: "Sign up.",
        doneWhen: "The user can sign in.",
      },
    ],
    healthChecks: [
      { id: HEALTH_ID, name: "Signs in", expectation: "Sign-in works." },
    ],
    requirements: [],
    createdAt: 1,
    updatedAt: 1,
  }
  const executionPlan = {
    project: { projectPrompt: "Test the application." },
    phases: [
      {
        id: "phase-1",
        name: "Setup",
        order: 1,
        scenarios: [
          {
            id: "scenario-1",
            name: "Articles",
            slug: "articles",
            status: "active",
            instructions: "Open articles.",
            evaluationChecks: [],
            phaseId: "phase-1",
            phaseName: "Setup",
            phaseOrder: 1,
            dependencyIds: [] as string[],
            fixtureRequirements: [
              {
                fixtureId: "fixture-1",
                access: "read",
                mutationScope: null,
              },
            ] as Array<{
              fixtureId: string
              access: string
              mutationScope: string | null
            }>,
          },
        ],
      },
    ],
    suite: null,
    unassignedScenarioCount: 0,
    fixtures: [fixture],
  }
  // Verdicts the fake agent returns per task, in order; default passed.
  const taskVerdicts: Array<"passed" | "failed"> = []
  const runTask = vi.fn(
    async (input: {
      checks: Array<{ id: string }>
      prompt: string
      signal?: AbortSignal
    }) => {
      const verdict = taskVerdicts.shift() ?? "passed"
      return {
        executionSummary: "Done.",
        checkResults: input.checks.map((check) => ({
          checkId: check.id,
          verdict,
          evidence: verdict === "passed" ? "Seen." : "Sign-in rejected.",
          blockedReason: null,
        })),
      }
    }
  )
  const executeScenario = vi.fn(async () => ({
    executionSummary: "Done.",
    checkResults: [],
    usage: { complete: true },
  }))
  const close = vi.fn(async () => undefined)
  const startRun = vi.fn(async (args: unknown) => {
    void args
    return { executeScenario, runTask, close, isHealthy: () => true }
  })
  return {
    STEP_ID,
    HEALTH_ID,
    executionPlan,
    taskVerdicts,
    runTask,
    executeScenario,
    close,
    startRun,
    hooks: {} as Record<string, { verify?: string; converge?: string }>,
    readFixtureHooks: vi.fn(async () => ({
      cwd: process.cwd(),
      hooks: mocks.hooks,
    })),
    createRun: vi.fn(async (args: unknown) => {
      void args
      return {
        run: {
          id: "run-1",
          name: "steady-hawk-20261104-120000",
          evidencePolicy: "text_only",
          requestedSuitePhases: [{ id: "phase-1", name: "Setup", order: 1 }],
        },
      }
    }),
    fetchExecutionPlan: vi.fn(async (args: unknown) => {
      void args
      return executionPlan
    }),
    fetchFixtures: vi.fn(async () => ({ fixtures: [fixture] })),
    finalizeRun: vi.fn(async (args: unknown) => {
      void args
    }),
    startScenarioExecution: vi.fn(async () => ({
      result: { id: "result-1" },
    })),
    submitScenarioResult: vi.fn(async () => undefined),
  }
})

vi.mock("./api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api.js")>()),
  createRun: mocks.createRun,
  fetchExecutionPlan: mocks.fetchExecutionPlan,
  fetchFixtures: mocks.fetchFixtures,
  finalizeRun: mocks.finalizeRun,
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
    model: "gpt-5.5",
    model_reasoning_effort: "high",
    selectedProjectSlug: "demo",
    userEmail: "test@example.com",
  })),
}))

vi.mock("./execution.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./execution.js")>()),
  getRunnerAdapter: vi.fn(() => ({ type: "codex", startRun: mocks.startRun })),
}))

vi.mock("./fixtures.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fixtures.js")>()),
  readFixtureHooks: mocks.readFixtureHooks,
}))

import {
  createFixtureCommand,
  fixtureOperationCommand,
  requireFixtureCommand,
  runCommand,
  updateFixtureCommand,
} from "./commands.js"
import type { RunCommandOptions } from "./types.js"

afterEach(() => {
  process.exitCode = undefined
  mocks.taskVerdicts.length = 0
  for (const key of Object.keys(mocks.hooks)) {
    delete mocks.hooks[key]
  }
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function output() {
  const chunks: string[] = []
  return {
    stream: {
      isTTY: false,
      write(chunk: string) {
        chunks.push(chunk)
        return true
      },
    },
    text: () => chunks.join(""),
  }
}

async function run(options: RunCommandOptions) {
  const stdout = output()
  const stderr = output()
  await runCommand(options, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    env: {},
  })
  return { stdout: stdout.text(), stderr: stderr.text() }
}

function createdPreflight() {
  const call = mocks.createRun.mock.calls[0]?.[0] as
    { payload: { fixturePreflight?: unknown } } | undefined
  return call?.payload.fixturePreflight
}

const entry = {
  fixtureId: "fixture-1",
  fixtureSlug: "demo-user",
  fixtureName: "Demo user",
  access: "read",
}

describe("fixture preflight in caracara run", () => {
  it("checks with an agent task, records the result and reuses the session", async () => {
    const { stdout } = await run({})

    expect(mocks.runTask).toHaveBeenCalledOnce()
    expect(mocks.startRun).toHaveBeenCalledOnce()
    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.5",
        modelReasoningEffort: "high",
      })
    )
    expect(createdPreflight()).toEqual([
      { ...entry, outcome: "healthy", executor: "agent" },
    ])
    expect(mocks.executeScenario).toHaveBeenCalledWith(
      expect.objectContaining({ fixtures: [mocks.executionPlan.fixtures[0]] })
    )
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(stdout).toContain("Fixture demo-user: healthy (agent)")
    expect(stdout).toContain("Fixtures   demo-user healthy (agent)")
    expect(process.exitCode).toBeUndefined()
  })

  it("exits 4 without creating a run when a fixture is unhealthy", async () => {
    mocks.taskVerdicts.push("failed")

    const { stdout, stderr } = await run({})

    expect(process.exitCode).toBe(4)
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(stdout).toContain(
      "Fixture demo-user: unhealthy (agent)\n  Signs in: failed. Sign-in rejected."
    )
    expect(stderr).toContain(
      "Fixture preflight failed; no run was created. Repair with --fixtures repair"
    )
  })

  it("treats a fixture without hook or health checks as unhealthy", async () => {
    mocks.fetchExecutionPlan.mockResolvedValueOnce({
      ...mocks.executionPlan,
      fixtures: [{ ...mocks.executionPlan.fixtures[0]!, healthChecks: [] }],
    })

    await run({})

    expect(process.exitCode).toBe(4)
    expect(mocks.startRun).not.toHaveBeenCalled()
    expect(mocks.createRun).not.toHaveBeenCalled()
  })

  it("leaves a healthy fixture alone under repair", async () => {
    await run({ fixtures: "repair" })

    const checks = mocks.runTask.mock.calls.map((call) =>
      call[0].checks.map((check) => check.id)
    )
    expect(checks).toEqual([[mocks.HEALTH_ID]])
    expect(createdPreflight()).toEqual([
      { ...entry, outcome: "healthy", executor: "agent" },
    ])
  })

  it("repairs an unhealthy fixture by converging, then verifying", async () => {
    // verify fails, converge passes, final verify passes
    mocks.taskVerdicts.push("failed", "passed", "passed")

    await run({ fixtures: "repair" })

    const checks = mocks.runTask.mock.calls.map((call) =>
      call[0].checks.map((check) => check.id)
    )
    expect(checks).toEqual([
      [mocks.HEALTH_ID],
      [mocks.STEP_ID],
      [mocks.HEALTH_ID],
    ])
    expect(createdPreflight()).toEqual([
      { ...entry, outcome: "repaired", executor: "agent" },
    ])
    expect(mocks.startRun).toHaveBeenCalledOnce()
  })

  it("exits 4 when the fixture is still unhealthy after repair", async () => {
    mocks.taskVerdicts.push("failed", "passed", "failed")

    await run({ fixtures: "repair" })

    expect(process.exitCode).toBe(4)
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it("skips the preflight and records skipped fixtures", async () => {
    await run({ fixtures: "skip" })

    expect(mocks.readFixtureHooks).not.toHaveBeenCalled()
    expect(mocks.runTask).not.toHaveBeenCalled()
    expect(createdPreflight()).toEqual([
      { ...entry, outcome: "skipped", executor: null },
    ])
  })

  it("uses a configured hook and keeps --json stdout to JSON lines", async () => {
    mocks.hooks["demo-user"] = { verify: "echo hook-output; exit 0" }

    const { stdout, stderr } = await run({ json: true })

    expect(mocks.runTask).not.toHaveBeenCalled()
    expect(createdPreflight()).toEqual([
      { ...entry, outcome: "healthy", executor: "hook" },
    ])
    for (const line of stdout.trimEnd().split("\n")) {
      expect(() => JSON.parse(line) as unknown).not.toThrow()
    }
    expect(stderr).toContain("hook-output")
    expect(stderr).toContain("Fixture demo-user: healthy (hook)")
  })

  it("prints only problems with --quiet", async () => {
    const { stdout, stderr } = await run({ quiet: true })

    expect(stdout).not.toContain("Fixture demo-user")
    expect(stderr).not.toContain("Fixture demo-user")
  })

  it("sends no preflight and reads no hooks when nothing requires a fixture", async () => {
    const plan = mocks.executionPlan
    mocks.fetchExecutionPlan.mockResolvedValueOnce({
      ...plan,
      phases: plan.phases.map((phase) => ({
        ...phase,
        scenarios: phase.scenarios.map((scenario) => ({
          ...scenario,
          fixtureRequirements: [],
        })),
      })),
    })

    await run({})

    expect(mocks.readFixtureHooks).not.toHaveBeenCalled()
    expect(createdPreflight()).toBeUndefined()
  })

  it("ends with 130, no run and a closed session when interrupted during preflight", async () => {
    mocks.runTask.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )
    const existing = new Set(process.listeners("SIGINT"))

    const pending = run({})
    await vi.waitFor(() => expect(mocks.runTask).toHaveBeenCalled())
    process.listeners("SIGINT").find((listener) => !existing.has(listener))?.(
      "SIGINT"
    )
    await pending

    expect(process.exitCode).toBe(130)
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(
      process.listeners("SIGINT").filter((listener) => !existing.has(listener))
    ).toHaveLength(0)
  })

  it("closes the session when run creation fails after preflight", async () => {
    mocks.createRun.mockRejectedValueOnce(new Error("API down"))

    await expect(run({})).rejects.toThrow("API down")

    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it("fetches the suite plan, runs the preflight, then creates and checks the run", async () => {
    await run({ suite: "smoke" })

    expect(mocks.fetchExecutionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ suiteSlug: "smoke" })
    )
    const order = [
      mocks.fetchExecutionPlan,
      mocks.runTask,
      mocks.createRun,
      mocks.executeScenario,
    ].map((mock) => mock.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((left, right) => left! - right!))
    expect(mocks.executeScenario).toHaveBeenCalledOnce()
  })

  it("rejects an unknown --fixtures mode before doing anything", async () => {
    await expect(run({ fixtures: "reset" })).rejects.toThrow(
      '--fixtures must be check, repair or skip, not "reset".'
    )
    expect(mocks.fetchExecutionPlan).not.toHaveBeenCalled()
  })
})

describe("fixture commands", () => {
  it("verifies a fixture and exits 4 when it is unhealthy", async () => {
    mocks.taskVerdicts.push("failed")
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await fixtureOperationCommand("verify", "demo-user", {})

    expect(process.exitCode).toBe(4)
    expect(String(stdout.mock.calls[0]?.[0])).toContain(
      "Fixture demo-user: unhealthy (agent)"
    )
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it("converges, then verifies, with hooks", async () => {
    mocks.hooks["demo-user"] = { converge: "true", verify: "true" }
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await fixtureOperationCommand("converge", "demo-user", {})

    expect(process.exitCode).toBeUndefined()
    expect(mocks.startRun).not.toHaveBeenCalled()
    expect(String(stdout.mock.calls[0]?.[0])).toBe(
      "Fixture demo-user: repaired (hook)\n"
    )
  })

  it("rejects an unknown fixture slug", async () => {
    await expect(fixtureOperationCommand("verify", "nope", {})).rejects.toThrow(
      'Fixture "nope" was not found in project demo.'
    )
  })
})

describe("fixture authoring arguments", () => {
  it("validates requireFixture targets and access before calling the API", async () => {
    await expect(
      requireFixtureCommand({ fixture: "demo-user" })
    ).rejects.toThrow("Pass exactly one of --phase or --scenario.")
    await expect(
      requireFixtureCommand({ fixture: "demo-user", phase: "1", scenario: "a" })
    ).rejects.toThrow("Pass exactly one of --phase or --scenario.")
    await expect(
      requireFixtureCommand({
        fixture: "demo-user",
        phase: "1",
        access: "write",
      })
    ).rejects.toThrow('--access must be read or mutates, not "write".')
    await expect(
      requireFixtureCommand({
        fixture: "demo-user",
        phase: "1",
        access: "mutates",
      })
    ).rejects.toThrow("--access mutates needs --mutation-scope")
    await expect(
      requireFixtureCommand({
        fixture: "demo-user",
        phase: "1",
        mutationScope: "titles",
      })
    ).rejects.toThrow("--mutation-scope only applies with --access mutates.")
  })

  it("rejects an empty update and malformed steps files", async () => {
    await expect(
      updateFixtureCommand({ fixture: "demo-user" })
    ).rejects.toThrow("Nothing to update.")
    const dir = await mkdtemp(join(tmpdir(), "caracara-fixture-steps-"))
    const stepsFile = join(dir, "steps.json")
    await writeFile(stepsFile, JSON.stringify([{ name: "Only a name" }]))
    await expect(
      createFixtureCommand({ name: "Demo user", stepsFile })
    ).rejects.toThrow(`${stepsFile} must be a JSON array of`)
  })
})
