import { ConvexError, v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import {
  environmentNameSchema,
  runEnvironmentSchema,
} from "@workspace/contracts"

import type { Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import { selectSuitePhases } from "./domain"
import {
  computeRunCheckCounts,
  createRunName,
  deleteScenarioResultEvidence,
  deleteRunAndResults,
  ensureRunOwnership,
  getExecutionPlan,
  getScenarioById,
  getSuiteBySlug,
  interruptRunScenarioResults,
  matchesTerminalScenarioResult,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toRun,
  toRunEvidence,
  toScenarioResult,
  validateCompletedCheckResults,
  validateFailedCheckEvidence,
  validateRunnerMatch,
} from "./lib"

const evaluationCheckValidator = v.object({
  id: v.string(),
  name: v.string(),
  expectation: v.string(),
})

const checkResultValidator = v.object({
  checkId: v.string(),
  verdict: v.union(
    v.literal("passed"),
    v.literal("failed"),
    v.literal("not_observed")
  ),
  evidence: v.string(),
})

function invalidEnvironment(message: string): never {
  throw new ConvexError({ code: "validation_error", message })
}

export function parseRunEnvironment(input: {
  environment?: string
  targetUrl?: string
}) {
  if (input.environment === undefined && input.targetUrl === undefined) {
    return null
  }
  if ((input.environment === undefined) !== (input.targetUrl === undefined)) {
    invalidEnvironment("Environment and target URL must be provided together.")
  }

  const parsed = runEnvironmentSchema.safeParse(input)
  if (!parsed.success) {
    invalidEnvironment(
      parsed.error.issues[0]?.message ?? "Run environment is invalid."
    )
  }

  return parsed.data
}

export function addRunEnvironmentName(names: string[], environment: string) {
  return names.includes(environment) ? names : [...names, environment].sort()
}

export function removeRunEnvironmentName(names: string[], environment: string) {
  return names.filter((name) => name !== environment)
}

export function matchesTerminalRun(
  existing: { status: string; finishedAt: number | null },
  submitted: { status: string; finishedAt: number }
) {
  return (
    existing.status === submitted.status &&
    existing.finishedAt === submitted.finishedAt
  )
}

export function canCorrectRunInterruption(
  existing: { status: string; finalizationAttemptId?: string },
  submitted: { status: string; finalizationAttemptId?: string }
) {
  return (
    submitted.status === "interrupted" &&
    submitted.finalizationAttemptId !== undefined &&
    submitted.finalizationAttemptId === existing.finalizationAttemptId &&
    (existing.status === "completed" || existing.status === "failed")
  )
}

export function canCorrectScenarioInterruption(
  runStatus: string,
  existingStatus: string,
  submittedStatus: string
) {
  return (
    runStatus === "running" &&
    submittedStatus === "interrupted" &&
    ["completed", "runner_failed", "dependency_failed"].includes(
      existingStatus
    )
  )
}

export function matchesScenarioExecutionAttempt(
  existingAttemptId?: string,
  submittedAttemptId?: string
) {
  return (
    existingAttemptId === undefined ||
    submittedAttemptId === existingAttemptId
  )
}

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

    return sorted.map(toRun)
  },
})

export const listPageForProject = query({
  args: {
    projectSlug: v.string(),
    environment: v.optional(v.string()),
    sortDirection: v.union(v.literal("asc"), v.literal("desc")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const environment =
      args.environment === undefined
        ? null
        : environmentNameSchema.safeParse(args.environment)
    if (environment && !environment.success) {
      invalidEnvironment("Environment filter is invalid.")
    }

    const runs = environment?.success
      ? ctx.db
          .query("runs")
          .withIndex("by_project_environment_started_at", (query) =>
            query
              .eq("projectId", project._id)
              .eq("environment", environment.data)
          )
      : ctx.db
          .query("runs")
          .withIndex("by_project_started_at", (query) =>
            query.eq("projectId", project._id)
          )
    const result = await runs
      .order(args.sortDirection)
      .paginate(args.paginationOpts)

    return {
      ...result,
      page: result.page.map(toRun),
    }
  },
})

export const listEnvironmentsForProject = query({
  args: { projectSlug: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    return project.runEnvironmentNames ?? []
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

    const [evidence, results] = await Promise.all([
      ctx.db
        .query("runEvidence")
        .withIndex("by_run", (query) => query.eq("runId", run._id))
        .collect(),
      ctx.db
        .query("scenarioResults")
        .withIndex("by_run_sequence", (query) => query.eq("runId", run._id))
        .collect(),
    ])

    return {
      run: toRun(run),
      results: results
        .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
        .map((result) => ({
          ...toScenarioResult(result),
          evidence: evidence
            .filter((item) => item.scenarioResultId === result._id)
            .map(toRunEvidence),
        })),
    }
  },
})

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    mode: v.union(
      v.literal("all"),
      v.literal("single"),
      v.literal("phase"),
      v.literal("through_phase"),
      v.literal("suite")
    ),
    runnerType: v.union(v.literal("codex"), v.literal("claude-code")),
    evidencePolicy: v.optional(
      v.union(v.literal("text_only"), v.literal("failed_check_screenshot"))
    ),
    environment: v.optional(v.string()),
    targetUrl: v.optional(v.string()),
    requestedScenarioSlug: v.optional(v.union(v.null(), v.string())),
    requestedPhaseOrder: v.optional(v.union(v.null(), v.number())),
    requestedSuiteSlug: v.optional(v.union(v.null(), v.string())),
    startedAt: v.number(),
    creationAttemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectOwnerById(
      ctx,
      args.projectId
    )
    if (args.creationAttemptId) {
      const existing = await ctx.db
        .query("runs")
        .withIndex("by_project_creation_attempt", (query) =>
          query
            .eq("projectId", project._id)
            .eq("creationAttemptId", args.creationAttemptId)
        )
        .unique()
      if (existing) {
        return toRun(existing)
      }
    }
    const isSuiteRun = args.mode === "suite"
    if (isSuiteRun !== (args.requestedSuiteSlug != null)) {
      throw new ConvexError({
        code: "validation_error",
        message: "Run mode and requested target do not match.",
      })
    }
    const suite = isSuiteRun
      ? await getSuiteBySlug(ctx, project._id, args.requestedSuiteSlug!)
      : null
    const suitePhases = suite
      ? selectSuitePhases(
          (await getExecutionPlan(ctx, project._id, { activeOnly: true }))
            .phases,
          suite.phaseIds
        )
      : []
    if (suite && !suitePhases.some((phase) => phase.scenarios.length > 0)) {
      throw new ConvexError({
        code: "validation_error",
        message: `Suite "${suite.slug}" has no active scenarios to run.`,
      })
    }
    const environment = parseRunEnvironment(args)
    const timestamp = Date.now()
    if (environment) {
      const runEnvironmentNames = addRunEnvironmentName(
        project.runEnvironmentNames ?? [],
        environment.environment
      )
      if (runEnvironmentNames !== project.runEnvironmentNames) {
        await ctx.db.patch(project._id, { runEnvironmentNames })
      }
    }
    const runId = await ctx.db.insert("runs", {
      projectId: project._id,
      ownerUserId: identity.subject,
      name: createRunName(),
      status: "running",
      mode: args.mode,
      requestedScenarioSlug: args.requestedScenarioSlug ?? null,
      requestedPhaseOrder: args.requestedPhaseOrder ?? null,
      requestedSuiteSlug: suite?.slug ?? null,
      requestedSuiteName: suite?.name ?? null,
      ...(suite
        ? {
            requestedSuitePhases: suitePhases.map(({ id, name, order }) => ({
              id: id as Id<"phases">,
              name,
              order,
            })),
          }
        : {}),
      runnerType: args.runnerType,
      evidencePolicy: args.evidencePolicy ?? "text_only",
      ...(environment ?? {}),
      passedCheckCount: 0,
      totalCheckCount: 0,
      startedAt: args.startedAt,
      finishedAt: null,
      ...(args.creationAttemptId
        ? { creationAttemptId: args.creationAttemptId }
        : {}),
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
      status: v.union(
        v.literal("completed"),
        v.literal("runner_failed"),
        v.literal("dependency_failed"),
        v.literal("interrupted")
      ),
      checkResults: v.array(checkResultValidator),
      executionSummary: v.union(v.null(), v.string()),
      failureDetail: v.union(v.null(), v.string()),
      finishedAt: v.number(),
      executionAttemptId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectOwnerById(
      ctx,
      args.projectId
    )
    const run = await ctx.db.get(args.runId)

    if (!run) {
      throw new ConvexError({
        code: "not_found",
        message: "Run not found.",
      })
    }

    if (run.projectId !== project._id || run.ownerUserId !== identity.subject) {
      throw new ConvexError({
        code: "unauthorized",
        message: "You do not have access to this run.",
      })
    }

    const scenario = await getScenarioById(ctx, args.result.scenarioId)

    if (
      scenario.projectId !== project._id ||
      scenario.projectId !== run.projectId
    ) {
      throw new ConvexError({
        code: "unauthorized",
        message: "Scenario does not belong to this project.",
      })
    }

    const existing = await ctx.db
      .query("scenarioResults")
      .withIndex("by_run_scenario", (query) =>
        query.eq("runId", args.runId).eq("scenarioId", args.result.scenarioId)
      )
      .unique()
    if (!existing) {
      throw new ConvexError({
        code: "conflict",
        message: "Scenario execution has not started or is already complete.",
      })
    }
    if (
      !matchesScenarioExecutionAttempt(
        existing.executionAttemptId,
        args.result.executionAttemptId
      )
    ) {
      throw new ConvexError({
        code: "conflict",
        message: "Scenario execution belongs to another attempt.",
      })
    }
    if (existing.status !== "running") {
      if (matchesTerminalScenarioResult(existing, args.result)) {
        return {
          run: toRun(run),
          result: toScenarioResult(existing),
        }
      }
      if (
        !canCorrectScenarioInterruption(
          run.status,
          existing.status,
          args.result.status
        )
      ) {
        throw new ConvexError({
          code: "conflict",
          message: "Scenario execution has already completed with other data.",
        })
      }
    }

    if (args.result.status === "completed") {
      validateCompletedCheckResults(
        existing.evaluationChecks,
        args.result.checkResults
      )
      const failedCheckIds = new Set(
        args.result.checkResults
          .filter((check) => check.verdict === "failed")
          .map((check) => check.checkId)
      )
      await deleteScenarioResultEvidence(ctx, existing._id, failedCheckIds)
      if (
        (run.evidencePolicy ?? "text_only") === "failed_check_screenshot" &&
        existing.runnerType === "codex"
      ) {
        const evidence = await ctx.db
          .query("runEvidence")
          .withIndex("by_result", (query) =>
            query.eq("scenarioResultId", existing._id)
          )
          .collect()
        validateFailedCheckEvidence(args.result.checkResults, evidence)
      }
    } else if (args.result.checkResults.length > 0) {
      throw new ConvexError({
        code: "validation_error",
        message: "Incomplete scenario executions cannot contain check results.",
      })
    } else {
      await deleteScenarioResultEvidence(ctx, existing._id)
    }

    await ctx.db.patch(existing._id, {
      status: args.result.status,
      checkResults: args.result.checkResults,
      executionSummary: args.result.executionSummary,
      failureDetail: args.result.failureDetail,
      finishedAt: args.result.finishedAt,
    })

    await ctx.db.patch(run._id, {
      updatedAt: Date.now(),
    })

    const updatedRun = await ctx.db.get(run._id)
    const storedResult = await ctx.db.get(existing._id)

    if (!updatedRun || !storedResult) {
      throw new Error("Failed to persist scenario result")
    }

    return {
      run: toRun(updatedRun),
      result: toScenarioResult(storedResult),
    }
  },
})

export const startScenarioExecution = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("runs"),
    result: v.object({
      scenarioId: v.id("scenarios"),
      scenarioSlug: v.string(),
      scenarioName: v.string(),
      executionInstructions: v.string(),
      evaluationChecks: v.array(evaluationCheckValidator),
      phaseId: v.optional(v.union(v.null(), v.string())),
      phaseName: v.optional(v.union(v.null(), v.string())),
      phaseOrder: v.optional(v.union(v.null(), v.number())),
      sequenceIndex: v.number(),
      runnerType: v.union(v.literal("codex"), v.literal("claude-code")),
      startedAt: v.number(),
      executionAttemptId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectOwnerById(
      ctx,
      args.projectId
    )
    const run = await ctx.db.get(args.runId)

    if (!run) {
      throw new ConvexError({
        code: "not_found",
        message: "Run not found.",
      })
    }

    if (run.projectId !== project._id || run.ownerUserId !== identity.subject) {
      throw new ConvexError({
        code: "unauthorized",
        message: "You do not have access to this run.",
      })
    }

    if (run.status !== "running") {
      throw new ConvexError({
        code: "conflict",
        message: "Run is no longer accepting scenario updates.",
      })
    }

    validateRunnerMatch(run.runnerType, args.result.runnerType)

    const scenario = await getScenarioById(ctx, args.result.scenarioId)

    if (
      scenario.projectId !== project._id ||
      scenario.projectId !== run.projectId
    ) {
      throw new ConvexError({
        code: "unauthorized",
        message: "Scenario does not belong to this project.",
      })
    }

    const existing = await ctx.db
      .query("scenarioResults")
      .withIndex("by_run_scenario", (query) =>
        query.eq("runId", args.runId).eq("scenarioId", args.result.scenarioId)
      )
      .unique()

    let resultId = existing?._id ?? null

    if (existing && existing.status !== "running") {
      throw new ConvexError({
        code: "conflict",
        message: "Scenario execution has already completed for this run.",
      })
    }

    const values = {
      runId: args.runId,
      scenarioId: args.result.scenarioId,
      scenarioSlug: args.result.scenarioSlug,
      scenarioName: args.result.scenarioName,
      executionInstructions: args.result.executionInstructions,
      evaluationChecks: args.result.evaluationChecks,
      checkResults: [],
      phaseId: args.result.phaseId ?? null,
      phaseName: args.result.phaseName ?? null,
      phaseOrder: args.result.phaseOrder ?? null,
      sequenceIndex: args.result.sequenceIndex,
      status: "running" as const,
      runnerType: args.result.runnerType,
      ...(args.result.executionAttemptId
        ? { executionAttemptId: args.result.executionAttemptId }
        : {}),
      executionSummary: null,
      failureDetail: null,
      startedAt: args.result.startedAt,
      finishedAt: null,
    }

    if (existing) {
      await deleteScenarioResultEvidence(ctx, existing._id)
      await ctx.db.patch(existing._id, values)
      resultId = existing._id
    } else {
      resultId = await ctx.db.insert("scenarioResults", values)
    }

    await ctx.db.patch(run._id, {
      updatedAt: Date.now(),
    })

    const updatedRun = await ctx.db.get(run._id)
    const storedResult = resultId ? await ctx.db.get(resultId) : null

    if (!updatedRun || !storedResult) {
      throw new Error("Failed to persist scenario execution state")
    }

    return {
      run: toRun(updatedRun),
      result: toScenarioResult(storedResult),
    }
  },
})

export const finalize = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("runs"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("interrupted")
    ),
    finishedAt: v.number(),
    finalizationAttemptId: v.optional(v.string()),
    interruptedScenarioResultId: v.optional(v.id("scenarioResults")),
    interruptedScenarioAttemptId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectOwnerById(
      ctx,
      args.projectId
    )
    const run = await ctx.db.get(args.runId)

    if (!run) {
      throw new ConvexError({
        code: "not_found",
        message: "Run not found.",
      })
    }

    if (run.projectId !== project._id || run.ownerUserId !== identity.subject) {
      throw new ConvexError({
        code: "unauthorized",
        message: "You do not have access to this run.",
      })
    }

    if (run.status !== "running") {
      if (matchesTerminalRun(run, args)) {
        return { run: toRun(run) }
      }
      if (canCorrectRunInterruption(run, args)) {
        await ctx.db.patch(run._id, {
          status: "interrupted",
          finishedAt: args.finishedAt,
          updatedAt: Date.now(),
        })
        const correctedRun = await ctx.db.get(run._id)
        if (!correctedRun) {
          throw new Error("Failed to correct interrupted run")
        }
        return { run: toRun(correctedRun) }
      }
      throw new ConvexError({
        code: "conflict",
        message: "Run has already been finalized.",
      })
    }

    if (args.status === "interrupted") {
      await interruptRunScenarioResults(
        ctx,
        run._id,
        args.finishedAt,
        args.interruptedScenarioResultId,
        args.interruptedScenarioAttemptId
      )
    }

    const counts = await computeRunCheckCounts(ctx, run._id)

    await ctx.db.patch(run._id, {
      status: args.status,
      ...counts,
      finishedAt: args.finishedAt,
      ...(args.finalizationAttemptId
        ? { finalizationAttemptId: args.finalizationAttemptId }
        : {}),
      updatedAt: Date.now(),
    })

    const updatedRun = await ctx.db.get(run._id)

    if (!updatedRun) {
      throw new Error("Failed to finalize run")
    }

    return {
      run: toRun(updatedRun),
    }
  },
})

export const remove = mutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const { project, run } = await ensureRunOwnership(ctx, args.runId)
    const { deletedResultCount } = await deleteRunAndResults(ctx, run._id)

    if (run.environment) {
      const remainingRun = await ctx.db
        .query("runs")
        .withIndex("by_project_environment_started_at", (query) =>
          query.eq("projectId", project._id).eq("environment", run.environment)
        )
        .first()
      if (!remainingRun) {
        await ctx.db.patch(project._id, {
          runEnvironmentNames: removeRunEnvironmentName(
            project.runEnvironmentNames ?? [],
            run.environment
          ),
        })
      }
    }

    return {
      deletedRunId: run._id,
      deletedRunName: run.name,
      deletedResultCount,
    }
  },
})
