import { v } from "convex/values"

import { internalMutation, internalQuery } from "./_generated/server"
import { computeRunAverageScore, rebuildScenarioNavigationMetadata } from "./lib"

export const countScenarioResultsMissingImprovementInstruction = internalQuery({
  args: {},
  handler: async (ctx) => {
    const results = await ctx.db.query("scenarioResults").collect()

    return results.filter(
      (result) => result.improvementInstruction === undefined
    ).length
  },
})

export const backfillScenarioResultImprovementInstruction = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db.query("scenarioResults").collect()
    const missing = results.filter(
      (result) => result.improvementInstruction === undefined
    )
    const limit = Math.max(1, args.limit ?? 100)
    const batch = missing.slice(0, limit)

    for (const result of batch) {
      await ctx.db.patch(result._id, {
        improvementInstruction: null,
      })
    }

    return {
      scanned: results.length,
      patched: batch.length,
      remaining: Math.max(0, missing.length - batch.length),
    }
  },
})

export const countCompletedRunsMissingAverageScore = internalQuery({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").collect()

    return runs.filter(
      (run) => run.status === "completed" && run.averageScore === null
    ).length
  },
})

export const countScenariosMissingNavigationMetadata = internalQuery({
  args: {},
  handler: async (ctx) => {
    const scenarios = await ctx.db.query("scenarios").collect()

    return scenarios.filter(
      (scenario) =>
        typeof scenario.navigationOrder !== "number" ||
        typeof scenario.phaseNavigationOrder !== "number" ||
        typeof scenario.phaseFilterKey !== "string" ||
        typeof scenario.dependencyCount !== "number" ||
        typeof scenario.searchText !== "string"
    ).length
  },
})

export const backfillScenarioNavigationMetadata = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scenarios = await ctx.db.query("scenarios").collect()
    const projectIds = new Set<string>()

    for (const scenario of scenarios) {
      if (
        typeof scenario.navigationOrder !== "number" ||
        typeof scenario.phaseNavigationOrder !== "number" ||
        typeof scenario.phaseFilterKey !== "string" ||
        typeof scenario.dependencyCount !== "number" ||
        typeof scenario.searchText !== "string"
      ) {
        projectIds.add(scenario.projectId)
      }
    }

    const limit = Math.max(1, args.limit ?? 25)
    const batch = [...projectIds].slice(0, limit)

    for (const projectId of batch) {
      await rebuildScenarioNavigationMetadata(ctx, projectId as never)
    }

    return {
      scanned: scenarios.length,
      patchedProjects: batch.length,
      remainingProjects: Math.max(0, projectIds.size - batch.length),
    }
  },
})

export const backfillCompletedRunAverageScores = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const runs = await ctx.db.query("runs").collect()
    const missing = runs.filter(
      (run) => run.status === "completed" && run.averageScore === null
    )
    const limit = Math.max(1, args.limit ?? 100)
    const batch = missing.slice(0, limit)

    for (const run of batch) {
      await ctx.db.patch(run._id, {
        averageScore: await computeRunAverageScore(ctx, run._id),
        updatedAt: Date.now(),
      })
    }

    return {
      scanned: runs.length,
      patched: batch.length,
      remaining: Math.max(0, missing.length - batch.length),
    }
  },
})
