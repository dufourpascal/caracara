import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import {
  ensureUniqueProjectSlug,
  requireIdentity,
  requireProjectOwnerById,
  requireProjectOwnerBySlug,
  toProject,
} from "./lib"

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
    const timestamp = Date.now()
    const slug = await ensureUniqueProjectSlug(
      ctx,
      identity.subject,
      args.slug ?? args.name
    )
    const projectId = await ctx.db.insert("projects", {
      ownerUserId: identity.subject,
      name: args.name,
      slug,
      description: args.description,
      projectPrompt: args.projectPrompt,
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
    const slug = await ensureUniqueProjectSlug(
      ctx,
      project.ownerUserId,
      args.slug,
      project._id
    )

    await ctx.db.patch(project._id, {
      name: args.name,
      slug,
      description: args.description,
      projectPrompt: args.projectPrompt,
      updatedAt: Date.now(),
    })

    const updatedProject = await ctx.db.get(project._id)
    if (!updatedProject) {
      throw new Error("Failed to update project")
    }

    return toProject(updatedProject)
  },
})
