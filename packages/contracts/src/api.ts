import { z } from "zod"

import { API_VERSION, MIN_SUPPORTED_CLI_VERSION } from "./constants.js"
import {
  evaluationCheckSchema,
  environmentNameSchema,
  nullableStringSchema,
  phaseSchema,
  projectSchema,
  runModeSchema,
  runSchema,
  runnerTypeSchema,
  scenarioResultSchema,
  scenarioSchema,
  slugSchema,
  suiteSchema,
  targetUrlSchema,
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

export const suiteListResponseSchema = z.object({
  suites: z.array(suiteSchema),
})

export const executionPlanResponseSchema = z.object({
  project: projectSchema.pick({
    id: true,
    name: true,
    slug: true,
    projectPrompt: true,
  }),
  phases: z.array(runnablePhaseSchema),
  suite: suiteSchema.pick({ name: true, slug: true }).nullable().optional(),
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

const addPhaseRequestSchema = z.object({
  operation: z.literal("addPhase"),
  name: z.string().trim().min(1).max(120),
})

const editPhaseRequestSchema = z.object({
  operation: z.literal("editPhase"),
  phaseId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
})

const removePhaseRequestSchema = z.object({
  operation: z.literal("removePhase"),
  phaseId: z.string().min(1),
})

const scenarioDependencyIdsSchema = z
  .array(z.string().min(1))
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Dependency IDs must be unique.",
  })

const createScenarioRequestSchema = z.object({
  operation: z.literal("createScenario"),
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  instructions: z.string().trim().min(1).max(20_000),
  phaseId: z.string().min(1).nullable().optional(),
  dependsOnScenarioIds: scenarioDependencyIdsSchema.default([]),
})

const updateScenarioRequestSchema = z.object({
  operation: z.literal("updateScenario"),
  scenarioId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugSchema.optional(),
  status: z.enum(["draft", "active"]).optional(),
  instructions: z.string().trim().min(1).max(20_000).optional(),
  phaseId: z.string().min(1).nullable().optional(),
  dependsOnScenarioIds: scenarioDependencyIdsSchema.optional(),
})

const addCheckRequestSchema = z.object({
  operation: z.literal("addCheck"),
  scenarioId: z.string().min(1),
  check: evaluationCheckSchema,
})

const removeCheckRequestSchema = z.object({
  operation: z.literal("removeCheck"),
  scenarioId: z.string().min(1),
  checkId: z.string().uuid(),
})

const updateCheckRequestSchema = z.object({
  operation: z.literal("updateCheck"),
  scenarioId: z.string().min(1),
  checkId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  expectation: z.string().trim().min(1).max(2_000).optional(),
})

export const authoringRequestSchema = z
  .discriminatedUnion("operation", [
    addPhaseRequestSchema,
    editPhaseRequestSchema,
    removePhaseRequestSchema,
    createScenarioRequestSchema,
    updateScenarioRequestSchema,
    addCheckRequestSchema,
    removeCheckRequestSchema,
    updateCheckRequestSchema,
  ])
  .superRefine((value, ctx) => {
    if (
      value.operation === "updateScenario" &&
      value.name === undefined &&
      value.slug === undefined &&
      value.status === undefined &&
      value.instructions === undefined &&
      value.phaseId === undefined &&
      value.dependsOnScenarioIds === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "updateScenario requires at least one change.",
      })
    }

    if (
      value.operation === "updateCheck" &&
      value.name === undefined &&
      value.expectation === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "updateCheck requires a name or expectation.",
      })
    }
  })

const phaseAuthoringResponseSchema = z.object({
  operation: z.enum(["addPhase", "editPhase"]),
  result: phaseSchema,
})

const removePhaseResponseSchema = z.object({
  operation: z.literal("removePhase"),
  result: z.object({
    deletedPhaseId: z.string().min(1),
    deletedPhaseName: z.string().min(1),
    unassignedScenarioCount: z.number().int().nonnegative(),
  }),
})

const scenarioAuthoringResponseSchema = z.object({
  operation: z.enum([
    "createScenario",
    "updateScenario",
    "addCheck",
    "removeCheck",
    "updateCheck",
  ]),
  result: scenarioSchema,
})

export const authoringResponseSchema = z.union([
  phaseAuthoringResponseSchema,
  removePhaseResponseSchema,
  scenarioAuthoringResponseSchema,
])

export const createRunRequestSchema = z
  .object({
    mode: runModeSchema,
    runnerType: runnerTypeSchema,
    environment: environmentNameSchema.optional(),
    targetUrl: targetUrlSchema.optional(),
    requestedScenarioSlug: slugSchema.nullable().optional(),
    requestedPhaseOrder: z.number().int().positive().nullable().optional(),
    requestedSuiteSlug: slugSchema.nullable().optional(),
    startedAt: z.number().int().positive(),
  })
  .refine(
    (value) =>
      (value.environment === undefined) === (value.targetUrl === undefined),
    {
      message: "Environment and target URL must be provided together.",
    }
  )
  .superRefine((value, ctx) => {
    const hasScenario = value.requestedScenarioSlug != null
    const hasPhase = value.requestedPhaseOrder != null
    const hasSuite = value.requestedSuiteSlug != null
    const isValid =
      (value.mode === "all" && !hasScenario && !hasPhase && !hasSuite) ||
      (value.mode === "single" && hasScenario && !hasPhase && !hasSuite) ||
      ((value.mode === "phase" || value.mode === "through_phase") &&
        !hasScenario &&
        hasPhase &&
        !hasSuite) ||
      (value.mode === "suite" && !hasScenario && !hasPhase && hasSuite)

    if (!isValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Run mode and requested target do not match.",
      })
    }
  })

export const createRunResponseSchema = z.object({
  run: runSchema.pick({
    id: true,
    name: true,
    status: true,
    mode: true,
    runnerType: true,
    evidencePolicy: true,
    environment: true,
    targetUrl: true,
    requestedScenarioSlug: true,
    requestedPhaseOrder: true,
    requestedSuiteSlug: true,
    requestedSuiteName: true,
    requestedSuitePhases: true,
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
    executionAttemptId: z.string().uuid().optional(),
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
    executionAttemptId: z.string().uuid().optional(),
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
  finalizationAttemptId: z.string().uuid().optional(),
  interruptedScenarioResultId: z.string().min(1).optional(),
  interruptedScenarioAttemptId: z.string().uuid().optional(),
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
export type AuthoringRequest = z.infer<typeof authoringRequestSchema>
export type AuthoringResponse = z.infer<typeof authoringResponseSchema>
export type OrderedScenario = z.infer<typeof orderedScenarioSchema>
export type RunnablePhase = z.infer<typeof runnablePhaseSchema>
export type RunEvidenceUploadResponse = z.infer<
  typeof runEvidenceUploadResponseSchema
>
