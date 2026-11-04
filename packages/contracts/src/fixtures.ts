import { z } from "zod"

import {
  checkVerdictSchema,
  environmentNameSchema,
  evaluationCheckSchema,
  slugSchema,
  targetUrlSchema,
  timestampSchema,
  fixtureAccessSchema,
} from "./domain.js"
import { maxUtf16Length } from "./string-length.js"

export const FIXTURE_DESCRIPTION_MAX_LENGTH = 1_500
export const FIXTURE_LOCATOR_MAX_LENGTH = 2_000
export const FIXTURE_PROTECTION_MAX_LENGTH = 4_000
export const FIXTURE_INSTRUCTIONS_MAX_LENGTH = 20_000
export const FIXTURE_DONE_WHEN_MAX_LENGTH = 2_000
export const FIXTURE_MUTATION_SCOPE_MAX_LENGTH = 500
export const FIXTURE_OPERATION_SUMMARY_MAX_LENGTH = 4_000
export const FIXTURE_MAX_STEPS = 20
export const FIXTURE_MAX_HEALTH_CHECKS = 20
/** A running fixture operation holds its fixture and environment for at most this long. */
export const FIXTURE_OPERATION_LEASE_MS = 4 * 60 * 60 * 1000
/** A verify operation can satisfy a run preflight for at most this long after it finished. */
export const FIXTURE_PREFLIGHT_MAX_AGE_MS = 6 * 60 * 60 * 1000

export const fixtureNameSchema = z
  .string()
  .trim()
  .min(1, "Fixture name is required.")
  .check(maxUtf16Length(120, "Fixture name must be 120 characters or fewer."))
export const fixtureDescriptionSchema = z
  .string()
  .check(maxUtf16Length(FIXTURE_DESCRIPTION_MAX_LENGTH))
export const fixtureLocatorSchema = z
  .string()
  .check(maxUtf16Length(FIXTURE_LOCATOR_MAX_LENGTH))
export const fixtureProtectionSchema = z
  .string()
  .check(maxUtf16Length(FIXTURE_PROTECTION_MAX_LENGTH))
export const fixtureInstructionsSchema = z
  .string()
  .trim()
  .min(1)
  .check(maxUtf16Length(FIXTURE_INSTRUCTIONS_MAX_LENGTH))
export const fixtureDoneWhenSchema = z
  .string()
  .trim()
  .min(1)
  .check(maxUtf16Length(FIXTURE_DONE_WHEN_MAX_LENGTH))
export const fixtureMutationScopeSchema = z
  .string()
  .trim()
  .min(1)
  .check(maxUtf16Length(FIXTURE_MUTATION_SCOPE_MAX_LENGTH))

/** One ordered, idempotent converge step run by an agent when no converge hook is configured. */
export const fixtureStepSchema = z.object({
  id: z.guid(),
  name: z.string().trim().min(1).check(maxUtf16Length(120)),
  instructions: fixtureInstructionsSchema,
  doneWhen: fixtureDoneWhenSchema,
})

export const fixtureSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: fixtureNameSchema,
  slug: slugSchema,
  description: fixtureDescriptionSchema,
  locator: fixtureLocatorSchema,
  protection: fixtureProtectionSchema,
  convergeSteps: z.array(fixtureStepSchema).max(FIXTURE_MAX_STEPS),
  healthChecks: z.array(evaluationCheckSchema).max(FIXTURE_MAX_HEALTH_CHECKS),
  resetInstructions: fixtureInstructionsSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

/** Web editor input. Entries with `id: null` are new; the server assigns their IDs. */
export const fixtureInputSchema = z.object({
  name: fixtureNameSchema,
  slug: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().check(maxUtf16Length(120)).optional()
  ),
  description: fixtureDescriptionSchema,
  locator: fixtureLocatorSchema,
  protection: fixtureProtectionSchema,
  convergeSteps: z
    .array(
      fixtureStepSchema.extend({
        id: z.guid().nullable(),
      })
    )
    .max(FIXTURE_MAX_STEPS),
  healthChecks: z
    .array(
      evaluationCheckSchema.extend({
        id: z.guid().nullable(),
      })
    )
    .max(FIXTURE_MAX_HEALTH_CHECKS),
  resetInstructions: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    fixtureInstructionsSchema.nullable()
  ),
})

export const fixtureRequirementSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    fixtureId: z.string(),
    phaseId: z.string().nullable(),
    scenarioId: z.string().nullable(),
    access: fixtureAccessSchema,
    mutationScope: fixtureMutationScopeSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .refine((value) => (value.phaseId === null) !== (value.scenarioId === null), {
    error: "A fixture requirement targets exactly one phase or scenario.",
  })

/** The fixture a scenario needs once its own and its phase's requirements are merged. */
export const effectiveFixtureRequirementSchema = z.object({
  fixtureId: z.string(),
  access: fixtureAccessSchema,
  /** Scopes of every mutating requirement, joined with "; ". */
  mutationScope: z.string().min(1).check(maxUtf16Length(4_000)).nullable(),
})

export const fixtureOperationKindSchema = z.enum(["verify", "converge", "reset"])
export const fixtureExecutorSchema = z.enum(["hook", "agent"])
export const fixtureOperationStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "interrupted",
])
export const fixtureHealthStatusSchema = z.enum([
  "healthy",
  "unhealthy",
  "unknown",
])

export const fixtureOperationCheckResultSchema = z.object({
  checkId: z.string().min(1),
  name: z.string().min(1).check(maxUtf16Length(120)),
  verdict: checkVerdictSchema.exclude(["not_observed"]),
  evidence: z.string().min(1).check(maxUtf16Length(2_000)),
})

export const fixtureOperationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  fixtureId: z.string().nullable(),
  fixtureSlug: slugSchema,
  fixtureName: fixtureNameSchema,
  environment: environmentNameSchema,
  targetUrl: targetUrlSchema,
  runId: z.string().nullable(),
  kind: fixtureOperationKindSchema,
  executor: fixtureExecutorSchema,
  status: fixtureOperationStatusSchema,
  checkResults: z.array(fixtureOperationCheckResultSchema).max(40),
  summary: z
    .string()
    .check(maxUtf16Length(FIXTURE_OPERATION_SUMMARY_MAX_LENGTH))
    .nullable(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  leaseExpiresAt: timestampSchema,
})

export const fixtureEnvironmentHealthSchema = z.object({
  environment: environmentNameSchema,
  status: fixtureHealthStatusSchema,
  /** The latest finished operation that decided the status. */
  operationId: z.string().nullable(),
  checkedAt: timestampSchema.nullable(),
  /** True while an operation for this fixture and environment is running. */
  busy: z.boolean(),
})

export const fixtureDetailSchema = fixtureSchema.extend({
  requirements: z.array(fixtureRequirementSchema),
  health: z.array(fixtureEnvironmentHealthSchema),
})

export const fixtureListResponseSchema = z.object({
  fixtures: z.array(fixtureDetailSchema),
})

export const startFixtureOperationRequestSchema = z.object({
  fixtureId: z.string().min(1),
  kind: fixtureOperationKindSchema,
  executor: fixtureExecutorSchema,
  environment: environmentNameSchema,
  targetUrl: targetUrlSchema,
  runId: z.string().min(1).nullable().optional(),
  attemptId: z.guid(),
  /**
   * The `updatedAt` of the fixture definition the client will execute. The
   * server rejects the start if the fixture changed since, and preflight only
   * accepts verifies whose version matches the current definition.
   */
  fixtureUpdatedAt: timestampSchema.optional(),
  /** Recovery after a lost start response: create or mark the attempt interrupted. */
  interruptedAt: z.number().int().positive().optional(),
})

export const fixtureOperationResponseSchema = z.object({
  operation: fixtureOperationSchema,
})

export const finishFixtureOperationRequestSchema = z.object({
  attemptId: z.guid(),
  status: fixtureOperationStatusSchema.exclude(["running"]),
  checkResults: z.array(fixtureOperationCheckResultSchema).max(40),
  summary: z
    .string()
    .check(maxUtf16Length(FIXTURE_OPERATION_SUMMARY_MAX_LENGTH))
    .nullable(),
})

export type Fixture = z.infer<typeof fixtureSchema>
export type FixtureInput = z.infer<typeof fixtureInputSchema>
export type FixtureStep = z.infer<typeof fixtureStepSchema>
export type FixtureRequirement = z.infer<typeof fixtureRequirementSchema>
export type EffectiveFixtureRequirement = z.infer<
  typeof effectiveFixtureRequirementSchema
>
export type FixtureOperation = z.infer<typeof fixtureOperationSchema>
export type FixtureOperationKind = z.infer<typeof fixtureOperationKindSchema>
export type FixtureExecutor = z.infer<typeof fixtureExecutorSchema>
export type FixtureOperationStatus = z.infer<
  typeof fixtureOperationStatusSchema
>
export type FixtureOperationCheckResult = z.infer<
  typeof fixtureOperationCheckResultSchema
>
export type FixtureHealthStatus = z.infer<typeof fixtureHealthStatusSchema>
export type FixtureEnvironmentHealth = z.infer<
  typeof fixtureEnvironmentHealthSchema
>
export type FixtureDetail = z.infer<typeof fixtureDetailSchema>
export type StartFixtureOperationRequest = z.infer<
  typeof startFixtureOperationRequestSchema
>
export type FinishFixtureOperationRequest = z.infer<
  typeof finishFixtureOperationRequestSchema
>

/**
 * Merges a scenario's own fixture requirements with its phase's. Mutating access
 * wins over read access, and the mutation scopes of both are kept.
 */
export function mergeFixtureRequirements(
  requirements: Array<{
    fixtureId: string
    access: "read" | "mutates"
    mutationScope: string | null
  }>
): EffectiveFixtureRequirement[] {
  const merged = new Map<string, EffectiveFixtureRequirement>()
  for (const requirement of requirements) {
    const current = merged.get(requirement.fixtureId)
    if (!current) {
      merged.set(requirement.fixtureId, {
        fixtureId: requirement.fixtureId,
        access: requirement.access,
        mutationScope:
          requirement.access === "mutates" ? requirement.mutationScope : null,
      })
      continue
    }
    if (requirement.access === "mutates") {
      const scopes = [current.mutationScope, requirement.mutationScope].filter(
        (scope): scope is string => Boolean(scope)
      )
      current.access = "mutates"
      current.mutationScope =
        scopes.length > 0 ? [...new Set(scopes)].join("; ") : null
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.fixtureId.localeCompare(right.fixtureId)
  )
}
