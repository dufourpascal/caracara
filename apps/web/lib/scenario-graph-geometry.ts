import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type ScenarioGraphLayoutEdge,
  type ScenarioGraphLayoutPhaseNode,
  type ScenarioGraphLayoutScenarioNode,
} from "@/lib/scenario-graph-layout"

export type GraphPoint = {
  x: number
  y: number
}

export type GraphRect = {
  x: number
  y: number
  width: number
  height: number
}

export const EDGE_CORNER_RADIUS = 6

function toRect(
  node: ScenarioGraphLayoutPhaseNode | ScenarioGraphLayoutScenarioNode
): GraphRect {
  const size =
    "size" in node ? node.size : { width: NODE_WIDTH, height: NODE_HEIGHT }

  return { ...node.position, ...size }
}

/**
 * Resolves an edge to its bottom-center source point and top-center target
 * point. Phase edges connect phase containers, scenario edges connect
 * scenario nodes. Returns null when either endpoint is missing.
 */
export function getEdgeEndpoints(
  edge: ScenarioGraphLayoutEdge,
  layout: {
    phaseNodes: ScenarioGraphLayoutPhaseNode[]
    scenarioNodes: ScenarioGraphLayoutScenarioNode[]
  }
): { source: GraphPoint; target: GraphPoint } | null {
  const nodes: Array<
    ScenarioGraphLayoutPhaseNode | ScenarioGraphLayoutScenarioNode
  > = edge.kind === "phase" ? layout.phaseNodes : layout.scenarioNodes
  const source = nodes.find((node) => node.id === edge.source)
  const target = nodes.find((node) => node.id === edge.target)

  if (!source || !target) {
    return null
  }

  const sourceRect = toRect(source)
  const targetRect = toRect(target)

  return {
    source: {
      x: sourceRect.x + sourceRect.width / 2,
      y: sourceRect.y + sourceRect.height,
    },
    target: {
      x: targetRect.x + targetRect.width / 2,
      y: targetRect.y,
    },
  }
}

/**
 * Orthogonal "smooth step" route: down from the source, across at the
 * vertical midpoint, down into the target, with quadratic rounded corners.
 */
export function buildSmoothStepPath(
  source: GraphPoint,
  target: GraphPoint,
  radius = EDGE_CORNER_RADIUS
) {
  const dx = target.x - source.x

  if (Math.abs(dx) < 0.5) {
    return `M${source.x} ${source.y} L${target.x} ${target.y}`
  }

  const midY = (source.y + target.y) / 2
  const xDir = Math.sign(dx)
  const yDir = target.y >= source.y ? 1 : -1
  const bend = Math.min(radius, Math.abs(dx) / 2, Math.abs(midY - source.y))

  return [
    `M${source.x} ${source.y}`,
    `L${source.x} ${midY - bend * yDir}`,
    `Q${source.x} ${midY} ${source.x + bend * xDir} ${midY}`,
    `L${target.x - bend * xDir} ${midY}`,
    `Q${target.x} ${midY} ${target.x} ${midY + bend * yDir}`,
    `L${target.x} ${target.y}`,
  ].join(" ")
}

/** Bounding box enclosing every phase and scenario node, or null when empty. */
export function getScenarioGraphBounds(layout: {
  phaseNodes: ScenarioGraphLayoutPhaseNode[]
  scenarioNodes: ScenarioGraphLayoutScenarioNode[]
}): GraphRect | null {
  const rects = [...layout.phaseNodes, ...layout.scenarioNodes].map(toRect)

  if (rects.length === 0) {
    return null
  }

  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width))
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height))

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
