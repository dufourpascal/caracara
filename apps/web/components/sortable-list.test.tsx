// @vitest-environment jsdom
import * as React from "react"
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

import { SortableList } from "@workspace/ui/components/sortable-list"

type Phase = {
  id: string
  name: string
}

const phases: Phase[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
]

const LIST_TOP = 100
const LIST_WIDTH = 300
const ROW_GAP = 8
const ROW_HEIGHT = 40

// Row centres sit at 120, 168 and 216.
function rowTop(index: number) {
  return LIST_TOP + index * (ROW_HEIGHT + ROW_GAP)
}

function makeRect(top: number, height: number, width = LIST_WIDTH) {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: width,
    top,
    width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function getRows(list: Element) {
  return Array.from(
    list.querySelectorAll(':scope > [data-slot="sortable-list-item"]')
  )
}

// jsdom has no layout: lay rows out top to bottom in DOM order.
function getBoundingClientRectStub(this: HTMLElement) {
  if (this.dataset.slot === "sortable-list-item" && this.parentElement) {
    return makeRect(
      rowTop(getRows(this.parentElement).indexOf(this)),
      ROW_HEIGHT
    )
  }

  if (this.dataset.slot === "sortable-list") {
    const count = getRows(this).length
    return makeRect(LIST_TOP, count * (ROW_HEIGHT + ROW_GAP) - ROW_GAP)
  }

  return makeRect(0, 0, 0)
}

// jsdom has neither PointerEvent nor pointer capture.
class PointerEventStub extends MouseEvent {
  readonly isPrimary: boolean
  readonly pointerId: number
  readonly pointerType: string

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.isPrimary = init.isPrimary ?? true
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? "mouse"
  }
}

type HarnessProps = {
  items?: Phase[]
  onReorder: (items: Phase[]) => void | Promise<void>
  onRowClick?: (id: string) => void
  onRowKeyDown?: (id: string) => void
}

function Harness({
  items = phases,
  onReorder,
  onRowClick = () => {},
  onRowKeyDown = () => {},
}: HarnessProps) {
  return (
    <SortableList
      items={items}
      onReorder={onReorder}
      renderItem={({ dragHandle, isDragging, item }) => (
        <div
          data-dragging={isDragging ? "true" : undefined}
          data-testid={`row-${item.id}`}
          onClick={() => onRowClick(item.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              onRowKeyDown(item.id)
            }
          }}
          role="button"
          tabIndex={0}
        >
          {dragHandle}
          <span data-testid="row-name">{item.name}</span>
        </div>
      )}
    />
  )
}

// Mirrors a parent that owns the order and accepts every reorder.
function StatefulHarness({
  onReorder,
}: {
  onReorder: (items: Phase[]) => void
}) {
  const [items, setItems] = React.useState(phases)

  return (
    <Harness
      items={items}
      onReorder={(next) => {
        onReorder(next)
        setItems(next)
      }}
    />
  )
}

function getHandle(name: string) {
  return screen.getByRole("button", { name: `Reorder ${name}` })
}

function getOrder() {
  return screen.getAllByTestId("row-name").map((node) => node.textContent)
}

function getLiveRegion(container: HTMLElement) {
  const region = container.querySelector('[aria-live="polite"]')

  if (!region) {
    throw new Error("live region not rendered")
  }

  return region
}

function getRowWrapper(id: string) {
  const wrapper = screen.getByTestId(`row-${id}`).parentElement

  if (!wrapper) {
    throw new Error("row wrapper not rendered")
  }

  return wrapper
}

function pressKey(element: Element, key: string) {
  fireEvent.keyDown(element, { key })
}

function startPointerDrag(handle: Element, clientY: number) {
  fireEvent.pointerDown(handle, {
    button: 0,
    clientX: 20,
    clientY,
    pointerId: 1,
  })
  fireEvent.pointerMove(handle, {
    clientX: 20,
    clientY: clientY + 10,
    pointerId: 1,
  })
}

function deferred() {
  let resolve: () => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

describe("SortableList", () => {
  beforeAll(() => {
    vi.stubGlobal("PointerEvent", PointerEventStub)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      getBoundingClientRectStub
    )
  })

  afterEach(() => {
    cleanup()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("describes the handle and its keyboard instructions", () => {
    render(<Harness onReorder={() => {}} />)

    const handle = getHandle("Alpha")
    const instructions = document.getElementById(
      handle.getAttribute("aria-describedby") ?? ""
    )

    expect(handle.getAttribute("aria-roledescription")).toBe("sortable")
    expect(handle.getAttribute("aria-pressed")).toBeNull()
    expect(instructions?.textContent).toBe(
      "Press Space or Enter to pick up. Use the arrow keys to move, Space or Enter to drop, Escape to cancel."
    )
  })

  describe("keyboard", () => {
    it("picks up, moves and drops once, keeping focus on the handle", () => {
      const onReorder = vi.fn()
      const { container } = render(<StatefulHarness onReorder={onReorder} />)
      const handle = getHandle("Alpha")
      const live = getLiveRegion(container)

      handle.focus()
      pressKey(handle, " ")

      expect(handle.getAttribute("aria-pressed")).toBe("true")
      expect(screen.getByTestId("row-a").dataset.dragging).toBe("true")
      expect(live.textContent).toBe("Picked up Alpha. Position 1 of 3.")

      pressKey(handle, "ArrowDown")
      expect(live.textContent).toBe("Alpha moved to position 2 of 3.")
      pressKey(handle, "ArrowDown")
      pressKey(handle, "ArrowDown")
      expect(live.textContent).toBe("Alpha moved to position 3 of 3.")
      // Preview by transform only; the DOM order holds until the drop.
      expect(getOrder()).toEqual(["Alpha", "Bravo", "Charlie"])
      expect(getRowWrapper("a").style.transform).toBe("translateY(96px)")
      expect(getRowWrapper("b").style.transform).toBe("translateY(-48px)")

      pressKey(handle, "ArrowUp")
      pressKey(handle, "Enter")

      expect(onReorder).toHaveBeenCalledTimes(1)
      expect(
        onReorder.mock.calls[0]?.[0].map((item: Phase) => item.id)
      ).toEqual(["b", "a", "c"])
      expect(getOrder()).toEqual(["Bravo", "Alpha", "Charlie"])
      expect(live.textContent).toBe("Alpha dropped at position 2 of 3.")
      expect(document.activeElement).toBe(getHandle("Alpha"))
      expect(handle.getAttribute("aria-pressed")).toBeNull()
    })

    it("does not call onReorder when dropped in place", () => {
      const onReorder = vi.fn()
      const { container } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Bravo")

      handle.focus()
      pressKey(handle, "Enter")
      pressKey(handle, "ArrowDown")
      pressKey(handle, "ArrowUp")
      pressKey(handle, "Enter")

      expect(onReorder).not.toHaveBeenCalled()
      expect(getLiveRegion(container).textContent).toBe(
        "Bravo dropped. Position 2 of 3 unchanged."
      )
    })

    it("clamps movement to the list bounds", () => {
      const onReorder = vi.fn()
      const { container } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowUp")

      expect(getLiveRegion(container).textContent).toBe(
        "Picked up Alpha. Position 1 of 3."
      )
      expect(getRowWrapper("a").style.transform).toBe("")
    })

    it("cancels on Escape without reordering and keeps focus", () => {
      const onReorder = vi.fn()
      const { container } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      pressKey(handle, "Escape")

      expect(onReorder).not.toHaveBeenCalled()
      expect(getOrder()).toEqual(["Alpha", "Bravo", "Charlie"])
      expect(getRowWrapper("b").style.transform).toBe("")
      expect(getLiveRegion(container).textContent).toBe(
        "Reorder cancelled. Alpha returned to position 1 of 3."
      )
      expect(document.activeElement).toBe(handle)
      expect(screen.getByTestId("row-a").dataset.dragging).toBeUndefined()
    })

    it("cancels when the handle loses focus", () => {
      const onReorder = vi.fn()
      const { container } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      act(() => {
        getHandle("Charlie").focus()
      })

      expect(onReorder).not.toHaveBeenCalled()
      expect(getLiveRegion(container).textContent).toBe(
        "Reorder cancelled. Alpha returned to position 1 of 3."
      )
      // A blur cancel must not pull focus back.
      expect(document.activeElement).toBe(getHandle("Charlie"))

      pressKey(getHandle("Alpha"), "ArrowDown")
      expect(onReorder).not.toHaveBeenCalled()
    })

    it("keeps reorder keys and synthetic clicks away from the row", () => {
      const onRowClick = vi.fn()
      const onRowKeyDown = vi.fn()
      render(
        <Harness
          onReorder={() => {}}
          onRowClick={onRowClick}
          onRowKeyDown={onRowKeyDown}
        />
      )
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, "Enter")
      pressKey(handle, "ArrowDown")
      pressKey(handle, " ")
      fireEvent.keyUp(handle, { key: " " })
      // Keyboard activation clicks carry detail 0.
      fireEvent.click(handle, { detail: 0 })

      expect(onRowKeyDown).not.toHaveBeenCalled()
      expect(onRowClick).not.toHaveBeenCalled()

      // A real pointer click still reaches the row.
      fireEvent.click(handle, { detail: 1 })
      expect(onRowClick).toHaveBeenCalledWith("a")
    })

    it("cancels when the dragged item disappears from items", () => {
      const onReorder = vi.fn()
      const { container, rerender } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Bravo")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      rerender(
        <Harness
          items={phases.filter((phase) => phase.id !== "b")}
          onReorder={onReorder}
        />
      )

      expect(getLiveRegion(container).textContent).toBe("Reorder cancelled.")
      expect(getRowWrapper("c").style.transform).toBe("")

      pressKey(getHandle("Alpha"), "Enter")
      pressKey(getHandle("Alpha"), "Enter")
      expect(onReorder).not.toHaveBeenCalled()
    })

    it("keeps the drag by id when other items change", () => {
      const onReorder = vi.fn()
      const { rerender } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      rerender(
        <Harness
          items={[{ id: "z", name: "Zulu" }, ...phases]}
          onReorder={onReorder}
        />
      )
      pressKey(handle, "Enter")

      expect(onReorder).toHaveBeenCalledTimes(1)
      expect(
        onReorder.mock.calls[0]?.[0].map((item: Phase) => item.id)
      ).toEqual(["z", "b", "a", "c"])
    })
  })

  describe("pointer", () => {
    it("treats movement under 4px as a click", () => {
      const onReorder = vi.fn()
      const onRowClick = vi.fn()
      render(<Harness onReorder={onReorder} onRowClick={onRowClick} />)
      const handle = getHandle("Alpha")

      fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 120 })
      fireEvent.pointerMove(handle, { clientX: 22, clientY: 122 })

      expect(screen.getByTestId("row-a").dataset.dragging).toBeUndefined()
      expect(document.body.style.userSelect).toBe("")

      fireEvent.pointerUp(handle, { clientX: 22, clientY: 122 })
      fireEvent.click(handle, { detail: 1 })

      expect(onReorder).not.toHaveBeenCalled()
      expect(onRowClick).toHaveBeenCalledWith("a")
    })

    it("ignores secondary buttons", () => {
      render(<Harness onReorder={() => {}} />)
      const handle = getHandle("Alpha")

      fireEvent.pointerDown(handle, { button: 2, clientX: 20, clientY: 120 })
      fireEvent.pointerMove(handle, { clientX: 20, clientY: 180 })

      expect(screen.getByTestId("row-a").dataset.dragging).toBeUndefined()
    })

    it("reorders once after crossing a neighbour's midpoint", async () => {
      const onReorder = vi.fn()
      const onRowClick = vi.fn()
      const { container } = render(<StatefulHarness onReorder={onReorder} />)
      const handle = getHandle("Alpha")
      const live = getLiveRegion(container)

      startPointerDrag(handle, 120)

      expect(screen.getByTestId("row-a").dataset.dragging).toBe("true")
      expect(document.body.style.userSelect).toBe("none")
      expect(document.body.style.cursor).toBe("grabbing")
      expect(live.textContent).toBe("Picked up Alpha. Position 1 of 3.")

      fireEvent.pointerMove(handle, { clientX: 20, clientY: 160 })
      expect(getRowWrapper("b").style.transform).toBe("")

      fireEvent.pointerMove(handle, { clientX: 20, clientY: 180 })
      expect(getRowWrapper("a").style.transform).toBe("translateY(60px)")
      expect(getRowWrapper("b").style.transform).toBe("translateY(-48px)")
      expect(getRowWrapper("c").style.transform).toBe("")
      expect(live.textContent).toBe("Alpha moved to position 2 of 3.")

      fireEvent.pointerUp(handle, { clientX: 20, clientY: 180 })

      expect(onReorder).toHaveBeenCalledTimes(1)
      expect(
        onReorder.mock.calls[0]?.[0].map((item: Phase) => item.id)
      ).toEqual(["b", "a", "c"])
      expect(getOrder()).toEqual(["Bravo", "Alpha", "Charlie"])
      expect(live.textContent).toBe("Alpha dropped at position 2 of 3.")
      expect(document.body.style.userSelect).toBe("")
      expect(document.body.style.cursor).toBe("")

      // Further pointer events after the drop are inert.
      fireEvent.pointerMove(handle, { clientX: 20, clientY: 230 })
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 230 })
      expect(onReorder).toHaveBeenCalledTimes(1)
      expect(onRowClick).not.toHaveBeenCalled()
    })

    it("swallows the click that follows a drag, then lets clicks through", async () => {
      const onRowClick = vi.fn()
      render(<Harness onReorder={() => {}} onRowClick={onRowClick} />)
      const handle = getHandle("Alpha")

      startPointerDrag(handle, 120)
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 130 })
      fireEvent.click(handle, { detail: 1 })

      expect(onRowClick).not.toHaveBeenCalled()

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      fireEvent.click(handle, { detail: 1 })
      expect(onRowClick).toHaveBeenCalledTimes(1)
    })

    it("cancels when dropped outside the list", () => {
      const onReorder = vi.fn()
      const { container } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      startPointerDrag(handle, 120)
      fireEvent.pointerMove(handle, { clientX: 20, clientY: 180 })
      fireEvent.pointerMove(handle, { clientX: 500, clientY: 180 })

      // Leaving the list previews the original order.
      expect(getRowWrapper("b").style.transform).toBe("")

      fireEvent.pointerUp(handle, { clientX: 500, clientY: 180 })

      expect(onReorder).not.toHaveBeenCalled()
      expect(getLiveRegion(container).textContent).toBe(
        "Reorder cancelled. Alpha returned to position 1 of 3."
      )
      expect(getRowWrapper("a").style.transform).toBe("")
    })

    it("cancels on Escape mid-drag", () => {
      const onReorder = vi.fn()
      const { container } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      startPointerDrag(handle, 120)
      fireEvent.pointerMove(handle, { clientX: 20, clientY: 230 })
      fireEvent.keyDown(window, { key: "Escape" })
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 230 })

      expect(onReorder).not.toHaveBeenCalled()
      expect(getLiveRegion(container).textContent).toBe(
        "Reorder cancelled. Alpha returned to position 1 of 3."
      )
      expect(document.body.style.userSelect).toBe("")
    })

    it("cancels on pointercancel", () => {
      const onReorder = vi.fn()
      render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      startPointerDrag(handle, 120)
      fireEvent.pointerMove(handle, { clientX: 20, clientY: 230 })
      fireEvent.pointerCancel(handle, { pointerId: 1 })
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 230 })

      expect(onReorder).not.toHaveBeenCalled()
      expect(screen.getByTestId("row-a").dataset.dragging).toBeUndefined()
      expect(getRowWrapper("c").style.transform).toBe("")
    })

    it("cancels when the window loses focus", () => {
      const onReorder = vi.fn()
      render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      startPointerDrag(handle, 120)
      fireEvent.pointerMove(handle, { clientX: 20, clientY: 230 })
      fireEvent.blur(window)
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 230 })

      expect(onReorder).not.toHaveBeenCalled()
    })

    it("cancels when the dragged item disappears from items", () => {
      const onReorder = vi.fn()
      const { rerender } = render(<Harness onReorder={onReorder} />)

      startPointerDrag(getHandle("Alpha"), 120)
      rerender(
        <Harness
          items={phases.filter((phase) => phase.id !== "a")}
          onReorder={onReorder}
        />
      )

      expect(document.body.style.userSelect).toBe("")
      fireEvent.pointerUp(window, { clientX: 20, clientY: 230 })
      expect(onReorder).not.toHaveBeenCalled()
    })

    it("restores body styles and detaches listeners on unmount mid-drag", () => {
      const onReorder = vi.fn()
      const consoleError = vi.spyOn(console, "error")
      const { unmount } = render(<Harness onReorder={onReorder} />)

      document.body.style.cursor = "help"
      startPointerDrag(getHandle("Alpha"), 120)
      expect(document.body.style.cursor).toBe("grabbing")

      unmount()

      expect(document.body.style.cursor).toBe("help")
      expect(document.body.style.userSelect).toBe("")
      fireEvent.pointerMove(window, { clientX: 20, clientY: 230 })
      fireEvent.pointerUp(window, { clientX: 20, clientY: 230 })
      expect(onReorder).not.toHaveBeenCalled()
      expect(consoleError).not.toHaveBeenCalled()

      document.body.style.cursor = ""
      consoleError.mockRestore()
    })
  })

  describe("optimistic order", () => {
    it("shows the new order until onReorder settles, then reverts to props", async () => {
      const pending = deferred()
      const onReorder = vi.fn(() => pending.promise)
      render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      pressKey(handle, " ")

      expect(onReorder).toHaveBeenCalledTimes(1)
      expect(getOrder()).toEqual(["Bravo", "Alpha", "Charlie"])
      expect(document.activeElement).toBe(handle)

      await act(async () => {
        pending.resolve()
        await pending.promise
      })

      expect(getOrder()).toEqual(["Alpha", "Bravo", "Charlie"])
    })

    it("reverts when onReorder rejects", async () => {
      const pending = deferred()
      render(<Harness onReorder={() => pending.promise} />)

      startPointerDrag(getHandle("Charlie"), 216)
      fireEvent.pointerMove(getHandle("Charlie"), { clientX: 20, clientY: 110 })
      fireEvent.pointerUp(getHandle("Charlie"), { clientX: 20, clientY: 110 })

      expect(getOrder()).toEqual(["Charlie", "Alpha", "Bravo"])

      await act(async () => {
        pending.reject(new Error("offline"))
        await pending.promise.catch(() => {})
      })

      expect(getOrder()).toEqual(["Alpha", "Bravo", "Charlie"])
    })

    it("yields to a props update while onReorder is pending", async () => {
      const pending = deferred()
      const onReorder = vi.fn(() => pending.promise)
      const { rerender } = render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      pressKey(handle, " ")
      expect(getOrder()).toEqual(["Bravo", "Alpha", "Charlie"])

      const serverOrder = [phases[2], phases[0], phases[1]] as Phase[]
      rerender(<Harness items={serverOrder} onReorder={onReorder} />)
      expect(getOrder()).toEqual(["Charlie", "Alpha", "Bravo"])

      await act(async () => {
        pending.resolve()
        await pending.promise
      })

      expect(getOrder()).toEqual(["Charlie", "Alpha", "Bravo"])
    })

    it("follows props right away when a synchronous onReorder is ignored", () => {
      const onReorder = vi.fn()
      render(<Harness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      pressKey(handle, " ")

      expect(onReorder).toHaveBeenCalledTimes(1)
      expect(getOrder()).toEqual(["Alpha", "Bravo", "Charlie"])
    })

    it("shows a synchronous parent's new order", () => {
      const onReorder = vi.fn()
      render(<StatefulHarness onReorder={onReorder} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      pressKey(handle, " ")

      expect(onReorder).toHaveBeenCalledTimes(1)
      expect(getOrder()).toEqual(["Bravo", "Alpha", "Charlie"])
      expect(document.activeElement).toBe(handle)
    })

    it("does not update state when onReorder settles after unmount", async () => {
      const pending = deferred()
      const consoleError = vi.spyOn(console, "error")
      const { unmount } = render(<Harness onReorder={() => pending.promise} />)
      const handle = getHandle("Alpha")

      handle.focus()
      pressKey(handle, " ")
      pressKey(handle, "ArrowDown")
      pressKey(handle, " ")
      unmount()

      await act(async () => {
        pending.resolve()
        await pending.promise
      })

      expect(consoleError).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })
})
