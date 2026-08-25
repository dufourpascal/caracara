import { ConvexError, v } from "convex/values"

import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"

const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024

type UploadTargetArgs = {
  ownerUserId: string
  runId: Id<"runs">
  scenarioResultId: Id<"scenarioResults">
  checkId: string
}

export async function requireUploadTarget(
  ctx: QueryCtx | MutationCtx,
  args: UploadTargetArgs
) {
  const [run, result] = await Promise.all([
    ctx.db.get(args.runId),
    ctx.db.get(args.scenarioResultId),
  ])

  if (!run || !result) {
    throw new ConvexError({
      code: "not_found",
      message: "Run result not found.",
    })
  }
  const project = await ctx.db.get(run.projectId)
  if (
    !project ||
    project.ownerUserId !== args.ownerUserId ||
    run.ownerUserId !== args.ownerUserId ||
    result.runId !== run._id
  ) {
    throw new ConvexError({
      code: "not_found",
      message: "Run result not found.",
    })
  }
  if (
    run.status !== "running" ||
    result.status !== "running" ||
    (run.evidencePolicy ?? "text_only") !== "failed_check_screenshot" ||
    result.runnerType !== "codex"
  ) {
    throw new ConvexError({
      code: "conflict",
      message: "This run result is not accepting screenshot evidence.",
    })
  }
  if (!result.evaluationChecks.some((check) => check.id === args.checkId)) {
    throw new ConvexError({
      code: "validation_error",
      message: "Check ID is not part of the scenario snapshot.",
    })
  }

  return { run, result }
}

export const validateUpload = internalQuery({
  args: {
    ownerUserId: v.string(),
    runId: v.id("runs"),
    scenarioResultId: v.id("scenarioResults"),
    checkId: v.string(),
    byteSize: v.number(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    await requireUploadTarget(ctx, args)
    if (args.byteSize <= 0 || args.byteSize > MAX_SCREENSHOT_BYTES) {
      throw new ConvexError({
        code: "validation_error",
        message: "Screenshot exceeds the 3 MiB limit.",
      })
    }
    if (!/^[a-f0-9]{64}$/.test(args.sha256)) {
      throw new ConvexError({
        code: "validation_error",
        message: "Screenshot digest is invalid.",
      })
    }

    const existing = await ctx.db
      .query("runEvidence")
      .withIndex("by_result_check", (query) =>
        query
          .eq("scenarioResultId", args.scenarioResultId)
          .eq("checkId", args.checkId)
      )
      .unique()

    return existing?.sha256 === args.sha256 &&
      existing.byteSize === args.byteSize
      ? {
          id: existing._id,
          checkId: existing.checkId,
          contentType: existing.contentType,
          byteSize: existing.byteSize,
          sha256: existing.sha256,
        }
      : null
  },
})

export const attach = internalMutation({
  args: {
    ownerUserId: v.string(),
    runId: v.id("runs"),
    scenarioResultId: v.id("scenarioResults"),
    checkId: v.string(),
    storageId: v.id("_storage"),
    byteSize: v.number(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    const { run } = await requireUploadTarget(ctx, args)
    const existing = await ctx.db
      .query("runEvidence")
      .withIndex("by_result_check", (query) =>
        query
          .eq("scenarioResultId", args.scenarioResultId)
          .eq("checkId", args.checkId)
      )
      .unique()
    const values = {
      projectId: run.projectId,
      runId: run._id,
      scenarioResultId: args.scenarioResultId,
      checkId: args.checkId,
      kind: "screenshot" as const,
      storageId: args.storageId,
      contentType: "image/webp" as const,
      byteSize: args.byteSize,
      sha256: args.sha256,
      createdAt: Date.now(),
    }

    const evidenceId =
      existing?._id ?? (await ctx.db.insert("runEvidence", values))
    if (existing) {
      await ctx.db.patch(existing._id, values)
    }

    return {
      evidence: {
        id: evidenceId,
        checkId: args.checkId,
        contentType: "image/webp" as const,
        byteSize: args.byteSize,
        sha256: args.sha256,
      },
      replacedStorageId:
        existing && existing.storageId !== args.storageId
          ? existing.storageId
          : null,
    }
  },
})

export async function getOwnedEvidenceForServing(
  ctx: QueryCtx,
  args: {
    ownerUserId: string
    evidenceId: Id<"runEvidence">
  }
) {
  const evidence = await ctx.db.get(args.evidenceId)
  if (!evidence) {
    return null
  }
  const run = await ctx.db.get(evidence.runId)
  if (
    !run ||
    run.ownerUserId !== args.ownerUserId ||
    run.projectId !== evidence.projectId
  ) {
    return null
  }
  const project = await ctx.db.get(run.projectId)
  return project?.ownerUserId === args.ownerUserId ? evidence : null
}

export const getForServing = internalQuery({
  args: {
    ownerUserId: v.string(),
    evidenceId: v.id("runEvidence"),
  },
  handler: async (ctx, args) => {
    const evidence = await getOwnedEvidenceForServing(ctx, args)
    if (!evidence) {
      return null
    }
    return {
      storageId: evidence.storageId,
      contentType: evidence.contentType,
      byteSize: evidence.byteSize,
    }
  },
})

const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000

export const cleanupOrphans = internalMutation({
  args: { cursor: v.optional(v.union(v.null(), v.string())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: 100 })
    const cutoff = Date.now() - ORPHAN_GRACE_MS
    const deletedStorageIds: string[] = []

    for (const file of page.page) {
      if (file._creationTime >= cutoff) {
        continue
      }
      const evidence = await ctx.db
        .query("runEvidence")
        .withIndex("by_storage_id", (query) => query.eq("storageId", file._id))
        .unique()
      if (!evidence) {
        await ctx.storage.delete(file._id)
        deletedStorageIds.push(file._id)
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.runEvidence.cleanupOrphans, {
        cursor: page.continueCursor,
      })
    }
    if (deletedStorageIds.length > 0) {
      console.info("Deleted orphaned run evidence", { deletedStorageIds })
    }

    return { deletedCount: deletedStorageIds.length, isDone: page.isDone }
  },
})
