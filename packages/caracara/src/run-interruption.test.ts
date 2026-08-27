import process from "node:process"

import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const executeScenario = vi.fn(
    ({ signal }: { signal?: AbortSignal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      })
  )

  return {
    close: vi.fn(async () => undefined),
    createRun: vi.fn(async () => ({
      run: {
        id: "run-1",
        name: "steady-hawk-20260827-120000",
        evidencePolicy: "text_only",
      },
    })),
    executeScenario,
    fetchExecutionPlan: vi.fn(async () => ({
      project: { projectPrompt: "Test the application." },
      phases: [
        {
          id: "phase-1",
          name: "Setup",
          order: 1,
          scenarios: [
            {
              id: "scenario-1",
              name: "Open application",
              slug: "open-application",
              status: "active",
              instructions: "Open the application.",
              evaluationChecks: [],
              phaseId: "phase-1",
              phaseName: "Setup",
              phaseOrder: 1,
              dependencyIds: [],
            },
          ],
        },
      ],
      suite: null,
      unassignedScenarioCount: 0,
    })),
    finalizeRun: vi.fn(async () => undefined),
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
    selectedProjectSlug: "demo",
    userEmail: "test@example.com",
  })),
}))

vi.mock("./execution.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./execution.js")>()),
  getRunnerAdapter: vi.fn(() => ({
    type: "codex",
    startRun: vi.fn(async () => ({
      close: mocks.close,
      executeScenario: mocks.executeScenario,
    })),
  })),
}))

import { runCommand } from "./commands.js"

afterEach(() => {
  process.exitCode = undefined
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("run interruption", () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "cancels the runner and persists %s as interrupted",
    async (signal, exitCode) => {
      const existingListeners = new Set(process.listeners(signal))
      vi.spyOn(process.stdout, "write").mockImplementation(() => true)

      const run = runCommand({})
      await vi.waitFor(() => expect(mocks.executeScenario).toHaveBeenCalled())

      const interrupt = process
        .listeners(signal)
        .find((listener) => !existingListeners.has(listener))
      expect(interrupt).toBeDefined()
      interrupt?.(signal)

      await run

      const executionInput = mocks.executeScenario.mock.calls[0]?.[0]
      expect(executionInput?.signal?.aborted).toBe(true)
      expect(mocks.close).toHaveBeenCalledOnce()
      expect(mocks.submitScenarioResult).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            result: expect.objectContaining({
              failureDetail: `Execution interrupted by ${signal}.`,
              status: "interrupted",
            }),
          }),
        })
      )
      expect(mocks.finalizeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ status: "interrupted" }),
        })
      )
      expect(process.exitCode).toBe(exitCode)
      expect(
        process
          .listeners(signal)
          .filter((listener) => !existingListeners.has(listener))
      ).toHaveLength(0)
    }
  )
})
