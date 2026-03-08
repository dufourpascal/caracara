import { ConvexError } from "convex/values"

import {
  createUniqueSlug,
  formatRunName,
  normalizeSlug,
} from "@workspace/contracts"

import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { assertValidDependencies, buildExecutionOrder } from "./domain"

type Ctx = QueryCtx | MutationCtx

function toTimestamp(value: number) {
  return Math.trunc(value)
}

export async function requireIdentity(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new ConvexError({
      code: "unauthenticated",
      message: "Authentication required.",
    })
  }

  return identity
}

export async function getProjectById(ctx: Ctx, projectId: Id<"projects">) {
  const project = await ctx.db.get(projectId)

  if (!project) {
    throw new ConvexError({
      code: "not_found",
      message: "Project not found.",
    })
  }

  return project
}

export async function requireProjectOwnerById(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const identity = await requireIdentity(ctx)
  const project = await getProjectById(ctx, projectId)

  if (project.ownerUserId !== identity.subject) {
    throw new ConvexError({
      code: "unauthorized",
      message: "You do not have access to this project.",
    })
  }

  return { identity, project }
}

export async function requireProjectOwnerBySlug(ctx: Ctx, slug: string) {
  const identity = await requireIdentity(ctx)
  const project = await ctx.db
    .query("projects")
    .withIndex("by_owner_slug", (query) =>
      query.eq("ownerUserId", identity.subject).eq("slug", slug)
    )
    .unique()

  if (!project) {
    const existingProject = (await ctx.db.query("projects").collect()).find(
      (candidate) => candidate.slug === slug
    )

    if (existingProject) {
      throw new ConvexError({
        code: "unauthorized",
        message: "You do not have access to this project.",
      })
    }

    throw new ConvexError({
      code: "not_found",
      message: "Project not found.",
    })
  }

  return { identity, project }
}

export function toProject(project: Doc<"projects">) {
  return {
    id: project._id,
    ownerUserId: project.ownerUserId,
    name: project.name,
    slug: project.slug,
    description: project.description,
    projectPrompt: project.projectPrompt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

export function toScenario(scenario: Doc<"scenarios">) {
  return {
    id: scenario._id,
    projectId: scenario.projectId,
    name: scenario.name,
    slug: scenario.slug,
    status: scenario.status,
    instructions: scenario.instructions,
    scoringPrompt: scenario.scoringPrompt,
    updatedAt: scenario.updatedAt,
  }
}

export function toRun(run: Doc<"runs">) {
  return {
    id: run._id,
    projectId: run.projectId,
    ownerUserId: run.ownerUserId,
    name: run.name,
    status: run.status,
    mode: run.mode,
    requestedScenarioSlug: run.requestedScenarioSlug,
    runnerType: run.runnerType,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: toTimestamp(run._creationTime),
    updatedAt: run.updatedAt,
  }
}

export function toScenarioResult(result: Doc<"scenarioResults">) {
  return {
    id: result._id,
    runId: result.runId,
    scenarioId: result.scenarioId,
    scenarioSlug: result.scenarioSlug,
    scenarioName: result.scenarioName,
    executionInstructions: result.executionInstructions,
    scoringPrompt: result.scoringPrompt,
    sequenceIndex: result.sequenceIndex,
    status: result.status,
    runnerType: result.runnerType,
    score: result.score,
    rationale: result.rationale,
    rawOutput: result.rawOutput,
    failureDetail: result.failureDetail,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    submittedAt: toTimestamp(result._creationTime),
  }
}

export async function getProjectScenarios(ctx: Ctx, projectId: Id<"projects">) {
  return await ctx.db
    .query("scenarios")
    .withIndex("by_project", (query) => query.eq("projectId", projectId))
    .collect()
}

export async function getProjectDependencies(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  return await ctx.db
    .query("scenarioDependencies")
    .withIndex("by_project", (query) => query.eq("projectId", projectId))
    .collect()
}

export async function getScenarioDependencyIds(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const dependencies = await getProjectDependencies(ctx, projectId)
  const idsByScenario = new Map<string, string[]>()

  for (const dependency of dependencies) {
    const current = idsByScenario.get(dependency.scenarioId) ?? []
    current.push(dependency.dependsOnScenarioId)
    idsByScenario.set(dependency.scenarioId, current)
  }

  return idsByScenario
}

export async function getOrderedScenarios(
  ctx: Ctx,
  projectId: Id<"projects">,
  options?: {
    activeOnly?: boolean
    ascending?: boolean
  }
) {
  const scenarios = await getProjectScenarios(ctx, projectId)
  const dependencies = await getProjectDependencies(ctx, projectId)
  const scenarioNodes = scenarios.map((scenario) => ({
    id: scenario._id,
    slug: scenario.slug,
    name: scenario.name,
    status: scenario.status,
    instructions: scenario.instructions,
    scoringPrompt: scenario.scoringPrompt,
  }))
  const dependencyEdges = dependencies.map((dependency) => ({
    scenarioId: dependency.scenarioId,
    dependsOnScenarioId: dependency.dependsOnScenarioId,
  }))

  assertValidDependencies(scenarioNodes, dependencyEdges)

  const ordered = buildExecutionOrder(scenarioNodes, dependencyEdges, options)

  const dependencyIds = await getScenarioDependencyIds(ctx, projectId)

  return ordered.map((scenario) => ({
    ...scenario,
    dependencyIds: [...(dependencyIds.get(scenario.id) ?? [])].sort(),
  }))
}

export async function ensureUniqueProjectSlug(
  ctx: Ctx,
  ownerUserId: string,
  desiredSlug: string,
  currentProjectId?: Id<"projects">
) {
  const existingProjects = await ctx.db
    .query("projects")
    .withIndex("by_owner", (query) => query.eq("ownerUserId", ownerUserId))
    .collect()

  const existingSlugs = existingProjects
    .filter((project) => project._id !== currentProjectId)
    .map((project) => project.slug)

  return createUniqueSlug(normalizeSlug(desiredSlug), existingSlugs)
}

export async function ensureUniqueScenarioSlug(
  ctx: Ctx,
  projectId: Id<"projects">,
  desiredSlug: string,
  currentScenarioId?: Id<"scenarios">
) {
  const scenarios = await getProjectScenarios(ctx, projectId)
  const existingSlugs = scenarios
    .filter((scenario) => scenario._id !== currentScenarioId)
    .map((scenario) => scenario.slug)

  return createUniqueSlug(normalizeSlug(desiredSlug), existingSlugs)
}

export async function replaceScenarioDependencies(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    scenarioId: Id<"scenarios">
    dependsOnScenarioIds: Id<"scenarios">[]
  }
) {
  const existing = await ctx.db
    .query("scenarioDependencies")
    .withIndex("by_scenario", (query) =>
      query.eq("scenarioId", args.scenarioId)
    )
    .collect()

  for (const dependency of existing) {
    await ctx.db.delete(dependency._id)
  }

  for (const dependsOnScenarioId of args.dependsOnScenarioIds) {
    await ctx.db.insert("scenarioDependencies", {
      projectId: args.projectId,
      scenarioId: args.scenarioId,
      dependsOnScenarioId,
    })
  }
}

export async function validateProjectDependencyGraph(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  await getOrderedScenarios(ctx, projectId)
}

export async function getScenarioBySlug(
  ctx: Ctx,
  projectId: Id<"projects">,
  slug: string
) {
  return await ctx.db
    .query("scenarios")
    .withIndex("by_project_slug", (query) =>
      query.eq("projectId", projectId).eq("slug", slug)
    )
    .unique()
}

export async function getScenarioById(ctx: Ctx, scenarioId: Id<"scenarios">) {
  const scenario = await ctx.db.get(scenarioId)

  if (!scenario) {
    throw new ConvexError({
      code: "not_found",
      message: "Scenario not found.",
    })
  }

  return scenario
}

export async function ensureScenarioOwnership(
  ctx: Ctx,
  scenarioId: Id<"scenarios">
) {
  const scenario = await getScenarioById(ctx, scenarioId)
  const { project } = await requireProjectOwnerById(ctx, scenario.projectId)

  return { project, scenario }
}

export function createRunName() {
  return formatRunName(new Date())
}

export async function computeRunAverageScore(ctx: Ctx, runId: Id<"runs">) {
  const results = await ctx.db
    .query("scenarioResults")
    .withIndex("by_run", (query) => query.eq("runId", runId))
    .collect()
  const scores = results.flatMap((result) =>
    typeof result.score === "number" ? [result.score] : []
  )

  if (scores.length === 0) {
    return null
  }

  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}
