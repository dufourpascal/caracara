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

import {
  buildScenarioGraphLayout,
  type ScenarioGraphScenario,
} from "@/lib/scenario-graph-layout"
import { Badge } from "@workspace/ui/components/badge"

type ScenarioGraphNodeData = {
  name: string
  slug: string
  isRoot: boolean
}

type ScenarioGraphNodeType = Node<ScenarioGraphNodeData, "scenario">

const EDGE_STROKE =
  "color-mix(in oklch, var(--foreground) 24%, var(--border) 76%)"

const nodeTypes = {
  scenario: ScenarioGraphNode,
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
  const layout = buildScenarioGraphLayout(scenarios)

  const nodes: ScenarioGraphNodeType[] = layout.nodes.map((node) => ({
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
      stroke: EDGE_STROKE,
      strokeWidth: 1.5,
    },
    markerEnd: {
      color: EDGE_STROKE,
      type: MarkerType.ArrowClosed,
    },
  }))

  return (
    <div className="h-full bg-muted/[0.08]">
      <ReactFlow
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
        minZoom={0.4}
        nodes={nodes}
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
  )
}
