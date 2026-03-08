export type ScenarioGraphScenario = {
  id: string
  slug: string
  name: string
  dependencyIds: string[]
}

export type ScenarioGraphLayoutNode = {
  id: string
  name: string
  slug: string
  dependencyCount: number
  dependentCount: number
  isRoot: boolean
  position: {
    x: number
    y: number
  }
}

export type ScenarioGraphLayoutEdge = {
  id: string
  source: string
  target: string
}

type OrderedNode = {
  id: string
  dependencyIds: string[]
  dependentIds: string[]
  depth: number
  sortIndex: number
}

const NODE_WIDTH = 184
const NODE_HEIGHT = 72
const HORIZONTAL_GAP = 64
const VERTICAL_GAP = 104
const PADDING = 48

function byScenarioName(
  scenarioById: Map<string, ScenarioGraphScenario>,
  leftId: string,
  rightId: string
) {
  const left = scenarioById.get(leftId)
  const right = scenarioById.get(rightId)

  if (!left || !right) {
    return leftId.localeCompare(rightId)
  }

  return (
    left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug)
  )
}

function getAverageIndex(ids: string[], orderById: Map<string, number>) {
  const resolvedIndexes = ids
    .map((id) => orderById.get(id))
    .filter((value): value is number => value !== undefined)

  if (resolvedIndexes.length === 0) {
    return null
  }

  return (
    resolvedIndexes.reduce((sum, value) => sum + value, 0) /
    resolvedIndexes.length
  )
}

export function buildScenarioGraphLayout(scenarios: ScenarioGraphScenario[]) {
  const scenarioById = new Map(
    scenarios.map((scenario) => [scenario.id, scenario])
  )
  const dependencyIdsById = new Map<string, string[]>()
  const dependentIdsById = new Map<string, string[]>()
  const indegreeById = new Map<string, number>()
  const depthById = new Map<string, number>()

  for (const scenario of scenarios) {
    const validDependencies = Array.from(
      new Set(
        scenario.dependencyIds.filter(
          (dependencyId) =>
            dependencyId !== scenario.id && scenarioById.has(dependencyId)
        )
      )
    )

    dependencyIdsById.set(scenario.id, validDependencies)
    dependentIdsById.set(scenario.id, [])
    indegreeById.set(scenario.id, validDependencies.length)
  }

  for (const scenario of scenarios) {
    for (const dependencyId of dependencyIdsById.get(scenario.id) ?? []) {
      dependentIdsById.get(dependencyId)?.push(scenario.id)
    }
  }

  const queue = scenarios
    .filter((scenario) => (indegreeById.get(scenario.id) ?? 0) === 0)
    .map((scenario) => scenario.id)
    .sort((leftId, rightId) => byScenarioName(scenarioById, leftId, rightId))

  const topoOrder: string[] = []

  while (queue.length > 0) {
    const id = queue.shift()

    if (!id) {
      break
    }

    topoOrder.push(id)

    const dependencyIds = dependencyIdsById.get(id) ?? []
    const depth =
      dependencyIds.length === 0
        ? 0
        : Math.max(
            ...dependencyIds.map(
              (dependencyId) => depthById.get(dependencyId) ?? 0
            )
          ) + 1

    depthById.set(id, depth)

    for (const dependentId of dependentIdsById.get(id) ?? []) {
      const nextIndegree = (indegreeById.get(dependentId) ?? 0) - 1
      indegreeById.set(dependentId, nextIndegree)

      if (nextIndegree === 0) {
        queue.push(dependentId)
        queue.sort((leftId, rightId) =>
          byScenarioName(scenarioById, leftId, rightId)
        )
      }
    }
  }

  if (topoOrder.length < scenarios.length) {
    const remainingIds = scenarios
      .map((scenario) => scenario.id)
      .filter((id) => !topoOrder.includes(id))
      .sort((leftId, rightId) => byScenarioName(scenarioById, leftId, rightId))

    for (const id of remainingIds) {
      if (!depthById.has(id)) {
        const dependencyIds = dependencyIdsById.get(id) ?? []
        const depth =
          dependencyIds.length === 0
            ? 0
            : Math.max(
                ...dependencyIds.map(
                  (dependencyId) => depthById.get(dependencyId) ?? 0
                )
              ) + 1

        depthById.set(id, depth)
      }

      topoOrder.push(id)
    }
  }

  const orderedNodes: OrderedNode[] = topoOrder.map((id, sortIndex) => ({
    id,
    dependencyIds: dependencyIdsById.get(id) ?? [],
    dependentIds: dependentIdsById.get(id) ?? [],
    depth: depthById.get(id) ?? 0,
    sortIndex,
  }))

  const layers = new Map<number, OrderedNode[]>()

  for (const node of orderedNodes) {
    const layer = layers.get(node.depth)

    if (layer) {
      layer.push(node)
    } else {
      layers.set(node.depth, [node])
    }
  }

  const sortedDepths = Array.from(layers.keys()).sort(
    (left, right) => left - right
  )

  for (const depth of sortedDepths) {
    layers
      .get(depth)
      ?.sort(
        (left, right) =>
          left.sortIndex - right.sortIndex ||
          byScenarioName(scenarioById, left.id, right.id)
      )
  }

  for (let index = 1; index < sortedDepths.length; index += 1) {
    const depth = sortedDepths[index]!
    const priorDepth = sortedDepths[index - 1]!

    const layer = layers.get(depth)

    if (!layer) {
      continue
    }

    const priorOrder = new Map(
      (layers.get(priorDepth) ?? []).map((node, layerIndex) => [
        node.id,
        layerIndex,
      ])
    )

    layer.sort((left, right) => {
      const leftAverage = getAverageIndex(left.dependencyIds, priorOrder)
      const rightAverage = getAverageIndex(right.dependencyIds, priorOrder)

      if (
        leftAverage !== null &&
        rightAverage !== null &&
        leftAverage !== rightAverage
      ) {
        return leftAverage - rightAverage
      }

      if (leftAverage !== null && rightAverage === null) {
        return -1
      }

      if (leftAverage === null && rightAverage !== null) {
        return 1
      }

      return byScenarioName(scenarioById, left.id, right.id)
    })
  }

  for (let index = sortedDepths.length - 2; index >= 0; index -= 1) {
    const depth = sortedDepths[index]!
    const nextDepth = sortedDepths[index + 1]!

    const layer = layers.get(depth)

    if (!layer) {
      continue
    }

    const nextOrder = new Map(
      (layers.get(nextDepth) ?? []).map((node, layerIndex) => [
        node.id,
        layerIndex,
      ])
    )

    layer.sort((left, right) => {
      const leftAverage = getAverageIndex(left.dependentIds, nextOrder)
      const rightAverage = getAverageIndex(right.dependentIds, nextOrder)

      if (
        leftAverage !== null &&
        rightAverage !== null &&
        leftAverage !== rightAverage
      ) {
        return leftAverage - rightAverage
      }

      if (leftAverage !== null && rightAverage === null) {
        return -1
      }

      if (leftAverage === null && rightAverage !== null) {
        return 1
      }

      return byScenarioName(scenarioById, left.id, right.id)
    })
  }

  const widestLayerWidth = Math.max(
    0,
    ...Array.from(layers.values()).map(
      (layer) =>
        layer.length * NODE_WIDTH +
        Math.max(layer.length - 1, 0) * HORIZONTAL_GAP
    )
  )

  const nodes = sortedDepths.flatMap((depth) => {
    const layer = layers.get(depth) ?? []
    const layerWidth =
      layer.length * NODE_WIDTH + Math.max(layer.length - 1, 0) * HORIZONTAL_GAP
    const startX = PADDING + (widestLayerWidth - layerWidth) / 2

    return layer.map((node, index) => {
      const scenario = scenarioById.get(node.id)

      if (!scenario) {
        throw new Error(
          `Scenario ${node.id} not found while building graph layout.`
        )
      }

      return {
        id: scenario.id,
        name: scenario.name,
        slug: scenario.slug,
        dependencyCount: node.dependencyIds.length,
        dependentCount: node.dependentIds.length,
        isRoot: node.dependencyIds.length === 0,
        position: {
          x: startX + index * (NODE_WIDTH + HORIZONTAL_GAP),
          y: PADDING + depth * (NODE_HEIGHT + VERTICAL_GAP),
        },
      }
    })
  })

  const edges = scenarios.flatMap((scenario) =>
    (dependencyIdsById.get(scenario.id) ?? []).map((dependencyId) => ({
      id: `${dependencyId}->${scenario.id}`,
      source: dependencyId,
      target: scenario.id,
    }))
  )

  return { edges, nodes }
}
