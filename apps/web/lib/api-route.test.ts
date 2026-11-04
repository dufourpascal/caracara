import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { authoringResponseSchema } from "@workspace/contracts"

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}))

import {
  ApiRouteError,
  authorProject,
  createRun,
  finishFixtureOperation,
  getRunResults,
  handleApiError,
  parseJsonBody,
  requireCliVersion,
  routeSchemas,
  startFixtureOperation,
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
      { projectId: "project-1", phaseId: "phase-1", name: "Prepare" },
    ],
    [
      { operation: "removePhase", phaseId: "phase-1" },
      { projectId: "project-1", phaseId: "phase-1" },
    ],
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
        projectId: "project-1",
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
        projectId: "project-1",
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
        projectId: "project-1",
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
        projectId: "project-1",
        scenarioId: "scenario-2",
        checkId: "00000000-0000-4000-8000-000000000001",
        expectation: "The final receipt is visible.",
      },
    ],
    [
      {
        operation: "createFixture",
        name: "Study fixture",
        locator: "Studies list",
      },
      {
        projectId: "project-1",
        name: "Study fixture",
        description: "",
        locator: "Studies list",
        protection: "",
      },
    ],
    [
      {
        operation: "updateFixture",
        fixtureId: "fixture-1",
        resetInstructions: null,
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        resetInstructions: null,
      },
    ],
    [
      {
        operation: "addFixtureStep",
        fixtureId: "fixture-1",
        name: "Create",
        instructions: "Create the study.",
        doneWhen: "The study exists.",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        name: "Create",
        instructions: "Create the study.",
        doneWhen: "The study exists.",
      },
    ],
    [
      {
        operation: "updateFixtureStep",
        fixtureId: "fixture-1",
        stepId: "00000000-0000-4000-8000-000000000002",
        doneWhen: "The study has 9 animals.",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        stepId: "00000000-0000-4000-8000-000000000002",
        doneWhen: "The study has 9 animals.",
      },
    ],
    [
      {
        operation: "removeFixtureStep",
        fixtureId: "fixture-1",
        stepId: "00000000-0000-4000-8000-000000000002",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        stepId: "00000000-0000-4000-8000-000000000002",
      },
    ],
    [
      {
        operation: "addFixtureCheck",
        fixtureId: "fixture-1",
        check: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Animals",
          expectation: "9 animals are listed.",
        },
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        check: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Animals",
          expectation: "9 animals are listed.",
        },
      },
    ],
    [
      {
        operation: "updateFixtureCheck",
        fixtureId: "fixture-1",
        checkId: "00000000-0000-4000-8000-000000000003",
        name: "Animal count",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        checkId: "00000000-0000-4000-8000-000000000003",
        name: "Animal count",
      },
    ],
    [
      {
        operation: "removeFixtureCheck",
        fixtureId: "fixture-1",
        checkId: "00000000-0000-4000-8000-000000000003",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        checkId: "00000000-0000-4000-8000-000000000003",
      },
    ],
    [
      {
        operation: "requireFixture",
        fixtureId: "fixture-1",
        scenarioId: "scenario-2",
        access: "mutates",
        mutationScope: "Adds analysis results.",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        scenarioId: "scenario-2",
        access: "mutates",
        mutationScope: "Adds analysis results.",
      },
    ],
    [
      {
        operation: "requireFixture",
        fixtureId: "fixture-1",
        phaseId: "phase-1",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        phaseId: "phase-1",
        access: "read",
        mutationScope: null,
      },
    ],
    [
      {
        operation: "unrequireFixture",
        fixtureId: "fixture-1",
        phaseId: "phase-1",
      },
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        phaseId: "phase-1",
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

  it("defaults omitted createScenario dependencies and omits unchanged ones on update", async () => {
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

    await authorProject({
      token: "token",
      projectSlug: "demo",
      body: {
        operation: "createScenario",
        name: "Checkout",
        instructions: "Complete checkout.",
      },
    })
    await authorProject({
      token: "token",
      projectSlug: "demo",
      body: {
        operation: "updateScenario",
        scenarioId: "scenario-2",
        status: "active",
      },
    })

    const [createArgs, updateArgs] = vi
      .mocked(fetchMutation)
      .mock.calls.map((call) => call[1])
    expect(createArgs).toEqual({
      projectId: "project-1",
      name: "Checkout",
      status: "draft",
      instructions: "Complete checkout.",
      evaluationChecks: [],
      dependsOnScenarioIds: [],
    })
    expect(updateArgs).toEqual({
      projectId: "project-1",
      scenarioId: "scenario-2",
      status: "active",
    })
    expect(updateArgs).not.toHaveProperty("dependsOnScenarioIds")
  })

  it("bounds request strings in UTF-16 code units like published CLIs", async () => {
    // 60 emoji are 120 UTF-16 units but only 60 code points.
    const atLimit = "😀".repeat(60)
    const request = (name: string) =>
      new Request("https://caracara.test/api", {
        method: "POST",
        body: JSON.stringify({ operation: "addPhase", name }),
      })

    await expect(
      parseJsonBody(request(atLimit), routeSchemas.authoringRequestSchema)
    ).resolves.toEqual({ operation: "addPhase", name: atLimit })

    const error = await parseJsonBody(
      request(`${atLimit}a`),
      routeSchemas.authoringRequestSchema
    ).catch((caught: unknown) => caught)
    const response = handleApiError(error)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(JSON.parse(body.details.reason)).toEqual([
      expect.objectContaining({
        code: "too_big",
        maximum: 120,
        path: ["name"],
      }),
    ])

    // 21 emoji plus "a" is a 43-unit PKCE verifier, which Zod 3 accepted.
    expect(
      routeSchemas.oauthTokenRequestSchema.parse({
        grantType: "authorization_code",
        clientId: "caracara-cli",
        code: "code",
        codeVerifier: `${"😀".repeat(21)}a`,
        redirectUri: "http://127.0.0.1:43123/callback",
      }).codeVerifier
    ).toHaveLength(43)
  })

  it("maps invalid request bodies to validation errors with issue details", async () => {
    const error = await parseJsonBody(
      new Request("https://caracara.test/api", {
        method: "POST",
        body: JSON.stringify({ mode: "all", runnerType: "codex" }),
      }),
      routeSchemas.createRunRequestSchema
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiRouteError)
    const response = handleApiError(error)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({
      code: "validation_error",
      message: "Invalid request payload.",
    })
    expect(JSON.parse(body.details.reason)).toEqual([
      expect.objectContaining({ code: "invalid_type", path: ["startedAt"] }),
    ])

    const malformed = await parseJsonBody(
      new Request("https://caracara.test/api", { method: "POST", body: "{" }),
      routeSchemas.createRunRequestSchema
    ).catch((caught: unknown) => caught)
    expect(handleApiError(malformed).status).toBe(400)
  })

  it("does not mistake response schema failures for structured API errors", async () => {
    vi.stubEnv("NODE_ENV", "test")
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const parsed = authoringResponseSchema.safeParse({
      operation: "addPhase",
      result: { id: "phase-1" },
    })
    expect(parsed.success).toBe(false)

    const response = handleApiError(parsed.error)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      code: "internal_error",
      message: "Unexpected server error.",
    })
    consoleError.mockRestore()
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

  it("stores the CLI environment snapshot when creating a run", async () => {
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
    vi.mocked(fetchMutation).mockResolvedValue({ id: "run-1" })

    await createRun("token", {
      projectSlug: "demo",
      evidencePolicy: "text_only",
      body: {
        mode: "all",
        runnerType: "codex",
        environment: "preview",
        targetUrl: "https://preview.example.com",
        startedAt: 1,
        creationAttemptId: "00000000-0000-4000-8000-000000000001",
        interruptedAt: 2,
      },
    })

    expect(fetchMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "project-1",
        environment: "preview",
        targetUrl: "https://preview.example.com/",
        interruptedAt: 2,
      }),
      { token: "token" }
    )
  })

  it("passes the fixture preflight to run creation", async () => {
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
    vi.mocked(fetchMutation).mockResolvedValue({ id: "run-1" })
    const fixturePreflight = [
      { fixtureId: "fixture-1", outcome: "healthy", operationId: "op-1" },
      { fixtureId: "fixture-2", outcome: "skipped", operationId: null },
    ]

    await createRun("token", {
      projectSlug: "demo",
      evidencePolicy: "text_only",
      body: {
        mode: "all",
        runnerType: "codex",
        startedAt: 1,
        fixturePreflight,
      },
    })

    expect(fetchMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fixturePreflight }),
      { token: "token" }
    )
  })

  it("starts and finishes fixture operations for the URL project", async () => {
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
    const operation = {
      id: "op-1",
      projectId: "project-1",
      fixtureId: "fixture-1",
      fixtureSlug: "study",
      fixtureName: "Study",
      environment: "preview",
      targetUrl: "https://preview.example.com/",
      runId: null,
      kind: "verify",
      executor: "hook",
      status: "running",
      checkResults: [],
      summary: null,
      startedAt: 1,
      finishedAt: null,
      leaseExpiresAt: 2,
    }
    vi.mocked(fetchMutation).mockResolvedValue(operation)

    await expect(
      startFixtureOperation({
        token: "token",
        projectSlug: "demo",
        body: {
          fixtureId: "fixture-1",
          kind: "verify",
          executor: "hook",
          environment: "preview",
          targetUrl: "https://preview.example.com",
          attemptId: "00000000-0000-4000-8000-000000000001",
        },
      })
    ).resolves.toEqual({ operation })
    expect(fetchMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        projectId: "project-1",
        fixtureId: "fixture-1",
        kind: "verify",
        executor: "hook",
        environment: "preview",
        targetUrl: "https://preview.example.com/",
        attemptId: "00000000-0000-4000-8000-000000000001",
      },
      { token: "token" }
    )

    vi.mocked(fetchMutation).mockResolvedValue({
      ...operation,
      status: "succeeded",
      finishedAt: 3,
    })
    await finishFixtureOperation({
      token: "token",
      projectSlug: "demo",
      operationId: "op-1",
      body: {
        attemptId: "00000000-0000-4000-8000-000000000001",
        status: "succeeded",
        checkResults: [],
        summary: "Healthy.",
      },
    })
    expect(fetchMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        projectId: "project-1",
        operationId: "op-1",
        attemptId: "00000000-0000-4000-8000-000000000001",
        status: "succeeded",
        checkResults: [],
        summary: "Healthy.",
      },
      { token: "token" }
    )
    expect(() =>
      routeSchemas.finishFixtureOperationRequestSchema.parse({
        attemptId: "00000000-0000-4000-8000-000000000001",
        status: "running",
        checkResults: [],
        summary: null,
      })
    ).toThrow()
  })

  it("delegates suite resolution to the run creation mutation", async () => {
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
    vi.mocked(fetchMutation).mockResolvedValue({ id: "run-1" })

    await createRun("token", {
      projectSlug: "demo",
      evidencePolicy: "text_only",
      body: {
        mode: "suite",
        requestedSuiteSlug: "public-surfaces",
        runnerType: "codex",
        startedAt: 1,
      },
    })

    expect(fetchMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "project-1",
        requestedSuiteSlug: "public-surfaces",
      }),
      { token: "token" }
    )
    expect(fetchQuery).toHaveBeenCalledTimes(1)
  })

  it("passes requested phase orders to the run creation mutation", async () => {
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
    vi.mocked(fetchMutation).mockResolvedValue({ id: "run-1" })

    await createRun("token", {
      projectSlug: "demo",
      evidencePolicy: "text_only",
      body: {
        mode: "phases",
        requestedPhaseOrders: [1, 2, 5],
        runnerType: "codex",
        startedAt: 1,
      },
    })
    await createRun("token", {
      projectSlug: "demo",
      evidencePolicy: "text_only",
      body: { mode: "all", runnerType: "codex", startedAt: 1 },
    })

    expect(vi.mocked(fetchMutation).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        mode: "phases",
        requestedPhaseOrders: [1, 2, 5],
        requestedPhaseOrder: null,
      }),
      expect.objectContaining({ mode: "all", requestedPhaseOrders: null }),
    ])
  })

  it("rejects unsorted requested phase orders before creating a run", async () => {
    await expect(
      createRun("token", {
        projectSlug: "demo",
        evidencePolicy: "text_only",
        body: {
          mode: "phases",
          requestedPhaseOrders: [3, 1],
          runnerType: "codex",
          startedAt: 1,
        },
      })
    ).rejects.toThrow(/sorted and unique/)
    expect(fetchMutation).not.toHaveBeenCalled()
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

  it("maps Convex argument validation failures to validation errors", async () => {
    const response = handleApiError(
      new Error(
        'ArgumentValidationError: Value does not match validator. Value: "not-an-id" Validator: v.id("phases")'
      )
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: "validation_error",
      message: "Invalid request payload.",
      details: {
        reason: expect.stringContaining("ArgumentValidationError:"),
      },
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

  it("passes run references and the environment filter to the results query", async () => {
    vi.mocked(fetchQuery).mockResolvedValueOnce({ run: {}, results: [] })

    await getRunResults({
      token: "token",
      projectSlug: "demo-project",
      runRef: "latest",
      environment: "staging",
    })

    expect(fetchQuery).toHaveBeenCalledWith(
      expect.anything(),
      { projectSlug: "demo-project", runRef: "latest", environment: "staging" },
      { token: "token" }
    )
  })

  it("maps a missing run to not_found", async () => {
    vi.mocked(fetchQuery).mockResolvedValueOnce(null)

    await expect(
      getRunResults({
        token: "token",
        projectSlug: "demo-project",
        runRef: "brave-heron-20261104-120000",
      })
    ).rejects.toEqual(new ApiRouteError(404, "not_found", "Run not found."))
    expect(fetchQuery).toHaveBeenCalledWith(
      expect.anything(),
      { projectSlug: "demo-project", runRef: "brave-heron-20261104-120000" },
      { token: "token" }
    )
  })
})
