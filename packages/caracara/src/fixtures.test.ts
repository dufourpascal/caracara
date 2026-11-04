import type {
  Fixture,
  FixtureOperation,
  OrderedScenario,
} from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  buildBlockedRetryPrompt,
  buildFixtureTaskResultSchema,
  executeFixtureTaskWithTurn,
  buildRunnerPrompt,
  RunnerExecutionError,
  validateFixtureTaskOutput,
} from "./execution.js"
import type { FixtureHookResult } from "./fixture-hooks.js"
import {
  buildFixtureMaintenancePrompt,
  resolveProtectedFixtures,
} from "./fixture-prompts.js"
import {
  collectRequiredFixtures,
  executeFixtureOperation,
  parseFixtureMode,
  runFixturePreflight,
  runPostRunMaintenance,
  selectFixtureExecutor,
  selectPostRunResetFixtures,
  type FixtureAgent,
  type FixtureRuntime,
} from "./fixtures.js"

const CHECK_A = "00000000-0000-4000-8000-00000000000a"
const CHECK_B = "00000000-0000-4000-8000-00000000000b"
const STEP_1 = "00000000-0000-4000-8000-000000000101"
const STEP_2 = "00000000-0000-4000-8000-000000000102"

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: "fixture-1",
    projectId: "project-1",
    name: "HET vs HOMO",
    slug: "het-vs-homo",
    description: "Nine animals and twelve slices.",
    locator: "Projects > Caracara Fixture HET vs HOMO",
    protection: "Never delete animals.",
    convergeSteps: [
      {
        id: STEP_1,
        name: "Create project",
        instructions: "Create the project.",
        doneWhen: "The project exists.",
      },
      {
        id: STEP_2,
        name: "Import animals",
        instructions: "Import nine animals.",
        doneWhen: "Nine animals exist.",
      },
    ],
    healthChecks: [
      { id: CHECK_A, name: "Animals", expectation: "Nine animals exist." },
      { id: CHECK_B, name: "Slices", expectation: "Twelve slices exist." },
    ],
    resetInstructions: "Delete results newer than the baseline.",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const scenario: OrderedScenario = {
  id: "scenario-1",
  name: "Calculate results",
  slug: "calculate-results",
  status: "active",
  instructions: "Calculate results.",
  evaluationChecks: [
    { id: CHECK_A, name: "Result", expectation: "A result is shown." },
  ],
  dependencyIds: [],
  fixtureRequirements: [],
}

function makeRuntime(overrides: Partial<FixtureRuntime> = {}) {
  let counter = 0
  const operations: Array<{ kind: string; status?: string }> = []
  const start = vi.fn(
    async (payload: { kind: string; fixtureId: string }) => {
      counter += 1
      operations.push({ kind: payload.kind })
      return { id: `op-${counter}`, kind: payload.kind } as FixtureOperation
    }
  )
  const finish = vi.fn(
    async (
      operationId: string,
      payload: { status: string },
      signal: AbortSignal
    ) => {
      void signal
      return { id: operationId, status: payload.status } as FixtureOperation
    }
  )
  const output: string[] = []
  const runtime: FixtureRuntime = {
    api: { start, finish },
    projectSlug: "demo",
    environment: { name: "development", targetUrl: "http://localhost:3000/" },
    hooks: {},
    hookCwd: "/project",
    secrets: {},
    signal: new AbortController().signal,
    getAgent: vi.fn(async () => {
      throw new Error("no agent in this test")
    }),
    recordUsage: vi.fn(),
    write: (text) => output.push(text),
    ...overrides,
  }
  return { runtime, start, finish, output, operations }
}

function hookResults(...results: Array<FixtureHookResult["status"]>) {
  const queue = [...results]
  return vi.fn(async (): Promise<FixtureHookResult> => {
    const status = queue.shift() ?? "succeeded"
    return {
      status,
      checkResults:
        status === "failed"
          ? [
              {
                checkId: CHECK_B,
                name: "Slices",
                verdict: "failed",
                evidence: "Only 11 slices.",
              },
            ]
          : [],
      summary: `hook ${status}`,
    }
  })
}

describe("executor selection", () => {
  const fixture = makeFixture()

  it("prefers a configured hook for that operation", () => {
    expect(selectFixtureExecutor(fixture, "verify", { verify: "x" })).toBe(
      "hook"
    )
    expect(selectFixtureExecutor(fixture, "converge", { verify: "x" })).toBe(
      "agent"
    )
  })

  it("falls back to the authored definition, else none", () => {
    const empty = makeFixture({
      healthChecks: [],
      convergeSteps: [],
      resetInstructions: null,
    })
    expect(selectFixtureExecutor(empty, "verify", undefined)).toBeNull()
    expect(selectFixtureExecutor(empty, "converge", undefined)).toBeNull()
    expect(selectFixtureExecutor(empty, "reset", undefined)).toBeNull()
    expect(selectFixtureExecutor(empty, "reset", { reset: "r" })).toBe("hook")
    expect(selectFixtureExecutor(fixture, "reset", undefined)).toBe("agent")
  })

  it("parses the run fixture mode", () => {
    expect(parseFixtureMode(undefined)).toBe("check")
    expect(parseFixtureMode("repair")).toBe("repair")
    expect(() => parseFixtureMode("force")).toThrow(/check, repair, skip/)
  })
})

describe("requirement selection", () => {
  const a = makeFixture({ id: "a", slug: "a" })
  const b = makeFixture({ id: "b", slug: "b" })
  const scenarios = [
    {
      fixtureRequirements: [
        { fixtureId: "b", access: "read" as const, mutationScope: null },
      ],
    },
    {
      fixtureRequirements: [
        { fixtureId: "a", access: "mutates" as const, mutationScope: "results" },
        { fixtureId: "b", access: "read" as const, mutationScope: null },
      ],
    },
  ]

  it("unions the queue's requirements in first-use order", () => {
    expect(
      collectRequiredFixtures(scenarios, [a, b]).map((f) => f.id)
    ).toEqual(["b", "a"])
    expect(() => collectRequiredFixtures(scenarios, [a])).toThrow(
      /does not define required fixture b/
    )
  })

  it("resets only fixtures an executed scenario could change", () => {
    expect(
      selectPostRunResetFixtures(scenarios, [a, b]).map((f) => f.id)
    ).toEqual(["a"])
    expect(selectPostRunResetFixtures([scenarios[0]!], [a, b])).toEqual([])
  })
})

describe("preflight", () => {
  it("records healthy fixtures with their verify operation", async () => {
    const runHook = hookResults("succeeded")
    const { runtime, start } = makeRuntime({
      hooks: { "het-vs-homo": { verify: "./verify.sh" } },
      runHook,
    })
    await expect(
      runFixturePreflight(runtime, [makeFixture()], "check")
    ).resolves.toEqual({
      ok: true,
      entries: [
        { fixtureId: "fixture-1", outcome: "healthy", operationId: "op-1" },
      ],
    })
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        fixtureId: "fixture-1",
        kind: "verify",
        executor: "hook",
        environment: "development",
        targetUrl: "http://localhost:3000/",
        attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
      runtime.signal
    )
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("runId")
  })

  it("check aborts on an unhealthy fixture and prints the failing checks", async () => {
    const { runtime, start, output } = makeRuntime({
      hooks: { "het-vs-homo": { verify: "./verify.sh", converge: "./c.sh" } },
      runHook: hookResults("failed"),
    })
    const result = await runFixturePreflight(runtime, [makeFixture()], "check")
    expect(result).toEqual({ ok: false, unhealthy: [makeFixture()] })
    expect(start).toHaveBeenCalledOnce()
    expect(output.join("")).toContain("failed: Slices: Only 11 slices.")
  })

  it("repair converges and verifies again", async () => {
    const { runtime, start } = makeRuntime({
      hooks: { "het-vs-homo": { verify: "./v.sh", converge: "./c.sh" } },
      runHook: hookResults("failed", "succeeded", "succeeded"),
    })
    await expect(
      runFixturePreflight(runtime, [makeFixture()], "repair")
    ).resolves.toEqual({
      ok: true,
      entries: [
        { fixtureId: "fixture-1", outcome: "repaired", operationId: "op-3" },
      ],
    })
    expect(start.mock.calls.map(([payload]) => payload.kind)).toEqual([
      "verify",
      "converge",
      "verify",
    ])
  })

  it("repair aborts when the fixture is still unhealthy", async () => {
    const { runtime } = makeRuntime({
      hooks: { "het-vs-homo": { verify: "./v.sh", converge: "./c.sh" } },
      runHook: hookResults("failed", "succeeded", "failed"),
    })
    const result = await runFixturePreflight(runtime, [makeFixture()], "repair")
    expect(result.ok).toBe(false)
  })

  it("skip runs no operations", async () => {
    const { runtime, start } = makeRuntime()
    await expect(
      runFixturePreflight(runtime, [makeFixture()], "skip")
    ).resolves.toEqual({
      ok: true,
      entries: [
        { fixtureId: "fixture-1", outcome: "skipped", operationId: null },
      ],
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("fails before any operation when a fixture cannot be verified", async () => {
    const { runtime, start } = makeRuntime()
    await expect(
      runFixturePreflight(
        runtime,
        [makeFixture({ healthChecks: [] })],
        "check"
      )
    ).rejects.toThrow(/cannot verify: it has no health checks and no local verify hook/)
    expect(start).not.toHaveBeenCalled()
  })
})

describe("operation lifecycle", () => {
  it("finishes a failed hook run as failed", async () => {
    const { runtime, finish } = makeRuntime({
      hooks: { "het-vs-homo": { verify: "./v.sh" } },
      runHook: vi.fn(async () => {
        throw new Error("spawn failed")
      }),
    })
    const outcome = await executeFixtureOperation(
      runtime,
      makeFixture(),
      "verify",
      { runId: "run-1" }
    )
    expect(outcome.status).toBe("failed")
    expect(finish).toHaveBeenCalledWith(
      "op-1",
      expect.objectContaining({ status: "failed", summary: "spawn failed" }),
      runtime.signal
    )
  })

  it("carries the run ID for post-run operations", async () => {
    const { runtime, start } = makeRuntime({
      hooks: { "het-vs-homo": { reset: "./r.sh", verify: "./v.sh" } },
      runHook: hookResults("succeeded", "failed"),
    })
    const results = await runPostRunMaintenance(
      runtime,
      [makeFixture()],
      "run-1"
    )
    expect(results).toEqual([
      expect.objectContaining({ healthy: false }),
    ])
    expect(start.mock.calls.map(([payload]) => payload)).toEqual([
      expect.objectContaining({ kind: "reset", runId: "run-1" }),
      expect.objectContaining({ kind: "verify", runId: "run-1" }),
    ])
  })

  it("finishes an interrupted operation and rethrows the signal", async () => {
    const controller = new AbortController()
    const { runtime, finish } = makeRuntime({
      signal: controller.signal,
      hooks: { "het-vs-homo": { verify: "./v.sh" } },
      runHook: vi.fn(async () => {
        controller.abort(new Error("Interrupted by SIGINT."))
        throw controller.signal.reason
      }),
    })
    await expect(
      executeFixtureOperation(runtime, makeFixture(), "verify")
    ).rejects.toThrow("Interrupted by SIGINT.")
    const [operationId, payload, signal] = finish.mock.calls[0]!
    expect(operationId).toBe("op-1")
    expect(payload).toMatchObject({ status: "interrupted", checkResults: [] })
    expect(signal).not.toBe(controller.signal)
    expect(signal.aborted).toBe(false)
  })

  it("records a lost start as interrupted with the same attempt", async () => {
    const controller = new AbortController()
    const { runtime, start } = makeRuntime({
      signal: controller.signal,
      hooks: { "het-vs-homo": { verify: "./v.sh" } },
    })
    start.mockImplementationOnce(async () => {
      controller.abort(new Error("Interrupted by SIGTERM."))
      throw new Error("connection reset")
    })
    await expect(
      executeFixtureOperation(runtime, makeFixture(), "verify")
    ).rejects.toThrow("Interrupted by SIGTERM.")
    const calls = start.mock.calls as unknown as Array<
      [{ attemptId: string; interruptedAt?: number }, AbortSignal]
    >
    expect(calls).toHaveLength(2)
    expect(calls[1]![0].attemptId).toBe(calls[0]![0].attemptId)
    expect(calls[1]![0].interruptedAt).toEqual(expect.any(Number))
    expect(calls[0]![0].interruptedAt).toBeUndefined()
  })
})

describe("agent operations", () => {
  function agentRuntime(
    verdicts: Array<"passed" | "failed" | "blocked" | Error>
  ) {
    const queue = [...verdicts]
    const executeFixtureTask = vi.fn<FixtureAgent["executeFixtureTask"]>(
      async (input) => {
        const verdict = queue.shift() ?? "passed"
        if (verdict instanceof Error) {
          throw verdict
        }
        return {
          summary: `did ${input.checks.map((check) => check.name).join(", ")}`,
          checkResults: input.checks.map((check) => ({
            checkId: check.id,
            name: check.name,
            verdict,
            evidence: `${check.name}: ${verdict}`,
          })),
          usage: { complete: true },
        }
      }
    )
    const made = makeRuntime({
      getAgent: async () => ({
        cwd: "/project",
        projectPrompt: "Never change fixtures.",
        secretNames: ["CARACARA_SECRET_PASSWORD"],
        executeFixtureTask,
      }),
    })
    return { ...made, executeFixtureTask }
  }

  it("runs one task per converge step and stops at the first non-passed step", async () => {
    const { runtime, executeFixtureTask } = agentRuntime(["blocked"])
    const outcome = await executeFixtureOperation(
      runtime,
      makeFixture(),
      "converge"
    )
    expect(executeFixtureTask).toHaveBeenCalledOnce()
    expect(executeFixtureTask.mock.calls[0]![0].checks).toEqual([
      { id: STEP_1, name: "Create project", expectation: "The project exists." },
    ])
    expect(outcome.status).toBe("failed")
    expect(outcome.executor).toBe("agent")
    expect(outcome.checkResults).toHaveLength(1)
  })

  it("succeeds when every step passes", async () => {
    const { runtime, executeFixtureTask } = agentRuntime(["passed", "passed"])
    const outcome = await executeFixtureOperation(
      runtime,
      makeFixture(),
      "converge"
    )
    expect(executeFixtureTask).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe("succeeded")
  })

  it("verifies against the health checks with an inspect-only prompt", async () => {
    const { runtime, executeFixtureTask } = agentRuntime(["passed"])
    const outcome = await executeFixtureOperation(
      runtime,
      makeFixture(),
      "verify"
    )
    const input = executeFixtureTask.mock.calls[0]![0]
    expect(input.checks.map((check) => check.id)).toEqual([CHECK_A, CHECK_B])
    expect(input.prompt).toContain("Change nothing")
    expect(outcome.status).toBe("succeeded")
  })

  it("fails the operation on a runner error and records usage", async () => {
    const { runtime } = agentRuntime([
      new RunnerExecutionError("Codex crashed", { complete: false }),
    ])
    const outcome = await executeFixtureOperation(
      runtime,
      makeFixture(),
      "reset"
    )
    expect(outcome.status).toBe("failed")
    expect(outcome.summary).toContain("Runner failed: Codex crashed")
    expect(runtime.recordUsage).toHaveBeenCalledWith({ complete: false })
  })

  it("redacts inherited-only secrets from fixture task output and errors", async () => {
    const checks = makeFixture().healthChecks.slice(0, 1)
    const env = { CARACARA_SECRET_INHERITED: "inherited-only-value" }
    const result = await executeFixtureTaskWithTurn(
      async () => ({
        output: {
          summary: "Used inherited-only-value to log in",
          checkResults: [
            {
              checkId: CHECK_A,
              verdict: "passed",
              evidence: "Token inherited-only-value accepted",
            },
          ],
        },
        usage: { complete: true },
      }),
      { cwd: "/project", prompt: "verify", checks },
      { CARACARA_SECRET_LOCAL: "local-value" },
      env
    )
    expect(result.summary).toBe("Used [REDACTED] to log in")
    expect(result.checkResults[0]?.evidence).toBe("Token [REDACTED] accepted")

    await expect(
      executeFixtureTaskWithTurn(
        async () => {
          throw new Error("Login failed for inherited-only-value")
        },
        { cwd: "/project", prompt: "verify", checks },
        {},
        env
      )
    ).rejects.toThrow("Login failed for [REDACTED]")
  })

  it("validates and redacts fixture task output", () => {
    const checks = makeFixture().healthChecks
    expect(
      validateFixtureTaskOutput(
        checks,
        {
          summary: "Logged in with pw-123",
          checkResults: [
            { checkId: CHECK_B, verdict: "failed", evidence: "11 slices" },
            { checkId: CHECK_A, verdict: "passed", evidence: "9 animals" },
          ],
        },
        ["pw-123"]
      )
    ).toEqual({
      summary: "Logged in with [REDACTED]",
      checkResults: [
        { checkId: CHECK_A, name: "Animals", verdict: "passed", evidence: "9 animals" },
        { checkId: CHECK_B, name: "Slices", verdict: "failed", evidence: "11 slices" },
      ],
    })
    expect(() =>
      validateFixtureTaskOutput(
        checks,
        {
          summary: "x",
          checkResults: [
            { checkId: CHECK_A, verdict: "passed", evidence: "ok" },
          ],
        },
        []
      )
    ).toThrow(/every fixture check/)
    expect(
      buildFixtureTaskResultSchema([]).properties.checkResults.items.properties
        .checkId
    ).toEqual({ type: "string" })
  })
})

describe("fixture prompts", () => {
  const fixture = makeFixture()
  const protectedFixtures = resolveProtectedFixtures(
    [
      { fixtureId: "fixture-1", access: "read", mutationScope: null },
      {
        fixtureId: "fixture-2",
        access: "mutates",
        mutationScope: "calculated results",
      },
    ],
    [
      fixture,
      makeFixture({ id: "fixture-2", slug: "trap-model", name: "TRAP model" }),
    ]
  )
  const base = {
    environment: "development",
    targetUrl: "http://localhost:3000/",
    projectPrompt: "Never change fixtures.",
    scenario,
    fixtures: protectedFixtures,
  }

  it("adds a protected fixtures section after the project context", () => {
    for (const prompt of [
      buildRunnerPrompt(base),
      buildBlockedRetryPrompt({
        ...base,
        blockedResults: [
          {
            checkId: CHECK_A,
            verdict: "blocked",
            blockedReason: "tool_limit",
            evidence: "Timed out.",
          },
        ],
      }),
    ]) {
      const projectIndex = prompt.indexOf("Never change fixtures.")
      const sectionIndex = prompt.indexOf("Protected fixtures:")
      expect(sectionIndex).toBeGreaterThan(projectIndex)
      expect(prompt).toContain("- HET vs HOMO (het-vs-homo)")
      expect(prompt).toContain(
        "  Find it: Projects > Caracara Fixture HET vs HOMO"
      )
      expect(prompt).toContain("  Access: read-only. Do not change it.")
      expect(prompt).toContain(
        "  Access: you may change only calculated results. Leave everything else in this fixture unchanged."
      )
      expect(prompt).toContain("  Protection: Never delete animals.")
      expect(prompt).toContain(
        "The scoped permissions above are the only exception to any project-context rule that protects fixtures."
      )
    }
  })

  it("omits the section when the scenario requires no fixtures", () => {
    expect(buildRunnerPrompt({ ...base, fixtures: [] })).not.toContain(
      "Protected fixtures"
    )
  })

  it("builds a maintenance prompt scoped to one fixture", () => {
    const converge = buildFixtureMaintenancePrompt({
      environment: "development",
      targetUrl: "http://localhost:3000/",
      projectPrompt: "Never change fixtures.",
      secretNames: ["CARACARA_SECRET_PASSWORD"],
      fixture,
      task: { kind: "converge", step: fixture.convergeSteps[1]! },
    })
    expect(converge).toContain("This is fixture maintenance, not an evaluation.")
    expect(converge).toContain("Never change fixtures.")
    expect(converge).toContain(
      "project-context rules that protect fixtures do not apply to the fixture HET vs HOMO (het-vs-homo) for this task. They still apply to every other fixture and to all other data"
    )
    expect(converge).toContain("Description: Nine animals and twelve slices.")
    expect(converge).toContain("Find it: Projects > Caracara Fixture HET vs HOMO")
    expect(converge).toContain("Import nine animals.")
    expect(converge).toContain("Done when: Nine animals exist.")
    expect(converge).toContain(
      "First check whether the done-when condition already holds. If it does, verify it and stop without making changes."
    )
    expect(converge).toContain(`- Import animals [${STEP_2}]`)
    expect(converge).toContain("- CARACARA_SECRET_PASSWORD")

    const verify = buildFixtureMaintenancePrompt({
      environment: "development",
      targetUrl: "http://localhost:3000/",
      projectPrompt: "Never change fixtures.",
      fixture,
      task: { kind: "verify" },
    })
    expect(verify).toContain("Change nothing")
    expect(verify).not.toContain("Maintenance permission")
    expect(verify).toContain(`- Slices [${CHECK_B}]`)

    const reset = buildFixtureMaintenancePrompt({
      environment: "development",
      targetUrl: "http://localhost:3000/",
      projectPrompt: "",
      fixture,
      task: { kind: "reset", resetInstructions: fixture.resetInstructions! },
    })
    expect(reset).toContain("Delete results newer than the baseline.")
    expect(reset).toContain("Maintenance permission")
  })
})
