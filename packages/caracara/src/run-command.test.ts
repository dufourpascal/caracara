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
    // setup-b builds on setup-a; every other scenario is independent.
    dependencyIds: slug === "setup-b" ? ["id-setup-a"] : [],
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
      runTask: vi.fn(),
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

  it("exits 2 and skips the dependents of a failed scenario in a single-phase run", async () => {
    mocks.failing.add("setup-a")
    const { stdout } = await run({ phase: "1" })

    expect(process.exitCode).toBe(2)
    expect(finalizedStatus()).toBe("failed")
    expect(submitted()).toEqual([
      ["setup-a", "runner_failed", "setup-a broke"],
      [
        "setup-b",
        "dependency_failed",
        "Skipped because dependency setup-a did not complete.",
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
        "Skipped because dependency setup-a did not complete.",
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

  it("keeps running independent scenarios in the failing phase", async () => {
    mocks.failing.add("data-a")
    await run({ phases: "2" })

    expect(submitted()).toEqual([
      ["data-a", "runner_failed", "data-a broke"],
      ["data-b", "completed", null],
    ])
  })

  it("does not stop after two failing first scenarios with a success between", async () => {
    const exportPhase = mocks.executionPlan.phases[2]!
    mocks.executionPlan.phases.push({
      id: "phase-4",
      name: "Phase 4",
      order: 4,
      scenarios: [
        {
          ...exportPhase.scenarios[0]!,
          id: "id-report-a",
          name: "report-a",
          slug: "report-a",
          phaseId: "phase-4",
          phaseName: "Phase 4",
          phaseOrder: 4,
        },
      ],
    })
    mocks.failing.add("data-a")
    mocks.failing.add("export-a")
    try {
      await run({})
    } finally {
      mocks.executionPlan.phases.pop()
    }

    expect(submitted().map(([slug, status]) => `${slug}:${status}`)).toEqual([
      "setup-a:completed",
      "setup-b:completed",
      "data-a:runner_failed",
      "data-b:completed",
      "export-a:runner_failed",
      "report-a:completed",
    ])
  })

  it("stops a single-phase run after three runner failures in a row", async () => {
    const dataPhase = mocks.executionPlan.phases[1]!
    const extra = ["data-c", "data-d"].map((slug) => ({
      ...dataPhase.scenarios[0]!,
      id: `id-${slug}`,
      name: slug,
      slug,
    }))
    dataPhase.scenarios.push(...extra)
    for (const slug of ["data-a", "data-b", "data-c"]) mocks.failing.add(slug)
    try {
      await run({ phases: "2" })
    } finally {
      dataPhase.scenarios.splice(2)
    }

    expect(submitted().map(([slug, status]) => `${slug}:${status}`)).toEqual([
      "data-a:runner_failed",
      "data-b:runner_failed",
      "data-c:runner_failed",
      "data-d:dependency_failed",
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
  it("creates no suite run when its plan cannot be loaded", async () => {
    mocks.fetchExecutionPlan.mockRejectedValueOnce(new Error("plan exploded"))
    const stdout = output()

    await expect(
      runCommand(
        { suite: "smoke", json: true },
        { stdout: stdout.stream, stderr: output().stream, env: {} }
      )
    ).rejects.toThrow("plan exploded")

    expect(mocks.fetchExecutionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ suiteSlug: "smoke" })
    )
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.finalizeRun).not.toHaveBeenCalled()
    expect(stdout.text()).toBe("")
  })
})

describe("runs that end during creation", () => {
  function jsonEvents(text: string) {
    return text
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it("keeps the loaded plan when interrupted while the run is created", async () => {
    const existing = new Set(process.listeners("SIGINT"))
    mocks.createRun.mockImplementationOnce(async () => {
      process.listeners("SIGINT").find((listener) => !existing.has(listener))?.(
        "SIGINT"
      )
      return {
        run: {
          id: "run-1",
          name: "steady-hawk-20261104-120000",
          evidencePolicy: "text_only",
        },
      }
    })
    const stdout = output()

    await runCommand(
      { phases: "1,3", json: true },
      { stdout: stdout.stream, stderr: output().stream, env: {} }
    )

    expect(process.exitCode).toBe(130)
    expect(mocks.executeScenario).not.toHaveBeenCalled()
    expect(finalizedStatus()).toBe("interrupted")
    expect(mocks.finalizeRun).toHaveBeenCalledOnce()
    const events = jsonEvents(stdout.text())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "run.finished",
      status: "interrupted",
      exitCode: 130,
      report: {
        run: { scenarioCounts: { total: 3, notRun: 3 } },
        phases: [
          { order: 1, scenarioCount: 2, notRunCount: 2 },
          { order: 3, scenarioCount: 1, notRunCount: 1 },
        ],
      },
    })
    expect(
      process.listeners("SIGINT").filter((listener) => !existing.has(listener))
    ).toHaveLength(0)
  })

  it("creates no suite run when the suite has no active scenarios", async () => {
    mocks.fetchExecutionPlan.mockResolvedValueOnce({
      ...mocks.executionPlan,
      phases: [],
    })

    await expect(run({ suite: "smoke" })).rejects.toThrow(
      'Suite "smoke" has no active scenarios to run.'
    )

    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.finalizeRun).not.toHaveBeenCalled()
  })
})

describe("exit paths", () => {
  it("prints the summary and exits 1 when finalization fails", async () => {
    mocks.finalizeRun.mockRejectedValueOnce(new Error("finalize down"))
    const stdout = output()

    await expect(
      runCommand(
        { phase: "1", json: true },
        { stdout: stdout.stream, stderr: output().stream, env: {} }
      )
    ).rejects.toThrow("finalize down")

    const last = JSON.parse(stdout.text().trimEnd().split("\n").at(-1)!) as {
      type: string
      exitCode: number
    }
    expect(last).toMatchObject({ type: "run.finished", exitCode: 1 })
  })

  it("exits 1 when the runner session cannot be closed", async () => {
    mocks.close.mockRejectedValueOnce(new Error("browser stuck"))
    await expect(run({ phase: "1" })).rejects.toThrow("browser stuck")
    expect(finalizedStatus()).toBe("completed")
  })

  it("reports an interrupted run with the signal exit code", async () => {
    const existing = new Set(process.listeners("SIGINT"))
    mocks.executeScenario.mockImplementationOnce(
      (input) =>
        new Promise((_, reject) => {
          const { signal } = input as { signal?: AbortSignal }
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
    )
    const stdout = output()
    const running = runCommand(
      { phase: "1", json: true },
      { stdout: stdout.stream, stderr: output().stream, env: {} }
    )
    await vi.waitFor(() => expect(mocks.executeScenario).toHaveBeenCalled())
    process.listeners("SIGINT").find((listener) => !existing.has(listener))?.(
      "SIGINT"
    )
    await running

    expect(process.exitCode).toBe(130)
    const events = stdout
      .text()
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(events.at(-2)).toMatchObject({
      type: "scenario.finished",
      status: "interrupted",
    })
    expect(events.at(-1)).toMatchObject({
      type: "run.finished",
      status: "interrupted",
      exitCode: 130,
    })
  })
})
