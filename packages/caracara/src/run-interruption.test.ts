import process from "node:process"

import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
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
  }
  const executeScenario = vi.fn(
    ({ signal }: { signal?: AbortSignal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      })
  )
  const close = vi.fn(async () => undefined)

  return {
    close,
    createRun: vi.fn(async () => ({
      run: {
        id: "run-1",
        name: "steady-hawk-20260827-120000",
        evidencePolicy: "text_only",
      },
    })),
    executeScenario,
    executionPlan,
    fetchExecutionPlan: vi.fn(async (args?: { signal?: AbortSignal }) => {
      void args
      return executionPlan
    }),
    finalizeRun: vi.fn(async (args?: { signal?: AbortSignal }) => {
      void args
    }),
    startScenarioExecution: vi.fn(
      async (args?: { signal?: AbortSignal }) => {
        void args
        return { result: { id: "result-1" } }
      }
    ),
    startRun: vi.fn(async (args?: { signal?: AbortSignal }) => {
      void args
      return {
        close,
        executeScenario,
      }
    }),
    submitScenarioResult: vi.fn(async (args?: { signal?: AbortSignal }) => {
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
    selectedProjectSlug: "demo",
    userEmail: "test@example.com",
  })),
}))

vi.mock("./execution.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./execution.js")>()),
  getRunnerAdapter: vi.fn(() => ({
    type: "codex",
    startRun: mocks.startRun,
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

  it("cancels runner startup", async () => {
    mocks.startRun.mockImplementationOnce(
      (args?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args?.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason),
            { once: true }
          )
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() => expect(mocks.startRun).toHaveBeenCalled())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await run

    const startInput = mocks.startRun.mock.calls[0]?.[0]
    expect(startInput?.signal?.aborted).toBe(true)
    expect(mocks.submitScenarioResult).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          result: expect.objectContaining({ status: "interrupted" }),
        }),
      })
    )
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "interrupted",
          interruptedScenarioResultId: "result-1",
        }),
      })
    )
    expect(process.exitCode).toBe(130)
  })

  it("cancels scenario startup", async () => {
    mocks.startScenarioExecution.mockImplementationOnce(
      (args?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args?.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason),
            { once: true }
          )
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() =>
      expect(mocks.startScenarioExecution).toHaveBeenCalled()
    )
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await run

    const startInput = mocks.startScenarioExecution.mock.calls[0]?.[0]
    expect(startInput?.signal?.aborted).toBe(true)
    expect(mocks.submitScenarioResult).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          result: expect.objectContaining({ status: "interrupted" }),
        }),
      })
    )
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: "interrupted" }),
      })
    )
    expect(process.exitCode).toBe(130)
  })

  it("listens before a suite run is created", async () => {
    let finishCreatingRun:
      | ((value: Awaited<ReturnType<typeof mocks.createRun>>) => void)
      | undefined
    mocks.createRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreatingRun = resolve
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({ suite: "smoke" })
    await vi.waitFor(() => expect(mocks.createRun).toHaveBeenCalled())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")
    finishCreatingRun?.({
      run: {
        id: "run-1",
        name: "steady-hawk-20260827-120000",
        evidencePolicy: "text_only",
      },
    })

    await run

    expect(mocks.fetchExecutionPlan).not.toHaveBeenCalled()
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: "interrupted" }),
      })
    )
    expect(process.exitCode).toBe(130)
  })

  it.each([
    ["suite", { suite: "smoke" }],
    ["non-suite", {}],
  ] as const)(
    "preserves the signal exit code when %s run creation rejects",
    async (_mode, options) => {
      let failCreatingRun: ((error: Error) => void) | undefined
      mocks.createRun.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failCreatingRun = reject
          })
      )
      const existingListeners = new Set(process.listeners("SIGINT"))
      vi.spyOn(process.stdout, "write").mockImplementation(() => true)

      const run = runCommand(options)
      await vi.waitFor(() => expect(mocks.createRun).toHaveBeenCalled())
      const interrupt = process
        .listeners("SIGINT")
        .find((listener) => !existingListeners.has(listener))
      expect(interrupt).toBeDefined()
      interrupt?.("SIGINT")
      failCreatingRun?.(new Error("Connection dropped"))

      await expect(run).resolves.toBeUndefined()

      expect(mocks.finalizeRun).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(130)
      expect(
        process
          .listeners("SIGINT")
          .filter((listener) => !existingListeners.has(listener))
      ).toHaveLength(0)
    }
  )

  it("preserves the signal exit code when plan-fetch cleanup fails", async () => {
    mocks.fetchExecutionPlan.mockImplementationOnce(
      (args?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args?.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason),
            { once: true }
          )
        })
    )
    mocks.finalizeRun.mockRejectedValueOnce(new Error("API unavailable"))
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true)

    const run = runCommand({ suite: "smoke" })
    await vi.waitFor(() => expect(mocks.fetchExecutionPlan).toHaveBeenCalled())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await run

    expect(mocks.executeScenario).not.toHaveBeenCalled()
    expect(mocks.fetchExecutionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: "interrupted" }),
      })
    )
    expect(process.exitCode).toBe(130)
    expect(stderr).toHaveBeenCalledWith(
      "Failed to finalize interrupted run: API unavailable\n"
    )
    expect(
      process
        .listeners("SIGINT")
        .filter((listener) => !existingListeners.has(listener))
    ).toHaveLength(0)
  })

  it("preserves the signal exit code during plan-error cleanup", async () => {
    let finishFinalization: (() => void) | undefined
    mocks.fetchExecutionPlan.mockRejectedValueOnce(new Error("Plan failed"))
    mocks.finalizeRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFinalization = () => resolve(undefined)
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({ suite: "smoke" })
    await vi.waitFor(() => expect(mocks.finalizeRun).toHaveBeenCalled())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")
    finishFinalization?.()

    await expect(run).resolves.toBeUndefined()

    expect(process.exitCode).toBe(130)
    expect(
      process
        .listeners("SIGINT")
        .filter((listener) => !existingListeners.has(listener))
    ).toHaveLength(0)
  })

  it("corrects finalization when a signal arrives during the request", async () => {
    mocks.executeScenario.mockResolvedValueOnce({
      checkResults: [],
      executionSummary: "Complete",
      usage: { complete: true },
    })
    mocks.finalizeRun.mockImplementationOnce(
      (args?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args?.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason),
            { once: true }
          )
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() => expect(mocks.finalizeRun).toHaveBeenCalledOnce())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await run

    expect(mocks.finalizeRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({ status: "completed" }),
        signal: expect.any(AbortSignal),
      })
    )
    expect(mocks.finalizeRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({ status: "interrupted" }),
      })
    )
    const finalizeCalls = mocks.finalizeRun.mock.calls as unknown as Array<
      [{ payload: { finalizationAttemptId?: string } }]
    >
    const initialAttemptId = finalizeCalls[0]?.[0].payload.finalizationAttemptId
    const correctionAttemptId =
      finalizeCalls[1]?.[0].payload.finalizationAttemptId
    expect(initialAttemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(correctionAttemptId).toBe(initialAttemptId)
    expect(process.exitCode).toBe(130)
  })

  it("retries an in-flight interrupted finalization with the same payload", async () => {
    mocks.startScenarioExecution.mockRejectedValueOnce(
      new Error("Scenario start failed")
    )
    mocks.finalizeRun.mockImplementationOnce(
      (args?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args?.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason),
            { once: true }
          )
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() => expect(mocks.finalizeRun).toHaveBeenCalledOnce())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await run

    const finalizeCalls = mocks.finalizeRun.mock.calls as unknown as Array<
      [{ payload: unknown }]
    >
    expect(finalizeCalls).toHaveLength(2)
    expect(finalizeCalls[1]?.[0].payload).toEqual(
      finalizeCalls[0]?.[0].payload
    )
    expect(process.exitCode).toBe(130)
  })

  it("corrects a completed scenario when its submission is interrupted", async () => {
    mocks.executeScenario.mockResolvedValueOnce({
      checkResults: [],
      executionSummary: "Complete",
      usage: { complete: true },
    })
    mocks.submitScenarioResult.mockImplementationOnce(
      (args?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args?.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason),
            { once: true }
          )
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() =>
      expect(mocks.submitScenarioResult).toHaveBeenCalledOnce()
    )
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await run

    expect(mocks.submitScenarioResult).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({
          result: expect.objectContaining({ status: "completed" }),
        }),
        signal: expect.any(AbortSignal),
      })
    )
    expect(mocks.submitScenarioResult).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({
          result: expect.objectContaining({ status: "interrupted" }),
        }),
      })
    )
    expect(mocks.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          status: "interrupted",
          interruptedScenarioResultId: "result-1",
          interruptedScenarioAttemptId: expect.any(String),
        }),
      })
    )
    const startCalls = mocks.startScenarioExecution.mock
      .calls as unknown as Array<
      [{ payload: { result: { executionAttemptId?: string } } }]
    >
    const finalizeCalls = mocks.finalizeRun.mock.calls as unknown as Array<
      [{ payload: { interruptedScenarioAttemptId?: string } }]
    >
    const submitCalls = mocks.submitScenarioResult.mock.calls as unknown as Array<
      [{ payload: { result: { executionAttemptId?: string } } }]
    >
    const executionAttemptId =
      startCalls[0]?.[0].payload.result.executionAttemptId
    expect(submitCalls[0]?.[0].payload.result.executionAttemptId).toBe(
      executionAttemptId
    )
    expect(submitCalls[1]?.[0].payload.result.executionAttemptId).toBe(
      executionAttemptId
    )
    expect(
      finalizeCalls[0]?.[0].payload.interruptedScenarioAttemptId
    ).toBe(executionAttemptId)
    expect(process.exitCode).toBe(130)
  })

  it("corrects a runner failure when its submission is interrupted", async () => {
    mocks.executeScenario.mockRejectedValueOnce(new Error("Runner failed"))
    mocks.submitScenarioResult.mockImplementationOnce(
      (args?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          args?.signal?.addEventListener(
            "abort",
            () => reject(args.signal?.reason),
            { once: true }
          )
        })
    )
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() =>
      expect(mocks.submitScenarioResult).toHaveBeenCalledOnce()
    )
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await run

    expect(mocks.submitScenarioResult).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({
          result: expect.objectContaining({ status: "runner_failed" }),
        }),
        signal: expect.any(AbortSignal),
      })
    )
    expect(mocks.submitScenarioResult).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({
          result: expect.objectContaining({ status: "interrupted" }),
        }),
      })
    )
    expect(process.exitCode).toBe(130)
  })

  it("preserves the signal exit code when interruption cleanup fails", async () => {
    mocks.finalizeRun
      .mockRejectedValueOnce(new Error("API unavailable"))
      .mockRejectedValueOnce(new Error("API unavailable"))
    const existingListeners = new Set(process.listeners("SIGINT"))
    vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true)

    const run = runCommand({})
    await vi.waitFor(() => expect(mocks.executeScenario).toHaveBeenCalled())
    const interrupt = process
      .listeners("SIGINT")
      .find((listener) => !existingListeners.has(listener))
    expect(interrupt).toBeDefined()
    interrupt?.("SIGINT")

    await expect(run).resolves.toBeUndefined()

    expect(process.exitCode).toBe(130)
    expect(stderr).toHaveBeenCalledWith(
      "Failed to finalize interrupted run: API unavailable\n"
    )
  })
})
