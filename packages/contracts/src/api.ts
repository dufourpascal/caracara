import { z } from "zod"

import { API_VERSION, MIN_SUPPORTED_CLI_VERSION } from "./constants.js"
import {
  projectSchema,
  runModeSchema,
  runSchema,
  runStatusSchema,
  runnerTypeSchema,
  scenarioResultSchema,
  scenarioSchema,
  slugSchema,
} from "./domain.js"

export const apiErrorCodeSchema = z.enum([
  "unauthenticated",
  "unauthorized",
  "not_found",
  "validation_error",
  "version_mismatch",
  "conflict",
  "internal_error",
])

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const authTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresAt: z.number().int().positive(),
})

export const oauthAuthorizeRequestSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  state: z.string().min(1),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.literal("S256"),
})

export const oauthTokenRequestSchema = z.object({
  grantType: z.literal("authorization_code"),
  clientId: z.string().min(1),
  code: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.string().url(),
})

export const cliConfigSchema = z.object({
  apiBaseUrl: z.string().url(),
  accessToken: z.string().min(1).nullable(),
  expiresAt: z.number().int().positive().nullable(),
  selectedProjectSlug: slugSchema.nullable(),
  userEmail: z.string().email().nullable(),
})

export const projectSummarySchema = projectSchema.pick({
  id: true,
  name: true,
  slug: true,
  description: true,
  updatedAt: true,
})

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
})

export const orderedScenarioSchema = scenarioSchema
  .pick({
    id: true,
    name: true,
    slug: true,
    status: true,
    instructions: true,
    scoringPrompt: true,
  })
  .extend({
    dependencyIds: z.array(z.string()),
  })

export const projectDetailResponseSchema = z.object({
  project: projectSchema,
})

export const orderedActiveScenariosResponseSchema = z.object({
  project: projectSchema.pick({
    id: true,
    name: true,
    slug: true,
    projectPrompt: true,
  }),
  scenarios: z.array(orderedScenarioSchema),
})

export const singleScenarioResponseSchema = z.object({
  project: projectSchema.pick({
    id: true,
    name: true,
    slug: true,
    projectPrompt: true,
  }),
  scenario: orderedScenarioSchema,
})

export const createRunRequestSchema = z.object({
  mode: runModeSchema,
  runnerType: runnerTypeSchema,
  requestedScenarioSlug: slugSchema.nullable().optional(),
  startedAt: z.number().int().positive(),
})

export const createRunResponseSchema = z.object({
  run: runSchema.pick({
    id: true,
    name: true,
    status: true,
    mode: true,
    runnerType: true,
    requestedScenarioSlug: true,
    startedAt: true,
  }),
})

export const submitScenarioResultRequestSchema = z.object({
  runId: z.string().min(1),
  result: scenarioResultSchema.pick({
    scenarioId: true,
    scenarioSlug: true,
    scenarioName: true,
    executionInstructions: true,
    scoringPrompt: true,
    sequenceIndex: true,
    status: true,
    runnerType: true,
    score: true,
    rationale: true,
    rawOutput: true,
    failureDetail: true,
    startedAt: true,
    finishedAt: true,
  }),
  runStatus: runStatusSchema.optional(),
})

export const submitScenarioResultResponseSchema = z.object({
  run: runSchema.pick({
    id: true,
    status: true,
    finishedAt: true,
    updatedAt: true,
  }),
  result: scenarioResultSchema,
})

export const finalizeRunRequestSchema = z.object({
  status: runStatusSchema,
  finishedAt: z.number().int().positive(),
})

export const versionMismatchDetailsSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  minimumSupportedCliVersion: z.literal(MIN_SUPPORTED_CLI_VERSION),
})

export const versionMismatchErrorSchema = apiErrorSchema.extend({
  code: z.literal("version_mismatch"),
  details: versionMismatchDetailsSchema,
})

export const whoAmIResponseSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().nullable(),
})

export function parseApiError(input: unknown) {
  return apiErrorSchema.safeParse(input)
}

export type ApiError = z.infer<typeof apiErrorSchema>
export type CliConfig = z.infer<typeof cliConfigSchema>
export type ProjectSummary = z.infer<typeof projectSummarySchema>
export type OrderedScenario = z.infer<typeof orderedScenarioSchema>
