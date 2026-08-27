import { ConvexError, v } from "convex/values"
import { suiteInputSchema } from "@workspace/contracts"

import type { Id } from "./_generated/dataModel"
import type { QueryCtx, MutationCtx } from "./_generated/server"
import { mutation, query } from "./_generated/server"
import {
  assertProjectAuthoringUnlocked,
  ensureSuiteOwnership,
  ensureUniqueSuiteSlug,
  getProjectPhases,
  getProjectSuites,
  getSuiteBySlug,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toSuite,
} from "./lib"

type Ctx = QueryCtx | MutationCtx

export function parseSuiteInput(input: {
  name: string
  slug?: string
  phaseIds: string[]
}) {
  const parsed = suiteInputSchema.safeParse(input)

  if (!parsed.success) {
    throw new ConvexError({
      code: "validation_error",
      message: "Check the highlighted suite fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    })
  }

  return parsed.data
}

export async function validateSuitePhaseIds(
  ctx: Ctx,
  projectId: Id<"projects">,
  phaseIds: Id<"phases">[]
) {
  if (new Set(phaseIds).size !== phaseIds.length) {
    throw new ConvexError({
      code: "validation_error",
      message: "Suite phase IDs must be unique.",
    })
  }

  const projectPhaseIds = new Set(
    (await getProjectPhases(ctx, projectId)).map((phase) => phase._id)
  )

  if (phaseIds.some((phaseId) => !projectPhaseIds.has(phaseId))) {
    throw new ConvexError({
      code: "validation_error",
      message: "Every suite phase must belong to this project.",
    })
  }
}

export const listForProject = query({
  args: { projectSlug: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    const suites = await getProjectSuites(ctx, project._id)

    return suites
      .map(toSuite)
      .sort((left, right) => left.createdAt - right.createdAt)
  },
})

export const getBySlugForProject = query({
  args: {
    projectSlug: v.string(),
    suiteSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.projectSlug)
    return toSuite(await getSuiteBySlug(ctx, project._id, args.suiteSlug))
  },
})

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.optional(v.string()),
    phaseIds: v.array(v.id("phases")),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    await assertProjectAuthoringUnlocked(ctx, project._id)
    const input = parseSuiteInput(args)
    await validateSuitePhaseIds(ctx, project._id, args.phaseIds)
    const timestamp = Date.now()
    const suiteId = await ctx.db.insert("suites", {
      projectId: project._id,
      name: input.name,
      slug: await ensureUniqueSuiteSlug(
        ctx,
        project._id,
        input.slug ?? input.name
      ),
      phaseIds: args.phaseIds,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const suite = await ctx.db.get(suiteId)

    if (!suite) {
      throw new Error("Failed to create suite")
    }

    return toSuite(suite)
  },
})

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    suiteId: v.id("suites"),
    name: v.string(),
    slug: v.string(),
    phaseIds: v.array(v.id("phases")),
  },
  handler: async (ctx, args) => {
    const { project, suite } = await ensureSuiteOwnership(
      ctx,
      args.suiteId,
      args.projectId
    )
    await assertProjectAuthoringUnlocked(ctx, project._id)
    const input = parseSuiteInput(args)
    await validateSuitePhaseIds(ctx, project._id, args.phaseIds)
    await ctx.db.patch(suite._id, {
      name: input.name,
      slug: await ensureUniqueSuiteSlug(
        ctx,
        project._id,
        input.slug ?? input.name,
        suite._id
      ),
      phaseIds: args.phaseIds,
      updatedAt: Date.now(),
    })
    const updated = await ctx.db.get(suite._id)

    if (!updated) {
      throw new Error("Failed to update suite")
    }

    return toSuite(updated)
  },
})

export const remove = mutation({
  args: {
    projectId: v.id("projects"),
    suiteId: v.id("suites"),
  },
  handler: async (ctx, args) => {
    const { project, suite } = await ensureSuiteOwnership(
      ctx,
      args.suiteId,
      args.projectId
    )
    await assertProjectAuthoringUnlocked(ctx, project._id)
    await ctx.db.delete(suite._id)

    return {
      deletedSuiteId: suite._id,
      deletedSuiteName: suite.name,
    }
  },
})
