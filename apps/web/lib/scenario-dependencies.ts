export function wouldCreateDependencyCycle(
  scenarios: Array<{ id: string; dependencyIds: string[] }>,
  scenarioId: string | undefined,
  dependencyId: string
) {
  if (!scenarioId) {
    return false
  }

  const dependencyIdsByScenario = new Map(
    scenarios.map((scenario) => [scenario.id, scenario.dependencyIds])
  )
  const pending = [dependencyId]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const currentId = pending.pop()

    if (!currentId || visited.has(currentId)) {
      continue
    }
    if (currentId === scenarioId) {
      return true
    }

    visited.add(currentId)
    pending.push(...(dependencyIdsByScenario.get(currentId) ?? []))
  }

  return false
}
