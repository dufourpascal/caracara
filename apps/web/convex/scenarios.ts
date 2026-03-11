import { v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import type { Id } from "./_generated/dataModel"

import { mutation, query } from "./_generated/server"
import {
  deleteDependenciesTouchingScenarioIds,
  ensureScenarioOwnership,
  ensureUniqueScenarioSlug,
  getExecutionPlan,
  getOrderedScenarios,
  getProjectDependencies,
  getProjectPhases,
  getProjectScenarios,
  getScenarioDependencyIds,
  getScenarioBySlug,
  replaceScenarioDependencies,
  rebuildScenarioNavigationMetadata,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toScenario,
  toScenarioSummary,
  UNASSIGNED_SCENARIO_PHASE_KEY,
  validateProjectDependencyGraph,
} from "./lib"

function normalizePhaseFilterKey(phaseFilter: string | null | undefined) {
  return phaseFilter === null || phaseFilter === undefined
    ? null
    : phaseFilter === UNASSIGNED_SCENARIO_PHASE_KEY
      ? UNASSIGNED_SCENARIO_PHASE_KEY
      : phaseFilter
}

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

export const listSummariesForProject = query({
  args: {
    projectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const [ordered, phases] = await Promise.all([
      getOrderedScenarios(ctx, project._id, {
        ascending: true,
      }),
      getProjectPhases(ctx, project._id),
    ])
    const phaseById = new Map(phases.map((phase) => [phase._id, phase]))

    return ordered.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      slug: scenario.slug,
      status: scenario.status,
      phaseId: scenario.phaseId ?? null,
      phaseName:
        scenario.phaseId
          ? phaseById.get(scenario.phaseId as Id<"phases">)?.name ?? null
          : null,
      phaseOrder:
        scenario.phaseId
          ? phaseById.get(scenario.phaseId as Id<"phases">)?.order ?? null
          : null,
      dependencyCount: scenario.dependencyIds.length,
    }))
  },
})

export const getNavigationSummaryForProject = query({
  args: {
    projectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const unassignedScenarioCount = (
      await ctx.db
      .query("scenarios")
      .withIndex("by_project_phase_navigation_order", (query) =>
        query
          .eq("projectId", project._id)
          .eq("phaseFilterKey", UNASSIGNED_SCENARIO_PHASE_KEY)
      )
      .collect()
    ).length

    return {
      unassignedScenarioCount,
    }
  },
})

export const listPageForProject = query({
  args: {
    projectSlug: v.string(),
    phaseFilter: v.optional(v.union(v.null(), v.string())),
    searchQuery: v.optional(v.string()),
    sortDirection: v.union(v.literal("asc"), v.literal("desc")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const phases = await getProjectPhases(ctx, project._id)
    const phaseById = new Map(phases.map((phase) => [phase._id, phase]))
    const normalizedSearchQuery = args.searchQuery?.trim() ?? ""
    const normalizedPhaseFilterKey = normalizePhaseFilterKey(args.phaseFilter)

    const result =
      normalizedSearchQuery.length > 0
        ? await ctx.db
            .query("scenarios")
            .withSearchIndex("search_by_project_phase", (query) => {
              let search = query
                .search("searchText", normalizedSearchQuery)
                .eq("projectId", project._id)

              if (normalizedPhaseFilterKey !== null) {
                search = search.eq("phaseFilterKey", normalizedPhaseFilterKey)
              }

              return search
            })
            .paginate(args.paginationOpts)
        : normalizedPhaseFilterKey === null
          ? await ctx.db
              .query("scenarios")
              .withIndex("by_project_navigation_order", (query) =>
                query.eq("projectId", project._id)
              )
              .order(args.sortDirection)
              .paginate(args.paginationOpts)
          : await ctx.db
              .query("scenarios")
              .withIndex("by_project_phase_navigation_order", (query) =>
                query
                  .eq("projectId", project._id)
                  .eq("phaseFilterKey", normalizedPhaseFilterKey)
              )
              .order(args.sortDirection)
              .paginate(args.paginationOpts)

    return {
      ...result,
      page: result.page.map((scenario) =>
        toScenarioSummary(
          scenario,
          scenario.phaseId ? phaseById.get(scenario.phaseId) ?? null : null
        )
      ),
    }
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
    await rebuildScenarioNavigationMetadata(ctx, project._id)

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

export const ensureNavigationMetadataForProject = mutation({
  args: {
    projectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const scenarios = await getProjectScenarios(ctx, project._id)
    const needsRebuild = scenarios.some(
      (scenario) =>
        typeof scenario.navigationOrder !== "number" ||
        typeof scenario.phaseNavigationOrder !== "number" ||
        typeof scenario.phaseFilterKey !== "string" ||
        typeof scenario.dependencyCount !== "number" ||
        typeof scenario.searchText !== "string"
    )

    if (needsRebuild) {
      await rebuildScenarioNavigationMetadata(ctx, project._id)
    }

    return {
      rebuilt: needsRebuild,
      scenarioCount: scenarios.length,
    }
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

    const currentPhaseId = scenario.phaseId ?? null
    const isChangingPhase = currentPhaseId !== selectedPhaseId

    await ctx.db.patch(scenario._id, {
      name: args.name,
      slug,
      status: args.status,
      instructions: args.instructions,
      scoringPrompt: args.scoringPrompt,
      phaseId: selectedPhaseId,
      updatedAt: Date.now(),
    })

    if (isChangingPhase) {
      await deleteDependenciesTouchingScenarioIds(ctx, project._id, [scenario._id])
    }

    await replaceScenarioDependencies(ctx, {
      projectId: project._id,
      scenarioId: scenario._id,
      dependsOnScenarioIds: args.dependsOnScenarioIds,
    })
    await validateProjectDependencyGraph(ctx, project._id)
    await rebuildScenarioNavigationMetadata(ctx, project._id)

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
    await rebuildScenarioNavigationMetadata(ctx, project._id)

    return {
      deletedScenarioId: scenario._id,
      deletedScenarioSlug: scenario.slug,
    }
  },
})
