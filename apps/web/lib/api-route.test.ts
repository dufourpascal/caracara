import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ApiRouteError,
  handleApiError,
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

  it("maps stringified structured errors in messages to API responses", async () => {
    const response = handleApiError(
      new Error(
        'Uncaught ConvexError: {"code":"unauthorized","message":"You do not have access to this run."}',
      ),
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
            scenarioSlug: "demo-scenario",
            scenarioName: "Demo scenario",
            executionInstructions: "Do the thing",
            scoringPrompt: "Score the thing",
            sequenceIndex: 0,
            status: "success",
            runnerType: "codex",
            score: 1,
            rationale: "Worked",
            executionSummary: "Output",
            failureDetail: null,
            startedAt: 1,
            finishedAt: 2,
          },
        },
      }),
    ).rejects.toEqual(
      new ApiRouteError(
        400,
        "validation_error",
        "Run ID in URL does not match request body.",
      ),
    )
  })
})
