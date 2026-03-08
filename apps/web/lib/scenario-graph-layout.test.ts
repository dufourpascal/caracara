import { describe, expect, it } from "vitest"

import { buildScenarioGraphLayout } from "./scenario-graph-layout"

describe("scenario graph layout", () => {
  it("places dependencies above dependents", () => {
    const layout = buildScenarioGraphLayout([
      {
        id: "login",
        name: "Login",
        slug: "login",
        dependencyIds: [],
      },
      {
        id: "project",
        name: "Create project",
        slug: "create-project",
        dependencyIds: ["login"],
      },
      {
        id: "publish",
        name: "Publish",
        slug: "publish",
        dependencyIds: ["project"],
      },
    ])

    const login = layout.nodes.find((node) => node.id === "login")
    const project = layout.nodes.find((node) => node.id === "project")
    const publish = layout.nodes.find((node) => node.id === "publish")

    expect(login?.position.y).toBeLessThan(project?.position.y ?? 0)
    expect(project?.position.y).toBeLessThan(publish?.position.y ?? 0)
  })

  it("keeps siblings on the same depth aligned horizontally", () => {
    const layout = buildScenarioGraphLayout([
      {
        id: "login",
        name: "Login",
        slug: "login",
        dependencyIds: [],
      },
      {
        id: "project",
        name: "Create project",
        slug: "create-project",
        dependencyIds: ["login"],
      },
      {
        id: "team",
        name: "Invite team",
        slug: "invite-team",
        dependencyIds: ["login"],
      },
    ])

    const project = layout.nodes.find((node) => node.id === "project")
    const team = layout.nodes.find((node) => node.id === "team")

    expect(project?.position.y).toBe(team?.position.y)
    expect(project?.position.x).not.toBe(team?.position.x)
  })

  it("drops missing dependencies instead of producing broken edges", () => {
    const layout = buildScenarioGraphLayout([
      {
        id: "login",
        name: "Login",
        slug: "login",
        dependencyIds: ["missing"],
      },
    ])

    expect(layout.nodes).toHaveLength(1)
    expect(layout.nodes[0]?.isRoot).toBe(true)
    expect(layout.edges).toHaveLength(0)
  })
})
