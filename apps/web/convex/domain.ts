import type { ScenarioStatus } from "@workspace/contracts"

export type ScenarioNode = {
  id: string
  slug: string
  name: string
  status: ScenarioStatus
  instructions: string
  scoringPrompt: string
}

export type DependencyEdge = {
  scenarioId: string
  dependsOnScenarioId: string
}

export function assertValidDependencies(
  scenarios: ScenarioNode[],
  dependencies: DependencyEdge[]
) {
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id))

  for (const dependency of dependencies) {
    if (
      !scenarioIds.has(dependency.scenarioId) ||
      !scenarioIds.has(dependency.dependsOnScenarioId)
    ) {
      throw new Error(
        "Dependencies must reference scenarios in the same project"
      )
    }

    if (dependency.scenarioId === dependency.dependsOnScenarioId) {
      throw new Error("A scenario cannot depend on itself")
    }
  }

  buildExecutionOrder(scenarios, dependencies)
}

export function buildExecutionOrder(
  scenarios: ScenarioNode[],
  dependencies: DependencyEdge[],
  options?: {
    activeOnly?: boolean
    ascending?: boolean
  }
) {
  const selectedScenarios = options?.activeOnly
    ? scenarios.filter((scenario) => scenario.status === "active")
    : [...scenarios]
  const selectedIds = new Set(selectedScenarios.map((scenario) => scenario.id))
  const relevantDependencies = dependencies.filter(
    (dependency) =>
      selectedIds.has(dependency.scenarioId) &&
      selectedIds.has(dependency.dependsOnScenarioId)
  )
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const scenario of selectedScenarios) {
    inDegree.set(scenario.id, 0)
    adjacency.set(scenario.id, [])
  }

  for (const dependency of relevantDependencies) {
    adjacency.get(dependency.dependsOnScenarioId)?.push(dependency.scenarioId)
    inDegree.set(
      dependency.scenarioId,
      (inDegree.get(dependency.scenarioId) ?? 0) + 1
    )
  }

  const compare = (left: ScenarioNode, right: ScenarioNode) =>
    options?.ascending === false
      ? right.slug.localeCompare(left.slug)
      : left.slug.localeCompare(right.slug)

  const queue = selectedScenarios
    .filter((scenario) => (inDegree.get(scenario.id) ?? 0) === 0)
    .sort(compare)
  const ordered: ScenarioNode[] = []

  while (queue.length > 0) {
    const next = queue.shift()

    if (!next) {
      break
    }

    ordered.push(next)

    for (const dependentId of adjacency.get(next.id) ?? []) {
      const remaining = (inDegree.get(dependentId) ?? 0) - 1
      inDegree.set(dependentId, remaining)

      if (remaining === 0) {
        const dependent = selectedScenarios.find(
          (scenario) => scenario.id === dependentId
        )
        if (dependent) {
          queue.push(dependent)
          queue.sort(compare)
        }
      }
    }
  }

  if (ordered.length !== selectedScenarios.length) {
    throw new Error("Scenario dependencies contain a cycle")
  }

  return ordered
}
