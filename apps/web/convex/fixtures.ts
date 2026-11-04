import { ConvexError, v } from "convex/values"
import {
  createUniqueSlug,
  evaluationCheckSchema,
  FIXTURE_MAX_HEALTH_CHECKS,
  FIXTURE_MAX_STEPS,
  FIXTURE_OPERATION_LEASE_MS,
  FIXTURE_PREFLIGHT_MAX_AGE_MS,
  finishFixtureOperationRequestSchema,
  fixtureDescriptionSchema,
  fixtureDoneWhenSchema,
  fixtureInputSchema,
  fixtureInstructionsSchema,
  fixtureLocatorSchema,
  fixtureMutationScopeSchema,
  fixtureNameSchema,
  fixtureProtectionSchema,
  mergeFixtureRequirements,
  normalizeSlug,
  runEnvironmentSchema,
  type EffectiveFixtureRequirement,
  type FixtureAccess,
  type FixtureEnvironmentHealth,
  type FixturePreflightEntry,
} from "@workspace/contracts"
import { z } from "zod"

import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  getActiveFixtureOperations,
  getScenarioBySlug,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
} from "./lib"

type Ctx = QueryCtx | MutationCtx

const RECENT_OPERATION_LIMIT = 20
const LEASE_EXPIRY_GRACE_MS = 1_000
const MAX_HEALTH_ENVIRONMENTS = 50

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fixtureAccessValidator = v.union(v.literal("read"), v.literal("mutates"))
const fixtureStepInputValidator = v.object({
  id: v.union(v.null(), v.string()),
  name: v.string(),
  instructions: v.string(),
  doneWhen: v.string(),
})
const fixtureCheckInputValidator = v.object({
  id: v.union(v.null(), v.string()),
  name: v.string(),
  expectation: v.string(),
})
const operationCheckResultValidator = v.object({
  checkId: v.string(),
  name: v.string(),
  verdict: v.union(
    v.literal("passed"),
    v.literal("failed"),
    v.literal("blocked")
  ),
  evidence: v.string(),
})

function validationError(message: string, extra?: Record<string, unknown>): never {
  throw new ConvexError({ code: "validation_error", message, ...extra })
}

function conflict(message: string): never {
  throw new ConvexError({ code: "conflict", message })
}

function notFound(message: string): never {
  throw new ConvexError({ code: "not_found", message })
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : ""
    validationError(`${path}${issue?.message ?? "Invalid fixture input."}`, {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    })
  }

  return parsed.data
}

function newEntryId() {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// Response mappers

export function toFixture(fixture: Doc<"fixtures">) {
  return {
    id: fixture._id,
    projectId: fixture.projectId,
    name: fixture.name,
    slug: fixture.slug,
    description: fixture.description,
    locator: fixture.locator,
    protection: fixture.protection,
    convergeSteps: fixture.convergeSteps,
    healthChecks: fixture.healthChecks,
    resetInstructions: fixture.resetInstructions,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  }
}

export function toFixtureRequirement(requirement: Doc<"fixtureRequirements">) {
  return {
    id: requirement._id,
    projectId: requirement.projectId,
    fixtureId: requirement.fixtureId,
    phaseId: requirement.phaseId,
    scenarioId: requirement.scenarioId,
    access: requirement.access,
    mutationScope: requirement.mutationScope,
    createdAt: requirement.createdAt,
    updatedAt: requirement.updatedAt,
  }
}

export function toFixtureOperation(operation: Doc<"fixtureOperations">) {
  return {
    id: operation._id,
    projectId: operation.projectId,
    fixtureId: operation.fixtureId,
    fixtureSlug: operation.fixtureSlug,
    fixtureName: operation.fixtureName,
    environment: operation.environment,
    targetUrl: operation.targetUrl,
    runId: operation.runId,
    kind: operation.kind,
    executor: operation.executor,
    status: operation.status,
    checkResults: operation.checkResults,
    summary: operation.summary,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    leaseExpiresAt: operation.leaseExpiresAt,
  }
}

// ---------------------------------------------------------------------------
// Lookups and guards

async function getProjectFixture(
  ctx: Ctx,
  projectId: Id<"projects">,
  fixtureId: Id<"fixtures">
) {
  const fixture = await ctx.db.get(fixtureId)

  if (!fixture || fixture.projectId !== projectId) {
    notFound("Fixture not found.")
  }

  return fixture
}

async function getProjectFixtures(ctx: Ctx, projectId: Id<"projects">) {
  return await ctx.db
    .query("fixtures")
    .withIndex("by_project", (query) => query.eq("projectId", projectId))
    .collect()
}

async function getFixtureRequirements(ctx: Ctx, fixtureId: Id<"fixtures">) {
  return await ctx.db
    .query("fixtureRequirements")
    .withIndex("by_fixture", (query) => query.eq("fixtureId", fixtureId))
    .collect()
}

async function ensureUniqueFixtureSlug(
  ctx: Ctx,
  projectId: Id<"projects">,
  desiredSlug: string,
  currentFixtureId?: Id<"fixtures">
) {
  const fixtures = await getProjectFixtures(ctx, projectId)
  return createUniqueSlug(
    normalizeSlug(desiredSlug),
    fixtures
      .filter((fixture) => fixture._id !== currentFixtureId)
      .map((fixture) => fixture.slug)
  )
}

/**
 * Fixture definition and requirement writes stay open while a run is running
 * (the run executes the plan it fetched at start) but wait for maintenance of
 * that fixture in any environment.
 */
async function assertFixtureWritable(
  ctx: Ctx,
  projectId: Id<"projects">,
  fixture: Doc<"fixtures"> | null
) {
  if (!fixture) {
    return
  }

  const active = (
    await getActiveFixtureOperations(ctx, projectId, Date.now())
  ).find((operation) => operation.fixtureId === fixture._id)

  if (active) {
    conflict(
      `Fixture ${fixture.slug} is being maintained (${active.kind} in ${active.environment}). Try again when it finishes.`
    )
  }
}

// ---------------------------------------------------------------------------
// Health

async function getFixtureOperationEnvironments(
  ctx: Ctx,
  fixtureId: Id<"fixtures">
) {
  const environments: string[] = []
  let previous: string | null = null

  // Skip-scan the index so each environment costs one read.
  while (environments.length < MAX_HEALTH_ENVIRONMENTS) {
    const after: string | null = previous
    const next: Doc<"fixtureOperations"> | null = await ctx.db
      .query("fixtureOperations")
      .withIndex("by_fixture_environment_started_at", (query) =>
        after === null
          ? query.eq("fixtureId", fixtureId)
          : query.eq("fixtureId", fixtureId).gt("environment", after)
      )
      .first()

    if (!next) {
      break
    }

    environments.push(next.environment)
    previous = next.environment
  }

  return environments
}

function holdsFixture(
  run: Doc<"runs">,
  fixtureId: string,
  predicate: (entry: FixturePreflightEntry) => boolean
) {
  return (run.fixturePreflight ?? []).some(
    (entry) => entry.fixtureId === fixtureId && predicate(entry)
  )
}

/**
 * True when a run that mutates the fixture in this environment is running or
 * started or finished after `since`. Evidence survives run deletion.
 */
async function hasMutatingRunSince(
  ctx: Ctx,
  args: {
    projectId: Id<"projects">
    environment: string
    fixtureId: Id<"fixtures">
    since: number
  }
) {
  const [state, runningRuns] = await Promise.all([
    getFixtureEnvironmentState(ctx, args.fixtureId, args.environment),
    ctx.db
      .query("runs")
      .withIndex("by_project_status", (query) =>
        query.eq("projectId", args.projectId).eq("status", "running")
      )
      .collect(),
  ])

  return (
    (state !== null && state.lastMutationAt >= args.since) ||
    runningRuns.some(
      (run) =>
        run.environment === args.environment &&
        holdsFixture(
          run,
          args.fixtureId,
          (entry) => entry.access === "mutates"
        )
    )
  )
}

async function getFixtureEnvironmentState(
  ctx: Ctx,
  fixtureId: Id<"fixtures">,
  environment: string
) {
  return await ctx.db
    .query("fixtureEnvironmentStates")
    .withIndex("by_fixture_environment", (query) =>
      query.eq("fixtureId", fixtureId).eq("environment", environment)
    )
    .unique()
}

/**
 * Records that a run mutating these fixtures started or finished now. Runs
 * without an environment cannot be attributed and record nothing.
 */
export async function recordFixtureMutations(
  ctx: MutationCtx,
  run: Pick<Doc<"runs">, "projectId" | "environment" | "fixturePreflight">,
  at: number
) {
  if (!run.environment) {
    return
  }

  for (const entry of run.fixturePreflight ?? []) {
    if (entry.access !== "mutates") {
      continue
    }
    const fixtureId = ctx.db.normalizeId("fixtures", entry.fixtureId)
    if (!fixtureId || !(await ctx.db.get(fixtureId))) {
      continue
    }
    const state = await getFixtureEnvironmentState(
      ctx,
      fixtureId,
      run.environment
    )
    if (state) {
      await ctx.db.patch(state._id, {
        lastMutationAt: Math.max(state.lastMutationAt, at),
      })
    } else {
      await ctx.db.insert("fixtureEnvironmentStates", {
        projectId: run.projectId,
        fixtureId,
        environment: run.environment,
        lastMutationAt: at,
      })
    }
  }
}

/**
 * The latest finished operation for a fixture and environment, plus the
 * operations still holding a lease that started after it. A running
 * operation past its lease counts as interrupted.
 */
async function getLatestFixtureOperations(
  ctx: Ctx,
  fixtureId: Id<"fixtures">,
  environment: string,
  now: number
) {
  const active: Array<Doc<"fixtureOperations">> = []
  const operations = ctx.db
    .query("fixtureOperations")
    .withIndex("by_fixture_environment_started_at", (query) =>
      query.eq("fixtureId", fixtureId).eq("environment", environment)
    )
    .order("desc")

  for await (const operation of operations) {
    if (operation.status === "running" && operation.leaseExpiresAt > now) {
      active.push(operation)
      continue
    }
    return { latestFinished: operation, active }
  }

  return { latestFinished: null, active }
}

export async function deriveFixtureHealth(
  ctx: Ctx,
  project: Doc<"projects">,
  fixture: Doc<"fixtures">,
  now: number
): Promise<FixtureEnvironmentHealth[]> {
  const environments = [
    ...new Set([
      ...(project.runEnvironmentNames ?? []),
      ...(await getFixtureOperationEnvironments(ctx, fixture._id)),
    ]),
  ].sort()
  const health: FixtureEnvironmentHealth[] = []

  for (const environment of environments) {
    const { latestFinished: decisive, active } =
      await getLatestFixtureOperations(ctx, fixture._id, environment, now)
    const busy = active.length > 0

    if (!decisive) {
      health.push({
        environment,
        status: "unknown",
        operationId: null,
        checkedAt: null,
        busy,
      })
      continue
    }

    const checkedAt = decisive.finishedAt ?? decisive.leaseExpiresAt
    let status: FixtureEnvironmentHealth["status"] = "unknown"

    if (decisive.kind === "verify" && decisive.status === "failed") {
      status = "unhealthy"
    } else if (
      decisive.kind === "verify" &&
      decisive.status === "succeeded" &&
      !(await hasMutatingRunSince(ctx, {
        projectId: project._id,
        environment,
        fixtureId: fixture._id,
        // A mutation that ended while the verify ran may not have been seen.
        since: decisive.startedAt,
      }))
    ) {
      status = "healthy"
    }

    health.push({
      environment,
      status,
      operationId: decisive._id,
      checkedAt,
      busy,
    })
  }

  return health
}

async function toFixtureDetail(
  ctx: Ctx,
  project: Doc<"projects">,
  fixture: Doc<"fixtures">
) {
  const [requirements, health] = await Promise.all([
    getFixtureRequirements(ctx, fixture._id),
    deriveFixtureHealth(ctx, project, fixture, Date.now()),
  ])

  return {
    ...toFixture(fixture),
    requirements: requirements
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(toFixtureRequirement),
    health,
  }
}

async function getFixtureDetail(
  ctx: Ctx,
  project: Doc<"projects">,
  fixtureId: Id<"fixtures">
) {
  const fixture = await ctx.db.get(fixtureId)

  if (!fixture) {
    throw new Error("Failed to persist fixture")
  }

  return await toFixtureDetail(ctx, project, fixture)
}

// ---------------------------------------------------------------------------
// Requirements in execution plans and run selections

export type FixtureRequirementIndex = {
  fixtureById: Map<string, Doc<"fixtures">>
  byPhase: Map<string, Array<Doc<"fixtureRequirements">>>
  byScenario: Map<string, Array<Doc<"fixtureRequirements">>>
  isEmpty: boolean
}

export async function getFixtureRequirementIndex(
  ctx: Ctx,
  projectId: Id<"projects">
): Promise<FixtureRequirementIndex> {
  const requirements = await ctx.db
    .query("fixtureRequirements")
    .withIndex("by_project", (query) => query.eq("projectId", projectId))
    .collect()
  const fixtures =
    requirements.length === 0 ? [] : await getProjectFixtures(ctx, projectId)
  const byPhase = new Map<string, Array<Doc<"fixtureRequirements">>>()
  const byScenario = new Map<string, Array<Doc<"fixtureRequirements">>>()

  for (const requirement of requirements) {
    const [map, key] =
      requirement.phaseId !== null
        ? [byPhase, requirement.phaseId]
        : [byScenario, requirement.scenarioId]

    if (key === null) {
      continue
    }

    map.set(key, [...(map.get(key) ?? []), requirement])
  }

  return {
    fixtureById: new Map(fixtures.map((fixture) => [fixture._id, fixture])),
    byPhase,
    byScenario,
    isEmpty: requirements.length === 0,
  }
}

export function effectiveFixtureRequirements(
  index: FixtureRequirementIndex,
  scenario: { id: string; phaseId?: string | null }
): EffectiveFixtureRequirement[] {
  const phaseId = scenario.phaseId ?? null

  return mergeFixtureRequirements(
    [
      ...(index.byScenario.get(scenario.id) ?? []),
      ...(phaseId === null ? [] : (index.byPhase.get(phaseId) ?? [])),
    ]
      .filter((requirement) => index.fixtureById.has(requirement.fixtureId))
      .map((requirement) => ({
        fixtureId: requirement.fixtureId,
        access: requirement.access,
        mutationScope: requirement.mutationScope,
      }))
  )
}

/** Fixture definitions referenced by a list of effective requirements. */
export function referencedFixtures(
  index: FixtureRequirementIndex,
  requirements: EffectiveFixtureRequirement[]
) {
  const ids = [...new Set(requirements.map((entry) => entry.fixtureId))]
  return ids
    .map((id) => index.fixtureById.get(id))
    .filter((fixture): fixture is Doc<"fixtures"> => fixture !== undefined)
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map(toFixture)
}

/** The fixtures a set of scenarios requires, with mutating access winning. */
export function requiredFixturesForScenarios(
  index: FixtureRequirementIndex,
  scenarios: Array<{ id: string; phaseId?: string | null }>
) {
  const required = new Map<
    string,
    { fixture: Doc<"fixtures">; access: FixtureAccess }
  >()

  for (const scenario of scenarios) {
    for (const requirement of effectiveFixtureRequirements(index, scenario)) {
      const fixture = index.fixtureById.get(requirement.fixtureId)
      if (!fixture) {
        continue
      }
      const current = required.get(fixture._id)
      required.set(fixture._id, {
        fixture,
        access:
          current?.access === "mutates" || requirement.access === "mutates"
            ? "mutates"
            : "read",
      })
    }
  }

  return [...required.values()]
}

/** Resolves the scenarios a single-scenario run executes. */
export async function getSingleRunScenarios(
  ctx: Ctx,
  projectId: Id<"projects">,
  scenarioSlug: string | null
) {
  const scenario = scenarioSlug
    ? await getScenarioBySlug(ctx, projectId, scenarioSlug)
    : null

  return scenario ? [{ id: scenario._id, phaseId: scenario.phaseId ?? null }] : []
}

/**
 * Validates the CLI's fixture preflight against the fixtures a run selection
 * requires and returns the snapshot to store on the run.
 */
export async function validateRunFixturePreflight(
  ctx: Ctx,
  args: {
    projectId: Id<"projects">
    required: Array<{ fixture: Doc<"fixtures">; access: FixtureAccess }>
    preflight:
      | Array<{
          fixtureId: string
          outcome: "healthy" | "repaired" | "skipped"
          operationId: string | null
        }>
      | undefined
    environment: { environment: string; targetUrl: string } | null
    now: number
  }
) {
  if (args.required.length === 0) {
    if (args.preflight && args.preflight.length > 0) {
      conflict("Fixture requirements changed since preflight; rerun.")
    }
    return null
  }

  if (args.preflight === undefined) {
    conflict(
      "This selection requires fixtures; caracara 0.8.0 or newer is required to run it."
    )
  }

  const entries = args.preflight
  const requiredIds = new Set(args.required.map(({ fixture }) => fixture._id))
  if (
    new Set(entries.map((entry) => entry.fixtureId)).size !== entries.length ||
    entries.length !== requiredIds.size ||
    entries.some((entry) => !requiredIds.has(entry.fixtureId as Id<"fixtures">))
  ) {
    conflict("Fixture requirements changed since preflight; rerun.")
  }

  const snapshot: FixturePreflightEntry[] = []
  const operationIds: Array<Id<"fixtureOperations">> = []

  for (const { fixture, access } of args.required) {
    const entry = entries.find((candidate) => candidate.fixtureId === fixture._id)
    if (!entry) {
      conflict("Fixture requirements changed since preflight; rerun.")
    }

    if (entry.outcome === "skipped") {
      if (entry.operationId !== null) {
        validationError("Skipped fixtures have no preflight operation.")
      }
    } else {
      const operation = await validatePreflightOperation(ctx, {
        projectId: args.projectId,
        fixture,
        operationId: entry.operationId,
        environment: args.environment,
        now: args.now,
      })
      operationIds.push(operation._id)
    }

    snapshot.push({
      fixtureId: fixture._id,
      fixtureSlug: fixture.slug,
      fixtureName: fixture.name,
      access,
      outcome: entry.outcome,
      operationId: entry.operationId,
    })
  }

  return { snapshot, operationIds }
}

async function validatePreflightOperation(
  ctx: Ctx,
  args: {
    projectId: Id<"projects">
    fixture: Doc<"fixtures">
    operationId: string | null
    environment: { environment: string; targetUrl: string } | null
    now: number
  }
) {
  const label = `Fixture ${args.fixture.slug}`
  const operationId =
    args.operationId === null
      ? null
      : ctx.db.normalizeId("fixtureOperations", args.operationId)
  const operation = operationId ? await ctx.db.get(operationId) : null

  if (
    !operation ||
    operation.projectId !== args.projectId ||
    operation.fixtureId !== args.fixture._id ||
    operation.kind !== "verify"
  ) {
    validationError(`${label}: preflight must name a verify operation of it.`)
  }
  if (!args.environment) {
    validationError(`${label}: a verified preflight requires a run environment.`)
  }
  if (
    operation.environment !== args.environment.environment ||
    operation.targetUrl !== args.environment.targetUrl
  ) {
    validationError(
      `${label}: the preflight verify ran against another environment or target URL.`
    )
  }
  if (operation.status !== "succeeded" || operation.finishedAt === null) {
    validationError(`${label}: the preflight verify did not succeed.`)
  }
  if (operation.runId !== null || operation.consumedAt !== undefined) {
    conflict(`${label}: the preflight verify already belongs to a run; rerun.`)
  }
  if (args.now - operation.finishedAt > FIXTURE_PREFLIGHT_MAX_AGE_MS) {
    conflict(`${label}: the preflight verify is too old; rerun.`)
  }
  if (operation.startedAt < args.fixture.updatedAt) {
    conflict(`${label}: the fixture changed after it was verified; rerun.`)
  }

  // Only newer verifies that succeeded or are still running may follow it;
  // anything else (maintenance, a failed or interrupted verify) replaces it.
  // Walk newest first and stop at the verify: the index breaks start-time ties
  // by creation order, so operations sharing its millisecond stay ordered.
  const newestFirst = ctx.db
    .query("fixtureOperations")
    .withIndex("by_fixture_environment_started_at", (query) =>
      query
        .eq("fixtureId", args.fixture._id)
        .eq("environment", operation.environment)
        .gte("startedAt", operation.startedAt)
    )
    .order("desc")
  for await (const candidate of newestFirst) {
    if (candidate._id === operation._id) {
      break
    }
    const stillRunning =
      candidate.status === "running" && candidate.leaseExpiresAt > args.now
    if (
      candidate.kind !== "verify" ||
      !(candidate.status === "succeeded" || stillRunning)
    ) {
      conflict(
        `${label}: a newer fixture operation replaced this verify; rerun.`
      )
    }
  }
  if (
    await hasMutatingRunSince(ctx, {
      projectId: args.projectId,
      environment: operation.environment,
      fixtureId: args.fixture._id,
      // A mutation that ended while the verify ran may not have been seen.
      since: operation.startedAt,
    })
  ) {
    conflict(
      `${label}: a run that changes it ran or is running since it was verified; rerun.`
    )
  }

  return operation
}

/**
 * Two running runs in one environment cannot share a fixture that either of
 * them mutates.
 */
export async function assertNoConflictingFixtureRun(
  ctx: Ctx,
  args: {
    projectId: Id<"projects">
    environment: string | null
    snapshot: FixturePreflightEntry[]
  }
) {
  const runningRuns = await ctx.db
    .query("runs")
    .withIndex("by_project_status", (query) =>
      query.eq("projectId", args.projectId).eq("status", "running")
    )
    .collect()

  for (const run of runningRuns) {
    if ((run.environment ?? null) !== args.environment) {
      continue
    }
    for (const entry of args.snapshot) {
      const other = (run.fixturePreflight ?? []).find(
        (candidate) => candidate.fixtureId === entry.fixtureId
      )
      if (other && (other.access === "mutates" || entry.access === "mutates")) {
        conflict(
          `Run ${run.name} is running in ${args.environment ?? "this environment"} and shares fixture ${entry.fixtureSlug}, which one of the runs changes.`
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Input normalization

type StepInput = {
  id: string | null
  name: string
  instructions: string
  doneWhen: string
}
type CheckInput = { id: string | null; name: string; expectation: string }

function resolveEntryIds<T extends { id: string | null }>(
  entries: T[],
  existingIds: Set<string>,
  label: string
) {
  const seen = new Set<string>()

  return entries.map((entry) => {
    if (entry.id !== null) {
      if (!existingIds.has(entry.id)) {
        validationError(`${label} ${entry.id} does not belong to this fixture.`)
      }
      if (seen.has(entry.id)) {
        validationError(`${label} IDs must be unique.`)
      }
      seen.add(entry.id)
      return { ...entry, id: entry.id }
    }
    return { ...entry, id: newEntryId() }
  })
}

function parseFullFixtureInput(
  input: {
    name: string
    slug?: string
    description: string
    locator: string
    protection: string
    resetInstructions: string | null
    convergeSteps: StepInput[]
    healthChecks: CheckInput[]
  },
  existing: Doc<"fixtures"> | null
) {
  const parsed = parseOrThrow(fixtureInputSchema, input)

  return {
    ...parsed,
    convergeSteps: resolveEntryIds(
      parsed.convergeSteps,
      new Set(existing?.convergeSteps.map((step) => step.id) ?? []),
      "Converge step"
    ),
    healthChecks: resolveEntryIds(
      parsed.healthChecks,
      new Set(existing?.healthChecks.map((check) => check.id) ?? []),
      "Health check"
    ),
  }
}

const stepFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instructions: fixtureInstructionsSchema,
  doneWhen: fixtureDoneWhenSchema,
})

const fixtureDetailsPatchSchema = z.object({
  name: fixtureNameSchema.optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  description: fixtureDescriptionSchema.optional(),
  locator: fixtureLocatorSchema.optional(),
  protection: fixtureProtectionSchema.optional(),
  resetInstructions: fixtureInstructionsSchema.nullable().optional(),
})

async function patchFixture(
  ctx: MutationCtx,
  project: Doc<"projects">,
  fixture: Doc<"fixtures">,
  patch: Partial<
    Pick<
      Doc<"fixtures">,
      | "name"
      | "slug"
      | "description"
      | "locator"
      | "protection"
      | "resetInstructions"
      | "convergeSteps"
      | "healthChecks"
    >
  >
) {
  if (patch.convergeSteps && patch.convergeSteps.length > FIXTURE_MAX_STEPS) {
    validationError(`A fixture has at most ${FIXTURE_MAX_STEPS} converge steps.`)
  }
  if (
    patch.healthChecks &&
    patch.healthChecks.length > FIXTURE_MAX_HEALTH_CHECKS
  ) {
    validationError(
      `A fixture has at most ${FIXTURE_MAX_HEALTH_CHECKS} health checks.`
    )
  }

  await ctx.db.patch(fixture._id, {
    ...patch,
    updatedAt: Math.max(Date.now(), fixture.updatedAt + 1),
  })

  return await getFixtureDetail(ctx, project, fixture._id)
}

async function loadWritableFixture(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  fixtureId: Id<"fixtures">
) {
  const { project } = await requireProjectOwnerById(ctx, projectId)
  const fixture = await getProjectFixture(ctx, project._id, fixtureId)
  await assertFixtureWritable(ctx, project._id, fixture)
  return { project, fixture }
}

// ---------------------------------------------------------------------------
// Queries

export const listForProject = query({
  args: { projectSlug: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const fixtures = await getProjectFixtures(ctx, project._id)

    return await Promise.all(
      fixtures
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((fixture) => toFixtureDetail(ctx, project, fixture))
    )
  },
})

export const getBySlugForProject = query({
  args: { projectSlug: v.string(), fixtureSlug: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const fixture = await ctx.db
      .query("fixtures")
      .withIndex("by_project_slug", (query) =>
        query.eq("projectId", project._id).eq("slug", args.fixtureSlug)
      )
      .unique()

    return fixture ? await toFixtureDetail(ctx, project, fixture) : null
  },
})

export const listOperationsForFixture = query({
  args: {
    projectSlug: v.string(),
    fixtureId: v.id("fixtures"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const fixture = await ctx.db.get(args.fixtureId)

    if (!fixture || fixture.projectId !== project._id) {
      return []
    }

    const limit = Math.min(
      Math.max(Math.trunc(args.limit ?? RECENT_OPERATION_LIMIT), 1),
      100
    )
    const environments = await getFixtureOperationEnvironments(
      ctx,
      fixture._id
    )
    const perEnvironment = await Promise.all(
      environments.map((environment) =>
        ctx.db
          .query("fixtureOperations")
          .withIndex("by_fixture_environment_started_at", (query) =>
            query.eq("fixtureId", fixture._id).eq("environment", environment)
          )
          .order("desc")
          .take(limit)
      )
    )

    return perEnvironment
      .flat()
      .sort((left, right) => right.startedAt - left.startedAt)
      .slice(0, limit)
      .map(toFixtureOperation)
  },
})

export const listOperationsForRun = query({
  args: { projectSlug: v.string(), runId: v.id("runs") },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const run = await ctx.db.get(args.runId)

    if (!run || run.projectId !== project._id) {
      return []
    }

    const operations = await ctx.db
      .query("fixtureOperations")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .collect()

    return operations
      .sort((left, right) => left.startedAt - right.startedAt)
      .map(toFixtureOperation)
  },
})

// ---------------------------------------------------------------------------
// Definition writes

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    locator: v.optional(v.string()),
    protection: v.optional(v.string()),
    resetInstructions: v.optional(v.union(v.null(), v.string())),
    convergeSteps: v.optional(v.array(fixtureStepInputValidator)),
    healthChecks: v.optional(v.array(fixtureCheckInputValidator)),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    const input = parseFullFixtureInput(
      {
        name: args.name,
        slug: args.slug,
        description: args.description ?? "",
        locator: args.locator ?? "",
        protection: args.protection ?? "",
        resetInstructions: args.resetInstructions ?? null,
        convergeSteps: args.convergeSteps ?? [],
        healthChecks: args.healthChecks ?? [],
      },
      null
    )
    await assertFixtureWritable(ctx, project._id, null)
    const timestamp = Date.now()
    const fixtureId = await ctx.db.insert("fixtures", {
      projectId: project._id,
      name: input.name,
      slug: await ensureUniqueFixtureSlug(
        ctx,
        project._id,
        input.slug ?? input.name
      ),
      description: input.description,
      locator: input.locator,
      protection: input.protection,
      convergeSteps: input.convergeSteps,
      healthChecks: input.healthChecks,
      resetInstructions: input.resetInstructions,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    return await getFixtureDetail(ctx, project, fixtureId)
  },
})

/** Web editor save: replaces the whole definition, keeping known entry IDs. */
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.string(),
    locator: v.string(),
    protection: v.string(),
    resetInstructions: v.union(v.null(), v.string()),
    convergeSteps: v.array(fixtureStepInputValidator),
    healthChecks: v.array(fixtureCheckInputValidator),
  },
  handler: async (ctx, args) => {
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    const input = parseFullFixtureInput(args, fixture)

    return await patchFixture(ctx, project, fixture, {
      name: input.name,
      slug:
        input.slug === undefined
          ? fixture.slug
          : await ensureUniqueFixtureSlug(
              ctx,
              project._id,
              input.slug,
              fixture._id
            ),
      description: input.description,
      locator: input.locator,
      protection: input.protection,
      resetInstructions: input.resetInstructions,
      convergeSteps: input.convergeSteps,
      healthChecks: input.healthChecks,
    })
  },
})

/** CLI `updateFixture`: changes only the provided fields. */
export const updateDetails = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    locator: v.optional(v.string()),
    protection: v.optional(v.string()),
    resetInstructions: v.optional(v.union(v.null(), v.string())),
  },
  handler: async (ctx, args) => {
    const patch = parseOrThrow(fixtureDetailsPatchSchema, {
      name: args.name,
      slug: args.slug,
      description: args.description,
      locator: args.locator,
      protection: args.protection,
      resetInstructions: args.resetInstructions,
    })
    if (Object.values(patch).every((value) => value === undefined)) {
      validationError("updateFixture requires at least one change.")
    }
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )

    return await patchFixture(ctx, project, fixture, {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.slug === undefined
        ? {}
        : {
            slug: await ensureUniqueFixtureSlug(
              ctx,
              project._id,
              patch.slug,
              fixture._id
            ),
          }),
      ...(patch.description === undefined
        ? {}
        : { description: patch.description }),
      ...(patch.locator === undefined ? {} : { locator: patch.locator }),
      ...(patch.protection === undefined
        ? {}
        : { protection: patch.protection }),
      ...(patch.resetInstructions === undefined
        ? {}
        : { resetInstructions: patch.resetInstructions }),
    })
  },
})

export const remove = mutation({
  args: { projectId: v.id("projects"), fixtureId: v.id("fixtures") },
  handler: async (ctx, args) => {
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    // A running run resets and verifies the fixtures in its preflight snapshot
    // after its scenarios, so the fixture must exist until that run ends.
    const holder = (
      await ctx.db
        .query("runs")
        .withIndex("by_project_status", (query) =>
          query.eq("projectId", project._id).eq("status", "running")
        )
        .collect()
    ).find((run) => holdsFixture(run, fixture._id, () => true))
    if (holder) {
      conflict(
        `Fixture deletion is unavailable while run ${holder.name} is running with fixture ${fixture.slug}. Finish or delete that run to continue.`
      )
    }
    const [requirements, operations] = await Promise.all([
      getFixtureRequirements(ctx, fixture._id),
      ctx.db
        .query("fixtureOperations")
        .withIndex("by_fixture_environment_started_at", (query) =>
          query.eq("fixtureId", fixture._id)
        )
        .collect(),
    ])

    for (const requirement of requirements) {
      await ctx.db.delete(requirement._id)
    }
    const states = await ctx.db
      .query("fixtureEnvironmentStates")
      .withIndex("by_fixture_environment", (query) =>
        query.eq("fixtureId", fixture._id)
      )
      .collect()
    for (const state of states) {
      await ctx.db.delete(state._id)
    }
    // Operation history stays with its fixture slug and name snapshot.
    for (const operation of operations) {
      await ctx.db.patch(operation._id, { fixtureId: null })
    }
    await ctx.db.delete(fixture._id)

    return {
      deletedFixtureId: fixture._id,
      deletedFixtureSlug: fixture.slug,
      deletedRequirementCount: requirements.length,
    }
  },
})

export const addStep = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    name: v.string(),
    instructions: v.string(),
    doneWhen: v.string(),
  },
  handler: async (ctx, args) => {
    const fields = parseOrThrow(stepFieldsSchema, args)
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )

    return await patchFixture(ctx, project, fixture, {
      convergeSteps: [...fixture.convergeSteps, { id: newEntryId(), ...fields }],
    })
  },
})

export const updateStep = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    stepId: v.string(),
    name: v.optional(v.string()),
    instructions: v.optional(v.string()),
    doneWhen: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fields = parseOrThrow(stepFieldsSchema.partial(), {
      name: args.name,
      instructions: args.instructions,
      doneWhen: args.doneWhen,
    })
    if (Object.values(fields).every((value) => value === undefined)) {
      validationError(
        "updateFixtureStep requires a name, instructions or done-when."
      )
    }
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    if (!fixture.convergeSteps.some((step) => step.id === args.stepId)) {
      notFound("Converge step not found.")
    }

    return await patchFixture(ctx, project, fixture, {
      convergeSteps: fixture.convergeSteps.map((step) =>
        step.id === args.stepId
          ? {
              ...step,
              name: fields.name ?? step.name,
              instructions: fields.instructions ?? step.instructions,
              doneWhen: fields.doneWhen ?? step.doneWhen,
            }
          : step
      ),
    })
  },
})

export const removeStep = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    stepId: v.string(),
  },
  handler: async (ctx, args) => {
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    if (!fixture.convergeSteps.some((step) => step.id === args.stepId)) {
      notFound("Converge step not found.")
    }

    return await patchFixture(ctx, project, fixture, {
      convergeSteps: fixture.convergeSteps.filter(
        (step) => step.id !== args.stepId
      ),
    })
  },
})

export const addCheck = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    check: v.object({
      id: v.optional(v.string()),
      name: v.string(),
      expectation: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const check = parseOrThrow(evaluationCheckSchema, {
      ...args.check,
      id: args.check.id ?? newEntryId(),
    })
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    if (fixture.healthChecks.some((existing) => existing.id === check.id)) {
      validationError("Health check IDs must be unique.")
    }

    return await patchFixture(ctx, project, fixture, {
      healthChecks: [...fixture.healthChecks, check],
    })
  },
})

export const updateCheck = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    checkId: v.string(),
    name: v.optional(v.string()),
    expectation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fields = parseOrThrow(
      evaluationCheckSchema.pick({ name: true, expectation: true }).partial(),
      { name: args.name, expectation: args.expectation }
    )
    if (fields.name === undefined && fields.expectation === undefined) {
      validationError("updateFixtureCheck requires a name or expectation.")
    }
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    if (!fixture.healthChecks.some((check) => check.id === args.checkId)) {
      notFound("Health check not found.")
    }

    return await patchFixture(ctx, project, fixture, {
      healthChecks: fixture.healthChecks.map((check) =>
        check.id === args.checkId
          ? {
              ...check,
              name: fields.name ?? check.name,
              expectation: fields.expectation ?? check.expectation,
            }
          : check
      ),
    })
  },
})

export const removeCheck = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    checkId: v.string(),
  },
  handler: async (ctx, args) => {
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    if (!fixture.healthChecks.some((check) => check.id === args.checkId)) {
      notFound("Health check not found.")
    }

    return await patchFixture(ctx, project, fixture, {
      healthChecks: fixture.healthChecks.filter(
        (check) => check.id !== args.checkId
      ),
    })
  },
})

// ---------------------------------------------------------------------------
// Requirements

async function resolveRequirementTarget(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  args: { phaseId?: Id<"phases">; scenarioId?: Id<"scenarios"> }
) {
  if ((args.phaseId === undefined) === (args.scenarioId === undefined)) {
    validationError("A fixture requirement targets exactly one phase or scenario.")
  }

  const target =
    args.phaseId !== undefined
      ? await ctx.db.get(args.phaseId)
      : args.scenarioId !== undefined
        ? await ctx.db.get(args.scenarioId)
        : null
  const label = args.phaseId !== undefined ? "Phase" : "Scenario"

  if (!target) {
    notFound(`${label} not found.`)
  }
  if (target.projectId !== projectId) {
    validationError(`${label} does not belong to this project.`)
  }

  return {
    phaseId: args.phaseId ?? null,
    scenarioId: args.scenarioId ?? null,
  }
}

async function findRequirement(
  ctx: MutationCtx,
  fixtureId: Id<"fixtures">,
  target: { phaseId: Id<"phases"> | null; scenarioId: Id<"scenarios"> | null }
) {
  return (await getFixtureRequirements(ctx, fixtureId)).find(
    (requirement) =>
      requirement.phaseId === target.phaseId &&
      requirement.scenarioId === target.scenarioId
  )
}

/** Adds or replaces the requirement of a fixture on one phase or scenario. */
export const setRequirement = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    phaseId: v.optional(v.id("phases")),
    scenarioId: v.optional(v.id("scenarios")),
    access: fixtureAccessValidator,
    mutationScope: v.optional(v.union(v.null(), v.string())),
  },
  handler: async (ctx, args) => {
    const mutationScope =
      args.access === "mutates"
        ? parseOrThrow(
            fixtureMutationScopeSchema,
            args.mutationScope ?? ""
          )
        : null
    if (args.access === "read" && (args.mutationScope ?? "").trim() !== "") {
      validationError("Only a mutating requirement has a mutation scope.")
    }
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    const target = await resolveRequirementTarget(ctx, project._id, args)
    const existing = await findRequirement(ctx, fixture._id, target)
    const timestamp = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        access: args.access,
        mutationScope,
        updatedAt: timestamp,
      })
    } else {
      await ctx.db.insert("fixtureRequirements", {
        projectId: project._id,
        fixtureId: fixture._id,
        ...target,
        access: args.access,
        mutationScope,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }

    return await getFixtureDetail(ctx, project, fixture._id)
  },
})

export const removeRequirement = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    phaseId: v.optional(v.id("phases")),
    scenarioId: v.optional(v.id("scenarios")),
  },
  handler: async (ctx, args) => {
    if ((args.phaseId === undefined) === (args.scenarioId === undefined)) {
      validationError(
        "A fixture requirement targets exactly one phase or scenario."
      )
    }
    const { project, fixture } = await loadWritableFixture(
      ctx,
      args.projectId,
      args.fixtureId
    )
    const existing = await findRequirement(ctx, fixture._id, {
      phaseId: args.phaseId ?? null,
      scenarioId: args.scenarioId ?? null,
    })

    if (!existing) {
      notFound("Fixture requirement not found.")
    }

    await ctx.db.delete(existing._id)

    return await getFixtureDetail(ctx, project, fixture._id)
  },
})

// ---------------------------------------------------------------------------
// Operations

/**
 * Starts a verify, converge or reset operation. One running operation holds a
 * fixture and environment until it finishes or its lease expires.
 */
export const startOperation = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    kind: v.union(
      v.literal("verify"),
      v.literal("converge"),
      v.literal("reset")
    ),
    executor: v.union(v.literal("hook"), v.literal("agent")),
    environment: v.string(),
    targetUrl: v.string(),
    runId: v.optional(v.union(v.null(), v.id("runs"))),
    attemptId: v.string(),
    interruptedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectOwnerById(
      ctx,
      args.projectId
    )
    if (!UUID_PATTERN.test(args.attemptId)) {
      validationError("Attempt ID must be a UUID.")
    }
    const environment = parseOrThrow(runEnvironmentSchema, {
      environment: args.environment,
      targetUrl: args.targetUrl,
    })
    const now = Date.now()
    const existing = await ctx.db
      .query("fixtureOperations")
      .withIndex("by_project_attempt", (query) =>
        query.eq("projectId", project._id).eq("attemptId", args.attemptId)
      )
      .unique()

    if (existing) {
      if (
        existing.fixtureId !== args.fixtureId ||
        existing.kind !== args.kind ||
        existing.environment !== environment.environment
      ) {
        conflict("Attempt ID belongs to another fixture operation.")
      }
      if (args.interruptedAt !== undefined && existing.status === "running") {
        await ctx.db.patch(existing._id, {
          status: "interrupted",
          finishedAt: now,
        })
      }
      const current = await ctx.db.get(existing._id)
      return toFixtureOperation(current ?? existing)
    }

    const fixture = await getProjectFixture(ctx, project._id, args.fixtureId)
    const runId = args.runId ?? null
    if (runId !== null) {
      const run = await ctx.db.get(runId)
      if (
        !run ||
        run.projectId !== project._id ||
        run.ownerUserId !== identity.subject
      ) {
        notFound("Run not found.")
      }
    }

    if (args.interruptedAt === undefined) {
      const running = await ctx.db
        .query("fixtureOperations")
        .withIndex("by_project_status", (query) =>
          query.eq("projectId", project._id).eq("status", "running")
        )
        .collect()

      for (const operation of running) {
        if (
          operation.fixtureId !== fixture._id ||
          operation.environment !== environment.environment
        ) {
          continue
        }
        if (operation.leaseExpiresAt > now) {
          conflict(
            `Fixture ${fixture.slug} is busy in ${environment.environment}: a ${operation.kind} operation is running.`
          )
        }
        await ctx.db.patch(operation._id, {
          status: "interrupted",
          finishedAt: now,
          summary: operation.summary ?? "Lease expired before the operation finished.",
        })
      }

      if (args.kind !== "verify") {
        const runningRuns = await ctx.db
          .query("runs")
          .withIndex("by_project_status", (query) =>
            query.eq("projectId", project._id).eq("status", "running")
          )
          .collect()
        const holder = runningRuns.find(
          (run) =>
            run.environment === environment.environment &&
            holdsFixture(run, fixture._id, (entry) => entry.outcome !== "skipped")
        )
        if (holder) {
          conflict(
            `Run ${holder.name} is running in ${environment.environment} with fixture ${fixture.slug}; ${args.kind} must wait until it finishes.`
          )
        }
      }
    }

    const operationId = await ctx.db.insert("fixtureOperations", {
      projectId: project._id,
      fixtureId: fixture._id,
      fixtureSlug: fixture.slug,
      fixtureName: fixture.name,
      environment: environment.environment,
      targetUrl: environment.targetUrl,
      runId,
      kind: args.kind,
      executor: args.executor,
      status: args.interruptedAt === undefined ? "running" : "interrupted",
      checkResults: [],
      summary: null,
      attemptId: args.attemptId,
      startedAt: now,
      finishedAt: args.interruptedAt === undefined ? null : now,
      leaseExpiresAt: now + FIXTURE_OPERATION_LEASE_MS,
    })
    const operation = await ctx.db.get(operationId)
    if (!operation) {
      throw new Error("Failed to start fixture operation")
    }
    if (operation.status === "running") {
      // Releases the lease in reactive views even if no client ever finishes it.
      await ctx.scheduler.runAt(
        operation.leaseExpiresAt + LEASE_EXPIRY_GRACE_MS,
        internal.fixtures.expireOperation,
        { operationId }
      )
    }

    return toFixtureOperation(operation)
  },
})

/** Marks an operation interrupted once its lease has expired. */
export const expireOperation = internalMutation({
  args: { operationId: v.id("fixtureOperations") },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId)
    const now = Date.now()

    if (!operation || operation.status !== "running") {
      return false
    }
    if (operation.leaseExpiresAt > now) {
      await ctx.scheduler.runAt(
        operation.leaseExpiresAt + LEASE_EXPIRY_GRACE_MS,
        internal.fixtures.expireOperation,
        { operationId: operation._id }
      )
      return false
    }

    await ctx.db.patch(operation._id, {
      status: "interrupted",
      finishedAt: now,
      summary:
        operation.summary ?? "Lease expired before the operation finished.",
    })
    return true
  },
})

export function matchesFinishedFixtureOperation(
  existing: { status: string },
  submitted: { status: string }
) {
  return existing.status === submitted.status
}

export const finishOperation = mutation({
  args: {
    projectId: v.id("projects"),
    operationId: v.id("fixtureOperations"),
    attemptId: v.string(),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("interrupted")
    ),
    checkResults: v.array(operationCheckResultValidator),
    summary: v.union(v.null(), v.string()),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    const operation = await ctx.db.get(args.operationId)

    if (!operation || operation.projectId !== project._id) {
      notFound("Fixture operation not found.")
    }
    if (operation.attemptId !== args.attemptId) {
      conflict("Fixture operation belongs to another attempt.")
    }

    const input = parseOrThrow(finishFixtureOperationRequestSchema, {
      attemptId: args.attemptId,
      status: args.status,
      checkResults: args.checkResults,
      summary: args.summary,
    })

    if (operation.status !== "running") {
      if (matchesFinishedFixtureOperation(operation, input)) {
        return toFixtureOperation(operation)
      }
      conflict("Fixture operation has already finished.")
    }
    if (
      input.status === "succeeded" &&
      input.checkResults.some((check) => check.verdict !== "passed")
    ) {
      validationError("A succeeded fixture operation cannot have unpassed checks.")
    }

    await ctx.db.patch(operation._id, {
      status: input.status,
      checkResults: input.checkResults,
      summary: input.summary,
      finishedAt: Math.max(Date.now(), operation.startedAt),
    })
    const finished = await ctx.db.get(operation._id)
    if (!finished) {
      throw new Error("Failed to finish fixture operation")
    }

    return toFixtureOperation(finished)
  },
})
