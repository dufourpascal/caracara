import type {
  EffectiveFixtureRequirement,
  EvaluationCheck,
  Fixture,
} from "@workspace/contracts"

/** The "Protected fixtures" section of the evaluation and blocked-retry prompts. */
export function buildProtectedFixturesSection(
  requirements: EffectiveFixtureRequirement[] | undefined,
  fixtures: Fixture[] | undefined
) {
  const byId = new Map((fixtures ?? []).map((fixture) => [fixture.id, fixture]))
  const entries = (requirements ?? []).flatMap((requirement) => {
    const fixture = byId.get(requirement.fixtureId)
    return fixture ? [{ fixture, requirement }] : []
  })
  if (entries.length === 0) {
    return []
  }

  return [
    "",
    "Protected fixtures:",
    "This scenario uses persistent test data that other scenarios and later runs depend on.",
    ...entries.flatMap(({ fixture, requirement }) => [
      `- ${fixture.name} (${fixture.slug})`,
      ...(fixture.locator.trim()
        ? [`  Find it: ${fixture.locator.trim()}`]
        : []),
      requirement.access === "mutates"
        ? `  Access: you may change only ${requirement.mutationScope?.trim() || "what this scenario requires"}. Leave the rest of this fixture unchanged.`
        : "  Access: read-only. Do not change it.",
      ...(fixture.protection.trim()
        ? [`  Protection: ${fixture.protection.trim()}`]
        : []),
    ]),
    "This scoped permission is the only exception to project-context rules that protect fixtures.",
  ]
}

export type FixtureTaskKind = "verify" | "converge"

/** The checks an agent fixture task reports on: health checks, or one per converge step. */
export function fixtureTaskChecks(
  fixture: Pick<Fixture, "healthChecks" | "convergeSteps">,
  kind: FixtureTaskKind
): EvaluationCheck[] {
  return kind === "verify"
    ? fixture.healthChecks
    : fixture.convergeSteps.map((step) => ({
        id: step.id,
        name: step.name,
        expectation: step.doneWhen,
      }))
}

/** Prompt for an agent fixture task (verify or converge). */
export function buildFixtureTaskPrompt(input: {
  kind: FixtureTaskKind
  environment: string
  targetUrl: string
  projectPrompt: string
  secretNames?: string[]
  fixture: Pick<
    Fixture,
    | "name"
    | "slug"
    | "description"
    | "locator"
    | "healthChecks"
    | "convergeSteps"
  >
}) {
  const { fixture, kind } = input
  const secretNames = [...(input.secretNames ?? [])].sort()
  const label = `${fixture.name} (${fixture.slug})`

  const taskLines =
    kind === "verify"
      ? [
          "Task: inspect the fixture and report whether each health check below holds.",
          "This is inspect-only. Change nothing: do not create, edit, or delete this fixture or any other data.",
          "",
          "Health checks:",
          ...fixture.healthChecks.flatMap((check) => [
            `- ${check.name} [${check.id}]`,
            `  Expected: ${check.expectation}`,
          ]),
        ]
      : [
          `Maintenance permission: project-context rules that protect fixtures do not apply to the fixture ${label} for this task. They still apply to every other fixture and to all other data in the application.`,
          "",
          "Task: bring the fixture to its intended state with the steps below. Each step is also a check, identified by its ID, and passes when its done-when condition holds.",
          "Go through the steps in order. Skip a step whose done-when condition already holds, without changing anything. Do the rest in order, then confirm the done-when condition.",
          'Stop at the first step that fails. Report it as "failed", and report every later step as "blocked" with blockedReason "blocked_by_check".',
          "Change only what the steps need.",
          "",
          "Steps:",
          ...fixture.convergeSteps.flatMap((step, index) => [
            `${index + 1}. ${step.name} [${step.id}]`,
            `   Instructions: ${step.instructions.trim()}`,
            `   Done when: ${step.doneWhen.trim()}`,
          ]),
        ]

  return [
    "You are maintaining a Caracara test fixture. This is fixture maintenance, not an evaluation.",
    "",
    `Target environment: ${input.environment}`,
    `Application URL: ${input.targetUrl}`,
    "Use this URL as the application origin. If project or fixture text names another origin, keep its path but use the URL above.",
    "",
    "Project context:",
    input.projectPrompt.trim(),
    "",
    `Fixture: ${label}`,
    ...(fixture.description.trim()
      ? [`Description: ${fixture.description.trim()}`]
      : []),
    ...(fixture.locator.trim() ? [`Find it: ${fixture.locator.trim()}`] : []),
    "",
    ...taskLines,
    ...(secretNames.length > 0
      ? [
          "",
          "Local secret environment variables available to this task:",
          ...secretNames.map((name) => `- ${name}`),
          "Read a secret only when the task requires it. Never repeat secret values in the summary, evidence, or other user-facing output.",
        ]
      : []),
    "",
    "Use the Chrome DevTools browser tools to work with the actual frontend.",
    "Return JSON with a concise executionSummary and exactly one checkResults entry per check ID.",
    'Use verdict "passed" when browser evidence confirms the expectation, "failed" when the observed state contradicts it, and "blocked" when you could not reach or inspect it.',
    'For "blocked", set blockedReason to exactly one of: "blocked_by_check", "setup_incomplete", "environment_failure", or "tool_limit". Set blockedReason to null for passed and failed checks.',
    "Every verdict needs concise, concrete browser evidence. Do not take screenshots.",
  ].join("\n")
}
