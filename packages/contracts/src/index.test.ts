import { describe, expect, it } from "vitest"

import birdNames from "./birds-safe.json" with { type: "json" }

import {
  API_VERSION,
  MIN_SUPPORTED_CLI_VERSION,
  authoringRequestSchema,
  authoringResponseSchema,
  authTokenResponseSchema,
  cliConfigSchema,
  executionPlanResponseSchema,
  finalizeRunResponseSchema,
  createUniqueSlug,
  formatRunName,
  isCliVersionSupported,
  normalizeSlug,
  phaseListResponseSchema,
  projectSchema,
  phaseSchema,
  runSchema,
  scenarioResultSchema,
  versionMismatchErrorSchema,
} from "./index.js"

describe("contracts", () => {
  it("validates core project and scenario shapes", () => {
    const project = projectSchema.parse({
      id: "project_1",
      ownerUserId: "user_1",
      name: "Inbox Bot",
      slug: "inbox-bot",
      description: "Email workflow app",
      projectPrompt: "Use the running localhost app.",
      createdAt: 1,
      updatedAt: 2,
    })

    const phase = phaseSchema.parse({
      id: "phase_1",
      projectId: project.id,
      name: "Setup",
      order: 1,
      createdAt: 1,
      updatedAt: 2,
    })

    const response = executionPlanResponseSchema.parse({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        projectPrompt: project.projectPrompt,
      },
      phases: [
        {
          id: phase.id,
          name: phase.name,
          order: phase.order,
          scenarios: [
            {
              id: "scenario_signup",
              name: "Complete signup",
              slug: "complete-signup",
              status: "active",
              instructions: "Create a new account in the app.",
              evaluationChecks: [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  name: "Account created",
                  expectation: "The dashboard opens for the new account.",
                },
              ],
              phaseId: phase.id,
              phaseName: phase.name,
              phaseOrder: phase.order,
              dependencyIds: [],
            },
          ],
        },
      ],
      unassignedScenarioCount: 0,
    })

    expect(response.project.slug).toBe("inbox-bot")
    expect(response.phases[0]?.scenarios[0]?.phaseName).toBe("Setup")
    expect(
      phaseListResponseSchema.parse({
        phases: [
          {
            ...phase,
            scenarioCount: 3,
          },
        ],
      }).phases[0]?.scenarioCount
    ).toBe(3)
    expect(
      scenarioResultSchema.parse({
        id: "result_1",
        runId: "run_1",
        scenarioId: "scenario_signup",
        scenarioSlug: "complete-signup",
        scenarioName: "Complete signup",
        executionInstructions: "Create a new account in the app.",
        evaluationChecks: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Account created",
            expectation: "The dashboard opens for the new account.",
          },
        ],
        checkResults: [
          {
            checkId: "00000000-0000-4000-8000-000000000001",
            verdict: "passed",
            evidence: "The dashboard heading was visible.",
          },
        ],
        phaseId: phase.id,
        phaseName: phase.name,
        phaseOrder: phase.order,
        sequenceIndex: 0,
        status: "completed",
        runnerType: "codex",
        executionSummary: "done",
        failureDetail: null,
        startedAt: 3,
        finishedAt: 4,
        submittedAt: 5,
      }).executionInstructions
    ).toBe("Create a new account in the app.")

    expect(
      scenarioResultSchema.parse({
        id: "result_2",
        runId: "run_1",
        scenarioId: "scenario_setup",
        scenarioSlug: "setup-session",
        scenarioName: "Setup session",
        executionInstructions: "Sign in to the app.",
        evaluationChecks: [],
        checkResults: [],
        phaseId: null,
        phaseName: null,
        phaseOrder: null,
        sequenceIndex: 1,
        status: "running",
        runnerType: "codex",
        executionSummary: null,
        failureDetail: null,
        startedAt: 6,
        finishedAt: null,
        submittedAt: 7,
      }).status
    ).toBe("running")

    expect(
      runSchema.parse({
        id: "run_1",
        projectId: project.id,
        ownerUserId: project.ownerUserId,
        name: "steady-hawk-20260308-120000",
        status: "completed",
        mode: "all",
        requestedScenarioSlug: null,
        requestedPhaseOrder: null,
        runnerType: "codex",
        evidencePolicy: "failed_check_screenshot",
        passedCheckCount: 9,
        totalCheckCount: 10,
        passRate: 90,
        startedAt: 1,
        finishedAt: 2,
        createdAt: 1,
        updatedAt: 2,
      }).passRate
    ).toBe(90)
  })

  it("rejects invalid cli config", () => {
    expect(() =>
      cliConfigSchema.parse({
        apiBaseUrl: "not-a-url",
        accessToken: null,
        expiresAt: null,
        selectedProjectSlug: null,
        userEmail: null,
      })
    ).toThrow()
  })

  it("validates the eight narrow authoring operations", () => {
    const checkId = "00000000-0000-4000-8000-000000000001"
    const requests = [
      { operation: "addPhase", name: "Checkout" },
      { operation: "editPhase", phaseId: "phase_1", name: "Purchase" },
      { operation: "removePhase", phaseId: "phase_1" },
      {
        operation: "createScenario",
        name: "Pay",
        instructions: "Complete checkout.",
      },
      {
        operation: "updateScenario",
        scenarioId: "scenario_1",
        status: "active",
      },
      {
        operation: "addCheck",
        scenarioId: "scenario_1",
        check: {
          id: checkId,
          name: "Receipt",
          expectation: "The receipt is visible.",
        },
      },
      { operation: "removeCheck", scenarioId: "scenario_1", checkId },
      {
        operation: "updateCheck",
        scenarioId: "scenario_1",
        checkId,
        expectation: "The VAT total is visible.",
      },
    ]

    expect(
      requests.map((request) => authoringRequestSchema.parse(request))
    ).toHaveLength(8)
    expect(() =>
      authoringRequestSchema.parse({
        operation: "updateScenario",
        scenarioId: "scenario_1",
      })
    ).toThrow(/at least one change/i)
    expect(() =>
      authoringRequestSchema.parse({
        operation: "updateCheck",
        scenarioId: "scenario_1",
        checkId,
      })
    ).toThrow(/name or expectation/i)
    for (const request of [
      {
        operation: "createScenario",
        name: "Pay",
        instructions: "Complete checkout.",
        dependsOnScenarioIds: ["scenario_1", "scenario_1"],
      },
      {
        operation: "updateScenario",
        scenarioId: "scenario_2",
        dependsOnScenarioIds: ["scenario_1", "scenario_1"],
      },
    ]) {
      expect(() => authoringRequestSchema.parse(request)).toThrow(
        /dependency ids must be unique/i
      )
    }

    expect(
      authoringResponseSchema.parse({
        operation: "removePhase",
        result: {
          deletedPhaseId: "phase_1",
          deletedPhaseName: "Checkout",
          unassignedScenarioCount: 2,
        },
      }).operation
    ).toBe("removePhase")
  })

  it("normalizes and deduplicates slugs", () => {
    expect(normalizeSlug("Crème brûlée 9000")).toBe("creme-brulee-9000")
    expect(
      createUniqueSlug("Hello world", ["hello-world", "hello-world-2"])
    ).toBe("hello-world-3")
  })

  it("formats run names with an adjective, bird, and timestamp suffix", () => {
    const [adjective, bird, datePart, timePart] = formatRunName(
      new Date("2026-03-07T14:25:30Z")
    ).split("-")

    expect(adjective).toMatch(/^[a-z]+$/)
    expect(birdNames).toContain(bird)
    expect(datePart).toBe("20260307")
    expect(timePart).toBe("142530")
  })

  it("checks cli version compatibility", () => {
    expect(isCliVersionSupported(MIN_SUPPORTED_CLI_VERSION)).toBe(true)
    expect(isCliVersionSupported("0.0.9")).toBe(false)
    expect(isCliVersionSupported("invalid")).toBe(false)
  })

  it("validates version mismatch and auth payloads", () => {
    const mismatch = versionMismatchErrorSchema.parse({
      code: "version_mismatch",
      message: "Upgrade required.",
      details: {
        apiVersion: API_VERSION,
        minimumSupportedCliVersion: MIN_SUPPORTED_CLI_VERSION,
      },
    })

    const token = authTokenResponseSchema.parse({
      accessToken: "token",
      tokenType: "Bearer",
      expiresAt: Date.now(),
    })

    expect(mismatch.details.minimumSupportedCliVersion).toBe(
      MIN_SUPPORTED_CLI_VERSION
    )
    expect(token.tokenType).toBe("Bearer")

    expect(
      finalizeRunResponseSchema.parse({
        run: {
          id: "run_1",
          status: "completed",
          passedCheckCount: 4,
          totalCheckCount: 5,
          passRate: 80,
          finishedAt: 10,
          updatedAt: 10,
        },
      }).run.passRate
    ).toBe(80)
  })
})
