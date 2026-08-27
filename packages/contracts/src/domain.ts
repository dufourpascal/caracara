import { z } from "zod"

import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_PROMPT_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from "./constants.js"

export const scenarioStatusSchema = z.enum(["draft", "active"])
export const runStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "interrupted",
])
export const scenarioResultStatusSchema = z.enum([
  "running",
  "completed",
  "runner_failed",
  "dependency_failed",
  "interrupted",
])
export const runnerTypeSchema = z.enum(["codex", "claude-code"])
export const runModeSchema = z.enum([
  "all",
  "single",
  "phase",
  "through_phase",
  "suite",
])
export const evidencePolicySchema = z.enum([
  "text_only",
  "failed_check_screenshot",
])

export const timestampSchema = z.number().int().nonnegative()
export const slugSchema = z
  .string()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const environmentNameSchema = slugSchema
export const targetUrlSchema = z
  .string()
  .superRefine((value, ctx) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target URL must be a valid URL.",
      })
      return
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target URL must use HTTP or HTTPS.",
      })
    }
    if (url.username !== "" || url.password !== "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target URL must not contain credentials.",
      })
    }
  })
  .transform((value) => new URL(value).toString())
export const runEnvironmentSchema = z.object({
  environment: environmentNameSchema,
  targetUrl: targetUrlSchema,
})
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Project name is required.")
  .max(PROJECT_NAME_MAX_LENGTH, "Project name must be 120 characters or fewer.")
export const projectDescriptionSchema = z
  .string()
  .max(
    PROJECT_DESCRIPTION_MAX_LENGTH,
    "Description must be 1,500 characters or fewer."
  )
export const projectPromptSchema = z
  .string()
  .max(
    PROJECT_PROMPT_MAX_LENGTH,
    "Project prompt must be 12,000 characters or fewer."
  )
export const projectInputSchema = z.object({
  name: projectNameSchema,
  slug: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .trim()
      .max(SLUG_MAX_LENGTH, "Slug must be 120 characters or fewer.")
      .optional()
  ),
  description: projectDescriptionSchema,
  projectPrompt: projectPromptSchema,
})
export const nullableStringSchema = z.string().max(20_000).nullable()
export const evaluationCheckSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  expectation: z.string().min(1).max(2_000),
})
export const checkVerdictSchema = z.enum(["passed", "failed", "not_observed"])
export const checkResultSchema = z.object({
  checkId: z.string().uuid(),
  verdict: checkVerdictSchema,
  evidence: z.string().min(1).max(2_000),
})

export const projectSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().min(1),
  name: projectNameSchema,
  slug: slugSchema,
  description: projectDescriptionSchema,
  projectPrompt: projectPromptSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const phaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(120),
  order: z.number().int().positive(),
  scenarioCount: z.number().int().nonnegative().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const suiteInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Suite name is required.")
    .max(120, "Suite name must be 120 characters or fewer."),
  slug: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .trim()
      .max(SLUG_MAX_LENGTH, "Slug must be 120 characters or fewer.")
      .optional()
  ),
  phaseIds: z
    .array(z.string().min(1))
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Suite phase IDs must be unique.",
    }),
})

export const suiteSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  phaseIds: z.array(z.string()),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const suitePhaseSnapshotSchema = phaseSchema.pick({
  id: true,
  name: true,
  order: true,
})

export const scenarioSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  status: scenarioStatusSchema,
  instructions: z.string().min(1).max(20_000),
  evaluationChecks: z.array(evaluationCheckSchema).max(20),
  phaseId: z.string().nullable().optional(),
  phaseName: z.string().min(1).max(120).nullable().optional(),
  phaseOrder: z.number().int().positive().nullable().optional(),
  updatedAt: timestampSchema,
})

export const scenarioDependencySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  scenarioId: z.string(),
  dependsOnScenarioId: z.string(),
  createdAt: timestampSchema,
})

export const runSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  ownerUserId: z.string().min(1),
  name: slugSchema,
  status: runStatusSchema,
  mode: runModeSchema,
  requestedScenarioSlug: slugSchema.nullable(),
  requestedPhaseOrder: z.number().int().positive().nullable().optional(),
  requestedSuiteSlug: slugSchema.nullable().optional(),
  requestedSuiteName: z.string().min(1).max(120).nullable().optional(),
  requestedSuitePhases: z.array(suitePhaseSnapshotSchema).optional(),
  runnerType: runnerTypeSchema.nullable(),
  evidencePolicy: evidencePolicySchema,
  environment: environmentNameSchema.nullable().optional(),
  targetUrl: targetUrlSchema.nullable().optional(),
  passedCheckCount: z.number().int().nonnegative(),
  totalCheckCount: z.number().int().nonnegative(),
  passRate: z.number().int().min(0).max(100).nullable(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const scenarioResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  scenarioId: z.string().min(1),
  scenarioSlug: slugSchema,
  scenarioName: z.string().min(1).max(120),
  executionInstructions: z.string().min(1).max(20_000),
  evaluationChecks: z.array(evaluationCheckSchema).max(20),
  checkResults: z.array(checkResultSchema).max(20),
  phaseId: z.string().nullable().optional(),
  phaseName: z.string().min(1).max(120).nullable().optional(),
  phaseOrder: z.number().int().positive().nullable().optional(),
  sequenceIndex: z.number().int().nonnegative(),
  status: scenarioResultStatusSchema,
  runnerType: runnerTypeSchema,
  executionSummary: nullableStringSchema,
  failureDetail: nullableStringSchema,
  startedAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  submittedAt: timestampSchema,
})

export type ScenarioStatus = z.infer<typeof scenarioStatusSchema>
export type RunStatus = z.infer<typeof runStatusSchema>
export type ScenarioResultStatus = z.infer<typeof scenarioResultStatusSchema>
export type EvaluationCheck = z.infer<typeof evaluationCheckSchema>
export type CheckVerdict = z.infer<typeof checkVerdictSchema>
export type CheckResult = z.infer<typeof checkResultSchema>
export type RunnerType = z.infer<typeof runnerTypeSchema>
export type RunMode = z.infer<typeof runModeSchema>
export type EvidencePolicy = z.infer<typeof evidencePolicySchema>
export type Project = z.infer<typeof projectSchema>
export type ProjectInput = z.infer<typeof projectInputSchema>
export type Phase = z.infer<typeof phaseSchema>
export type Suite = z.infer<typeof suiteSchema>
export type SuiteInput = z.infer<typeof suiteInputSchema>
export type Scenario = z.infer<typeof scenarioSchema>
export type ScenarioDependency = z.infer<typeof scenarioDependencySchema>
export type Run = z.infer<typeof runSchema>
export type ScenarioResult = z.infer<typeof scenarioResultSchema>
