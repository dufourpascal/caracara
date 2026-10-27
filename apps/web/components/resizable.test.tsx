// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizableLayout,
} from "@workspace/ui/components/resizable"

afterEach(() => {
  cleanup()
  document.body.style.userSelect = ""
  document.body.style.cursor = ""
})

function renderSplit({
  defaultLayout,
  onLayoutChanged = vi.fn(),
}: {
  defaultLayout?: ResizableLayout
  onLayoutChanged?: (layout: ResizableLayout) => void
} = {}) {
  const result = render(
    <ResizablePanelGroup
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      orientation="horizontal"
    >
      <ResizablePanel
        defaultSize="320px"
        id="list"
        maxSize="420px"
        minSize="260px"
      >
        list
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="detail">detail</ResizablePanel>
    </ResizablePanelGroup>
  )

  return {
    ...result,
    detail: result.container.querySelector<HTMLElement>(
      '[data-panel-id="detail"]'
    )!,
    handle: screen.getByRole("separator"),
    list: result.container.querySelector<HTMLElement>(
      '[data-panel-id="list"]'
    )!,
    onLayoutChanged,
  }
}

function drag(handle: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(handle, { button: 0, clientX: from, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: to, pointerId: 1 })
}

describe("Resizable", () => {
  it("renders the default width and separator semantics", () => {
    const { detail, handle, list, onLayoutChanged } = renderSplit()

    expect(list.style.width).toBe("320px")
    expect(list.style.flex).toBe("0 0 auto")
    expect(detail.style.flex).toBe("1 1 0px")
    expect(detail.style.width).toBe("")
    expect(list.id).not.toBe("list")

    expect(handle.getAttribute("aria-controls")).toBe(list.id)
    expect(handle.getAttribute("aria-orientation")).toBe("vertical")
    expect(handle.getAttribute("aria-label")).toBe("Resize panel")
    expect(handle.getAttribute("aria-valuenow")).toBe("320")
    expect(handle.getAttribute("aria-valuemin")).toBe("260")
    expect(handle.getAttribute("aria-valuemax")).toBe("420")
    expect(handle.tabIndex).toBe(0)
    expect(onLayoutChanged).not.toHaveBeenCalled()
  })

  it("lets callers override the separator label", () => {
    render(
      <ResizablePanelGroup>
        <ResizablePanel defaultSize={200} id="a" />
        <ResizableHandle aria-label="Resize run list" />
        <ResizablePanel id="b" />
      </ResizablePanelGroup>
    )

    expect(
      screen.getByRole("separator", { name: "Resize run list" })
    ).toBeTruthy()
  })

  it("restores, clamps and validates the default layout", () => {
    const restored = renderSplit({ defaultLayout: { list: 300 } })
    expect(restored.list.style.width).toBe("300px")
    cleanup()

    const tooWide = renderSplit({ defaultLayout: { list: 9000 } })
    expect(tooWide.list.style.width).toBe("420px")
    expect(tooWide.handle.getAttribute("aria-valuenow")).toBe("420")
    cleanup()

    const tooNarrow = renderSplit({ defaultLayout: { list: 10 } })
    expect(tooNarrow.list.style.width).toBe("260px")
    cleanup()

    const notFinite = renderSplit({ defaultLayout: { list: Number.NaN } })
    expect(notFinite.list.style.width).toBe("320px")
    cleanup()

    const malformed = renderSplit({
      defaultLayout: { list: "abc" } as unknown as ResizableLayout,
    })
    expect(malformed.list.style.width).toBe("320px")
    expect(malformed.onLayoutChanged).not.toHaveBeenCalled()
  })

  it("reads the default layout on mount only", () => {
    const { handle, list, rerender } = renderSplit({
      defaultLayout: { list: 300 },
    })

    rerender(
      <ResizablePanelGroup defaultLayout={{ list: 400 }}>
        <ResizablePanel
          defaultSize="320px"
          id="list"
          maxSize="420px"
          minSize="260px"
        />
        <ResizableHandle />
        <ResizablePanel id="detail" />
      </ResizablePanelGroup>
    )

    expect(list.style.width).toBe("300px")
    expect(handle.getAttribute("aria-valuenow")).toBe("300")
  })

  it("steps with the keyboard and commits each change", () => {
    const { handle, list, onLayoutChanged } = renderSplit()

    expect(fireEvent.keyDown(handle, { key: "ArrowRight" })).toBe(false)
    expect(list.style.width).toBe("336px")
    expect(onLayoutChanged).toHaveBeenLastCalledWith({ list: 336 })

    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true })
    expect(list.style.width).toBe("272px")
    expect(handle.getAttribute("aria-valuenow")).toBe("272")
    expect(onLayoutChanged).toHaveBeenLastCalledWith({ list: 272 })

    fireEvent.keyDown(handle, { key: "Home" })
    expect(list.style.width).toBe("260px")

    fireEvent.keyDown(handle, { key: "End" })
    expect(list.style.width).toBe("420px")
    expect(onLayoutChanged).toHaveBeenCalledTimes(4)

    fireEvent.keyDown(handle, { key: "End" })
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true })
    expect(list.style.width).toBe("420px")
    expect(onLayoutChanged).toHaveBeenCalledTimes(4)

    expect(fireEvent.keyDown(handle, { key: "Enter" })).toBe(true)
  })

  it("ignores End when the panel has no maximum", () => {
    const onLayoutChanged = vi.fn()
    render(
      <ResizablePanelGroup onLayoutChanged={onLayoutChanged}>
        <ResizablePanel defaultSize="200px" id="a" />
        <ResizableHandle />
        <ResizablePanel id="b" />
      </ResizablePanelGroup>
    )
    const handle = screen.getByRole("separator")

    expect(handle.hasAttribute("aria-valuemax")).toBe(false)
    expect(handle.getAttribute("aria-valuemin")).toBe("0")
    expect(fireEvent.keyDown(handle, { key: "End" })).toBe(true)
    expect(onLayoutChanged).not.toHaveBeenCalled()
  })

  it("drags live and commits once with the clamped width", () => {
    const { handle, list, onLayoutChanged } = renderSplit()

    expect(
      fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 })
    ).toBe(false)
    expect(handle.hasAttribute("data-resize-handle-active")).toBe(true)

    fireEvent.pointerMove(window, { clientX: 140, pointerId: 1 })
    expect(list.style.width).toBe("360px")

    fireEvent.pointerMove(document, { clientX: 900, pointerId: 1 })
    expect(list.style.width).toBe("420px")
    expect(handle.getAttribute("aria-valuenow")).toBe("420")

    fireEvent.pointerMove(window, { clientX: 50, pointerId: 2 })
    expect(list.style.width).toBe("420px")
    expect(onLayoutChanged).not.toHaveBeenCalled()

    fireEvent.pointerUp(document, { clientX: 900, pointerId: 1 })
    expect(onLayoutChanged).toHaveBeenCalledTimes(1)
    expect(onLayoutChanged).toHaveBeenCalledWith({ list: 420 })
    expect(handle.hasAttribute("data-resize-handle-active")).toBe(false)

    fireEvent.pointerMove(window, { clientX: 0, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 0, pointerId: 1 })
    expect(list.style.width).toBe("420px")
    expect(onLayoutChanged).toHaveBeenCalledTimes(1)
  })

  it("does not commit a drag that ends at the start width", () => {
    const { handle, list, onLayoutChanged } = renderSplit()

    drag(handle, 100, 160)
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 })

    expect(list.style.width).toBe("320px")
    expect(onLayoutChanged).not.toHaveBeenCalled()
  })

  it("locks body selection during a drag and restores it afterwards", () => {
    document.body.style.userSelect = "text"
    document.body.style.cursor = "wait"
    const { handle } = renderSplit()

    drag(handle, 100, 120)
    expect(document.body.style.userSelect).toBe("none")
    expect(document.body.style.cursor).toBe("col-resize")

    fireEvent.pointerUp(handle, { clientX: 120, pointerId: 1 })
    expect(document.body.style.userSelect).toBe("text")
    expect(document.body.style.cursor).toBe("wait")
  })

  it.each([
    [
      "pointercancel",
      (handle: HTMLElement) =>
        fireEvent.pointerCancel(handle, { pointerId: 1 }),
    ],
    [
      "Escape",
      (handle: HTMLElement) => fireEvent.keyDown(handle, { key: "Escape" }),
    ],
    ["window blur", () => fireEvent.blur(window)],
    [
      "lost pointer capture",
      (handle: HTMLElement) =>
        fireEvent.lostPointerCapture(handle, { pointerId: 1 }),
    ],
  ])("reverts without committing on %s", (_label, interrupt) => {
    const { handle, list, onLayoutChanged } = renderSplit()

    drag(handle, 100, 180)
    expect(list.style.width).toBe("400px")

    interrupt(handle)
    expect(list.style.width).toBe("320px")
    expect(handle.getAttribute("aria-valuenow")).toBe("320")
    expect(document.body.style.userSelect).toBe("")

    fireEvent.pointerUp(handle, { clientX: 180, pointerId: 1 })
    expect(onLayoutChanged).not.toHaveBeenCalled()
  })

  it("ignores non-primary buttons", () => {
    const { handle, list } = renderSplit()

    expect(
      fireEvent.pointerDown(handle, { button: 2, clientX: 100, pointerId: 1 })
    ).toBe(true)
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 })

    expect(list.style.width).toBe("320px")
    expect(document.body.style.userSelect).toBe("")
    expect(handle.hasAttribute("data-resize-handle-active")).toBe(false)
  })

  it("cleans up when unmounted mid-drag", () => {
    const { handle, onLayoutChanged, unmount } = renderSplit()
    const removeListener = vi.spyOn(window, "removeEventListener")

    drag(handle, 100, 150)
    unmount()

    expect(document.body.style.userSelect).toBe("")
    expect(document.body.style.cursor).toBe("")
    expect(removeListener).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
      true
    )

    fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 300, pointerId: 1 })
    expect(onLayoutChanged).not.toHaveBeenCalled()
    removeListener.mockRestore()
  })

  it("inverts direction for a sized panel after the handle", () => {
    const onLayoutChanged = vi.fn()
    const { container } = render(
      <ResizablePanelGroup onLayoutChanged={onLayoutChanged}>
        <ResizablePanel id="main" />
        <ResizableHandle />
        <ResizablePanel defaultSize={300} id="aside" minSize={200} />
      </ResizablePanelGroup>
    )
    const handle = screen.getByRole("separator")
    const aside = container.querySelector<HTMLElement>(
      '[data-panel-id="aside"]'
    )!

    expect(handle.getAttribute("aria-controls")).toBe(aside.id)

    fireEvent.keyDown(handle, { key: "ArrowLeft" })
    expect(aside.style.width).toBe("316px")
    expect(onLayoutChanged).toHaveBeenLastCalledWith({ aside: 316 })

    drag(handle, 500, 450)
    expect(aside.style.width).toBe("366px")
    fireEvent.pointerUp(handle, { clientX: 450, pointerId: 1 })
    expect(onLayoutChanged).toHaveBeenLastCalledWith({ aside: 366 })

    fireEvent.keyDown(handle, { key: "Home" })
    expect(aside.style.width).toBe("200px")
  })

  it("keeps nested groups independent", () => {
    const outerChanged = vi.fn()
    const innerChanged = vi.fn()
    const { container } = render(
      <ResizablePanelGroup onLayoutChanged={outerChanged}>
        <ResizablePanel defaultSize="320px" id="list" minSize="260px" />
        <ResizableHandle aria-label="Resize outer" />
        <ResizablePanel id="detail">
          <ResizablePanelGroup onLayoutChanged={innerChanged}>
            <ResizablePanel
              defaultSize="280px"
              id="summary"
              maxSize="360px"
              minSize="220px"
            />
            <ResizableHandle aria-label="Resize inner" />
            <ResizablePanel id="result" />
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    )
    const outer = screen.getByRole("separator", { name: "Resize outer" })
    const inner = screen.getByRole("separator", { name: "Resize inner" })
    const list = container.querySelector<HTMLElement>('[data-panel-id="list"]')!
    const summary = container.querySelector<HTMLElement>(
      '[data-panel-id="summary"]'
    )!

    expect(outer.getAttribute("aria-controls")).toBe(list.id)
    expect(inner.getAttribute("aria-controls")).toBe(summary.id)
    expect(inner.getAttribute("aria-valuenow")).toBe("280")

    fireEvent.keyDown(inner, { key: "End" })
    expect(summary.style.width).toBe("360px")
    expect(list.style.width).toBe("320px")
    expect(innerChanged).toHaveBeenCalledWith({ summary: 360 })
    expect(outerChanged).not.toHaveBeenCalled()

    drag(outer, 100, 60)
    fireEvent.pointerUp(outer, { clientX: 60, pointerId: 1 })
    expect(list.style.width).toBe("280px")
    expect(summary.style.width).toBe("360px")
    expect(outerChanged).toHaveBeenCalledWith({ list: 280 })
    expect(innerChanged).toHaveBeenCalledTimes(1)
  })
})
