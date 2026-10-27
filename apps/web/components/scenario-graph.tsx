"use client"

import { useId, useMemo } from "react"
import { AlertCircle, Maximize, Minus, Plus } from "lucide-react"

import {
  buildSmoothStepPath,
  getEdgeEndpoints,
  getScenarioGraphBounds,
} from "@/lib/scenario-graph-geometry"
import {
  buildScenarioGraphLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
  type ScenarioGraphLayoutPhaseNode,
  type ScenarioGraphLayoutScenarioNode,
  type ScenarioGraphScenario,
} from "@/lib/scenario-graph-layout"
import { usePanZoom } from "@/lib/use-pan-zoom"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

const EDGE_STROKE =
  "color-mix(in oklch, var(--foreground) 24%, var(--border) 76%)"
const PHASE_EDGE_STROKE =
  "color-mix(in oklch, var(--foreground) 38%, var(--border) 62%)"
const BACKGROUND_GAP = 24
const BACKGROUND_DOT_SIZE = 1

function PhaseGraphNode({ node }: { node: ScenarioGraphLayoutPhaseNode }) {
  return (
    <div className="h-full border border-border bg-muted/[0.16]">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3">
        <div>
          <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Phase {node.order}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {node.name}
          </p>
        </div>
        <Badge className="font-mono" variant="outline">
          {node.scenarioCount}
        </Badge>
      </div>
    </div>
  )
}

function ScenarioGraphNode({
  node,
}: {
  node: ScenarioGraphLayoutScenarioNode
}) {
  return (
    <div className="h-full overflow-hidden border border-border bg-background px-3 py-2 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 max-w-32 text-[13px] leading-snug font-medium text-foreground">
          {node.name}
        </p>
        {node.isRoot ? (
          <Badge
            className="shrink-0 px-1.5 py-0 text-[9px] font-normal tracking-[0.18em] uppercase"
            variant="outline"
          >
            Root
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {node.slug}
      </p>
    </div>
  )
}

function ArrowMarker({ color, id }: { color: string; id: string }) {
  return (
    <marker
      id={id}
      markerHeight="12.5"
      markerUnits="strokeWidth"
      markerWidth="12.5"
      orient="auto-start-reverse"
      refX="0"
      refY="0"
      viewBox="-10 -10 20 20"
    >
      <polyline
        points="-5,-4 0,0 -5,4 -5,-4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ fill: color, stroke: color, strokeWidth: 1 }}
      />
    </marker>
  )
}

export function ScenarioGraph({
  scenarios,
}: {
  scenarios: ScenarioGraphScenario[]
}) {
  const layout = useMemo(() => buildScenarioGraphLayout(scenarios), [scenarios])
  const bounds = useMemo(() => getScenarioGraphBounds(layout), [layout])
  const {
    canZoomIn,
    canZoomOut,
    fitView,
    handlers,
    size,
    transform,
    viewportRef,
    zoomIn,
    zoomOut,
  } = usePanZoom(bounds)
  const idPrefix = useId()
  const patternId = `${idPrefix}-dots`
  const markerId = `${idPrefix}-arrow`
  const phaseMarkerId = `${idPrefix}-phase-arrow`
  const scaledGap = BACKGROUND_GAP * transform.k
  const dotRadius = (BACKGROUND_DOT_SIZE * transform.k) / 2

  return (
    <div className="flex h-full flex-col bg-muted/[0.08]">
      {layout.omittedScenarioCount > 0 ? (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/8 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertCircle className="size-4" />
          <span>
            {layout.omittedScenarioCount} unassigned scenario
            {layout.omittedScenarioCount === 1 ? "" : "s"} omitted from the
            phase graph.
          </span>
        </div>
      ) : null}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        ref={viewportRef}
      >
        <svg
          aria-label="Scenario dependency graph"
          className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
          role="group"
          {...handlers}
        >
          <defs>
            <pattern
              height={scaledGap}
              id={patternId}
              patternTransform={`translate(${-scaledGap / 2},${-scaledGap / 2})`}
              patternUnits="userSpaceOnUse"
              width={scaledGap}
              x={transform.x % scaledGap}
              y={transform.y % scaledGap}
            >
              <circle
                cx={dotRadius}
                cy={dotRadius}
                r={dotRadius}
                style={{ fill: "var(--color-border)" }}
              />
            </pattern>
            <ArrowMarker color={EDGE_STROKE} id={markerId} />
            <ArrowMarker color={PHASE_EDGE_STROKE} id={phaseMarkerId} />
          </defs>
          <rect fill={`url(#${patternId})`} height="100%" width="100%" />
          {size ? (
            <g
              transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}
            >
              {layout.edges.map((edge) => {
                const endpoints = getEdgeEndpoints(edge, layout)

                if (!endpoints) {
                  return null
                }

                const isPhase = edge.kind === "phase"

                return (
                  <path
                    d={buildSmoothStepPath(endpoints.source, endpoints.target)}
                    data-edge-kind={edge.kind}
                    fill="none"
                    key={edge.id}
                    markerEnd={`url(#${isPhase ? phaseMarkerId : markerId})`}
                    style={{
                      stroke: isPhase ? PHASE_EDGE_STROKE : EDGE_STROKE,
                      strokeDasharray: isPhase ? "8 6" : undefined,
                      strokeWidth: isPhase ? 1.25 : 1.5,
                    }}
                  />
                )
              })}
              {layout.phaseNodes.map((node) => (
                <foreignObject
                  data-node-kind="phase"
                  height={node.size.height}
                  key={node.id}
                  width={node.size.width}
                  x={node.position.x}
                  y={node.position.y}
                >
                  <PhaseGraphNode node={node} />
                </foreignObject>
              ))}
              {layout.scenarioNodes.map((node) => (
                <foreignObject
                  data-node-kind="scenario"
                  height={NODE_HEIGHT}
                  key={node.id}
                  width={NODE_WIDTH}
                  x={node.position.x}
                  y={node.position.y}
                >
                  <ScenarioGraphNode node={node} />
                </foreignObject>
              ))}
            </g>
          ) : null}
        </svg>
        <div className="absolute bottom-4 left-4 flex flex-col [&>button+button]:border-t-0">
          <Button
            aria-label="Zoom in"
            disabled={!canZoomIn}
            onClick={zoomIn}
            size="icon-sm"
            variant="outline"
          >
            <Plus />
          </Button>
          <Button
            aria-label="Zoom out"
            disabled={!canZoomOut}
            onClick={zoomOut}
            size="icon-sm"
            variant="outline"
          >
            <Minus />
          </Button>
          <Button
            aria-label="Fit view"
            onClick={fitView}
            size="icon-sm"
            variant="outline"
          >
            <Maximize />
          </Button>
        </div>
      </div>
    </div>
  )
}
