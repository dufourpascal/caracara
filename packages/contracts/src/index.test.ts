import { describe, expect, it } from "vitest"
import { z, ZodError } from "zod"

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
  createUniqueSlug,
  formatRunName,
  isCliVersionSupported,
  normalizeSlug,
  oauthAuthorizeRequestSchema,
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
