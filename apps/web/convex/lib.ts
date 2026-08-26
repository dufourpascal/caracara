import { ConvexError } from "convex/values"

import {
  createUniqueSlug,
  formatRunName,
  normalizeSlug,
} from "@workspace/contracts"

import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  assertValidDependencies,
  buildPhaseExecutionPlan,
  filterDependenciesForPhaseExecution,
  type DependencyEdge,
  type PhaseNode,
  type ScenarioNode,
} from "./domain"

type Ctx = QueryCtx | MutationCtx
export const UNASSIGNED_SCENARIO_PHASE_KEY = "__unassigned__"

function toTimestamp(value: number) {
  return Math.trunc(value)
}

function normalizePhaseId<T>(value: T | null | undefined) {
  return value ?? null
}

function getScenarioPhaseFilterKey(phaseId: string | null) {
  return phaseId ?? UNASSIGNED_SCENARIO_PHASE_KEY
}

function toPhaseNode(phase: Doc<"phases">): PhaseNode {
  return {
    id: phase._id,
    name: phase.name,
    order: phase.order,
  }
}

function toScenarioNode(args: {
  scenario: Doc<"scenarios">
  phaseById: Map<string, Doc<"phases">>
}): ScenarioNode {
  const phaseId = normalizePhaseId(args.scenario.phaseId)
  const phase = phaseId ? (args.phaseById.get(phaseId) ?? null) : null

  return {
    id: args.scenario._id,
    slug: args.scenario.slug,
    name: args.scenario.name,
    status: args.scenario.status,
    instructions: args.scenario.instructions,
    evaluationChecks: args.scenario.evaluationChecks,
    phaseId,
    phaseName: phase?.name ?? null,
    phaseOrder: phase?.order ?? null,
  }
}

function toDependencyEdges(
  dependencies: Array<Doc<"scenarioDependencies">>
): DependencyEdge[] {
  return dependencies.map((dependency) => ({
    scenarioId: dependency.scenarioId,
    dependsOnScenarioId: dependency.dependsOnScenarioId,
  }))
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

export async function assertProjectAuthoringUnlocked(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const runningRun = await ctx.db
    .query("runs")
    .withIndex("by_project_status", (query) =>
      query.eq("projectId", projectId).eq("status", "running")
    )
    .first()

  if (runningRun) {
    throw new ConvexError({
      code: "conflict",
      message: `Authoring is unavailable while run ${runningRun.name} is running.`,
    })
  }
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

export function toPhase(phase: Doc<"phases">, scenarioCount?: number) {
  return {
    id: phase._id,
    projectId: phase.projectId,
    name: phase.name,
    order: phase.order,
    scenarioCount,
    createdAt: phase.createdAt,
    updatedAt: phase.updatedAt,
  }
}

export function toScenario(
  scenario: Doc<"scenarios">,
  phase?: Doc<"phases"> | null
) {
  return {
    id: scenario._id,
    projectId: scenario.projectId,
    name: scenario.name,
    slug: scenario.slug,
    status: scenario.status,
    instructions: scenario.instructions,
    evaluationChecks: scenario.evaluationChecks,
    phaseId: normalizePhaseId(scenario.phaseId),
    phaseName: phase?.name ?? null,
    phaseOrder: phase?.order ?? null,
    updatedAt: scenario.updatedAt,
  }
}

export function toScenarioSummary(
  scenario: Doc<"scenarios">,
  phase?: Doc<"phases"> | null
) {
  return {
    id: scenario._id,
    name: scenario.name,
    slug: scenario.slug,
    status: scenario.status,
    phaseId: normalizePhaseId(scenario.phaseId),
    phaseName: phase?.name ?? null,
    phaseOrder: phase?.order ?? null,
    dependencyCount: scenario.dependencyCount ?? 0,
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
    requestedPhaseOrder: run.requestedPhaseOrder ?? null,
    runnerType: run.runnerType,
    evidencePolicy: run.evidencePolicy ?? "text_only",
    passedCheckCount: run.passedCheckCount,
    totalCheckCount: run.totalCheckCount,
    passRate:
      run.status === "completed" && run.totalCheckCount > 0
        ? Math.round((100 * run.passedCheckCount) / run.totalCheckCount)
        : null,
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
    evaluationChecks: result.evaluationChecks,
    checkResults: result.checkResults,
    phaseId: result.phaseId ?? null,
    phaseName: result.phaseName ?? null,
    phaseOrder: result.phaseOrder ?? null,
    sequenceIndex: result.sequenceIndex,
    status: result.status,
    runnerType: result.runnerType,
    executionSummary: result.executionSummary,
    failureDetail: result.failureDetail,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    submittedAt: toTimestamp(result._creationTime),
  }
}

export function toRunEvidence(evidence: Doc<"runEvidence">) {
  return {
    id: evidence._id,
    checkId: evidence.checkId,
    kind: evidence.kind,
    contentType: evidence.contentType,
    byteSize: evidence.byteSize,
    sha256: evidence.sha256,
    createdAt: evidence.createdAt,
  }
}

export async function getProjectScenarios(ctx: Ctx, projectId: Id<"projects">) {
  return await ctx.db
    .query("scenarios")
    .withIndex("by_project", (query) => query.eq("projectId", projectId))
    .collect()
}

export function deriveScenarioNavigationMetadata(args: {
  phases: Array<Doc<"phases">>
  scenarios: Array<Doc<"scenarios">>
  dependencies: Array<Doc<"scenarioDependencies">>
}) {
  const phaseById = new Map(args.phases.map((phase) => [phase._id, phase]))
  const scenarioNodes = args.scenarios.map((scenario) =>
    toScenarioNode({
      scenario,
      phaseById,
    })
  )
  const dependencyEdges = toDependencyEdges(args.dependencies)

  assertValidDependencies(scenarioNodes, dependencyEdges)
  const filteredDependencies = filterDependenciesForPhaseExecution(
    scenarioNodes,
    dependencyEdges
  )
  const executionPlan = buildPhaseExecutionPlan(
    args.phases.map(toPhaseNode),
    scenarioNodes,
    filteredDependencies,
    { ascending: true }
  )
  const dependencyCounts = new Map<string, number>()

  for (const dependency of filteredDependencies) {
    dependencyCounts.set(
      dependency.scenarioId,
      (dependencyCounts.get(dependency.scenarioId) ?? 0) + 1
    )
  }

  const orderedAssigned = executionPlan.flatMap((phase) => phase.scenarios)
  const assignedIds = new Set(orderedAssigned.map((scenario) => scenario.id))
  const orderedUnassigned = scenarioNodes
    .filter((scenario) => !assignedIds.has(scenario.id))
    .sort((left, right) => left.slug.localeCompare(right.slug))
  const orderedScenarios = [...orderedAssigned, ...orderedUnassigned]
  const phaseOrders = new Map<string, number>()

  return orderedScenarios.map((scenario, index) => {
    const phaseKey = getScenarioPhaseFilterKey(scenario.phaseId ?? null)
    const nextPhaseOrder = (phaseOrders.get(phaseKey) ?? 0) + 1
    phaseOrders.set(phaseKey, nextPhaseOrder)

    return {
      scenarioId: scenario.id,
      navigationOrder: index + 1,
      phaseNavigationOrder: nextPhaseOrder,
      phaseFilterKey: phaseKey,
      dependencyCount: dependencyCounts.get(scenario.id) ?? 0,
      searchText: `${scenario.name} ${scenario.slug}`.trim(),
    }
  })
}

export async function rebuildScenarioNavigationMetadata(
  ctx: MutationCtx,
  projectId: Id<"projects">
) {
  const [phases, scenarios, dependencies] = await Promise.all([
    getProjectPhases(ctx, projectId),
    getProjectScenarios(ctx, projectId),
    getProjectDependencies(ctx, projectId),
  ])
  const metadata = deriveScenarioNavigationMetadata({
    phases,
    scenarios,
    dependencies,
  })
  const metadataByScenarioId = new Map(
    metadata.map((entry) => [entry.scenarioId, entry])
  )

  for (const scenario of scenarios) {
    const nextMetadata = metadataByScenarioId.get(scenario._id)

    if (!nextMetadata) {
      continue
    }

    if (
      scenario.navigationOrder === nextMetadata.navigationOrder &&
      scenario.phaseNavigationOrder === nextMetadata.phaseNavigationOrder &&
      scenario.phaseFilterKey === nextMetadata.phaseFilterKey &&
      scenario.dependencyCount === nextMetadata.dependencyCount &&
      scenario.searchText === nextMetadata.searchText
    ) {
      continue
    }

    await ctx.db.patch(scenario._id, {
      navigationOrder: nextMetadata.navigationOrder,
      phaseNavigationOrder: nextMetadata.phaseNavigationOrder,
      phaseFilterKey: nextMetadata.phaseFilterKey,
      dependencyCount: nextMetadata.dependencyCount,
      searchText: nextMetadata.searchText,
    })
  }
}

export async function getProjectPhases(ctx: Ctx, projectId: Id<"projects">) {
  return await ctx.db
    .query("phases")
    .withIndex("by_project_order", (query) => query.eq("projectId", projectId))
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

export async function getPhaseById(ctx: Ctx, phaseId: Id<"phases">) {
  const phase = await ctx.db.get(phaseId)

  if (!phase) {
    throw new ConvexError({
      code: "not_found",
      message: "Phase not found.",
    })
  }

  return phase
}

export async function getScenarioDependencyIds(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const [phases, scenarios, dependencies] = await Promise.all([
    getProjectPhases(ctx, projectId),
    getProjectScenarios(ctx, projectId),
    getProjectDependencies(ctx, projectId),
  ])
  const phaseById = new Map(phases.map((phase) => [phase._id, phase]))
  const scenarioNodes = scenarios.map((scenario) =>
    toScenarioNode({
      scenario,
      phaseById,
    })
  )
  const validDependencies = filterDependenciesForPhaseExecution(
    scenarioNodes,
    toDependencyEdges(dependencies)
  )
  const idsByScenario = new Map<string, string[]>()

  for (const dependency of validDependencies) {
    const current = idsByScenario.get(dependency.scenarioId) ?? []
    current.push(dependency.dependsOnScenarioId)
    idsByScenario.set(dependency.scenarioId, current)
  }

  return idsByScenario
}

export async function getExecutionPlan(
  ctx: Ctx,
  projectId: Id<"projects">,
  options?: {
    activeOnly?: boolean
    ascending?: boolean
  }
) {
  const [phases, scenarios, dependencies] = await Promise.all([
    getProjectPhases(ctx, projectId),
    getProjectScenarios(ctx, projectId),
    getProjectDependencies(ctx, projectId),
  ])
  const phaseById = new Map(phases.map((phase) => [phase._id, phase]))
  const scenarioNodes = scenarios.map((scenario) =>
    toScenarioNode({
      scenario,
      phaseById,
    })
  )
  const dependencyEdges = toDependencyEdges(dependencies)

  assertValidDependencies(scenarioNodes, dependencyEdges, {
    strictPhaseBoundaries: true,
  })

  const phasesWithScenarios = buildPhaseExecutionPlan(
    phases.map(toPhaseNode),
    scenarioNodes,
    filterDependenciesForPhaseExecution(scenarioNodes, dependencyEdges),
    options
  )
  const dependencyIds = new Map<string, string[]>()

  for (const dependency of filterDependenciesForPhaseExecution(
    scenarioNodes,
    dependencyEdges
  )) {
    const current = dependencyIds.get(dependency.scenarioId) ?? []
    current.push(dependency.dependsOnScenarioId)
    dependencyIds.set(dependency.scenarioId, current)
  }
  const unassignedScenarioCount = scenarios.filter(
    (scenario) => normalizePhaseId(scenario.phaseId) === null
  ).length

  return {
    phases: phasesWithScenarios.map(
      ({ phase, scenarios: orderedScenarios }) => ({
        id: phase.id,
        name: phase.name,
        order: phase.order,
        scenarios: orderedScenarios.map((scenario) => ({
          ...scenario,
          dependencyIds: [...(dependencyIds.get(scenario.id) ?? [])].sort(),
        })),
      })
    ),
    unassignedScenarioCount,
  }
}

export async function getOrderedScenarios(
  ctx: Ctx,
  projectId: Id<"projects">,
  options?: {
    activeOnly?: boolean
    ascending?: boolean
  }
) {
  const [phases, scenarios, dependencies] = await Promise.all([
    getProjectPhases(ctx, projectId),
    getProjectScenarios(ctx, projectId),
    getProjectDependencies(ctx, projectId),
  ])
  const phaseById = new Map(phases.map((phase) => [phase._id, phase]))
  const scenarioNodes = scenarios.map((scenario) =>
    toScenarioNode({
      scenario,
      phaseById,
    })
  )
  const dependencyEdges = toDependencyEdges(dependencies)

  assertValidDependencies(scenarioNodes, dependencyEdges)
  const filteredDependencies = filterDependenciesForPhaseExecution(
    scenarioNodes,
    dependencyEdges
  )

  const executionPlan = buildPhaseExecutionPlan(
    phases.map(toPhaseNode),
    scenarioNodes,
    filteredDependencies,
    options
  )
  const dependencyIds = new Map<string, string[]>()

  for (const dependency of filteredDependencies) {
    const current = dependencyIds.get(dependency.scenarioId) ?? []
    current.push(dependency.dependsOnScenarioId)
    dependencyIds.set(dependency.scenarioId, current)
  }
  const orderedAssigned = executionPlan.flatMap((phase) =>
    phase.scenarios.map((scenario) => ({
      ...scenario,
      dependencyIds: [...(dependencyIds.get(scenario.id) ?? [])].sort(),
    }))
  )
  const assignedIds = new Set(orderedAssigned.map((scenario) => scenario.id))
  const compareUnassigned = (left: ScenarioNode, right: ScenarioNode) =>
    options?.ascending === false
      ? right.slug.localeCompare(left.slug)
      : left.slug.localeCompare(right.slug)
  const unassigned = scenarioNodes
    .filter((scenario) => !assignedIds.has(scenario.id))
    .sort(compareUnassigned)
    .map((scenario) => ({
      ...scenario,
      dependencyIds: [],
    }))

  return [...orderedAssigned, ...unassigned]
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

export async function ensureScenarioDependenciesReusable(
  ctx: Ctx,
  projectId: Id<"projects">,
  scenarioIds: Id<"scenarios">[]
) {
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    throw new ConvexError({
      code: "validation_error",
      message: "Dependency IDs must be unique.",
    })
  }

  const scenarios = await getProjectScenarios(ctx, projectId)
  const scenarioIdSet = new Set(scenarios.map((scenario) => scenario._id))

  for (const scenarioId of scenarioIds) {
    if (!scenarioIdSet.has(scenarioId)) {
      throw new ConvexError({
        code: "validation_error",
        message: "Dependencies must reference scenarios in the same project.",
      })
    }
  }
}

export async function replaceScenarioDependencies(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    scenarioId: Id<"scenarios">
    dependsOnScenarioIds: Id<"scenarios">[]
  }
) {
  await ensureScenarioDependenciesReusable(
    ctx,
    args.projectId,
    args.dependsOnScenarioIds
  )

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

export async function deleteDependenciesTouchingScenarioIds(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  scenarioIds: Id<"scenarios">[]
) {
  const idSet = new Set(scenarioIds)
  const dependencies = await getProjectDependencies(ctx, projectId)

  for (const dependency of dependencies) {
    if (
      idSet.has(dependency.scenarioId) ||
      idSet.has(dependency.dependsOnScenarioId)
    ) {
      await ctx.db.delete(dependency._id)
    }
  }
}

export async function normalizeProjectPhaseOrders(
  ctx: MutationCtx,
  projectId: Id<"projects">
) {
  const phases = await getProjectPhases(ctx, projectId)

  for (const [index, phase] of phases.entries()) {
    const nextOrder = index + 1

    if (phase.order !== nextOrder) {
      await ctx.db.patch(phase._id, {
        order: nextOrder,
        updatedAt: Date.now(),
      })
    }
  }
}

export async function validateProjectDependencyGraph(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  try {
    await getExecutionPlan(ctx, projectId)
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error
    }

    throw new ConvexError({
      code: "validation_error",
      message:
        error instanceof Error
          ? error.message
          : "Scenario dependencies are invalid.",
    })
  }
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

export async function getRunById(ctx: Ctx, runId: Id<"runs">) {
  const run = await ctx.db.get(runId)

  if (!run) {
    throw new ConvexError({
      code: "not_found",
      message: "Run not found.",
    })
  }

  return run
}

export async function ensureScenarioOwnership(
  ctx: Ctx,
  scenarioId: Id<"scenarios">,
  expectedProjectId?: Id<"projects">
) {
  const scenario = await getScenarioById(ctx, scenarioId)
  const { project } = await requireProjectOwnerById(ctx, scenario.projectId)

  if (expectedProjectId !== undefined && project._id !== expectedProjectId) {
    throw new ConvexError({
      code: "unauthorized",
      message: "Scenario does not belong to this project.",
    })
  }

  return { project, scenario }
}

export async function ensurePhaseOwnership(
  ctx: Ctx,
  phaseId: Id<"phases">,
  expectedProjectId?: Id<"projects">
) {
  const phase = await getPhaseById(ctx, phaseId)
  const { project } = await requireProjectOwnerById(ctx, phase.projectId)

  if (expectedProjectId !== undefined && project._id !== expectedProjectId) {
    throw new ConvexError({
      code: "unauthorized",
      message: "Phase does not belong to this project.",
    })
  }

  return { project, phase }
}

export async function ensureRunOwnership(ctx: Ctx, runId: Id<"runs">) {
  const run = await getRunById(ctx, runId)
  const { identity, project } = await requireProjectOwnerById(
    ctx,
    run.projectId
  )

  if (run.ownerUserId !== identity.subject) {
    throw new ConvexError({
      code: "unauthorized",
      message: "You do not have access to this run.",
    })
  }

  return { identity, project, run }
}

export async function deleteRunAndResults(ctx: MutationCtx, runId: Id<"runs">) {
  const [evidence, results] = await Promise.all([
    ctx.db
      .query("runEvidence")
      .withIndex("by_run", (query) => query.eq("runId", runId))
      .collect(),
    ctx.db
      .query("scenarioResults")
      .withIndex("by_run", (query) => query.eq("runId", runId))
      .collect(),
  ])

  for (const item of evidence) {
    await ctx.storage.delete(item.storageId)
    await ctx.db.delete(item._id)
  }

  for (const result of results) {
    await ctx.db.delete(result._id)
  }

  await ctx.db.delete(runId)

  return {
    deletedEvidenceCount: evidence.length,
    deletedResultCount: results.length,
  }
}

export async function deleteScenarioResultEvidence(
  ctx: MutationCtx,
  scenarioResultId: Id<"scenarioResults">,
  keepCheckIds: ReadonlySet<string> = new Set()
) {
  const evidence = await ctx.db
    .query("runEvidence")
    .withIndex("by_result", (query) =>
      query.eq("scenarioResultId", scenarioResultId)
    )
    .collect()

  let deletedCount = 0
  for (const item of evidence) {
    if (keepCheckIds.has(item.checkId)) {
      continue
    }
    await ctx.storage.delete(item.storageId)
    await ctx.db.delete(item._id)
    deletedCount += 1
  }

  return deletedCount
}

export function validateFailedCheckEvidence(
  checkResults: Array<{ checkId: string; verdict: string }>,
  evidence: Array<{ checkId: string }>
) {
  const failedCheckIds = checkResults
    .filter((check) => check.verdict === "failed")
    .map((check) => check.checkId)
  const evidenceIds = evidence.map((item) => item.checkId)

  if (
    evidenceIds.length !== failedCheckIds.length ||
    new Set(evidenceIds).size !== evidenceIds.length ||
    failedCheckIds.some((checkId) => !evidenceIds.includes(checkId))
  ) {
    throw new ConvexError({
      code: "validation_error",
      message: "Every failed check requires exactly one screenshot.",
    })
  }
}

export async function deleteProjectCascade(
  ctx: MutationCtx,
  projectId: Id<"projects">
) {
  const [dependencies, phases, scenarios, runs] = await Promise.all([
    getProjectDependencies(ctx, projectId),
    getProjectPhases(ctx, projectId),
    getProjectScenarios(ctx, projectId),
    ctx.db
      .query("runs")
      .withIndex("by_project", (query) => query.eq("projectId", projectId))
      .collect(),
  ])

  let deletedResultCount = 0

  for (const run of runs) {
    const result = await deleteRunAndResults(ctx, run._id)
    deletedResultCount += result.deletedResultCount
  }

  for (const dependency of dependencies) {
    await ctx.db.delete(dependency._id)
  }

  for (const scenario of scenarios) {
    await ctx.db.delete(scenario._id)
  }

  for (const phase of phases) {
    await ctx.db.delete(phase._id)
  }

  await ctx.db.delete(projectId)

  return {
    deletedDependencyCount: dependencies.length,
    deletedPhaseCount: phases.length,
    deletedProjectId: projectId,
    deletedResultCount,
    deletedRunCount: runs.length,
    deletedScenarioCount: scenarios.length,
  }
}

export function createRunName() {
  return formatRunName(new Date())
}

export function validateCompletedCheckResults(
  evaluationChecks: Array<{ id: string }>,
  checkResults: Array<{ checkId: string; evidence: string }>
) {
  const expectedIds = evaluationChecks.map((check) => check.id)
  const returnedIds = checkResults.map((check) => check.checkId)
  if (
    returnedIds.length !== expectedIds.length ||
    new Set(returnedIds).size !== returnedIds.length ||
    expectedIds.some((id) => !returnedIds.includes(id)) ||
    checkResults.some(
      (check) => check.evidence.trim() === "" || check.evidence.length > 2_000
    )
  ) {
    throw new ConvexError({
      code: "validation_error",
      message: "Check results must match the scenario snapshot exactly.",
    })
  }
}

export function validateRunnerMatch(
  runRunnerType: "codex" | "claude-code" | null,
  resultRunnerType: "codex" | "claude-code"
) {
  if (runRunnerType !== resultRunnerType) {
    throw new ConvexError({
      code: "validation_error",
      message: "Scenario runner must match the run runner.",
    })
  }
}

export function matchesTerminalScenarioResult(
  existing: {
    status: string
    checkResults: Array<{
      checkId: string
      verdict: string
      evidence: string
    }>
    executionSummary: string | null
    failureDetail: string | null
    finishedAt: number | null
  },
  submitted: {
    status: string
    checkResults: Array<{
      checkId: string
      verdict: string
      evidence: string
    }>
    executionSummary: string | null
    failureDetail: string | null
    finishedAt: number
  }
) {
  return (
    existing.status === submitted.status &&
    existing.executionSummary === submitted.executionSummary &&
    existing.failureDetail === submitted.failureDetail &&
    existing.finishedAt === submitted.finishedAt &&
    existing.checkResults.length === submitted.checkResults.length &&
    existing.checkResults.every((check, index) => {
      const candidate = submitted.checkResults[index]
      return (
        candidate?.checkId === check.checkId &&
        candidate.verdict === check.verdict &&
        candidate.evidence === check.evidence
      )
    })
  )
}

export async function computeRunCheckCounts(ctx: Ctx, runId: Id<"runs">) {
  const results = await ctx.db
    .query("scenarioResults")
    .withIndex("by_run", (query) => query.eq("runId", runId))
    .collect()
  const completed = results.filter((result) => result.status === "completed")
  return {
    passedCheckCount: completed.reduce(
      (count, result) =>
        count +
        result.checkResults.filter((check) => check.verdict === "passed")
          .length,
      0
    ),
    totalCheckCount: completed.reduce(
      (count, result) => count + result.evaluationChecks.length,
      0
    ),
  }
}
