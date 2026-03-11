import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import {
  ensureScenarioOwnership,
  ensureUniqueScenarioSlug,
  getExecutionPlan,
  getOrderedScenarios,
  getProjectDependencies,
  getProjectPhases,
  getScenarioDependencyIds,
  getScenarioBySlug,
  replaceScenarioDependencies,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toScenario,
  validateProjectDependencyGraph,
} from "./lib"

export const listForProject = query({
  args: {
    projectSlug: v.string(),
    ascending: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const ordered = await getOrderedScenarios(ctx, project._id, {
      ascending: args.ascending ?? true,
    })

    return ordered
  },
})

export const getBySlug = query({
  args: {
    projectSlug: v.string(),
    scenarioSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const [scenario, dependencyIdsByScenario, phases] = await Promise.all([
      getScenarioBySlug(ctx, project._id, args.scenarioSlug),
      getScenarioDependencyIds(ctx, project._id),
      getProjectPhases(ctx, project._id),
    ])

    if (!scenario) {
      return null
    }

    const dependencyIds = [...(dependencyIdsByScenario.get(scenario._id) ?? [])].sort()
    const phase =
      phases.find((candidate) => candidate._id === (scenario.phaseId ?? null)) ??
      null

    return {
      ...toScenario(scenario, phase),
      dependencyIds,
    }
  },
})

export const executionPlanForProject = query({
  args: {
    projectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const executionPlan = await getExecutionPlan(ctx, project._id, {
      activeOnly: true,
    })

    return {
      projectPrompt: project.projectPrompt,
      project: {
        id: project._id,
        name: project.name,
        slug: project.slug,
      },
      phases: executionPlan.phases,
      unassignedScenarioCount: executionPlan.unassignedScenarioCount,
    }
  },
})

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("active")),
    instructions: v.string(),
    scoringPrompt: v.string(),
    phaseId: v.optional(v.union(v.null(), v.id("phases"))),
    dependsOnScenarioIds: v.array(v.id("scenarios")),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    const phases = await getProjectPhases(ctx, project._id)
    const timestamp = Date.now()
    const slug = await ensureUniqueScenarioSlug(
      ctx,
      project._id,
      args.slug ?? args.name
    )
    const selectedPhaseId =
      args.phaseId !== undefined
        ? args.phaseId
        : (phases.length > 0 ? phases[phases.length - 1]?._id ?? null : null)

    if (
      selectedPhaseId !== null &&
      !phases.some((phase) => phase._id === selectedPhaseId)
    ) {
      throw new Error("Selected phase does not belong to this project")
    }

    const scenarioId = await ctx.db.insert("scenarios", {
      projectId: project._id,
      name: args.name,
      slug,
      status: args.status,
      instructions: args.instructions,
      scoringPrompt: args.scoringPrompt,
      phaseId: selectedPhaseId,
      updatedAt: timestamp,
    })

    await replaceScenarioDependencies(ctx, {
      projectId: project._id,
      scenarioId,
      dependsOnScenarioIds: args.dependsOnScenarioIds,
    })
    await validateProjectDependencyGraph(ctx, project._id)

    const scenario = await ctx.db.get(scenarioId)
    if (!scenario) {
      throw new Error("Failed to create scenario")
    }

    const phase =
      phases.find((candidate) => candidate._id === (scenario.phaseId ?? null)) ??
      null

    return toScenario(scenario, phase)
  },
})

export const update = mutation({
  args: {
    scenarioId: v.id("scenarios"),
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal("draft"), v.literal("active")),
    instructions: v.string(),
    scoringPrompt: v.string(),
    phaseId: v.optional(v.union(v.null(), v.id("phases"))),
    dependsOnScenarioIds: v.array(v.id("scenarios")),
  },
  handler: async (ctx, args) => {
    const { project, scenario } = await ensureScenarioOwnership(
      ctx,
      args.scenarioId
    )
    const phases = await getProjectPhases(ctx, project._id)
    const slug = await ensureUniqueScenarioSlug(
      ctx,
      project._id,
      args.slug,
      scenario._id
    )
    const selectedPhaseId =
      args.phaseId !== undefined ? args.phaseId : (scenario.phaseId ?? null)

    if (
      selectedPhaseId !== null &&
      !phases.some((phase) => phase._id === selectedPhaseId)
    ) {
      throw new Error("Selected phase does not belong to this project")
    }

    await ctx.db.patch(scenario._id, {
      name: args.name,
      slug,
      status: args.status,
      instructions: args.instructions,
      scoringPrompt: args.scoringPrompt,
      phaseId: selectedPhaseId,
      updatedAt: Date.now(),
    })
    await replaceScenarioDependencies(ctx, {
      projectId: project._id,
      scenarioId: scenario._id,
      dependsOnScenarioIds: args.dependsOnScenarioIds,
    })
    await validateProjectDependencyGraph(ctx, project._id)

    const updatedScenario = await ctx.db.get(scenario._id)
    if (!updatedScenario) {
      throw new Error("Failed to update scenario")
    }

    const phase =
      phases.find(
        (candidate) => candidate._id === (updatedScenario.phaseId ?? null)
      ) ?? null

    return toScenario(updatedScenario, phase)
  },
})

export const remove = mutation({
  args: {
    scenarioId: v.id("scenarios"),
  },
  handler: async (ctx, args) => {
    const { project, scenario } = await ensureScenarioOwnership(
      ctx,
      args.scenarioId
    )

    const dependencies = await getProjectDependencies(ctx, project._id)
    const relatedDependencies = dependencies.filter(
      (dependency) =>
        dependency.scenarioId === scenario._id ||
        dependency.dependsOnScenarioId === scenario._id
    )

    for (const dependency of relatedDependencies) {
      await ctx.db.delete(dependency._id)
    }

    await ctx.db.delete(scenario._id)

    return {
      deletedScenarioId: scenario._id,
      deletedScenarioSlug: scenario.slug,
    }
  },
})
