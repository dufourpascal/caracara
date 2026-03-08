import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  projects: defineTable({
    ownerUserId: v.string(),
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    projectPrompt: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_slug", ["ownerUserId", "slug"]),
  scenarios: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal("draft"), v.literal("active")),
    instructions: v.string(),
    scoringPrompt: v.string(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_slug", ["projectId", "slug"]),
  scenarioDependencies: defineTable({
    projectId: v.id("projects"),
    scenarioId: v.id("scenarios"),
    dependsOnScenarioId: v.id("scenarios"),
  })
    .index("by_project", ["projectId"])
    .index("by_scenario", ["scenarioId"]),
  runs: defineTable({
    projectId: v.id("projects"),
    ownerUserId: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("interrupted")
    ),
    mode: v.union(v.literal("all"), v.literal("single")),
    requestedScenarioSlug: v.union(v.null(), v.string()),
    runnerType: v.union(v.null(), v.literal("codex"), v.literal("claude-code")),
    startedAt: v.number(),
    finishedAt: v.union(v.null(), v.number()),
    updatedAt: v.number(),
  })
    .index("by_project_started_at", ["projectId", "startedAt"])
    .index("by_project", ["projectId"]),
  scenarioResults: defineTable({
    runId: v.id("runs"),
    scenarioId: v.id("scenarios"),
    scenarioSlug: v.string(),
    scenarioName: v.string(),
    executionInstructions: v.string(),
    scoringPrompt: v.string(),
    sequenceIndex: v.number(),
    status: v.union(
      v.literal("success"),
      v.literal("scoring_failed"),
      v.literal("runner_failed"),
      v.literal("dependency_failed"),
      v.literal("interrupted")
    ),
    runnerType: v.union(v.literal("codex"), v.literal("claude-code")),
    score: v.union(v.null(), v.number()),
    rationale: v.union(v.null(), v.string()),
    rawOutput: v.union(v.null(), v.string()),
    failureDetail: v.union(v.null(), v.string()),
    startedAt: v.number(),
    finishedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_sequence", ["runId", "sequenceIndex"])
    .index("by_run_scenario", ["runId", "scenarioId"]),
})
