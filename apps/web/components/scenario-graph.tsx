"use client"

import "@xyflow/react/dist/style.css"

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import { AlertCircle } from "lucide-react"
import { useTheme } from "next-themes"

import {
  buildScenarioGraphLayout,
  type ScenarioGraphScenario,
} from "@/lib/scenario-graph-layout"
import { Badge } from "@workspace/ui/components/badge"

type PhaseGraphNodeData = {
  name: string
  order: number
  scenarioCount: number
  width: number
  height: number
}

type ScenarioGraphNodeData = {
  name: string
  slug: string
  isRoot: boolean
}

type PhaseGraphNodeType = Node<PhaseGraphNodeData, "phase">
type ScenarioGraphNodeType = Node<ScenarioGraphNodeData, "scenario">

const EDGE_STROKE =
  "color-mix(in oklch, var(--foreground) 24%, var(--border) 76%)"
const PHASE_EDGE_STROKE =
  "color-mix(in oklch, var(--foreground) 38%, var(--border) 62%)"

const nodeTypes = {
  phase: PhaseGraphNode,
  scenario: ScenarioGraphNode,
}

function PhaseGraphNode({ data }: NodeProps<PhaseGraphNodeType>) {
  return (
    <div
      className="border border-border bg-muted/[0.16]"
      style={{
        height: data.height,
        width: data.width,
      }}
    >
      <Handle
        className="pointer-events-none size-2 border-0 bg-transparent opacity-0"
        isConnectable={false}
        position={Position.Top}
        type="target"
      />
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3">
        <div>
          <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Phase {data.order}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">{data.name}</p>
        </div>
        <Badge className="font-mono" variant="outline">
          {data.scenarioCount}
        </Badge>
      </div>
      <Handle
        className="pointer-events-none size-2 border-0 bg-transparent opacity-0"
        isConnectable={false}
        position={Position.Bottom}
        type="source"
      />
    </div>
  )
}

function ScenarioGraphNode({ data }: NodeProps<ScenarioGraphNodeType>) {
  return (
    <div className="w-[11.5rem] border border-border bg-background px-3 py-2 text-left">
      <Handle
        className="pointer-events-none size-2 border-0 bg-transparent opacity-0"
        isConnectable={false}
        position={Position.Top}
        type="target"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-32 text-[13px] leading-snug font-medium text-foreground">
          {data.name}
        </p>
        {data.isRoot ? (
          <Badge
            className="shrink-0 px-1.5 py-0 text-[9px] font-normal tracking-[0.18em] uppercase"
            variant="outline"
          >
            Root
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {data.slug}
      </p>
      <Handle
        className="pointer-events-none size-2 border-0 bg-transparent opacity-0"
        isConnectable={false}
        position={Position.Bottom}
        type="source"
      />
    </div>
  )
}

export function ScenarioGraph({
  scenarios,
}: {
  scenarios: ScenarioGraphScenario[]
}) {
  const { resolvedTheme } = useTheme()
  const layout = buildScenarioGraphLayout(scenarios)

  const phaseNodes: PhaseGraphNodeType[] = layout.phaseNodes.map((node) => ({
    id: node.id,
    type: "phase",
    position: node.position,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      name: node.name,
      order: node.order,
      scenarioCount: node.scenarioCount,
      width: node.size.width,
      height: node.size.height,
    },
  }))

  const scenarioNodes: ScenarioGraphNodeType[] = layout.scenarioNodes.map((node) => ({
    id: node.id,
    type: "scenario",
    position: node.position,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      name: node.name,
      slug: node.slug,
      isRoot: node.isRoot,
    },
  }))

  const edges: Edge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: false,
    style: {
      stroke: edge.kind === "phase" ? PHASE_EDGE_STROKE : EDGE_STROKE,
      strokeDasharray: edge.kind === "phase" ? "8 6" : undefined,
      strokeWidth: edge.kind === "phase" ? 1.25 : 1.5,
    },
    markerEnd: {
      color: edge.kind === "phase" ? PHASE_EDGE_STROKE : EDGE_STROKE,
      type: MarkerType.ArrowClosed,
    },
  }))

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
      <div className="min-h-0 flex-1">
        <ReactFlow
          colorMode={resolvedTheme === "dark" ? "dark" : "light"}
          defaultEdgeOptions={{
            markerEnd: {
              color: EDGE_STROKE,
              type: MarkerType.ArrowClosed,
            },
            style: {
              stroke: EDGE_STROKE,
              strokeWidth: 1.5,
            },
            type: "smoothstep",
          }}
          edges={edges}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          maxZoom={1.4}
          minZoom={0.35}
          nodes={[...phaseNodes, ...scenarioNodes]}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          panOnDrag
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={false}
        >
          <Background
            color="var(--color-border)"
            gap={24}
            size={1}
            variant={BackgroundVariant.Dots}
          />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
