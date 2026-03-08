import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import {
  ensureScenarioOwnership,
  ensureUniqueScenarioSlug,
  getOrderedScenarios,
  getProjectDependencies,
  getProjectScenarios,
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
    const scenario = await getScenarioBySlug(
      ctx,
      project._id,
      args.scenarioSlug
    )

    if (!scenario) {
      return null
    }

    const dependencies = await getProjectDependencies(ctx, project._id)
    const dependencyIds = dependencies
      .filter((dependency) => dependency.scenarioId === scenario._id)
      .map((dependency) => dependency.dependsOnScenarioId)
      .sort()

    return {
      ...toScenario(scenario),
      dependencyIds,
    }
  },
})

export const orderedActiveForProject = query({
  args: {
    projectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const ordered = await getOrderedScenarios(ctx, project._id, {
      activeOnly: true,
    })

    return {
      projectPrompt: project.projectPrompt,
      project: {
        id: project._id,
        name: project.name,
        slug: project.slug,
      },
      scenarios: ordered,
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
    dependsOnScenarioIds: v.array(v.id("scenarios")),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    const timestamp = Date.now()
    const slug = await ensureUniqueScenarioSlug(
      ctx,
      project._id,
      args.slug ?? args.name
    )
    const scenarioId = await ctx.db.insert("scenarios", {
      projectId: project._id,
      name: args.name,
      slug,
      status: args.status,
      instructions: args.instructions,
      scoringPrompt: args.scoringPrompt,
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

    return toScenario(scenario)
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
    dependsOnScenarioIds: v.array(v.id("scenarios")),
  },
  handler: async (ctx, args) => {
    const { project, scenario } = await ensureScenarioOwnership(
      ctx,
      args.scenarioId
    )
    const slug = await ensureUniqueScenarioSlug(
      ctx,
      project._id,
      args.slug,
      scenario._id
    )

    await ctx.db.patch(scenario._id, {
      name: args.name,
      slug,
      status: args.status,
      instructions: args.instructions,
      scoringPrompt: args.scoringPrompt,
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

    return toScenario(updatedScenario)
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
