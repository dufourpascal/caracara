import type { ScenarioStatus } from "@workspace/contracts"

export type PhaseNode = {
  id: string
  name: string
  order: number
}

export type ScenarioNode = {
  id: string
  slug: string
  name: string
  status: ScenarioStatus
  instructions: string
  scoringPrompt: string
  phaseId?: string | null
  phaseName?: string | null
  phaseOrder?: number | null
}

export type DependencyEdge = {
  scenarioId: string
  dependsOnScenarioId: string
}

type ExecutionPhase = {
  phase: PhaseNode
  scenarios: ScenarioNode[]
}

function normalizePhaseId(value: string | null | undefined) {
  return value ?? null
}

export function assertValidDependencies(
  scenarios: ScenarioNode[],
  dependencies: DependencyEdge[],
  options?: {
    strictPhaseBoundaries?: boolean
  }
) {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]))

  for (const dependency of dependencies) {
    const scenario = scenarioById.get(dependency.scenarioId)
    const dependsOnScenario = scenarioById.get(dependency.dependsOnScenarioId)

    if (!scenario || !dependsOnScenario) {
      throw new Error(
        "Dependencies must reference scenarios in the same project"
      )
    }

    if (dependency.scenarioId === dependency.dependsOnScenarioId) {
      throw new Error("A scenario cannot depend on itself")
    }

    const scenarioPhaseId = normalizePhaseId(scenario.phaseId)
    const dependsOnPhaseId = normalizePhaseId(dependsOnScenario.phaseId)

    if (scenarioPhaseId === null || dependsOnPhaseId === null) {
      continue
    }

    if (scenarioPhaseId !== dependsOnPhaseId) {
      if (options?.strictPhaseBoundaries) {
        throw new Error(
          "Dependencies are only allowed between scenarios in the same phase"
        )
      }

      continue
    }
  }

  const groupedScenarios = new Map<string, ScenarioNode[]>()

  for (const scenario of scenarios) {
    const phaseId = normalizePhaseId(scenario.phaseId)

    if (!phaseId) {
      continue
    }

    const current = groupedScenarios.get(phaseId) ?? []
    current.push(scenario)
    groupedScenarios.set(phaseId, current)
  }

  for (const phaseScenarios of groupedScenarios.values()) {
    const scenarioIds = new Set(phaseScenarios.map((scenario) => scenario.id))
    const phaseDependencies = dependencies.filter(
      (dependency) =>
        scenarioIds.has(dependency.scenarioId) &&
        scenarioIds.has(dependency.dependsOnScenarioId)
    )

    buildExecutionOrder(phaseScenarios, phaseDependencies)
  }
}

export function filterDependenciesForPhaseExecution(
  scenarios: ScenarioNode[],
  dependencies: DependencyEdge[]
) {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]))

  return dependencies.filter((dependency) => {
    const scenario = scenarioById.get(dependency.scenarioId)
    const dependsOnScenario = scenarioById.get(dependency.dependsOnScenarioId)

    if (!scenario || !dependsOnScenario) {
      return false
    }

    if (scenario.id === dependsOnScenario.id) {
      return false
    }

    const scenarioPhaseId = normalizePhaseId(scenario.phaseId)
    const dependsOnPhaseId = normalizePhaseId(dependsOnScenario.phaseId)

    if (scenarioPhaseId === null || dependsOnPhaseId === null) {
      return false
    }

    return scenarioPhaseId === dependsOnPhaseId
  })
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

export function buildPhaseExecutionPlan(
  phases: PhaseNode[],
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
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]))
  const assignedScenarios = selectedScenarios.filter((scenario) => {
    const phaseId = normalizePhaseId(scenario.phaseId)
    return phaseId !== null && phaseById.has(phaseId)
  })
  const scenarioIds = new Set(assignedScenarios.map((scenario) => scenario.id))
  const relevantDependencies = dependencies.filter(
    (dependency) =>
      scenarioIds.has(dependency.scenarioId) &&
      scenarioIds.has(dependency.dependsOnScenarioId)
  )
  const scenariosByPhase = new Map<string, ScenarioNode[]>()

  for (const scenario of assignedScenarios) {
    const phaseId = normalizePhaseId(scenario.phaseId)

    if (!phaseId) {
      continue
    }

    const current = scenariosByPhase.get(phaseId) ?? []
    current.push(scenario)
    scenariosByPhase.set(phaseId, current)
  }

  const orderedPhases = [...phases].sort((left, right) => left.order - right.order)
  const executionPhases: ExecutionPhase[] = []

  for (const phase of orderedPhases) {
    const phaseScenarios = scenariosByPhase.get(phase.id) ?? []

    if (phaseScenarios.length === 0) {
      executionPhases.push({
        phase,
        scenarios: [],
      })
      continue
    }

    const phaseScenarioIds = new Set(phaseScenarios.map((scenario) => scenario.id))
    const phaseDependencies = relevantDependencies.filter(
      (dependency) =>
        phaseScenarioIds.has(dependency.scenarioId) &&
        phaseScenarioIds.has(dependency.dependsOnScenarioId)
    )

    executionPhases.push({
      phase,
      scenarios: buildExecutionOrder(phaseScenarios, phaseDependencies, options),
    })
  }

  return executionPhases
}
