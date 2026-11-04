import type {
  EffectiveFixtureRequirement,
  EvaluationCheck,
  Fixture,
  FixtureStep,
} from "@workspace/contracts"

/** A fixture a scenario requires, with the access it was granted. */
export type ProtectedFixture = {
  fixture: Pick<Fixture, "id" | "name" | "slug" | "locator" | "protection">
  access: EffectiveFixtureRequirement["access"]
  mutationScope: string | null
}

/**
 * Pairs a scenario's effective requirements with the fixture definitions of
 * the plan. A requirement without a definition is a server contract error.
 */
export function resolveProtectedFixtures(
  requirements: EffectiveFixtureRequirement[],
  fixtures: Fixture[]
): ProtectedFixture[] {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  return requirements.map((requirement) => {
    const fixture = byId.get(requirement.fixtureId)
    if (!fixture) {
      throw new Error(
        `The execution plan does not define required fixture ${requirement.fixtureId}.`
      )
    }
    return {
      fixture,
      access: requirement.access,
      mutationScope: requirement.mutationScope,
    }
  })
}

/** The "Protected fixtures" section of the evaluation and blocked-retry prompts. */
export function buildProtectedFixturesSection(
  fixtures: ProtectedFixture[] | undefined
) {
  if (!fixtures || fixtures.length === 0) {
    return []
  }

  return [
    "",
    "Protected fixtures:",
    "This scenario uses persistent test data that later runs depend on.",
    ...fixtures.flatMap(({ fixture, access, mutationScope }) => [
      `- ${fixture.name} (${fixture.slug})`,
      ...(fixture.locator.trim() ? [`  Find it: ${fixture.locator.trim()}`] : []),
      access === "mutates"
        ? `  Access: you may change only ${mutationScope?.trim() || "what this scenario requires"}. Leave everything else in this fixture unchanged.`
        : "  Access: read-only. Do not change it.",
      ...(fixture.protection.trim()
        ? [`  Protection: ${fixture.protection.trim()}`]
        : []),
    ]),
    "The scoped permissions above are the only exception to any project-context rule that protects fixtures.",
  ]
}

export type FixtureMaintenanceTask =
  | { kind: "verify" }
  | { kind: "converge"; step: FixtureStep }
  | { kind: "reset"; resetInstructions: string }

/** The checks a maintenance task reports on. */
export function fixtureTaskChecks(
  fixture: Pick<Fixture, "healthChecks">,
  task: FixtureMaintenanceTask
): EvaluationCheck[] {
  return task.kind === "converge"
    ? [
        {
          id: task.step.id,
          name: task.step.name,
          expectation: task.step.doneWhen,
        },
      ]
    : fixture.healthChecks
}

export function buildFixtureMaintenancePrompt(input: {
  environment: string
  targetUrl: string
  projectPrompt: string
  secretNames?: string[]
  fixture: Pick<
    Fixture,
    "name" | "slug" | "description" | "locator" | "healthChecks"
  >
  task: FixtureMaintenanceTask
}) {
  const { fixture, task } = input
  const secretNames = [...(input.secretNames ?? [])].sort()
  const checks = fixtureTaskChecks(fixture, task)

  const taskLines =
    task.kind === "verify"
      ? [
          "Task: inspect the fixture and report whether each health check below holds.",
          "This is inspect-only. Change nothing: do not create, edit, or delete this fixture or any other data.",
        ]
      : task.kind === "converge"
        ? [
            `Step: ${task.step.name}`,
            "Instructions:",
            task.step.instructions.trim(),
            "",
            `Done when: ${task.step.doneWhen.trim()}`,
            "First check whether the done-when condition already holds. If it does, verify it and stop without making changes.",
            "Otherwise perform the step, then check the done-when condition. Change only what this step needs.",
          ]
        : [
            "Task: reset the fixture to its baseline.",
            "Reset instructions:",
            task.resetInstructions.trim(),
            "",
            "After the reset, inspect the fixture against the checks below. Change only what the reset needs.",
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
    `Fixture: ${fixture.name} (${fixture.slug})`,
    ...(fixture.description.trim()
      ? [`Description: ${fixture.description.trim()}`]
      : []),
    ...(fixture.locator.trim() ? [`Find it: ${fixture.locator.trim()}`] : []),
    "",
    ...(task.kind === "verify"
      ? []
      : [
          `Maintenance permission: project-context rules that protect fixtures do not apply to the fixture ${fixture.name} (${fixture.slug}) for this task. They still apply to every other fixture and to all other data in the application.`,
          "",
        ]),
    ...taskLines,
    "",
    "Checks:",
    ...checks.flatMap((check) => [
      `- ${check.name} [${check.id}]`,
      `  Expected: ${check.expectation}`,
    ]),
    ...(secretNames.length > 0
      ? [
          "",
          "Local secret environment variables available to this task:",
          ...secretNames.map((name) => `- ${name}`),
          "Read a secret only when the task requires it. Never repeat secret values in the summary, evidence, or other user-facing output.",
        ]
      : []),
    "",
    "Use the Chrome DevTools browser tools to inspect the actual frontend.",
    "Return JSON with a concise summary and exactly one checkResults entry per check ID.",
    'Use verdict "passed" when browser evidence confirms the expectation, "failed" when observed state contradicts it, and "blocked" when you could not reach or inspect it.',
    "Every verdict needs concise, concrete browser evidence. Do not take screenshots.",
  ].join("\n")
}
