import { ConvexError, v } from "convex/values"

import { mutation, query } from "./_generated/server"
import {
  computeRunAverageScore,
  createRunName,
  getScenarioById,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toRun,
  toScenarioResult,
} from "./lib"

export const listForProject = query({
  args: {
    projectSlug: v.string(),
    ascending: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_project_started_at", (query) =>
        query.eq("projectId", project._id)
      )
      .collect()

    const sorted = runs.sort((left, right) =>
      args.ascending
        ? left.startedAt - right.startedAt
        : right.startedAt - left.startedAt
    )

    return await Promise.all(
      sorted.map(async (run) => ({
        ...toRun(run),
        averageScore: await computeRunAverageScore(ctx, run._id),
      }))
    )
  },
})

export const getDetail = query({
  args: {
    projectSlug: v.string(),
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const run = await ctx.db.get(args.runId)

    if (!run || run.projectId !== project._id) {
      return null
    }

    const results = await ctx.db
      .query("scenarioResults")
      .withIndex("by_run_sequence", (query) => query.eq("runId", run._id))
      .collect()

    return {
      run: {
        ...toRun(run),
        averageScore: await computeRunAverageScore(ctx, run._id),
      },
      results: results
        .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
        .map(toScenarioResult),
    }
  },
})

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    mode: v.union(v.literal("all"), v.literal("single")),
    runnerType: v.union(v.literal("codex"), v.literal("claude-code")),
    requestedScenarioSlug: v.optional(v.union(v.null(), v.string())),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectOwnerById(
      ctx,
      args.projectId
    )
    const timestamp = Date.now()
    const runId = await ctx.db.insert("runs", {
      projectId: project._id,
      ownerUserId: identity.subject,
      name: createRunName(),
      status: "running",
      mode: args.mode,
      requestedScenarioSlug: args.requestedScenarioSlug ?? null,
      runnerType: args.runnerType,
      startedAt: args.startedAt,
      finishedAt: null,
      updatedAt: timestamp,
    })

    const run = await ctx.db.get(runId)
    if (!run) {
      throw new Error("Failed to create run")
    }

    return toRun(run)
  },
})

export const submitScenarioResult = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("runs"),
    result: v.object({
      scenarioId: v.id("scenarios"),
      scenarioSlug: v.string(),
      scenarioName: v.string(),
      executionInstructions: v.string(),
      scoringPrompt: v.string(),
      sequenceIndex: v.number(),
      status: v.union(
        v.literal("success"),
        v.literal("scoring_failed"),
        v.literal("runner_failed"),
        v.literal("dependency_failed"),
        v.literal("interrupted")
      ),
      runnerType: v.union(v.literal("codex"), v.literal("claude-code")),
      score: v.union(v.null(), v.number()),
      rationale: v.union(v.null(), v.string()),
      rawOutput: v.union(v.null(), v.string()),
      failureDetail: v.union(v.null(), v.string()),
      startedAt: v.number(),
      finishedAt: v.number(),
    }),
    runStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("interrupted")
      )
    ),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectOwnerById(ctx, args.projectId)
    const run = await ctx.db.get(args.runId)

    if (!run) {
      throw new ConvexError({
        code: "not_found",
        message: "Run not found.",
      })
    }

    if (
      run.projectId !== project._id ||
      run.ownerUserId !== identity.subject
    ) {
      throw new ConvexError({
        code: "unauthorized",
        message: "You do not have access to this run.",
      })
    }

    const scenario = await getScenarioById(ctx, args.result.scenarioId)

    if (scenario.projectId !== project._id || scenario.projectId !== run.projectId) {
      throw new ConvexError({
        code: "unauthorized",
        message: "Scenario does not belong to this project.",
      })
    }

    const existing = await ctx.db
      .query("scenarioResults")
      .withIndex("by_run_scenario", (query) =>
        query
          .eq("runId", args.runId)
          .eq("scenarioId", args.result.scenarioId)
      )
      .unique()
    const values = {
      runId: args.runId,
      ...args.result,
    }

    let resultId = existing?._id ?? null

    if (existing) {
      await ctx.db.patch(existing._id, values)
      resultId = existing._id
    } else {
      resultId = await ctx.db.insert("scenarioResults", values)
    }

    await ctx.db.patch(run._id, {
      status: args.runStatus ?? "running",
      finishedAt:
        args.runStatus && args.runStatus !== "running"
          ? args.result.finishedAt
          : run.finishedAt,
      updatedAt: Date.now(),
    })

    const updatedRun = await ctx.db.get(run._id)
    const storedResult = resultId ? await ctx.db.get(resultId) : null

    if (!updatedRun || !storedResult) {
      throw new Error("Failed to persist scenario result")
    }

    return {
      run: toRun(updatedRun),
      result: toScenarioResult(storedResult),
    }
  },
})
