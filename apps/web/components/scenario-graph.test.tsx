// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { buildScenarioGraphLayout } from "@/lib/scenario-graph-layout"
import type { ScenarioGraphScenario } from "@/lib/scenario-graph-layout"

import { ScenarioGraph } from "./scenario-graph"

const scenarios: ScenarioGraphScenario[] = [
  {
    id: "login",
    name: "Login",
    slug: "login-flow",
    dependencyIds: [],
    phaseId: "setup",
    phaseName: "Setup",
    phaseOrder: 1,
  },
  {
    id: "project",
    name: "Create project",
    slug: "create-project",
    dependencyIds: ["login"],
    phaseId: "setup",
    phaseName: "Setup",
    phaseOrder: 1,
  },
  {
    id: "publish",
    name: "Publish",
    slug: "publish-release",
    dependencyIds: [],
    phaseId: "release",
    phaseName: "Release",
    phaseOrder: 2,
  },
]

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [{ target } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }

  unobserve() {}

  disconnect() {}
}

describe("ScenarioGraph", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600)
  })

  afterEach(cleanup)

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("renders phases, scenarios and one path per layout edge", () => {
    const { container } = render(<ScenarioGraph scenarios={scenarios} />)
    const layout = buildScenarioGraphLayout(scenarios)

    expect(screen.getByText("Setup")).toBeTruthy()
    expect(screen.getByText("Release")).toBeTruthy()

    for (const scenario of scenarios) {
      expect(screen.getByText(scenario.name)).toBeTruthy()
      expect(screen.getByText(scenario.slug)).toBeTruthy()
    }

    const paths = container.querySelectorAll("path[data-edge-kind]")

    expect(paths).toHaveLength(layout.edges.length)
    expect(
      container.querySelectorAll('path[data-edge-kind="phase"]')
    ).toHaveLength(1)
    expect(
      container.querySelectorAll('path[data-edge-kind="scenario"]')
    ).toHaveLength(1)
    expect(screen.getAllByText("Root")).toHaveLength(2)
    expect(screen.queryByText(/omitted from the/)).toBeNull()
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Fit view" })).toBeTruthy()
  })

  it("shows the omitted banner when a scenario has no phase", () => {
    render(
      <ScenarioGraph
        scenarios={[
          ...scenarios,
          {
            id: "orphan",
            name: "Orphan",
            slug: "orphan",
            dependencyIds: [],
            phaseId: null,
          },
        ]}
      />
    )

    expect(
      screen.getByText(/1 unassigned scenario\s+omitted from the/)
    ).toBeTruthy()
    expect(screen.queryByText("Orphan")).toBeNull()
  })
})
