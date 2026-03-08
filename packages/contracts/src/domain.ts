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
  "success",
  "scoring_failed",
  "runner_failed",
  "dependency_failed",
  "interrupted",
])
export const runnerTypeSchema = z.enum(["codex", "claude-code"])
export const runModeSchema = z.enum(["all", "single"])

export const timestampSchema = z.number().int().nonnegative()
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const nullableStringSchema = z.string().max(20_000).nullable()

export const projectSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(1_500),
  projectPrompt: z.string().max(12_000),
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
  scoringPrompt: z.string().min(1).max(20_000),
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
  runnerType: runnerTypeSchema.nullable(),
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
  scoringPrompt: z.string().min(1).max(20_000),
  sequenceIndex: z.number().int().nonnegative(),
  status: scenarioResultStatusSchema,
  runnerType: runnerTypeSchema,
  score: z.number().min(0).max(1).nullable(),
  rationale: nullableStringSchema,
  rawOutput: nullableStringSchema,
  failureDetail: nullableStringSchema,
  startedAt: timestampSchema,
  finishedAt: timestampSchema,
  submittedAt: timestampSchema,
})

export type ScenarioStatus = z.infer<typeof scenarioStatusSchema>
export type RunStatus = z.infer<typeof runStatusSchema>
export type ScenarioResultStatus = z.infer<typeof scenarioResultStatusSchema>
export type RunnerType = z.infer<typeof runnerTypeSchema>
export type RunMode = z.infer<typeof runModeSchema>
export type Project = z.infer<typeof projectSchema>
export type Scenario = z.infer<typeof scenarioSchema>
export type ScenarioDependency = z.infer<typeof scenarioDependencySchema>
export type Run = z.infer<typeof runSchema>
export type ScenarioResult = z.infer<typeof scenarioResultSchema>
