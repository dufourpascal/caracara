import process from "node:process"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const check = (id: string) => ({
    id,
    name: `Check ${id.slice(-1)}`,
    expectation: "It works.",
  })
  const scenario = (
    slug: string,
    phase: { id: string; name: string; order: number }
  ) => ({
    id: `id-${slug}`,
    name: slug,
    slug,
    status: "active",
    instructions: "Do it.",
    evaluationChecks: [
      check("00000000-0000-4000-8000-000000000001"),
      check("00000000-0000-4000-8000-000000000002"),
    ],
    phaseId: phase.id,
    phaseName: phase.name,
    phaseOrder: phase.order,
    dependencyIds: [],
  })
  const phase = (order: number, slugs: string[]) => {
    const info = { id: `phase-${order}`, name: `Phase ${order}`, order }
    return { ...info, scenarios: slugs.map((slug) => scenario(slug, info)) }
  }
  const executionPlan = {
    project: { projectPrompt: "Test the application." },
    phases: [
      phase(1, ["setup-a", "setup-b"]),
      phase(2, ["data-a", "data-b"]),
      phase(3, ["export-a"]),
    ],
    suite: null,
    unassignedScenarioCount: 0,
  }
  const failing = new Set<string>()
  const verdicts = new Map<string, Array<"passed" | "failed" | "blocked">>()
  const health = { healthy: true }
  const executeScenario = vi.fn(
    async ({
      scenario,
    }: {
      scenario: { slug: string; evaluationChecks: Array<{ id: string }> }
    }) => {
      if (failing.has(scenario.slug)) {
        throw new Error(`${scenario.slug} broke`)
      }
      const pattern = verdicts.get(scenario.slug) ?? ["passed", "passed"]
      return {
        executionSummary: "Done.",
        checkResults: scenario.evaluationChecks.map((check, index) => ({
          checkId: check.id,
          verdict: pattern[index]!,
          evidence: "Seen.",
          blockedReason: pattern[index] === "blocked" ? "tool_limit" : null,
        })),
        usage: {
          complete: true,
          usage: {
            inputTokens: 1000,
            cachedInputTokens: 500,
            cacheWriteInputTokens: 0,
            outputTokens: 100,
            reasoningOutputTokens: 0,
            estimatedCostUsd: null,
          },
        },
      }
    }
  )
  return {
    executionPlan,
    failing,
    verdicts,
    health,
    executeScenario,
    close: vi.fn(async () => undefined),
    createRun: vi.fn(async (args: unknown) => {
      void args
      return {
        run: {
          id: "run-1",
          name: "steady-hawk-20261104-120000",
          evidencePolicy: "text_only",
        },
      }
    }),
    fetchExecutionPlan: vi.fn(async (args: unknown) => {
      void args
      return executionPlan
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
  }
})

vi.mock("./api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api.js")>()),
  createRun: mocks.createRun,
  fetchExecutionPlan: mocks.fetchExecutionPlan,
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
    selectedProjectSlug: "demo",
    userEmail: "test@example.com",
  })),
}))

vi.mock("./execution.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./execution.js")>()),
  getRunnerAdapter: vi.fn(() => ({
    type: "codex",
    startRun: vi.fn(async () => ({
      executeScenario: mocks.executeScenario,
      isHealthy: () => mocks.health.healthy,
      close: mocks.close,
    })),
  })),
}))

import { runCommand } from "./commands.js"
import type { RunCommandOptions } from "./types.js"

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

function submitted() {
  return mocks.submitScenarioResult.mock.calls.map((call) => {
    const { payload } = call[0] as {
      payload: {
        result: {
          scenarioId: string
          status: string
          failureDetail: string | null
        }
      }
    }
    return [
      payload.result.scenarioId.replace(/^id-/, ""),
      payload.result.status,
      payload.result.failureDetail,
    ]
  })
}

function finalizedStatus() {
  const call = mocks.finalizeRun.mock.calls.at(-1)?.[0] as
    { payload: { status: string } } | undefined
  return call?.payload.status
}

beforeEach(() => {
  mocks.failing.clear()
  mocks.verdicts.clear()
  mocks.health.healthy = true
})

afterEach(() => {
  process.exitCode = undefined
  vi.clearAllMocks()
})

describe("run exit codes and summary", () => {
  it("exits 0 and prints a summary when every scenario ran", async () => {
    mocks.verdicts.set("setup-a", ["passed", "failed"])
    const { stdout } = await run({ phase: "1" })

    expect(process.exitCode).toBeUndefined()
    expect(finalizedStatus()).toBe("completed")
    expect(stdout).toContain("[1/2] setup-a 1/2 (1 failed)")
    expect(stdout).toContain("━━ Run steady-hawk-20261104-120000")
    expect(stdout).toContain("COMPLETED")
    expect(stdout).toContain(
      "Web        https://caracara.example.com/projects/demo/runs/run-1"
    )
    expect(stdout).toContain(
      "Checks     3 passed · 1 failed · 0 blocked of 4 (75%)"
    )
    expect(stdout).not.toContain("Tokens: ")
  })

  it("exits 3 when --fail-on matches a verdict", async () => {
    mocks.verdicts.set("setup-b", ["passed", "blocked"])
    await run({ phase: "1", failOn: "failed" })
    expect(process.exitCode).toBeUndefined()
    await run({ phase: "1", failOn: "blocked" })
    expect(process.exitCode).toBe(3)
  })

  it("exits 2 and stops a single-phase run after an execution error", async () => {
    mocks.failing.add("setup-a")
    const { stdout } = await run({ phase: "1" })

    expect(process.exitCode).toBe(2)
    expect(finalizedStatus()).toBe("failed")
    expect(submitted()).toEqual([
      ["setup-a", "runner_failed", "setup-a broke"],
      [
        "setup-b",
        "dependency_failed",
        "Dependency chain stopped after an earlier failure.",
      ],
    ])
    expect(stdout).toContain("[2/2] setup-b SKIPPED")
    expect(stdout).toContain(
      "Rerun: caracara run --environment development --scenario setup-a"
    )
  })
})

describe("multi-phase runs", () => {
  it("runs the selected phases as one run", async () => {
    await run({ phases: "1,3" })

    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          mode: "phases",
          requestedPhaseOrder: null,
          requestedPhaseOrders: [1, 3],
        }),
      })
    )
    expect(submitted().map(([slug]) => slug)).toEqual([
      "setup-a",
      "setup-b",
      "export-a",
    ])
  })

  it("uses the single-phase mode for a one-phase list", async () => {
    await run({ phases: "2" })
    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          mode: "phase",
          requestedPhaseOrder: 2,
        }),
      })
    )
  })

  it("rejects phases the project does not have", async () => {
    await expect(run({ phases: "1-3,7,9" })).rejects.toThrow(
      "Phases 7, 9 do not exist in project demo."
    )
  })

  it("keeps going with the next phase by default", async () => {
    mocks.failing.add("setup-a")
    await run({ phases: "1-3" })

    expect(process.exitCode).toBe(2)
    expect(finalizedStatus()).toBe("failed")
    expect(submitted()).toEqual([
      ["setup-a", "runner_failed", "setup-a broke"],
      [
        "setup-b",
        "dependency_failed",
        "Skipped after an execution error earlier in this phase.",
      ],
      ["data-a", "completed", null],
      ["data-b", "completed", null],
      ["export-a", "completed", null],
    ])
  })

  it("keeps going by default for full runs too", async () => {
    mocks.failing.add("data-b")
    await run({})
    expect(submitted().map(([slug, status]) => `${slug}:${status}`)).toEqual([
      "setup-a:completed",
      "setup-b:completed",
      "data-a:completed",
      "data-b:runner_failed",
      "export-a:completed",
    ])
  })

  it("stops after the first error with --no-keep-going", async () => {
    mocks.failing.add("setup-b")
    await run({ phases: "1-3", keepGoing: false })

    expect(submitted().map(([slug, status]) => `${slug}:${status}`)).toEqual([
      "setup-a:completed",
      "setup-b:runner_failed",
      "data-a:dependency_failed",
      "data-b:dependency_failed",
      "export-a:dependency_failed",
    ])
  })

  it("stops when the browser session is gone", async () => {
    mocks.executeScenario.mockImplementationOnce(async () => {
      mocks.health.healthy = false
      throw new Error("Target closed")
    })
    await run({ phases: "1-3" })

    expect(submitted().map(([slug, status]) => `${slug}:${status}`)).toEqual([
      "setup-a:runner_failed",
      "setup-b:dependency_failed",
      "data-a:dependency_failed",
      "data-b:dependency_failed",
      "export-a:dependency_failed",
    ])
  })

  it("stops when two phases in a row fail on their first scenario", async () => {
    mocks.failing.add("setup-a")
    mocks.failing.add("data-a")
    await run({ phases: "1-3" })

    expect(submitted().map(([slug, status]) => `${slug}:${status}`)).toEqual([
      "setup-a:runner_failed",
      "setup-b:dependency_failed",
      "data-a:runner_failed",
      "data-b:dependency_failed",
      "export-a:dependency_failed",
    ])
  })
})

describe("JSON output", () => {
  it("writes only JSON events, ending with run.finished", async () => {
    mocks.failing.add("export-a")
    const { stdout } = await run({ phases: "1,3", json: true })

    const events = stdout
      .trimEnd()
      .split("\n")
      .map(
        (line) => JSON.parse(line) as { type: string; [key: string]: unknown }
      )
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "phase.started",
      "scenario.started",
      "scenario.finished",
      "scenario.started",
      "scenario.finished",
      "phase.started",
      "scenario.started",
      "scenario.finished",
      "run.finished",
    ])
    expect(events.at(-1)).toMatchObject({
      status: "failed",
      exitCode: 2,
      runUrl: "https://caracara.example.com/projects/demo/runs/run-1",
      report: {
        formatVersion: 1,
        run: {
          selection: "phases 1, 3",
          passedCheckCount: 4,
          model: "gpt-5.5",
        },
      },
    })
    expect(process.exitCode).toBe(2)
  })
})

describe("runs that end before any scenario", () => {
  it("reports a created suite run whose plan cannot be loaded", async () => {
    mocks.fetchExecutionPlan.mockRejectedValueOnce(new Error("plan exploded"))
    const stdout = output()

    await expect(
      runCommand(
        { suite: "smoke", json: true },
        { stdout: stdout.stream, stderr: output().stream, env: {} }
      )
    ).rejects.toThrow("plan exploded")

    expect(finalizedStatus()).toBe("interrupted")
    const events = stdout
      .text()
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; exitCode?: number })
    expect(events).toEqual([
      expect.objectContaining({
        type: "run.finished",
        status: "interrupted",
        exitCode: 1,
      }),
    ])
  })
})
