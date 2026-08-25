import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchMutation, fetchQuery } from "convex/nextjs"

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}))

import {
  ApiRouteError,
  authorProject,
  handleApiError,
  requireCliVersion,
  startScenarioExecution,
  submitScenarioResult,
} from "./api-route"

describe("api-route helpers", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it.each([
    [
      { operation: "addPhase", name: "Setup" },
      { projectId: "project-1", name: "Setup" },
    ],
    [
      { operation: "editPhase", phaseId: "phase-1", name: "Prepare" },
      { phaseId: "phase-1", name: "Prepare" },
    ],
    [{ operation: "removePhase", phaseId: "phase-1" }, { phaseId: "phase-1" }],
    [
      {
        operation: "createScenario",
        name: "Checkout",
        instructions: "Complete checkout.",
        phaseId: "phase-1",
        dependsOnScenarioIds: ["scenario-1"],
      },
      {
        projectId: "project-1",
        name: "Checkout",
        status: "draft",
        instructions: "Complete checkout.",
        evaluationChecks: [],
        phaseId: "phase-1",
        dependsOnScenarioIds: ["scenario-1"],
      },
    ],
    [
      {
        operation: "updateScenario",
        scenarioId: "scenario-2",
        status: "active",
        phaseId: null,
        dependsOnScenarioIds: [],
      },
      {
        scenarioId: "scenario-2",
        status: "active",
        phaseId: null,
        dependsOnScenarioIds: [],
      },
    ],
    [
      {
        operation: "addCheck",
        scenarioId: "scenario-2",
        check: {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Receipt",
          expectation: "A receipt is visible.",
        },
      },
      {
        scenarioId: "scenario-2",
        check: {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Receipt",
          expectation: "A receipt is visible.",
        },
      },
    ],
    [
      {
        operation: "removeCheck",
        scenarioId: "scenario-2",
        checkId: "00000000-0000-4000-8000-000000000001",
      },
      {
        scenarioId: "scenario-2",
        checkId: "00000000-0000-4000-8000-000000000001",
      },
    ],
    [
      {
        operation: "updateCheck",
        scenarioId: "scenario-2",
        checkId: "00000000-0000-4000-8000-000000000001",
        expectation: "The final receipt is visible.",
      },
      {
        scenarioId: "scenario-2",
        checkId: "00000000-0000-4000-8000-000000000001",
        expectation: "The final receipt is visible.",
      },
    ],
  ])(
    "dispatches the $operation authoring operation",
    async (body, mutationArgs) => {
      vi.mocked(fetchQuery).mockResolvedValue({
        id: "project-1",
        ownerUserId: "user-1",
        name: "Demo",
        slug: "demo",
        description: "",
        projectPrompt: "",
        createdAt: 1,
        updatedAt: 1,
      })
      vi.mocked(fetchMutation).mockResolvedValue({ id: "result-1" })

      const response = await authorProject({
        token: "token",
        projectSlug: "demo",
        body,
      })

      expect(fetchMutation).toHaveBeenCalledWith(
        expect.anything(),
        mutationArgs,
        { token: "token" }
      )
      expect(response.operation).toBe(body.operation)
    }
  )

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
