import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ApiRouteError,
  handleApiError,
  requireCliVersion,
  startScenarioExecution,
  submitScenarioResult,
} from "./api-route"

describe("api-route helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("maps structured Convex-style error payloads to API responses", async () => {
    const response = handleApiError({
      data: {
        code: "not_found",
        message: "Run not found.",
      },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      code: "not_found",
      message: "Run not found.",
    })
  })

  it("requires 0.3 clients on v3", () => {
    const requestFor = (version: string) =>
      new Request("https://example.com", {
        headers: { "x-caracara-cli-version": version },
      })

    expect(requireCliVersion(requestFor("0.3.0"))).toBe("0.3.0")
    expect(() => requireCliVersion(requestFor("0.2.9"))).toThrow(
      /upgrade required/i
    )
  })

  it("maps stringified structured errors in messages to API responses", async () => {
    const response = handleApiError(
      new Error(
        'Uncaught ConvexError: {"code":"unauthorized","message":"You do not have access to this run."}'
      )
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "You do not have access to this run.",
    })
  })

  it("includes internal error details outside production", async () => {
    vi.stubEnv("NODE_ENV", "test")

    const response = handleApiError(new Error("Database insert failed"))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      code: "internal_error",
      message: "Unexpected server error.",
      details: {
        reason: "Database insert failed",
      },
    })
  })

  it("rejects result submissions when the URL run id and body run id differ", async () => {
    await expect(
      submitScenarioResult({
        token: "token",
        projectSlug: "demo-project",
        runId: "url-run-id",
        body: {
          runId: "body-run-id",
          result: {
            scenarioId: "scenario-id",
            status: "completed",
            checkResults: [],
            executionSummary: "Output",
            failureDetail: null,
            startedAt: 1,
            finishedAt: 2,
          },
        },
      })
    ).rejects.toEqual(
      new ApiRouteError(
        400,
        "validation_error",
        "Run ID in URL does not match request body."
      )
    )
  })

  it("rejects scenario start submissions when the URL run id and body run id differ", async () => {
    await expect(
      startScenarioExecution({
        token: "token",
        projectSlug: "demo-project",
        runId: "url-run-id",
        body: {
          runId: "body-run-id",
          result: {
            scenarioId: "scenario-id",
            scenarioSlug: "demo-scenario",
            scenarioName: "Demo scenario",
            executionInstructions: "Do the thing",
            evaluationChecks: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                name: "Thing worked",
                expectation: "The thing is visible.",
              },
            ],
            sequenceIndex: 0,
            runnerType: "codex",
            startedAt: 1,
          },
        },
      })
    ).rejects.toEqual(
      new ApiRouteError(
        400,
        "validation_error",
        "Run ID in URL does not match request body."
      )
    )
  })
})
