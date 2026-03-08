import { describe, expect, it } from "vitest"

import {
  API_VERSION,
  MIN_SUPPORTED_CLI_VERSION,
  authTokenResponseSchema,
  cliConfigSchema,
  createUniqueSlug,
  formatRunName,
  isCliVersionSupported,
  normalizeSlug,
  orderedActiveScenariosResponseSchema,
  projectSchema,
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

    const response = orderedActiveScenariosResponseSchema.parse({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        projectPrompt: project.projectPrompt,
      },
      scenarios: [
        {
          id: "scenario_signup",
          name: "Complete signup",
          slug: "complete-signup",
          status: "active",
          instructions: "Create a new account in the app.",
          scoringPrompt: "Return a score between 0 and 1.",
          dependencyIds: [],
        },
      ],
    })

    expect(response.project.slug).toBe("inbox-bot")
    expect(
      scenarioResultSchema.parse({
        id: "result_1",
        runId: "run_1",
        scenarioId: "scenario_signup",
        scenarioSlug: "complete-signup",
        scenarioName: "Complete signup",
        executionInstructions: "Create a new account in the app.",
        scoringPrompt: "Return a score between 0 and 1.",
        sequenceIndex: 0,
        status: "success",
        runnerType: "codex",
        score: 1,
        rationale: "Passed",
        executionSummary: "done",
        failureDetail: null,
        startedAt: 3,
        finishedAt: 4,
        submittedAt: 5,
      }).executionInstructions
    ).toBe("Create a new account in the app.")
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

  it("normalizes and deduplicates slugs", () => {
    expect(normalizeSlug("Crème brûlée 9000")).toBe("creme-brulee-9000")
    expect(
      createUniqueSlug("Hello world", ["hello-world", "hello-world-2"])
    ).toBe("hello-world-3")
  })

  it("formats run names with an adjective, animal, and timestamp suffix", () => {
    expect(formatRunName(new Date("2026-03-07T14:25:30Z"))).toMatch(
      /^[a-z]+-[a-z]+-20260307-142530$/
    )
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
  })
})
