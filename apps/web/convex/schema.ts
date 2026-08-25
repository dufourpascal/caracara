import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const evaluationCheck = v.object({
  id: v.string(),
  name: v.string(),
  expectation: v.string(),
})

const checkResult = v.object({
  checkId: v.string(),
  verdict: v.union(
    v.literal("passed"),
    v.literal("failed"),
    v.literal("not_observed")
  ),
  evidence: v.string(),
})

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
    evaluationChecks: v.array(evaluationCheck),
    phaseId: v.optional(v.union(v.null(), v.id("phases"))),
    navigationOrder: v.optional(v.number()),
    phaseNavigationOrder: v.optional(v.number()),
    phaseFilterKey: v.optional(v.string()),
    dependencyCount: v.optional(v.number()),
    searchText: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_slug", ["projectId", "slug"])
    .index("by_project_navigation_order", ["projectId", "navigationOrder"])
    .index("by_project_phase_navigation_order", [
      "projectId",
      "phaseFilterKey",
      "phaseNavigationOrder",
    ])
    .searchIndex("search_by_project_phase", {
      searchField: "searchText",
      filterFields: ["projectId", "phaseFilterKey"],
    }),
  phases: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_order", ["projectId", "order"]),
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
    mode: v.union(
      v.literal("all"),
      v.literal("single"),
      v.literal("phase"),
      v.literal("through_phase")
    ),
    requestedScenarioSlug: v.union(v.null(), v.string()),
    requestedPhaseOrder: v.optional(v.union(v.null(), v.number())),
    runnerType: v.union(v.null(), v.literal("codex"), v.literal("claude-code")),
    evidencePolicy: v.optional(
      v.union(v.literal("text_only"), v.literal("failed_check_screenshot"))
    ),
    passedCheckCount: v.number(),
    totalCheckCount: v.number(),
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
    evaluationChecks: v.array(evaluationCheck),
    checkResults: v.array(checkResult),
    phaseId: v.optional(v.union(v.null(), v.string())),
    phaseName: v.optional(v.union(v.null(), v.string())),
    phaseOrder: v.optional(v.union(v.null(), v.number())),
    sequenceIndex: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("runner_failed"),
      v.literal("dependency_failed"),
      v.literal("interrupted")
    ),
    runnerType: v.union(v.literal("codex"), v.literal("claude-code")),
    executionSummary: v.union(v.null(), v.string()),
    failureDetail: v.union(v.null(), v.string()),
    startedAt: v.number(),
    finishedAt: v.union(v.null(), v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_run_sequence", ["runId", "sequenceIndex"])
    .index("by_run_scenario", ["runId", "scenarioId"]),
  runEvidence: defineTable({
    projectId: v.id("projects"),
    runId: v.id("runs"),
    scenarioResultId: v.id("scenarioResults"),
    checkId: v.string(),
    kind: v.literal("screenshot"),
    storageId: v.id("_storage"),
    contentType: v.literal("image/webp"),
    byteSize: v.number(),
    sha256: v.string(),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_result", ["scenarioResultId"])
    .index("by_result_check", ["scenarioResultId", "checkId"])
    .index("by_storage_id", ["storageId"]),
})
