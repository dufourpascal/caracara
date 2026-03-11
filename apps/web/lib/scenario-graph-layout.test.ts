import { describe, expect, it } from "vitest"

import { buildScenarioGraphLayout } from "./scenario-graph-layout"

describe("scenario graph layout", () => {
  it("stacks phases from top to bottom", () => {
    const layout = buildScenarioGraphLayout([
      {
        id: "login",
        name: "Login",
        slug: "login",
        dependencyIds: [],
        phaseId: "phase-1",
        phaseName: "Setup",
        phaseOrder: 1,
      },
      {
        id: "project",
        name: "Create project",
        slug: "create-project",
        dependencyIds: ["login"],
        phaseId: "phase-2",
        phaseName: "Interaction",
        phaseOrder: 2,
      },
      {
        id: "publish",
        name: "Publish",
        slug: "publish",
        dependencyIds: [],
        phaseId: "phase-3",
        phaseName: "Cleanup",
        phaseOrder: 3,
      },
    ])

    const phase1 = layout.phaseNodes.find((node) => node.id === "phase-1")
    const phase2 = layout.phaseNodes.find((node) => node.id === "phase-2")
    const phase3 = layout.phaseNodes.find((node) => node.id === "phase-3")

    expect(phase1?.position.y).toBeLessThan(phase2?.position.y ?? 0)
    expect(phase2?.position.y).toBeLessThan(phase3?.position.y ?? 0)
  })

  it("keeps same-phase siblings on the same depth aligned horizontally", () => {
    const layout = buildScenarioGraphLayout([
      {
        id: "login",
        name: "Login",
        slug: "login",
        dependencyIds: [],
        phaseId: "phase-1",
        phaseName: "Setup",
        phaseOrder: 1,
      },
      {
        id: "project",
        name: "Create project",
        slug: "create-project",
        dependencyIds: ["login"],
        phaseId: "phase-1",
        phaseName: "Setup",
        phaseOrder: 1,
      },
      {
        id: "team",
        name: "Invite team",
        slug: "invite-team",
        dependencyIds: ["login"],
        phaseId: "phase-1",
        phaseName: "Setup",
        phaseOrder: 1,
      },
    ])

    const project = layout.scenarioNodes.find((node) => node.id === "project")
    const team = layout.scenarioNodes.find((node) => node.id === "team")

    expect(project?.position.y).toBe(team?.position.y)
    expect(project?.position.x).not.toBe(team?.position.x)
  })

  it("drops unassigned scenarios from grouped graph output", () => {
    const layout = buildScenarioGraphLayout([
      {
        id: "login",
        name: "Login",
        slug: "login",
        dependencyIds: [],
      },
    ])

    expect(layout.phaseNodes).toHaveLength(0)
    expect(layout.scenarioNodes).toHaveLength(0)
    expect(layout.omittedScenarioCount).toBe(1)
    expect(layout.edges).toHaveLength(0)
  })
})
