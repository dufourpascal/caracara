import { describe, expect, it } from "vitest"

import {
  buildSmoothStepPath,
  getEdgeEndpoints,
  getScenarioGraphBounds,
} from "./scenario-graph-geometry"
import {
  buildScenarioGraphLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./scenario-graph-layout"

const layout = buildScenarioGraphLayout([
  {
    id: "login",
    name: "Login",
    slug: "login",
    dependencyIds: [],
    phaseId: "setup",
    phaseName: "Setup",
    phaseOrder: 1,
  },
  {
    id: "invite",
    name: "Invite",
    slug: "invite",
    dependencyIds: [],
    phaseId: "setup",
    phaseName: "Setup",
    phaseOrder: 1,
  },
  {
    id: "project",
    name: "Create project",
    slug: "create-project",
    dependencyIds: ["login", "invite"],
    phaseId: "setup",
    phaseName: "Setup",
    phaseOrder: 1,
  },
  {
    id: "publish",
    name: "Publish",
    slug: "publish",
    dependencyIds: [],
    phaseId: "release",
    phaseName: "Release",
    phaseOrder: 2,
  },
])

describe("buildSmoothStepPath", () => {
  it("draws a straight line when source and target are vertically aligned", () => {
    expect(buildSmoothStepPath({ x: 50, y: 0 }, { x: 50, y: 100 })).toBe(
      "M50 0 L50 100"
    )
  })

  it("routes offset endpoints orthogonally through the vertical midpoint", () => {
    expect(buildSmoothStepPath({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe(
      "M0 0 L0 44 Q0 50 6 50 L94 50 Q100 50 100 56 L100 100"
    )
    expect(buildSmoothStepPath({ x: 100, y: 0 }, { x: 0, y: 100 })).toBe(
      "M100 0 L100 44 Q100 50 94 50 L6 50 Q0 50 0 56 L0 100"
    )
  })

  it("shrinks the corner radius for small horizontal offsets", () => {
    expect(buildSmoothStepPath({ x: 0, y: 0 }, { x: 4, y: 100 })).toBe(
      "M0 0 L0 48 Q0 50 2 50 L2 50 Q4 50 4 52 L4 100"
    )
  })
})

describe("getEdgeEndpoints", () => {
  it("connects scenario edges from the source bottom-center to the target top-center", () => {
    const edge = layout.edges.find((item) => item.id === "login->project")!
    const login = layout.scenarioNodes.find((node) => node.id === "login")!
    const project = layout.scenarioNodes.find((node) => node.id === "project")!

    expect(getEdgeEndpoints(edge, layout)).toEqual({
      source: {
        x: login.position.x + NODE_WIDTH / 2,
        y: login.position.y + NODE_HEIGHT,
      },
      target: {
        x: project.position.x + NODE_WIDTH / 2,
        y: project.position.y,
      },
    })
  })

  it("connects phase edges using the phase container size", () => {
    const edge = layout.edges.find((item) => item.kind === "phase")!
    const [setup, release] = layout.phaseNodes

    expect(getEdgeEndpoints(edge, layout)).toEqual({
      source: {
        x: setup!.position.x + setup!.size.width / 2,
        y: setup!.position.y + setup!.size.height,
      },
      target: {
        x: release!.position.x + release!.size.width / 2,
        y: release!.position.y,
      },
    })
  })

  it("returns null when an endpoint is not in the matching node set", () => {
    expect(
      getEdgeEndpoints(
        { id: "x", kind: "phase", source: "login", target: "project" },
        layout
      )
    ).toBeNull()
  })
})

describe("getScenarioGraphBounds", () => {
  it("encloses every phase container", () => {
    const [setup, release] = layout.phaseNodes

    expect(getScenarioGraphBounds(layout)).toEqual({
      x: 0,
      y: 0,
      width: setup!.size.width,
      height: release!.position.y + release!.size.height,
    })
  })

  it("returns null for an empty graph", () => {
    expect(getScenarioGraphBounds(buildScenarioGraphLayout([]))).toBeNull()
  })
})
