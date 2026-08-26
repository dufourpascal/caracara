import { z } from "zod"

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
export const runModeSchema = z.enum(["all", "single", "phase", "through_phase"])
export const evidencePolicySchema = z.enum([
  "text_only",
  "failed_check_screenshot",
])

export const timestampSchema = z.number().int().nonnegative()
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Project name is required.")
  .max(120, "Project name must be 120 characters or fewer.")
export const projectDescriptionSchema = z
  .string()
  .max(1_500, "Description must be 1,500 characters or fewer.")
export const projectPromptSchema = z
  .string()
  .max(12_000, "Project prompt must be 12,000 characters or fewer.")
export const projectInputSchema = z.object({
  name: projectNameSchema,
  slug: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .trim()
      .max(120, "Slug must be 120 characters or fewer.")
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
  runnerType: runnerTypeSchema.nullable(),
  evidencePolicy: evidencePolicySchema,
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
export type Scenario = z.infer<typeof scenarioSchema>
export type ScenarioDependency = z.infer<typeof scenarioDependencySchema>
export type Run = z.infer<typeof runSchema>
export type ScenarioResult = z.infer<typeof scenarioResultSchema>
