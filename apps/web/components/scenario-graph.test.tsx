// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
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

const resizeObservers: ResizeObserverStub[] = []

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this)
  }

  observe(target: Element) {
    this.trigger(target)
  }

  trigger(target: Element) {
    this.callback(
      [{ target } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }

  unobserve() {}

  disconnect() {}
}

// jsdom has neither PointerEvent nor pointer capture.
class PointerEventStub extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? "mouse"
  }
}

let viewportWidth = 800

function getTransform(container: HTMLElement) {
  const group = container.querySelector("svg > g")
  const match = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(
    group?.getAttribute("transform") ?? ""
  )

  if (!match) {
    throw new Error("graph transform not rendered")
  }

  return { x: Number(match[1]), y: Number(match[2]), k: Number(match[3]) }
}

function getSvg(container: HTMLElement) {
  const svg = container.querySelector("svg")

  if (!svg) {
    throw new Error("svg not rendered")
  }

  return svg
}

describe("ScenarioGraph", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal("PointerEvent", PointerEventStub)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => viewportWidth
    )
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600)
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => true)
  })

  afterEach(() => {
    cleanup()
    resizeObservers.length = 0
    viewportWidth = 800
  })

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

  it("pans on drag and ignores wheel zoom while dragging", () => {
    const { container } = render(<ScenarioGraph scenarios={scenarios} />)
    const svg = getSvg(container)
    const fitted = getTransform(container)

    fireEvent.pointerDown(svg, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(svg, { buttons: 1, clientX: 130, clientY: 90 })

    expect(getTransform(container)).toEqual({
      x: fitted.x + 30,
      y: fitted.y - 10,
      k: fitted.k,
    })

    fireEvent.wheel(svg, { deltaY: -200, clientX: 130, clientY: 90 })

    expect(getTransform(container).k).toBe(fitted.k)

    fireEvent.pointerMove(svg, { buttons: 1, clientX: 140, clientY: 90 })

    expect(getTransform(container)).toEqual({
      x: fitted.x + 40,
      y: fitted.y - 10,
      k: fitted.k,
    })

    fireEvent.pointerUp(svg, { clientX: 140, clientY: 90 })
    fireEvent.wheel(svg, { deltaY: -200, clientX: 140, clientY: 90 })

    expect(getTransform(container).k).toBeGreaterThan(fitted.k)
  })

  it("stops panning when pointer capture is lost or no button is held", () => {
    const { container } = render(<ScenarioGraph scenarios={scenarios} />)
    const svg = getSvg(container)
    const fitted = getTransform(container)

    fireEvent.pointerDown(svg, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.lostPointerCapture(svg)
    fireEvent.pointerMove(svg, { buttons: 1, clientX: 150, clientY: 100 })

    expect(getTransform(container)).toEqual(fitted)

    fireEvent.pointerDown(svg, {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(svg, { buttons: 0, clientX: 150, clientY: 100 })
    fireEvent.pointerMove(svg, { buttons: 1, clientX: 200, clientY: 100 })

    expect(getTransform(container)).toEqual(fitted)
  })

  it("keeps a manual view across a resize and refits when scenarios change", () => {
    const { container, rerender } = render(
      <ScenarioGraph scenarios={scenarios} />
    )
    const svg = getSvg(container)
    const viewport = svg.parentElement as HTMLElement

    fireEvent.wheel(svg, { deltaY: -200, clientX: 200, clientY: 200 })

    const zoomed = getTransform(container)

    viewportWidth = 400
    act(() => {
      for (const observer of resizeObservers) {
        observer.trigger(viewport)
      }
    })

    expect(getTransform(container)).toEqual(zoomed)

    rerender(<ScenarioGraph scenarios={[...scenarios]} />)

    expect(getTransform(container)).toEqual(zoomed)

    rerender(<ScenarioGraph scenarios={scenarios.slice(0, 2)} />)

    expect(getTransform(container)).not.toEqual(zoomed)
  })

  it("disables the zoom buttons at the limits and fit view restores the fit", () => {
    const { container } = render(<ScenarioGraph scenarios={scenarios} />)
    const fitted = getTransform(container)
    const zoomIn = screen.getByRole("button", { name: "Zoom in" })
    const zoomOut = screen.getByRole("button", { name: "Zoom out" })

    for (
      let index = 0;
      index < 20 && !zoomIn.hasAttribute("disabled");
      index++
    ) {
      fireEvent.click(zoomIn)
    }

    expect(zoomIn.hasAttribute("disabled")).toBe(true)
    expect(getTransform(container).k).toBe(1.4)

    for (
      let index = 0;
      index < 20 && !zoomOut.hasAttribute("disabled");
      index++
    ) {
      fireEvent.click(zoomOut)
    }

    expect(zoomOut.hasAttribute("disabled")).toBe(true)
    expect(getTransform(container).k).toBe(0.35)

    fireEvent.click(screen.getByRole("button", { name: "Fit view" }))

    expect(getTransform(container)).toEqual(fitted)
  })
})
