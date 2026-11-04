import { z } from "zod"

import { API_VERSION, MIN_SUPPORTED_CLI_VERSION } from "./constants.js"
import {
  evaluationCheckSchema,
  environmentNameSchema,
  fixtureAccessSchema,
  fixturePreflightEntrySchema,
  fixtureSchema,
  fixtureStepSchema,
  nullableStringSchema,
  phaseSchema,
  projectSchema,
  requestedPhaseOrdersSchema,
  runModeSchema,
  runModelSchema,
  runReasoningEffortSchema,
  runSchema,
  runnerTypeSchema,
  scenarioResultSchema,
  scenarioSchema,
  slugSchema,
  suiteSchema,
  targetUrlSchema,
  tokenUsageSchema,
} from "./domain.js"
import { maxUtf16Length, minUtf16Length } from "./string-length.js"

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
  redirectUri: z.url(),
  state: z.string().min(1),
  codeChallenge: z.string().check(minUtf16Length(43), maxUtf16Length(128)),
  codeChallengeMethod: z.literal("S256"),
})

export const oauthTokenRequestSchema = z.object({
  grantType: z.literal("authorization_code"),
  clientId: z.string().min(1),
  code: z.string().min(1),
  codeVerifier: z.string().check(minUtf16Length(43), maxUtf16Length(128)),
  redirectUri: z.url(),
})

export const cliConfigSchema = z.object({
  apiBaseUrl: z.url(),
  accessToken: z.string().min(1).nullable(),
  expiresAt: z.number().int().positive().nullable(),
  selectedProjectSlug: slugSchema.nullable(),
  userEmail: z.email().nullable(),
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
    /** The scenario's own and its phase's fixture requirements, merged. */
    fixtureRequirements: z
      .array(
        z.object({
          fixtureId: z.string().min(1),
          access: fixtureAccessSchema,
          mutationScope: z.string().min(1).nullable(),
        })
      )
      .default([]),
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
  /** Definitions of the fixtures the plan's scenarios require. */
  fixtures: z.array(fixtureSchema).default([]),
})

export const singleScenarioResponseSchema = z.object({
  project: projectSchema.pick({
    id: true,
    name: true,
    slug: true,
    projectPrompt: true,
  }),
  scenario: orderedScenarioSchema,
  fixtures: z.array(fixtureSchema).default([]),
})

export const fixtureListResponseSchema = z.object({
  fixtures: z.array(fixtureSchema),
})

const addPhaseRequestSchema = z.object({
  operation: z.literal("addPhase"),
  name: z.string().trim().min(1).check(maxUtf16Length(120)),
})

const editPhaseRequestSchema = z.object({
  operation: z.literal("editPhase"),
  phaseId: z.string().min(1),
  name: z.string().trim().min(1).check(maxUtf16Length(120)),
})

const removePhaseRequestSchema = z.object({
  operation: z.literal("removePhase"),
  phaseId: z.string().min(1),
})

const scenarioDependencyIdsSchema = z
  .array(z.string().min(1))
  .refine((ids) => new Set(ids).size === ids.length, {
    error: "Dependency IDs must be unique.",
  })

const createScenarioRequestSchema = z.object({
  operation: z.literal("createScenario"),
  name: z.string().trim().min(1).check(maxUtf16Length(120)),
  slug: slugSchema.optional(),
  instructions: z.string().trim().min(1).check(maxUtf16Length(20_000)),
  phaseId: z.string().min(1).nullable().optional(),
  dependsOnScenarioIds: scenarioDependencyIdsSchema.default([]),
})

const updateScenarioRequestSchema = z.object({
  operation: z.literal("updateScenario"),
  scenarioId: z.string().min(1),
  name: z.string().trim().min(1).check(maxUtf16Length(120)).optional(),
  slug: slugSchema.optional(),
  status: z.enum(["draft", "active"]).optional(),
  instructions: z
    .string()
    .trim()
    .min(1)
    .check(maxUtf16Length(20_000))
    .optional(),
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
  checkId: z.guid(),
})

const updateCheckRequestSchema = z.object({
  operation: z.literal("updateCheck"),
  scenarioId: z.string().min(1),
  checkId: z.guid(),
  name: z.string().trim().min(1).check(maxUtf16Length(120)).optional(),
  expectation: z.string().trim().min(1).check(maxUtf16Length(2_000)).optional(),
})

/** Steps and checks from authoring may omit IDs; the server assigns them. */
const fixtureStepInputSchema = fixtureStepSchema.extend({
  id: z.guid().optional(),
})
const fixtureCheckInputSchema = evaluationCheckSchema.extend({
  id: z.guid().optional(),
})
const fixtureFieldsSchema = z.object({
  name: z.string().trim().min(1).check(maxUtf16Length(120)),
  slug: slugSchema,
  description: z.string().check(maxUtf16Length(1_500)),
  locator: z.string().check(maxUtf16Length(2_000)),
  protection: z.string().check(maxUtf16Length(4_000)),
  convergeSteps: z.array(fixtureStepInputSchema).max(20),
  healthChecks: z.array(fixtureCheckInputSchema).max(20),
})

const createFixtureRequestSchema = fixtureFieldsSchema
  .partial()
  .required({ name: true })
  .extend({ operation: z.literal("createFixture") })

const updateFixtureRequestSchema = fixtureFieldsSchema.partial().extend({
  operation: z.literal("updateFixture"),
  fixtureId: z.string().min(1),
})

const fixtureTargetSchema = z.object({
  fixtureId: z.string().min(1),
  phaseId: z.string().min(1).optional(),
  scenarioId: z.string().min(1).optional(),
})

const requireFixtureRequestSchema = fixtureTargetSchema.extend({
  operation: z.literal("requireFixture"),
  access: fixtureAccessSchema.default("read"),
  mutationScope: z.string().trim().min(1).check(maxUtf16Length(500)).optional(),
})

const unrequireFixtureRequestSchema = fixtureTargetSchema.extend({
  operation: z.literal("unrequireFixture"),
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
    createFixtureRequestSchema,
    updateFixtureRequestSchema,
    requireFixtureRequestSchema,
    unrequireFixtureRequestSchema,
  ])
  .superRefine((value, ctx) => {
    if (
      (value.operation === "requireFixture" ||
        value.operation === "unrequireFixture") &&
      (value.phaseId === undefined) === (value.scenarioId === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Name exactly one phase or scenario.",
      })
    }
    if (
      value.operation === "requireFixture" &&
      (value.access === "mutates") !== (value.mutationScope !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A mutating requirement needs a scope; a read one has none.",
        path: ["mutationScope"],
      })
    }

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
        code: "custom",
        message: "updateScenario requires at least one change.",
      })
    }

    if (
      value.operation === "updateCheck" &&
      value.name === undefined &&
      value.expectation === undefined
    ) {
      ctx.addIssue({
        code: "custom",
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

const fixtureAuthoringResponseSchema = z.object({
  operation: z.enum([
    "createFixture",
    "updateFixture",
    "requireFixture",
    "unrequireFixture",
  ]),
  result: fixtureSchema,
})

export const authoringResponseSchema = z.union([
  phaseAuthoringResponseSchema,
  removePhaseResponseSchema,
  scenarioAuthoringResponseSchema,
  fixtureAuthoringResponseSchema,
])

export const createRunRequestSchema = z
  .object({
    mode: runModeSchema,
    runnerType: runnerTypeSchema,
    environment: environmentNameSchema.optional(),
    targetUrl: targetUrlSchema.optional(),
    model: runModelSchema.optional(),
    reasoningEffort: runReasoningEffortSchema.optional(),
    requestedScenarioSlug: slugSchema.nullable().optional(),
    requestedPhaseOrder: z.number().int().positive().nullable().optional(),
    requestedPhaseOrders: requestedPhaseOrdersSchema.nullable().optional(),
    requestedSuiteSlug: slugSchema.nullable().optional(),
    startedAt: z.number().int().positive(),
    creationAttemptId: z.guid().optional(),
    interruptedAt: z.number().int().positive().optional(),
    fixturePreflight: z.array(fixturePreflightEntrySchema).max(100).optional(),
  })
  .refine(
    (value) =>
      (value.environment === undefined) === (value.targetUrl === undefined),
    {
      error: "Environment and target URL must be provided together.",
    }
  )
  .superRefine((value, ctx) => {
    if (
      value.runnerType !== "codex" &&
      (value.model !== undefined || value.reasoningEffort !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Model settings are only supported for Codex runs.",
        path: ["model"],
      })
    }
    if (
      value.interruptedAt !== undefined &&
      value.creationAttemptId === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Interrupted run creation requires a creation attempt ID.",
        path: ["creationAttemptId"],
      })
    }
    const hasScenario = value.requestedScenarioSlug != null
    const hasPhase = value.requestedPhaseOrder != null
    const hasPhases = value.requestedPhaseOrders != null
    const hasSuite = value.requestedSuiteSlug != null
    const targetCount = [hasScenario, hasPhase, hasPhases, hasSuite].filter(
      Boolean
    ).length
    const hasModeTarget = {
      all: true,
      single: hasScenario,
      phase: hasPhase,
      through_phase: hasPhase,
      suite: hasSuite,
      phases: hasPhases,
    }[value.mode]
    const isValid =
      hasModeTarget && targetCount === (value.mode === "all" ? 0 : 1)

    if (!isValid) {
      ctx.addIssue({
        code: "custom",
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
    model: true,
    reasoningEffort: true,
    requestedScenarioSlug: true,
    requestedPhaseOrder: true,
    requestedPhaseOrders: true,
    requestedSuiteSlug: true,
    requestedSuiteName: true,
    requestedSuitePhases: true,
    fixturePreflight: true,
    startedAt: true,
  }),
  evidenceUploadUrl: z.url().optional(),
})

export const runEvidenceUploadResponseSchema = z.object({
  evidence: z.object({
    id: z.string().min(1),
    checkId: z.guid(),
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
    scenarioName: z.string().min(1).check(maxUtf16Length(120)),
    executionInstructions: z.string().min(1).check(maxUtf16Length(20_000)),
    evaluationChecks: scenarioSchema.shape.evaluationChecks.min(1),
    phaseId: z.string().nullable().optional(),
    phaseName: z
      .string()
      .min(1)
      .check(maxUtf16Length(120))
      .nullable()
      .optional(),
    phaseOrder: z.number().int().positive().nullable().optional(),
    sequenceIndex: z.number().int().nonnegative(),
    runnerType: runnerTypeSchema,
    startedAt: z.number().int().positive(),
    executionAttemptId: z.guid().optional(),
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
    executionAttemptId: z.guid().optional(),
    tokenUsage: tokenUsageSchema.optional(),
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
  finalizationAttemptId: z.guid().optional(),
  interruptedScenarioResultId: z.string().min(1).optional(),
  interruptedScenarioAttemptId: z.guid().optional(),
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

/** Run reference accepted by `GET /runs/:runRef`: run ID, run name or "latest". */
export const LATEST_RUN_REFERENCE = "latest"

export const runResultsResponseSchema = z.object({
  run: runSchema.omit({ ownerUserId: true }),
  results: z.array(scenarioResultSchema.omit({ executionInstructions: true })),
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
  email: z.email().nullable(),
})

export function parseApiError(input: unknown) {
  return apiErrorSchema.safeParse(input)
}

export type ApiError = z.infer<typeof apiErrorSchema>
export type CliConfig = z.infer<typeof cliConfigSchema>
export type ProjectSummary = z.infer<typeof projectSummarySchema>
export type AuthoringRequest = z.infer<typeof authoringRequestSchema>
export type AuthoringResponse = z.infer<typeof authoringResponseSchema>
export type FixtureListResponse = z.infer<typeof fixtureListResponseSchema>
export type EffectiveFixtureRequirement = OrderedScenario["fixtureRequirements"][number]
export type OrderedScenario = z.infer<typeof orderedScenarioSchema>
export type RunnablePhase = z.infer<typeof runnablePhaseSchema>
export type RunEvidenceUploadResponse = z.infer<
  typeof runEvidenceUploadResponseSchema
>
export type RunResultsResponse = z.infer<typeof runResultsResponseSchema>
