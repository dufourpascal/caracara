import { z } from "zod"

import { API_VERSION, MIN_SUPPORTED_CLI_VERSION } from "./constants.js"
import {
  nullableStringSchema,
  phaseSchema,
  projectSchema,
  runModeSchema,
  runSchema,
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
    evaluationChecks: true,
    phaseId: true,
    phaseName: true,
    phaseOrder: true,
  })
  .extend({
    dependencyIds: z.array(z.string()),
  })

export const runnablePhaseSchema = phaseSchema
  .pick({
    id: true,
    name: true,
    order: true,
  })
  .extend({
    scenarios: z.array(orderedScenarioSchema),
  })

export const projectDetailResponseSchema = z.object({
  project: projectSchema,
})

export const phaseListResponseSchema = z.object({
  phases: z.array(phaseSchema),
})

export const executionPlanResponseSchema = z.object({
  project: projectSchema.pick({
    id: true,
    name: true,
    slug: true,
    projectPrompt: true,
  }),
  phases: z.array(runnablePhaseSchema),
  unassignedScenarioCount: z.number().int().nonnegative(),
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
  requestedPhaseOrder: z.number().int().positive().nullable().optional(),
  startedAt: z.number().int().positive(),
})

export const createRunResponseSchema = z.object({
  run: runSchema.pick({
    id: true,
    name: true,
    status: true,
    mode: true,
    runnerType: true,
    evidencePolicy: true,
    requestedScenarioSlug: true,
    requestedPhaseOrder: true,
    startedAt: true,
  }),
  evidenceUploadUrl: z.string().url().optional(),
})

export const runEvidenceUploadResponseSchema = z.object({
  evidence: z.object({
    id: z.string().min(1),
    checkId: z.string().uuid(),
    contentType: z.literal("image/webp"),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(3 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
})

export const startScenarioExecutionRequestSchema = z.object({
  runId: z.string().min(1),
  result: z.object({
    scenarioId: z.string().min(1),
    scenarioSlug: slugSchema,
    scenarioName: z.string().min(1).max(120),
    executionInstructions: z.string().min(1).max(20_000),
    evaluationChecks: scenarioSchema.shape.evaluationChecks.min(1),
    phaseId: z.string().nullable().optional(),
    phaseName: z.string().min(1).max(120).nullable().optional(),
    phaseOrder: z.number().int().positive().nullable().optional(),
    sequenceIndex: z.number().int().nonnegative(),
    runnerType: runnerTypeSchema,
    startedAt: z.number().int().positive(),
  }),
})

export const startScenarioExecutionResponseSchema = z.object({
  run: runSchema.pick({
    id: true,
    status: true,
    finishedAt: true,
    updatedAt: true,
  }),
  result: scenarioResultSchema,
})

export const submitScenarioResultRequestSchema = z.object({
  runId: z.string().min(1),
  result: z.object({
    scenarioId: z.string().min(1),
    status: z.enum([
      "completed",
      "runner_failed",
      "dependency_failed",
      "interrupted",
    ]),
    checkResults: scenarioResultSchema.shape.checkResults,
    executionSummary: nullableStringSchema,
    failureDetail: nullableStringSchema,
    finishedAt: z.number().int().positive(),
  }),
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
  status: z.enum(["completed", "failed", "interrupted"]),
  finishedAt: z.number().int().positive(),
})

export const finalizeRunResponseSchema = z.object({
  run: runSchema.pick({
    id: true,
    status: true,
    passedCheckCount: true,
    totalCheckCount: true,
    passRate: true,
    finishedAt: true,
    updatedAt: true,
  }),
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
export type RunnablePhase = z.infer<typeof runnablePhaseSchema>
export type RunEvidenceUploadResponse = z.infer<
  typeof runEvidenceUploadResponseSchema
>
