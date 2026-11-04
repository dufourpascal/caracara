import { ConvexError, v } from "convex/values"
import {
  createUniqueSlug,
  fixtureRequirementSchema,
  fixtureSchema,
  fixtureStepSchema,
  mergeFixtureRequirements,
  normalizeSlug,
  type Fixture,
} from "@workspace/contracts"
import { z } from "zod"

import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { mutation, query } from "./_generated/server"
import {
  getProjectFixtures,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
} from "./lib"

type Ctx = QueryCtx | MutationCtx
type FixtureRequirementDoc = Doc<"fixtures">["requirements"][number]

// Authoring follows the open-during-runs rule (see assertNoRunningProjectRun):
// the CLI uses the fixture definitions it fetched with the plan.

const fixtureFieldsSchema = z
  .object({
    name: fixtureSchema.shape.name,
    slug: z.string().trim().max(120, "Slug must be 120 characters or fewer."),
    description: fixtureSchema.shape.description,
    locator: fixtureSchema.shape.locator,
    protection: fixtureSchema.shape.protection,
    convergeSteps: z
      .array(fixtureStepSchema.extend({ id: z.guid().optional() }))
      .max(20, "A fixture can have at most 20 converge steps."),
    healthChecks: z
      .array(
        z.object({
          id: z.guid().optional(),
          name: z.string().trim().min(1).max(120),
          expectation: z.string().trim().min(1).max(2_000),
        })
      )
      .max(20, "A fixture can have at most 20 health checks."),
  })
  .partial()

const fieldArgs = {
  name: v.optional(v.string()),
  slug: v.optional(v.string()),
  description: v.optional(v.string()),
  locator: v.optional(v.string()),
  protection: v.optional(v.string()),
  convergeSteps: v.optional(
    v.array(
      v.object({
        id: v.optional(v.string()),
        name: v.string(),
        instructions: v.string(),
        doneWhen: v.string(),
      })
    )
  ),
  healthChecks: v.optional(
    v.array(
      v.object({
        id: v.optional(v.string()),
        name: v.string(),
        expectation: v.string(),
      })
    )
  ),
}

const targetArgs = {
  projectId: v.id("projects"),
  fixtureId: v.id("fixtures"),
  phaseId: v.optional(v.id("phases")),
  scenarioId: v.optional(v.id("scenarios")),
}

function validationError(message: string): never {
  throw new ConvexError({ code: "validation_error", message })
}

function assignIds<T extends { id?: string }>(items: T[], label: string) {
  const assigned = items.map((item) => ({
    ...item,
    id: item.id ?? crypto.randomUUID(),
  }))
  if (new Set(assigned.map((item) => item.id)).size !== assigned.length) {
    validationError(`${label} IDs must be unique.`)
  }
  return assigned
}

/** Validates a full or partial fixture; missing step and check IDs are assigned. */
export function parseFixtureFields(input: z.input<typeof fixtureFieldsSchema>) {
  const parsed = fixtureFieldsSchema.safeParse(input)
  if (!parsed.success) {
    throw new ConvexError({
      code: "validation_error",
      message: "Check the highlighted fixture fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    })
  }
  const { convergeSteps, healthChecks, ...fields } = parsed.data
  return {
    ...fields,
    ...(convergeSteps
      ? { convergeSteps: assignIds(convergeSteps, "Converge step") }
      : {}),
    ...(healthChecks
      ? { healthChecks: assignIds(healthChecks, "Health check") }
      : {}),
  }
}

export function toFixture(fixture: Doc<"fixtures">): Fixture {
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
    requirements: fixture.requirements,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  }
}

async function ensureFixtureOwnership(
  ctx: Ctx,
  fixtureId: Id<"fixtures">,
  projectId: Id<"projects">
) {
  const { project } = await requireProjectOwnerById(ctx, projectId)
  const fixture = await ctx.db.get(fixtureId)

  if (!fixture || fixture.projectId !== project._id) {
    throw new ConvexError({ code: "not_found", message: "Fixture not found." })
  }

  return { project, fixture }
}

async function ensureUniqueFixtureSlug(
  ctx: Ctx,
  projectId: Id<"projects">,
  desiredSlug: string,
  currentFixtureId?: Id<"fixtures">
) {
  const existingSlugs = (await getProjectFixtures(ctx, projectId))
    .filter((fixture) => fixture._id !== currentFixtureId)
    .map((fixture) => fixture.slug)

  return createUniqueSlug(normalizeSlug(desiredSlug), existingSlugs)
}

function isSameTarget(
  left: Pick<FixtureRequirementDoc, "phaseId" | "scenarioId">,
  right: Pick<FixtureRequirementDoc, "phaseId" | "scenarioId">
) {
  return left.phaseId === right.phaseId && left.scenarioId === right.scenarioId
}

/** Replaces the requirement for the same phase or scenario, or appends it. */
export function upsertRequirement(
  requirements: FixtureRequirementDoc[],
  requirement: FixtureRequirementDoc
) {
  return [
    ...requirements.filter((current) => !isSameTarget(current, requirement)),
    requirement,
  ]
}

async function resolveRequirementTarget(
  ctx: Ctx,
  projectId: Id<"projects">,
  args: { phaseId?: Id<"phases">; scenarioId?: Id<"scenarios"> }
) {
  if ((args.phaseId === undefined) === (args.scenarioId === undefined)) {
    validationError("Name exactly one phase or scenario.")
  }
  const target = args.phaseId
    ? await ctx.db.get(args.phaseId)
    : await ctx.db.get(args.scenarioId!)

  if (!target || target.projectId !== projectId) {
    throw new ConvexError({
      code: "not_found",
      message: args.phaseId ? "Phase not found." : "Scenario not found.",
    })
  }

  return { phaseId: args.phaseId ?? null, scenarioId: args.scenarioId ?? null }
}

/** Drops requirements on a deleted phase or scenario from every fixture. */
export async function stripFixtureRequirements(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  targetId: Id<"phases"> | Id<"scenarios">
) {
  for (const fixture of await getProjectFixtures(ctx, projectId)) {
    const requirements = fixture.requirements.filter(
      (requirement) =>
        requirement.phaseId !== targetId && requirement.scenarioId !== targetId
    )
    if (requirements.length !== fixture.requirements.length) {
      await ctx.db.patch(fixture._id, { requirements, updatedAt: Date.now() })
    }
  }
}

/**
 * Adds each scenario's merged fixture requirements (its own and its phase's)
 * and returns the definitions of the fixtures the scenarios require.
 */
export function attachFixtureRequirements<
  Scenario extends { id: string; phaseId?: string | null },
>(scenarios: Scenario[], fixtures: Doc<"fixtures">[]) {
  const withRequirements = scenarios.map((scenario) => ({
    ...scenario,
    fixtureRequirements: mergeFixtureRequirements(
      fixtures.flatMap((fixture) =>
        fixture.requirements
          .filter(
            (requirement) =>
              requirement.scenarioId === scenario.id ||
              (requirement.phaseId !== null &&
                requirement.phaseId === (scenario.phaseId ?? null))
          )
          .map((requirement) => ({
            fixtureId: fixture._id as string,
            access: requirement.access,
            mutationScope: requirement.mutationScope,
          }))
      )
    ),
  }))
  const requiredIds = new Set(
    withRequirements.flatMap((scenario) =>
      scenario.fixtureRequirements.map((requirement) => requirement.fixtureId)
    )
  )

  return {
    scenarios: withRequirements,
    fixtures: fixtures
      .filter((fixture) => requiredIds.has(fixture._id))
      .map(toFixture),
  }
}

export const listForProject = query({
  args: { projectSlug: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const fixtures = await getProjectFixtures(ctx, project._id)

    return fixtures
      .map(toFixture)
      .sort((left, right) => left.createdAt - right.createdAt)
  },
})

export const create = mutation({
  args: { projectId: v.id("projects"), ...fieldArgs, name: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    // The schema strips the ID arguments.
    const fields = parseFixtureFields(args)
    const timestamp = Date.now()
    const fixtureId = await ctx.db.insert("fixtures", {
      projectId: project._id,
      name: fields.name!,
      slug: await ensureUniqueFixtureSlug(
        ctx,
        project._id,
        fields.slug || fields.name!
      ),
      description: fields.description ?? "",
      locator: fields.locator ?? "",
      protection: fields.protection ?? "",
      convergeSteps: fields.convergeSteps ?? [],
      healthChecks: fields.healthChecks ?? [],
      requirements: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    return toFixture((await ctx.db.get(fixtureId))!)
  },
})

/** Partial update: given fields replace stored ones; arrays replace wholesale. */
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    fixtureId: v.id("fixtures"),
    ...fieldArgs,
  },
  handler: async (ctx, args) => {
    const { project, fixture } = await ensureFixtureOwnership(
      ctx,
      args.fixtureId,
      args.projectId
    )
    const { slug, ...fields } = parseFixtureFields(args)
    await ctx.db.patch(fixture._id, {
      ...fields,
      ...(slug === undefined
        ? {}
        : {
            slug: await ensureUniqueFixtureSlug(
              ctx,
              project._id,
              slug || (fields.name ?? fixture.name),
              fixture._id
            ),
          }),
      updatedAt: Date.now(),
    })

    return toFixture((await ctx.db.get(fixture._id))!)
  },
})

export const remove = mutation({
  args: { projectId: v.id("projects"), fixtureId: v.id("fixtures") },
  handler: async (ctx, args) => {
    const { fixture } = await ensureFixtureOwnership(
      ctx,
      args.fixtureId,
      args.projectId
    )
    // Runs keep their own preflight snapshot, so nothing else references it.
    await ctx.db.delete(fixture._id)

    return { deletedFixtureId: fixture._id, deletedFixtureName: fixture.name }
  },
})

/** Adds the requirement for a phase or scenario, or replaces its access. */
export const setRequirement = mutation({
  args: {
    ...targetArgs,
    access: v.union(v.literal("read"), v.literal("mutates")),
    mutationScope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { project, fixture } = await ensureFixtureOwnership(
      ctx,
      args.fixtureId,
      args.projectId
    )
    const target = await resolveRequirementTarget(ctx, project._id, args)
    const parsed = fixtureRequirementSchema.safeParse({
      ...target,
      access: args.access,
      mutationScope: args.mutationScope ?? null,
    })
    if (!parsed.success) {
      validationError(
        parsed.error.issues[0]?.message ?? "Fixture requirement is invalid."
      )
    }
    await ctx.db.patch(fixture._id, {
      requirements: upsertRequirement(fixture.requirements, {
        ...target,
        access: parsed.data.access,
        mutationScope: parsed.data.mutationScope,
      }),
      updatedAt: Date.now(),
    })

    return toFixture((await ctx.db.get(fixture._id))!)
  },
})

export const removeRequirement = mutation({
  args: targetArgs,
  handler: async (ctx, args) => {
    const { fixture } = await ensureFixtureOwnership(
      ctx,
      args.fixtureId,
      args.projectId
    )
    if ((args.phaseId === undefined) === (args.scenarioId === undefined)) {
      validationError("Name exactly one phase or scenario.")
    }
    const target = {
      phaseId: args.phaseId ?? null,
      scenarioId: args.scenarioId ?? null,
    }
    const requirements = fixture.requirements.filter(
      (requirement) => !isSameTarget(requirement, target)
    )
    if (requirements.length === fixture.requirements.length) {
      throw new ConvexError({
        code: "not_found",
        message: "The fixture has no requirement for that phase or scenario.",
      })
    }
    await ctx.db.patch(fixture._id, { requirements, updatedAt: Date.now() })

    return toFixture((await ctx.db.get(fixture._id))!)
  },
})
