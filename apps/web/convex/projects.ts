import { ConvexError, v } from "convex/values"
import { projectInputSchema } from "@workspace/contracts"

import { mutation, query } from "./_generated/server"
import {
  assertProjectAuthoringUnlocked,
  deleteProjectCascade,
  ensureUniqueProjectSlug,
  requireIdentity,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toProject,
} from "./lib"

export function parseProjectInput(input: {
  name: string
  slug?: string
  description: string
  projectPrompt: string
}) {
  const parsed = projectInputSchema.safeParse(input)

  if (!parsed.success) {
    throw new ConvexError({
      code: "validation_error",
      message: "Check the highlighted project fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    })
  }

  return parsed.data
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (query) =>
        query.eq("ownerUserId", identity.subject)
      )
      .collect()

    return projects
      .map(toProject)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  },
})

export const getBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerBySlug(ctx, args.slug)
    return toProject(project)
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.string(),
    projectPrompt: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const input = parseProjectInput(args)
    const timestamp = Date.now()
    const slug = await ensureUniqueProjectSlug(
      ctx,
      identity.subject,
      input.slug ?? input.name
    )
    const projectId = await ctx.db.insert("projects", {
      ownerUserId: identity.subject,
      name: input.name,
      slug,
      description: input.description,
      projectPrompt: input.projectPrompt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const project = await ctx.db.get(projectId)
    if (!project) {
      throw new Error("Failed to create project")
    }

    return toProject(project)
  },
})

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    projectPrompt: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)
    const input = parseProjectInput(args)
    const slug = await ensureUniqueProjectSlug(
      ctx,
      project.ownerUserId,
      input.slug ?? input.name,
      project._id
    )

    await ctx.db.patch(project._id, {
      name: input.name,
      slug,
      description: input.description,
      projectPrompt: input.projectPrompt,
      updatedAt: Date.now(),
    })

    const updatedProject = await ctx.db.get(project._id)
    if (!updatedProject) {
      throw new Error("Failed to update project")
    }

    return toProject(updatedProject)
  },
})

export const remove = mutation({
  args: {
    projectId: v.id("projects"),
    slugConfirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwnerById(ctx, args.projectId)

    if (args.slugConfirmation.trim() !== project.slug) {
      throw new ConvexError({
        code: "conflict",
        message: "Project slug confirmation does not match.",
      })
    }

    await assertProjectAuthoringUnlocked(ctx, project._id)
    const result = await deleteProjectCascade(ctx, project._id)

    return {
      ...result,
      deletedProjectSlug: project.slug,
    }
  },
})
