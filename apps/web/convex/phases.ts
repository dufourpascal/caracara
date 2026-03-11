import { ConvexError, v } from "convex/values"

import { mutation, query } from "./_generated/server"
import {
  deleteDependenciesTouchingScenarioIds,
  ensurePhaseOwnership,
  getProjectPhases,
  getProjectScenarios,
  normalizeProjectPhaseOrders,
  rebuildScenarioNavigationMetadata,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toPhase,
} from "./lib"

export const listForProject = query({
  args: {
    projectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const [phases, scenarios] = await Promise.all([
      getProjectPhases(ctx, project._id),
      getProjectScenarios(ctx, project._id),
    ])

    return phases.map((phase) =>
      toPhase(
        phase,
        scenarios.filter((scenario) => (scenario.phaseId ?? null) === phase._id)
          .length
      )
    )
  },
})

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    const phases = await getProjectPhases(ctx, project._id)
    const timestamp = Date.now()
    const phaseId = await ctx.db.insert("phases", {
      projectId: project._id,
      name: args.name,
      order: phases.length + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const phase = await ctx.db.get(phaseId)

    if (!phase) {
      throw new Error("Failed to create phase")
    }

    return toPhase(phase, 0)
  },
})

export const update = mutation({
  args: {
    phaseId: v.id("phases"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { phase } = await ensurePhaseOwnership(ctx, args.phaseId)
    await ctx.db.patch(phase._id, {
      name: args.name,
      updatedAt: Date.now(),
    })
    const updatedPhase = await ctx.db.get(phase._id)

    if (!updatedPhase) {
      throw new Error("Failed to update phase")
    }

    return toPhase(updatedPhase)
  },
})

export const reorder = mutation({
  args: {
    projectId: v.id("projects"),
    phaseIds: v.array(v.id("phases")),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    const phases = await getProjectPhases(ctx, project._id)

    if (phases.length !== args.phaseIds.length) {
      throw new ConvexError({
        code: "validation_error",
        message: "Phase reorder payload does not match project phases.",
      })
    }

    const existingIds = new Set(phases.map((phase) => phase._id))

    for (const phaseId of args.phaseIds) {
      if (!existingIds.has(phaseId)) {
        throw new ConvexError({
          code: "validation_error",
          message: "Phase reorder payload does not match project phases.",
        })
      }
    }

    for (const [index, phaseId] of args.phaseIds.entries()) {
      await ctx.db.patch(phaseId, {
        order: index + 1,
        updatedAt: Date.now(),
      })
    }

    await rebuildScenarioNavigationMetadata(ctx, project._id)

    const updated = await getProjectPhases(ctx, project._id)
    const scenarios = await getProjectScenarios(ctx, project._id)

    return updated.map((phase) =>
      toPhase(
        phase,
        scenarios.filter((scenario) => (scenario.phaseId ?? null) === phase._id)
          .length
      )
    )
  },
})

export const remove = mutation({
  args: {
    phaseId: v.id("phases"),
  },
  handler: async (ctx, args) => {
    const { project, phase } = await ensurePhaseOwnership(ctx, args.phaseId)
    const scenarios = await getProjectScenarios(ctx, project._id)
    const affectedScenarios = scenarios.filter(
      (scenario) => (scenario.phaseId ?? null) === phase._id
    )

    for (const scenario of affectedScenarios) {
      await ctx.db.patch(scenario._id, {
        phaseId: null,
        updatedAt: Date.now(),
      })
    }

    await deleteDependenciesTouchingScenarioIds(
      ctx,
      project._id,
      affectedScenarios.map((scenario) => scenario._id)
    )
    await ctx.db.delete(phase._id)
    await normalizeProjectPhaseOrders(ctx, project._id)
    await rebuildScenarioNavigationMetadata(ctx, project._id)

    return {
      deletedPhaseId: phase._id,
      deletedPhaseName: phase.name,
      unassignedScenarioCount: affectedScenarios.length,
    }
  },
})
