import { internalMutation, type MutationCtx } from "./_generated/server"

export async function clearRunEnvironmentSummaries(ctx: MutationCtx) {
  const projects = await ctx.db.query("projects").collect()

  for (const project of projects) {
    await ctx.db.patch(project._id, { runEnvironmentNames: [] })
  }
}

export const resetEvaluationData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tableNames = [
      "scenarioResults",
      "runs",
      "scenarioDependencies",
      "scenarios",
    ] as const
    const deleted: Record<(typeof tableNames)[number], number> = {
      scenarioResults: 0,
      runs: 0,
      scenarioDependencies: 0,
      scenarios: 0,
    }

    for (const tableName of tableNames) {
      const documents = await ctx.db.query(tableName).collect()
      for (const document of documents) {
        await ctx.db.delete(document._id)
      }
      deleted[tableName] = documents.length
    }

    await clearRunEnvironmentSummaries(ctx)

    return deleted
  },
})
