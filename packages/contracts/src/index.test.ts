import { describe, expect, it } from "vitest"
import { z, ZodError } from "zod"

import adjectiveNames from "./adjectives-safe.json" with { type: "json" }
import birdNames from "./birds-safe.json" with { type: "json" }

import {
  API_VERSION,
  MIN_SUPPORTED_CLI_VERSION,
  apiErrorSchema,
  authoringRequestSchema,
  authoringResponseSchema,
  authTokenResponseSchema,
  cliConfigSchema,
  checkResultSchema,
  createRunRequestSchema,
  createRunResponseSchema,
  evaluationCheckSchema,
  executionPlanResponseSchema,
  finalizeRunRequestSchema,
  finalizeRunResponseSchema,
  finishFixtureOperationRequestSchema,
  fixtureInputSchema,
  fixtureListResponseSchema,
  fixtureRequirementSchema,
  mergeFixtureRequirements,
  singleScenarioResponseSchema,
  startFixtureOperationRequestSchema,
  createUniqueSlug,
  formatRunName,
  isCliVersionSupported,
  normalizeSlug,
  oauthAuthorizeRequestSchema,
  oauthTokenRequestSchema,
  phaseListResponseSchema,
  projectDetailResponseSchema,
  projectInputSchema,
  projectSchema,
  phaseSchema,
  runSchema,
  scenarioResultSchema,
  startScenarioExecutionRequestSchema,
  submitScenarioResultRequestSchema,
  suiteInputSchema,
  suiteSchema,
  targetUrlSchema,
  timestampSchema,
  versionMismatchErrorSchema,
  whoAmIResponseSchema,
} from "./index.js"

describe("contracts", () => {
  it("requires structured reasons for blocked check results", () => {
    const blocked = {
      checkId: "00000000-0000-4000-8000-000000000001",
      verdict: "blocked",
      evidence: "The target environment was unavailable.",
    }

    expect(
      checkResultSchema.parse({
        ...blocked,
        blockedReason: "environment_failure",
      }).blockedReason
    ).toBe("environment_failure")
    expect(() => checkResultSchema.parse(blocked)).toThrow(/structured reason/i)
    expect(() =>
      checkResultSchema.parse({
        ...blocked,
        verdict: "passed",
        blockedReason: "environment_failure",
      })
    ).toThrow(/only blocked/i)
    expect(
      checkResultSchema.parse({ ...blocked, verdict: "not_observed" }).verdict
    ).toBe("not_observed")
  })

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

  it("validates suites and suite run targets", () => {
    expect(
      suiteSchema.parse({
        id: "suite_1",
        projectId: "project_1",
        name: "Demo only",
        slug: "demo-only",
        phaseIds: ["phase_2", "phase_4"],
        createdAt: 1,
        updatedAt: 2,
      }).phaseIds
    ).toEqual(["phase_2", "phase_4"])
    expect(
      suiteInputSchema.parse({ name: "Empty", phaseIds: [] }).phaseIds
    ).toEqual([])
    expect(
      createRunRequestSchema.parse({
        mode: "suite",
        requestedSuiteSlug: "demo-only",
        runnerType: "codex",
        startedAt: 1,
        creationAttemptId: "00000000-0000-4000-8000-000000000001",
        interruptedAt: 2,
      })
    ).toMatchObject({ mode: "suite", interruptedAt: 2 })
    expect(() =>
      createRunRequestSchema.parse({
        mode: "all",
        runnerType: "codex",
        startedAt: 1,
        interruptedAt: 2,
      })
    ).toThrow(/creation attempt ID/i)

    expect(
      runSchema.parse({
        id: "run-1",
        projectId: "project-1",
        ownerUserId: "user-1",
        name: "calm-macaw-20260827-120000",
        status: "running",
        mode: "suite",
        requestedScenarioSlug: null,
        requestedSuiteSlug: "public-surfaces",
        requestedSuiteName: "Public surfaces",
        requestedSuitePhases: [{ id: "phase-1", name: "Landing", order: 1 }],
        runnerType: "codex",
        evidencePolicy: "failed_check_screenshot",
        passedCheckCount: 0,
        totalCheckCount: 0,
        passRate: null,
        startedAt: 1,
        finishedAt: null,
        createdAt: 1,
        updatedAt: 1,
      }).requestedSuitePhases
    ).toEqual([{ id: "phase-1", name: "Landing", order: 1 }])
    expect(() =>
      createRunRequestSchema.parse({
        mode: "suite",
        requestedPhaseOrder: 2,
        requestedSuiteSlug: "demo-only",
        runnerType: "codex",
        startedAt: 1,
      })
    ).toThrow(/target do not match/i)
  })

  it("validates multi-phase run targets", () => {
    const base = { runnerType: "codex", startedAt: 1 } as const
    expect(
      createRunRequestSchema.parse({
        ...base,
        mode: "phases",
        requestedPhaseOrders: [1, 2, 3, 7],
      }).requestedPhaseOrders
    ).toEqual([1, 2, 3, 7])
    expect(
      createRunRequestSchema.parse({
        ...base,
        mode: "phases",
        requestedPhaseOrders: Array.from({ length: 100 }, (_, i) => i + 1),
      }).requestedPhaseOrders
    ).toHaveLength(100)

    for (const [requestedPhaseOrders, message] of [
      [[3, 1], /sorted and unique/],
      [[1, 2, 2], /sorted and unique/],
      [[2], /at least 2 phases/],
      [[], /at least 2 phases/],
      [Array.from({ length: 101 }, (_, i) => i + 1), /at most 100 phases/],
      [[0, 1], /too small|>0/i],
      [[1, 2.5], /int/i],
    ] as const) {
      expect(() =>
        createRunRequestSchema.parse({
          ...base,
          mode: "phases",
          requestedPhaseOrders,
        })
      ).toThrow(message)
    }

    for (const body of [
      { mode: "phases" },
      { mode: "phases", requestedPhaseOrders: null },
      { mode: "phases", requestedPhaseOrder: 2 },
      {
        mode: "phases",
        requestedPhaseOrders: [1, 2],
        requestedScenarioSlug: "login",
      },
      {
        mode: "phases",
        requestedPhaseOrders: [1, 2],
        requestedPhaseOrder: 1,
      },
      {
        mode: "phases",
        requestedPhaseOrders: [1, 2],
        requestedSuiteSlug: "demo-only",
      },
      { mode: "all", requestedPhaseOrders: [1, 2] },
      {
        mode: "single",
        requestedScenarioSlug: "login",
        requestedPhaseOrders: [1, 2],
      },
      { mode: "phase", requestedPhaseOrder: 1, requestedPhaseOrders: [1, 2] },
      {
        mode: "through_phase",
        requestedPhaseOrder: 2,
        requestedPhaseOrders: [1, 2],
      },
      {
        mode: "suite",
        requestedSuiteSlug: "demo-only",
        requestedPhaseOrders: [1, 2],
      },
    ]) {
      expect(() => createRunRequestSchema.parse({ ...base, ...body })).toThrow(
        /target do not match/i
      )
    }
    for (const body of [
      { mode: "all", requestedPhaseOrders: null },
      { mode: "phase", requestedPhaseOrder: 1, requestedPhaseOrders: null },
    ]) {
      expect(
        createRunRequestSchema.safeParse({ ...base, ...body }).success
      ).toBe(true)
    }

    const run = {
      id: "run-1",
      projectId: "project-1",
      ownerUserId: "user-1",
      name: "calm-macaw-20260827-120000",
      status: "running",
      mode: "phases",
      requestedScenarioSlug: null,
      runnerType: "codex",
      evidencePolicy: "failed_check_screenshot",
      passedCheckCount: 0,
      totalCheckCount: 0,
      passRate: null,
      startedAt: 1,
      finishedAt: null,
      createdAt: 1,
      updatedAt: 1,
    } as const
    expect(
      runSchema.parse({ ...run, requestedPhaseOrders: [1, 3] })
        .requestedPhaseOrders
    ).toEqual([1, 3])
    expect(
      runSchema.parse({ ...run, mode: "all", requestedPhaseOrders: null })
        .requestedPhaseOrders
    ).toBeNull()
    expect(runSchema.parse({ ...run, mode: "all" })).not.toHaveProperty(
      "requestedPhaseOrders"
    )

    const createdRun = {
      id: run.id,
      name: run.name,
      status: run.status,
      mode: run.mode,
      runnerType: run.runnerType,
      evidencePolicy: run.evidencePolicy,
      requestedScenarioSlug: null,
      startedAt: 1,
    }
    expect(
      createRunResponseSchema.parse({
        run: { ...createdRun, requestedPhaseOrders: [2, 4] },
      }).run.requestedPhaseOrders
    ).toEqual([2, 4])
    expect(
      createRunResponseSchema.parse({
        run: { ...createdRun, mode: "all", requestedPhaseOrders: null },
      }).run.requestedPhaseOrders
    ).toBeNull()
    expect(
      createRunResponseSchema.parse({ run: { ...createdRun, mode: "all" } }).run
    ).not.toHaveProperty("requestedPhaseOrders")
  })

  it("validates environment-aware run creation", () => {
    expect(
      createRunRequestSchema.parse({
        mode: "all",
        runnerType: "codex",
        environment: "preview",
        targetUrl: "https://preview.example.com",
        startedAt: 1,
      })
    ).toMatchObject({
      environment: "preview",
      targetUrl: "https://preview.example.com/",
    })
    expect(() =>
      createRunRequestSchema.parse({
        mode: "all",
        runnerType: "codex",
        environment: "preview",
        startedAt: 1,
      })
    ).toThrow("provided together")
    expect(() =>
      targetUrlSchema.parse("https://user:pass@example.com")
    ).toThrow("must not contain credentials")
    expect(targetUrlSchema.safeParse("not-a-url").success).toBe(false)
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

  it("validates project input and treats a blank slug as omitted", () => {
    const project = projectInputSchema.parse({
      name: "  Blank Slug Derivation  ",
      slug: "   ",
      description: "Kept as entered.",
      projectPrompt: "Shared context.",
    })

    expect(project).toEqual({
      name: "Blank Slug Derivation",
      slug: undefined,
      description: "Kept as entered.",
      projectPrompt: "Shared context.",
    })
    expect(
      createUniqueSlug(project.slug ?? project.name, [
        "blank-slug-derivation",
        "blank-slug-derivation-2",
      ])
    ).toBe("blank-slug-derivation-3")

    const invalid = projectInputSchema.safeParse({
      name: " ".repeat(121),
      slug: "project",
      description: "d".repeat(1_501),
      projectPrompt: "p".repeat(12_001),
    })

    expect(invalid.success).toBe(false)
    if (!invalid.success) {
      expect(z.flattenError(invalid.error).fieldErrors).toMatchObject({
        name: ["Project name is required."],
        description: ["Description must be 1,500 characters or fewer."],
        projectPrompt: ["Project prompt must be 12,000 characters or fewer."],
      })
    }

    expect(
      projectInputSchema.safeParse({
        name: "n".repeat(121),
        slug: "project",
        description: "",
        projectPrompt: "",
      }).success
    ).toBe(false)
  })

  it("formats run names with an adjective, bird, and timestamp suffix", () => {
    const [adjective, bird, datePart, timePart] = formatRunName(
      new Date("2026-03-07T14:25:30Z")
    ).split("-")

    expect(adjectiveNames).toContain(adjective)
    expect(birdNames).toContain(bird)
    expect(datePart).toBe("20260307")
    expect(timePart).toBe("142530")
  })

  it("keeps the run name word lists kebab-safe and distinct", () => {
    for (const list of [adjectiveNames, birdNames]) {
      expect(list.length).toBeGreaterThan(0)
      expect(new Set(list).size).toBe(list.length)
      for (const word of list) {
        expect(word).toMatch(/^[a-z]+$/)
      }
    }
    const overlap = adjectiveNames.filter((word) => birdNames.includes(word))
    expect(overlap).toEqual([])
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
      finalizeRunRequestSchema.parse({
        status: "interrupted",
        finishedAt: 10,
        finalizationAttemptId: "00000000-0000-4000-8000-000000000001",
        interruptedScenarioResultId: "result-1",
        interruptedScenarioAttemptId:
          "00000000-0000-4000-8000-000000000002",
      }).finalizationAttemptId
    ).toBe("00000000-0000-4000-8000-000000000001")
    expect(
      finalizeRunRequestSchema.parse({
        status: "interrupted",
        finishedAt: 10,
        interruptedScenarioResultId: "result-1",
        interruptedScenarioAttemptId:
          "00000000-0000-4000-8000-000000000002",
      }).interruptedScenarioResultId
    ).toBe("result-1")

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

describe("contract compatibility across schema library upgrades", () => {
  const check = {
    id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    name: "Receipt",
    expectation: "The receipt is visible.",
  }

  it("accepts any hyphenated hex GUID as a check or attempt ID", () => {
    for (const id of [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "12345678-1234-0234-0234-123456789abc",
      "12345678-1234-1234-c234-123456789abc",
      "6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B",
    ]) {
      expect(evaluationCheckSchema.parse({ ...check, id }).id).toBe(id)
      expect(
        authoringRequestSchema.parse({
          operation: "updateCheck",
          scenarioId: "scenario_1",
          checkId: id,
          name: "Renamed",
        })
      ).toMatchObject({ checkId: id })
      expect(
        finalizeRunRequestSchema.parse({
          status: "completed",
          finishedAt: 1,
          finalizationAttemptId: id,
        }).finalizationAttemptId
      ).toBe(id)
    }

    const legacyId = "12345678-1234-0234-0234-123456789abc"
    expect(
      executionPlanResponseSchema.parse({
        project: {
          id: "project_1",
          name: "Demo",
          slug: "demo",
          projectPrompt: "",
        },
        phases: [
          {
            id: "phase_1",
            name: "Setup",
            order: 1,
            scenarios: [
              {
                id: "scenario_1",
                name: "Login",
                slug: "login",
                status: "active",
                instructions: "Sign in.",
                evaluationChecks: [{ ...check, id: legacyId }],
                dependencyIds: [],
              },
            ],
          },
        ],
        unassignedScenarioCount: 0,
      }).phases[0]?.scenarios[0]?.evaluationChecks[0]?.id
    ).toBe(legacyId)

    for (const id of [
      "6f1c2a3b4d5e4f608a7b9c0d1e2f3a4b",
      "{6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b}",
      "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4",
      "not-a-uuid",
    ]) {
      expect(evaluationCheckSchema.safeParse({ ...check, id }).success).toBe(
        false
      )
    }
  })

  it("defaults omitted createScenario dependencies without inventing updateScenario ones", () => {
    const base = {
      operation: "createScenario",
      name: "Login",
      instructions: "Sign in.",
    }

    expect(authoringRequestSchema.parse(base)).toEqual({
      ...base,
      dependsOnScenarioIds: [],
    })
    expect(
      authoringRequestSchema.parse({ ...base, dependsOnScenarioIds: undefined })
    ).toMatchObject({ dependsOnScenarioIds: [] })
    expect(
      authoringRequestSchema.safeParse({ ...base, dependsOnScenarioIds: null })
        .success
    ).toBe(false)

    const duplicate = authoringRequestSchema.safeParse({
      ...base,
      dependsOnScenarioIds: ["scenario_1", "scenario_1"],
    })
    expect(duplicate.success).toBe(false)
    if (!duplicate.success) {
      expect(z.flattenError(duplicate.error).fieldErrors).toEqual({
        dependsOnScenarioIds: ["Dependency IDs must be unique."],
      })
    }

    const unknownOperation = authoringRequestSchema.safeParse({
      operation: "deleteProject",
    })
    expect(unknownOperation.success).toBe(false)
    if (!unknownOperation.success) {
      expect(
        Object.keys(z.flattenError(unknownOperation.error).fieldErrors)
      ).toEqual(["operation"])
    }

    const update = authoringRequestSchema.parse({
      operation: "updateScenario",
      scenarioId: "scenario_1",
      status: "active",
    })
    expect(Object.keys(update).sort()).toEqual([
      "operation",
      "scenarioId",
      "status",
    ])
  })

  it("keeps blank and omitted project slugs distinguishable only as undefined", () => {
    const project = { name: "Demo", description: "", projectPrompt: "" }

    expect(Object.hasOwn(projectInputSchema.parse(project), "slug")).toBe(false)
    for (const slug of ["", "   ", undefined]) {
      const parsed = projectInputSchema.parse({ ...project, slug })
      expect(Object.hasOwn(parsed, "slug")).toBe(true)
      expect(parsed.slug).toBeUndefined()
    }
    expect(
      projectInputSchema.parse({ ...project, slug: " My Slug " }).slug
    ).toBe("My Slug")
    expect(
      projectInputSchema.safeParse({ ...project, slug: null }).success
    ).toBe(false)
  })

  it("reports field errors per field and form errors for cross-field rules", () => {
    const suite = suiteInputSchema.safeParse({
      name: "   ",
      phaseIds: ["phase_1", "phase_1"],
    })
    expect(suite.success).toBe(false)
    if (!suite.success) {
      expect(z.flattenError(suite.error)).toEqual({
        formErrors: [],
        fieldErrors: {
          name: ["Suite name is required."],
          phaseIds: ["Suite phase IDs must be unique."],
        },
      })
    }

    const blocked = checkResultSchema.safeParse({
      checkId: check.id,
      verdict: "blocked",
      evidence: "",
    })
    expect(blocked.success).toBe(false)
    if (!blocked.success) {
      expect(
        Object.keys(z.flattenError(blocked.error).fieldErrors).sort()
      ).toEqual(["blockedReason", "evidence"])
    }

    const run = createRunRequestSchema.safeParse({
      mode: "single",
      runnerType: "codex",
      environment: "preview",
      startedAt: 1,
    })
    expect(run.success).toBe(false)
    if (!run.success) {
      expect(z.flattenError(run.error)).toEqual({
        formErrors: [
          "Environment and target URL must be provided together.",
          "Run mode and requested target do not match.",
        ],
        fieldErrors: {},
      })
      expect(run.error).toBeInstanceOf(ZodError)
    }
  })

  it("accepts integer millisecond timestamps and rejects non-integers", () => {
    expect(timestampSchema.parse(0)).toBe(0)
    expect(timestampSchema.parse(Date.UTC(2026, 9, 26))).toBe(
      Date.UTC(2026, 9, 26)
    )
    expect(timestampSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER
    )
    for (const value of [-1, 1.5, Number.NaN, Infinity, "1", null]) {
      expect(timestampSchema.safeParse(value).success).toBe(false)
    }
    // Integers beyond 2^53 - 1 cannot be represented exactly, so they are rejected.
    expect(timestampSchema.safeParse(2 ** 53).success).toBe(false)
  })

  it("validates URLs and emails without narrowing accepted values", () => {
    const authorize = {
      clientId: "caracara-cli",
      state: "state",
      codeChallenge: "a".repeat(43),
      codeChallengeMethod: "S256",
    }

    for (const redirectUri of [
      "http://127.0.0.1:43123/callback",
      "http://localhost:43123/callback",
      "http://[::1]:43123/callback",
    ]) {
      expect(
        oauthAuthorizeRequestSchema.parse({ ...authorize, redirectUri })
          .redirectUri
      ).toBe(redirectUri)
    }
    for (const redirectUri of ["not a url", "", "/callback"]) {
      expect(
        oauthAuthorizeRequestSchema.safeParse({ ...authorize, redirectUri })
          .success
      ).toBe(false)
    }

    for (const email of ["a@b.co", "first.last+tag@example.com", null]) {
      expect(
        whoAmIResponseSchema.parse({ userId: "user_1", email }).email
      ).toBe(email)
    }
    for (const email of ["a..b@example.com", "a@localhost", "not-an-email"]) {
      expect(
        whoAmIResponseSchema.safeParse({ userId: "user_1", email }).success
      ).toBe(false)
    }

    expect(targetUrlSchema.parse("HTTPS://Example.COM")).toBe(
      "https://example.com/"
    )
    for (const url of ["javascript:alert(1)", "ftp://example.com"]) {
      expect(() => targetUrlSchema.parse(url)).toThrow("HTTP or HTTPS")
    }
  })

  it("strips unknown keys from API payloads and keeps response shapes", () => {
    const project = {
      id: "project_1",
      ownerUserId: "user_1",
      name: "Demo",
      slug: "demo",
      description: "",
      projectPrompt: "",
      createdAt: 1,
      updatedAt: 2,
    }

    expect(
      projectDetailResponseSchema.parse({
        project: { ...project, _creationTime: 1, internal: true },
      })
    ).toEqual({ project })
    expect(
      cliConfigSchema.parse({
        apiBaseUrl: "https://example.com",
        accessToken: null,
        expiresAt: null,
        selectedProjectSlug: null,
        userEmail: null,
        legacyField: 1,
      })
    ).not.toHaveProperty("legacyField")

    expect(
      createRunResponseSchema.parse({
        run: {
          id: "run_1",
          name: "brave-owl-20261026-120000",
          status: "running",
          mode: "all",
          runnerType: "codex",
          evidencePolicy: "failed_check_screenshot",
          environment: "preview",
          targetUrl: "https://Preview.example.com",
          requestedScenarioSlug: null,
          startedAt: 1,
        },
        evidenceUploadUrl: "https://upload.example.com/evidence",
      })
    ).toEqual({
      run: {
        id: "run_1",
        name: "brave-owl-20261026-120000",
        status: "running",
        mode: "all",
        runnerType: "codex",
        evidencePolicy: "failed_check_screenshot",
        environment: "preview",
        targetUrl: "https://preview.example.com/",
        requestedScenarioSlug: null,
        startedAt: 1,
      },
      evidenceUploadUrl: "https://upload.example.com/evidence",
    })

    expect(
      apiErrorSchema.parse({
        code: "validation_error",
        message: "Invalid request payload.",
        details: { reason: "x", nested: { ok: true } },
      })
    ).toEqual({
      code: "validation_error",
      message: "Invalid request payload.",
      details: { reason: "x", nested: { ok: true } },
    })
    expect(
      apiErrorSchema.safeParse({ code: "conflict", message: "x", details: [] })
        .success
    ).toBe(false)
  })

  it("enforces scenario execution collection limits", () => {
    const result = {
      scenarioId: "scenario_1",
      scenarioSlug: "login",
      scenarioName: "Login",
      executionInstructions: "Sign in.",
      evaluationChecks: [check],
      sequenceIndex: 0,
      runnerType: "codex",
      startedAt: 1,
    }

    expect(
      startScenarioExecutionRequestSchema.safeParse({ runId: "run_1", result })
        .success
    ).toBe(true)
    for (const evaluationChecks of [
      [],
      Array.from({ length: 21 }, () => check),
    ]) {
      expect(
        startScenarioExecutionRequestSchema.safeParse({
          runId: "run_1",
          result: { ...result, evaluationChecks },
        }).success
      ).toBe(false)
    }

    const submit = {
      scenarioId: "scenario_1",
      status: "completed",
      checkResults: Array.from({ length: 21 }, () => ({
        checkId: check.id,
        verdict: "passed",
        evidence: "Seen.",
      })),
      executionSummary: null,
      failureDetail: null,
      finishedAt: 2,
    }
    expect(
      submitScenarioResultRequestSchema.safeParse({
        runId: "run_1",
        result: submit,
      }).success
    ).toBe(false)
    expect(
      submitScenarioResultRequestSchema.safeParse({
        runId: "run_1",
        result: { ...submit, checkResults: submit.checkResults.slice(0, 20) },
      }).success
    ).toBe(true)
  })
})

describe("string bounds measured in UTF-16 code units", () => {
  // Zod 3 clients count UTF-16 code units. "😀" is one code point but two
  // units, so these cases fail if a bound is measured in code points.
  const units = (count: number) =>
    "😀".repeat(Math.floor(count / 2)) + (count % 2 === 1 ? "a" : "")

  const checkId = "00000000-0000-4000-8000-000000000001"
  const check = { id: checkId, name: "Receipt", expectation: "Visible." }
  const projectInput = { name: "Demo", description: "", projectPrompt: "" }
  const suiteInput = { name: "Smoke", phaseIds: [] }
  const project = {
    id: "project_1",
    ownerUserId: "user_1",
    name: "Demo",
    slug: "demo",
    description: "",
    projectPrompt: "",
    createdAt: 1,
    updatedAt: 2,
  }
  const phase = {
    id: "phase_1",
    projectId: "project_1",
    name: "Setup",
    order: 1,
    createdAt: 1,
    updatedAt: 2,
  }
  const orderedScenario = {
    id: "scenario_1",
    name: "Checkout",
    slug: "checkout",
    status: "active",
    instructions: "Check out.",
    evaluationChecks: [check],
    phaseId: "phase_1",
    phaseName: "Setup",
    phaseOrder: 1,
    dependencyIds: [],
  }
  const plan = (overrides: {
    projectName?: string
    projectPrompt?: string
    phaseName?: string
    scenario?: Record<string, unknown>
    suiteName?: string
  }) => ({
    project: {
      id: "project_1",
      name: overrides.projectName ?? "Demo",
      slug: "demo",
      projectPrompt: overrides.projectPrompt ?? "",
    },
    phases: [
      {
        id: "phase_1",
        name: overrides.phaseName ?? "Setup",
        order: 1,
        scenarios: [{ ...orderedScenario, ...overrides.scenario }],
      },
    ],
    suite: { name: overrides.suiteName ?? "Smoke", slug: "smoke" },
    unassignedScenarioCount: 0,
  })
  const startRequest = {
    runId: "run_1",
    result: {
      scenarioId: "scenario_1",
      scenarioSlug: "checkout",
      scenarioName: "Checkout",
      executionInstructions: "Check out.",
      evaluationChecks: [check],
      sequenceIndex: 0,
      runnerType: "codex",
      startedAt: 1,
    },
  }
  const submitRequest = {
    runId: "run_1",
    result: {
      scenarioId: "scenario_1",
      status: "completed",
      checkResults: [] as unknown[],
      executionSummary: null,
      failureDetail: null,
      finishedAt: 2,
    },
  }
  const scenarioResult = {
    id: "result_1",
    runId: "run_1",
    scenarioId: "scenario_1",
    scenarioSlug: "checkout",
    scenarioName: "Checkout",
    executionInstructions: "Check out.",
    evaluationChecks: [check],
    checkResults: [],
    phaseId: "phase_1",
    phaseName: "Setup",
    phaseOrder: 1,
    sequenceIndex: 0,
    status: "completed",
    runnerType: "codex",
    executionSummary: null,
    failureDetail: null,
    startedAt: 1,
    finishedAt: 2,
    submittedAt: 3,
  }

  type BoundCase = {
    label: string
    max: number
    path: PropertyKey[]
    message?: string
    trimmed?: boolean
    parse: (value: string) => { success: boolean; error?: ZodError }
  }
  const projectNameMessage = "Project name must be 120 characters or fewer."
  const descriptionMessage = "Description must be 1,500 characters or fewer."
  const promptMessage = "Project prompt must be 12,000 characters or fewer."
  const slugMessage = "Slug must be 120 characters or fewer."
  const cases: BoundCase[] = [
    {
      label: "project input name",
      max: 120,
      path: ["name"],
      message: projectNameMessage,
      trimmed: true,
      parse: (name) => projectInputSchema.safeParse({ ...projectInput, name }),
    },
    {
      label: "project input slug",
      max: 120,
      path: ["slug"],
      message: slugMessage,
      trimmed: true,
      parse: (slug) => projectInputSchema.safeParse({ ...projectInput, slug }),
    },
    {
      label: "project input description",
      max: 1_500,
      path: ["description"],
      message: descriptionMessage,
      parse: (description) =>
        projectInputSchema.safeParse({ ...projectInput, description }),
    },
    {
      label: "project input prompt",
      max: 12_000,
      path: ["projectPrompt"],
      message: promptMessage,
      parse: (projectPrompt) =>
        projectInputSchema.safeParse({ ...projectInput, projectPrompt }),
    },
    {
      label: "suite input name",
      max: 120,
      path: ["name"],
      message: "Suite name must be 120 characters or fewer.",
      trimmed: true,
      parse: (name) => suiteInputSchema.safeParse({ ...suiteInput, name }),
    },
    {
      label: "suite input slug",
      max: 120,
      path: ["slug"],
      message: slugMessage,
      trimmed: true,
      parse: (slug) => suiteInputSchema.safeParse({ ...suiteInput, slug }),
    },
    {
      label: "project detail name",
      max: 120,
      path: ["project", "name"],
      message: projectNameMessage,
      trimmed: true,
      parse: (name) =>
        projectDetailResponseSchema.safeParse({
          project: { ...project, name },
        }),
    },
    {
      label: "project detail description",
      max: 1_500,
      path: ["project", "description"],
      message: descriptionMessage,
      parse: (description) =>
        projectDetailResponseSchema.safeParse({
          project: { ...project, description },
        }),
    },
    {
      label: "phase list name",
      max: 120,
      path: ["phases", 0, "name"],
      parse: (name) =>
        phaseListResponseSchema.safeParse({ phases: [{ ...phase, name }] }),
    },
    {
      label: "suite name",
      max: 120,
      path: ["name"],
      parse: (name) =>
        suiteSchema.safeParse({
          id: "suite_1",
          projectId: "project_1",
          name,
          slug: "smoke",
          phaseIds: [],
          createdAt: 1,
          updatedAt: 2,
        }),
    },
    {
      label: "execution plan project name",
      max: 120,
      path: ["project", "name"],
      message: projectNameMessage,
      trimmed: true,
      parse: (projectName) =>
        executionPlanResponseSchema.safeParse(plan({ projectName })),
    },
    {
      label: "execution plan project prompt",
      max: 12_000,
      path: ["project", "projectPrompt"],
      message: promptMessage,
      parse: (projectPrompt) =>
        executionPlanResponseSchema.safeParse(plan({ projectPrompt })),
    },
    {
      label: "execution plan suite name",
      max: 120,
      path: ["suite", "name"],
      parse: (suiteName) =>
        executionPlanResponseSchema.safeParse(plan({ suiteName })),
    },
    {
      label: "execution plan phase name",
      max: 120,
      path: ["phases", 0, "name"],
      parse: (phaseName) =>
        executionPlanResponseSchema.safeParse(plan({ phaseName })),
    },
    ...(["name", "phaseName"] as const).map((field) => ({
      label: `execution plan scenario ${field}`,
      max: 120,
      path: ["phases", 0, "scenarios", 0, field],
      parse: (value: string) =>
        executionPlanResponseSchema.safeParse(
          plan({ scenario: { [field]: value } })
        ),
    })),
    {
      label: "execution plan scenario instructions",
      max: 20_000,
      path: ["phases", 0, "scenarios", 0, "instructions"],
      parse: (instructions) =>
        executionPlanResponseSchema.safeParse(
          plan({ scenario: { instructions } })
        ),
    },
    ...(["name", "expectation"] as const).map((field) => ({
      label: `execution plan check ${field}`,
      max: field === "name" ? 120 : 2_000,
      path: ["phases", 0, "scenarios", 0, "evaluationChecks", 0, field],
      parse: (value: string) =>
        executionPlanResponseSchema.safeParse(
          plan({
            scenario: { evaluationChecks: [{ ...check, [field]: value }] },
          })
        ),
    })),
    {
      label: "addPhase name",
      max: 120,
      path: ["name"],
      trimmed: true,
      parse: (name) =>
        authoringRequestSchema.safeParse({ operation: "addPhase", name }),
    },
    {
      label: "editPhase name",
      max: 120,
      path: ["name"],
      trimmed: true,
      parse: (name) =>
        authoringRequestSchema.safeParse({
          operation: "editPhase",
          phaseId: "phase_1",
          name,
        }),
    },
    ...(["createScenario", "updateScenario"] as const).flatMap((operation) =>
      (["name", "instructions"] as const).map((field) => ({
        label: `${operation} ${field}`,
        max: field === "name" ? 120 : 20_000,
        path: [field],
        trimmed: true,
        parse: (value: string) =>
          authoringRequestSchema.safeParse({
            operation,
            ...(operation === "createScenario"
              ? { name: "Checkout", instructions: "Check out." }
              : { scenarioId: "scenario_1" }),
            [field]: value,
          }),
      }))
    ),
    ...(["name", "expectation"] as const).flatMap((field) => [
      {
        label: `addCheck ${field}`,
        max: field === "name" ? 120 : 2_000,
        path: ["check", field],
        parse: (value: string) =>
          authoringRequestSchema.safeParse({
            operation: "addCheck",
            scenarioId: "scenario_1",
            check: { ...check, [field]: value },
          }),
      },
      {
        label: `updateCheck ${field}`,
        max: field === "name" ? 120 : 2_000,
        path: [field],
        trimmed: true,
        parse: (value: string) =>
          authoringRequestSchema.safeParse({
            operation: "updateCheck",
            scenarioId: "scenario_1",
            checkId,
            [field]: value,
          }),
      },
    ]),
    ...(
      [
        ["scenarioName", 120],
        ["executionInstructions", 20_000],
        ["phaseName", 120],
      ] as const
    ).map(([field, max]) => ({
      label: `start scenario ${field}`,
      max,
      path: ["result", field],
      parse: (value: string) =>
        startScenarioExecutionRequestSchema.safeParse({
          ...startRequest,
          result: { ...startRequest.result, [field]: value },
        }),
    })),
    ...(["executionSummary", "failureDetail"] as const).map((field) => ({
      label: `submit result ${field}`,
      max: 20_000,
      path: ["result", field],
      parse: (value: string) =>
        submitScenarioResultRequestSchema.safeParse({
          ...submitRequest,
          result: { ...submitRequest.result, [field]: value },
        }),
    })),
    {
      label: "submit result check evidence",
      max: 2_000,
      path: ["result", "checkResults", 0, "evidence"],
      parse: (evidence) =>
        submitScenarioResultRequestSchema.safeParse({
          ...submitRequest,
          result: {
            ...submitRequest.result,
            checkResults: [{ checkId, verdict: "passed", evidence }],
          },
        }),
    },
    ...(
      [
        ["scenarioName", 120],
        ["executionInstructions", 20_000],
        ["phaseName", 120],
        ["executionSummary", 20_000],
        ["failureDetail", 20_000],
      ] as const
    ).map(([field, max]) => ({
      label: `scenario result ${field}`,
      max,
      path: [field],
      parse: (value: string) =>
        scenarioResultSchema.safeParse({ ...scenarioResult, [field]: value }),
    })),
    {
      label: "run requested suite name",
      max: 120,
      path: [],
      parse: (name) => runSchema.shape.requestedSuiteName.safeParse(name),
    },
  ]

  it("accepts astral text at each exact UTF-16 limit, after trimming", () => {
    for (const { label, max, parse, trimmed } of cases) {
      expect(parse(units(max)).success, label).toBe(true)
      if (trimmed) {
        expect(parse(` ${units(max)}\t`).success, label).toBe(true)
      }
    }
  })

  it("rejects astral text one UTF-16 unit over each limit", () => {
    for (const { label, max, path, message, parse } of cases) {
      const parsed = parse(units(max + 1))
      expect(parsed.success, label).toBe(false)
      expect(parsed.error?.issues, label).toEqual([
        expect.objectContaining({
          code: "too_big",
          maximum: max,
          path,
          ...(message === undefined ? {} : { message }),
        }),
      ])
    }
  })

  it("keeps default messages and continues to later refinements", () => {
    expect(
      evaluationCheckSchema.safeParse({ ...check, name: units(121) }).error
        ?.issues[0]?.message
    ).toBe(
      z.string().max(120).safeParse("a".repeat(121)).error?.issues[0]?.message
    )

    const blocked = checkResultSchema.safeParse({
      checkId,
      verdict: "blocked",
      evidence: units(2_001),
    })
    expect(
      blocked.error && Object.keys(z.flattenError(blocked.error).fieldErrors)
    ).toEqual(["evidence", "blockedReason"])

    const project = projectInputSchema.safeParse({
      name: units(121),
      description: units(1_501),
      projectPrompt: units(12_001),
    })
    expect(project.error && z.flattenError(project.error)).toEqual({
      formErrors: [],
      fieldErrors: {
        name: [projectNameMessage],
        description: [descriptionMessage],
        projectPrompt: [promptMessage],
      },
    })
  })

  it("keeps PKCE challenge and verifier bounds at 43 to 128 UTF-16 units", () => {
    const redirectUri = "http://127.0.0.1:43123/callback"
    const pkce = [
      {
        field: "codeChallenge",
        parse: (codeChallenge: string) =>
          oauthAuthorizeRequestSchema.safeParse({
            clientId: "caracara-cli",
            redirectUri,
            state: "state",
            codeChallenge,
            codeChallengeMethod: "S256",
          }),
      },
      {
        field: "codeVerifier",
        parse: (codeVerifier: string) =>
          oauthTokenRequestSchema.safeParse({
            grantType: "authorization_code",
            clientId: "caracara-cli",
            code: "code",
            codeVerifier,
            redirectUri,
          }),
      },
    ]

    for (const { field, parse } of pkce) {
      // 21 emoji plus "a" is 43 units but only 22 code points.
      for (const value of [units(43), units(128), "a".repeat(43)]) {
        expect(parse(value).success, field).toBe(true)
      }
      expect(parse(units(42)).error?.issues, field).toEqual([
        expect.objectContaining({
          code: "too_small",
          minimum: 43,
          path: [field],
        }),
      ])
      expect(parse(units(129)).error?.issues, field).toEqual([
        expect.objectContaining({
          code: "too_big",
          maximum: 128,
          path: [field],
        }),
      ])
    }
  })

  it("only serves suite and project values that UTF-16 clients can parse", () => {
    const suite = suiteInputSchema.parse({
      name: ` ${units(120)} `,
      phaseIds: [],
    })
    const input = projectInputSchema.parse({
      name: units(120),
      description: units(1_500),
      projectPrompt: units(12_000),
    })
    const response = JSON.parse(
      JSON.stringify(
        plan({
          projectName: input.name,
          projectPrompt: input.projectPrompt,
          suiteName: suite.name,
        })
      )
    )

    const parsed = executionPlanResponseSchema.parse(response)
    expect(parsed.suite?.name.length).toBe(120)
    expect(parsed.project.name.length).toBe(120)
    expect(parsed.project.projectPrompt.length).toBe(12_000)
    // The reported case: 61 emoji are 122 units, over the 120-unit limit.
    expect(
      suiteInputSchema.safeParse({ name: "😀".repeat(61), phaseIds: [] })
        .success
    ).toBe(false)
  })
})

describe("fixture contracts", () => {
  const guid = (index: number) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`

  it("merges scenario and phase requirements with mutating access winning", () => {
    expect(
      mergeFixtureRequirements([
        { fixtureId: "b", access: "read", mutationScope: null },
        { fixtureId: "a", access: "read", mutationScope: "ignored" },
        { fixtureId: "b", access: "mutates", mutationScope: "Adds results." },
        { fixtureId: "b", access: "mutates", mutationScope: "Adds results." },
        { fixtureId: "a", access: "mutates", mutationScope: "Renames a slice." },
      ])
    ).toEqual([
      { fixtureId: "a", access: "mutates", mutationScope: "Renames a slice." },
      { fixtureId: "b", access: "mutates", mutationScope: "Adds results." },
    ])
    expect(
      mergeFixtureRequirements([
        { fixtureId: "a", access: "mutates", mutationScope: "One." },
        { fixtureId: "a", access: "mutates", mutationScope: "Two." },
      ])[0]?.mutationScope
    ).toBe("One.; Two.")
  })

  it("normalizes editor input and marks new entries with null IDs", () => {
    const parsed = fixtureInputSchema.parse({
      name: " Study ",
      slug: " ",
      description: "",
      locator: "",
      protection: "",
      resetInstructions: "  ",
      convergeSteps: [
        { id: null, name: "Create", instructions: "Create.", doneWhen: "Done." },
      ],
      healthChecks: [{ id: guid(1), name: "Animals", expectation: "9." }],
    })
    expect(parsed).toMatchObject({
      name: "Study",
      slug: undefined,
      resetInstructions: null,
    })
    expect(
      fixtureInputSchema.safeParse({
        ...parsed,
        convergeSteps: Array.from({ length: 21 }, () => parsed.convergeSteps[0]),
      }).success
    ).toBe(false)
  })

  it("requires exactly one requirement target", () => {
    const base = {
      id: "r",
      projectId: "p",
      fixtureId: "f",
      access: "read",
      mutationScope: null,
      createdAt: 1,
      updatedAt: 1,
    }
    expect(
      fixtureRequirementSchema.safeParse({ ...base, phaseId: "x", scenarioId: null })
        .success
    ).toBe(true)
    expect(
      fixtureRequirementSchema.safeParse({ ...base, phaseId: "x", scenarioId: "y" })
        .success
    ).toBe(false)
    expect(
      fixtureRequirementSchema.safeParse({ ...base, phaseId: null, scenarioId: null })
        .success
    ).toBe(false)
  })

  it("validates fixture authoring requests", () => {
    expect(
      authoringRequestSchema.parse({ operation: "createFixture", name: "Study" })
    ).toEqual({
      operation: "createFixture",
      name: "Study",
      description: "",
      locator: "",
      protection: "",
    })
    expect(
      authoringRequestSchema.parse({
        operation: "requireFixture",
        fixtureId: "f",
        phaseId: "p",
      })
    ).toMatchObject({ access: "read" })
    for (const invalid of [
      { operation: "updateFixture", fixtureId: "f" },
      { operation: "updateFixtureStep", fixtureId: "f", stepId: guid(1) },
      { operation: "updateFixtureCheck", fixtureId: "f", checkId: guid(1) },
      { operation: "requireFixture", fixtureId: "f" },
      { operation: "unrequireFixture", fixtureId: "f", phaseId: "p", scenarioId: "s" },
      { operation: "requireFixture", fixtureId: "f", phaseId: "p", access: "mutates" },
      {
        operation: "requireFixture",
        fixtureId: "f",
        phaseId: "p",
        access: "read",
        mutationScope: "Changes.",
      },
    ]) {
      expect(authoringRequestSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it("checks the run preflight shape", () => {
    const run = { mode: "all", runnerType: "codex", startedAt: 1 }
    expect(
      createRunRequestSchema.safeParse({
        ...run,
        fixturePreflight: [
          { fixtureId: "a", outcome: "healthy", operationId: "op" },
          { fixtureId: "b", outcome: "skipped", operationId: null },
        ],
      }).success
    ).toBe(true)
    for (const fixturePreflight of [
      [{ fixtureId: "a", outcome: "skipped", operationId: "op" }],
      [{ fixtureId: "a", outcome: "repaired", operationId: null }],
      [
        { fixtureId: "a", outcome: "skipped", operationId: null },
        { fixtureId: "a", outcome: "skipped", operationId: null },
      ],
    ]) {
      expect(
        createRunRequestSchema.safeParse({ ...run, fixturePreflight }).success
      ).toBe(false)
    }
  })

  it("keeps fixture fields optional in responses from older servers", () => {
    const scenario = {
      id: "s",
      name: "S",
      slug: "s",
      status: "active",
      instructions: "Do.",
      evaluationChecks: [],
      phaseId: null,
      phaseName: null,
      phaseOrder: null,
      dependencyIds: [],
    }
    const project = { id: "p", name: "P", slug: "p", projectPrompt: "" }
    const plan = executionPlanResponseSchema.parse({
      project,
      phases: [{ id: "ph", name: "Ph", order: 1, scenarios: [scenario] }],
      unassignedScenarioCount: 0,
    })
    expect(plan.fixtures).toEqual([])
    expect(plan.phases[0]?.scenarios[0]?.fixtureRequirements).toEqual([])
    expect(singleScenarioResponseSchema.parse({ project, scenario }).fixtures).toEqual(
      []
    )
  })

  it("parses fixture lists and operation requests", () => {
    const fixture = {
      id: "f",
      projectId: "p",
      name: "Study",
      slug: "study",
      description: "",
      locator: "",
      protection: "",
      convergeSteps: [
        { id: guid(1), name: "Create", instructions: "Create.", doneWhen: "Done." },
      ],
      healthChecks: [],
      resetInstructions: null,
      createdAt: 1,
      updatedAt: 1,
      requirements: [],
      health: [
        {
          environment: "preview",
          status: "healthy",
          operationId: "op",
          checkedAt: 2,
          busy: false,
        },
      ],
    }
    expect(fixtureListResponseSchema.parse({ fixtures: [fixture] }).fixtures).toHaveLength(1)
    expect(
      startFixtureOperationRequestSchema.parse({
        fixtureId: "f",
        kind: "converge",
        executor: "agent",
        environment: "preview",
        targetUrl: "https://preview.example.com",
        attemptId: guid(2),
        fixtureUpdatedAt: 2,
      }).targetUrl
    ).toBe("https://preview.example.com/")
    expect(
      startFixtureOperationRequestSchema.safeParse({
        fixtureId: "f",
        kind: "verify",
        executor: "hook",
        environment: "preview",
        targetUrl: "https://preview.example.com",
        attemptId: guid(2),
      }).success
    ).toBe(false)
    expect(
      finishFixtureOperationRequestSchema.safeParse({
        attemptId: guid(2),
        status: "failed",
        checkResults: [
          { checkId: guid(1), name: "Create", verdict: "not_observed", evidence: "?" },
        ],
        summary: null,
      }).success
    ).toBe(false)
  })
})
