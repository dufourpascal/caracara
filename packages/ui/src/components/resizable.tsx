"use client"

import { GripVertical } from "lucide-react"
import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

// Horizontal-only pixel splitter. Panels with a `defaultSize` are "sized"
// and keep an explicit width; panels without one flex into the remaining
// space. Each handle resizes the sized panel directly before it, or the one
// directly after it (with the drag direction inverted).

/** Panel id -> width in px, for sized panels only. */
export type ResizableLayout = Record<string, number>

/** Pixel size; a bare number is treated as px. */
export type ResizablePanelSize = number | `${number}px`

const KEYBOARD_STEP = 16
const KEYBOARD_STEP_LARGE = 64

type PanelMeta = {
  domId: string
  initialWidth: number
  max: number
  min: number
}

type ResizableGroupContextValue = {
  commit: () => void
  defaultLayout: ResizableLayout | undefined
  getPanel: (panelId: string) => PanelMeta | undefined
  getWidth: (panelId: string) => number | undefined
  layout: ResizableLayout
  panels: Record<string, PanelMeta>
  registerPanel: (panelId: string, meta: PanelMeta) => () => void
  setWidth: (panelId: string, width: number) => void
}

const ResizableGroupContext =
  React.createContext<ResizableGroupContextValue | null>(null)

function useResizableGroup(component: string) {
  const context = React.useContext(ResizableGroupContext)
  if (!context) {
    throw new Error(`${component} must be rendered inside ResizablePanelGroup`)
  }
  return context
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

function parsePanelSize(size: ResizablePanelSize | undefined) {
  const value =
    typeof size === "number"
      ? size
      : typeof size === "string" && size.endsWith("px")
        ? Number(size.slice(0, -2))
        : Number.NaN
  return Number.isFinite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resolveWidth(
  layout: ResizableLayout,
  meta: PanelMeta | undefined,
  panelId: string
) {
  if (!meta) {
    return undefined
  }
  return clamp(layout[panelId] ?? meta.initialWidth, meta.min, meta.max)
}

function ResizablePanelGroup({
  className,
  defaultLayout,
  onLayoutChanged,
  orientation = "horizontal",
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  orientation?: "horizontal"
  defaultLayout?: ResizableLayout
  onLayoutChanged?: (layout: ResizableLayout) => void
}) {
  const [initialLayout] = React.useState(defaultLayout)
  const [layout, setLayout] = React.useState<ResizableLayout>({})
  const [panels, setPanels] = React.useState<Record<string, PanelMeta>>({})

  // Event handlers read the latest values synchronously through refs.
  const layoutRef = React.useRef(layout)
  const panelsRef = React.useRef(panels)
  const onLayoutChangedRef = React.useRef(onLayoutChanged)
  useIsomorphicLayoutEffect(() => {
    onLayoutChangedRef.current = onLayoutChanged
  })

  const getPanel = React.useCallback(
    (panelId: string) => panelsRef.current[panelId],
    []
  )

  const getWidth = React.useCallback(
    (panelId: string) =>
      resolveWidth(layoutRef.current, panelsRef.current[panelId], panelId),
    []
  )

  const setWidth = React.useCallback((panelId: string, width: number) => {
    const meta = panelsRef.current[panelId]
    const next = meta ? clamp(width, meta.min, meta.max) : width
    if (layoutRef.current[panelId] === next) {
      return
    }
    layoutRef.current = { ...layoutRef.current, [panelId]: next }
    setLayout(layoutRef.current)
  }, [])

  const commit = React.useCallback(() => {
    const nextLayout: ResizableLayout = {}
    for (const panelId of Object.keys(panelsRef.current)) {
      const width = getWidth(panelId)
      if (width !== undefined) {
        nextLayout[panelId] = width
      }
    }
    onLayoutChangedRef.current?.(nextLayout)
  }, [getWidth])

  const registerPanel = React.useCallback(
    (panelId: string, meta: PanelMeta) => {
      panelsRef.current = { ...panelsRef.current, [panelId]: meta }
      setPanels(panelsRef.current)
      return () => {
        if (panelsRef.current[panelId] !== meta) {
          return
        }
        const rest = { ...panelsRef.current }
        delete rest[panelId]
        panelsRef.current = rest
        setPanels(rest)
      }
    },
    []
  )

  const contextValue = React.useMemo<ResizableGroupContextValue>(
    () => ({
      commit,
      defaultLayout: initialLayout,
      getPanel,
      getWidth,
      layout,
      panels,
      registerPanel,
      setWidth,
    }),
    [
      commit,
      getPanel,
      getWidth,
      initialLayout,
      layout,
      panels,
      registerPanel,
      setWidth,
    ]
  )

  return (
    <ResizableGroupContext.Provider value={contextValue}>
      <div
        data-orientation={orientation}
        data-slot="resizable-panel-group"
        className={cn("flex h-full w-full", className)}
        {...props}
      />
    </ResizableGroupContext.Provider>
  )
}

function ResizablePanel({
  className,
  defaultSize,
  id,
  maxSize,
  minSize,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  id: string
  defaultSize?: ResizablePanelSize
  minSize?: ResizablePanelSize
  maxSize?: ResizablePanelSize
}) {
  const group = useResizableGroup("ResizablePanel")
  const domId = React.useId()
  const sized = defaultSize !== undefined
  const min = parsePanelSize(minSize) ?? 0
  const max = parsePanelSize(maxSize) ?? Number.POSITIVE_INFINITY

  // Resolved synchronously so server and first client render agree.
  const [initialWidth] = React.useState(() => {
    const stored = group.defaultLayout?.[id]
    const width =
      typeof stored === "number" && Number.isFinite(stored)
        ? stored
        : (parsePanelSize(defaultSize) ?? min)
    return clamp(width, min, max)
  })

  const { registerPanel } = group
  useIsomorphicLayoutEffect(() => {
    if (!sized) {
      return
    }
    return registerPanel(id, { domId, initialWidth, max, min })
  }, [domId, id, initialWidth, max, min, registerPanel, sized])

  const width = clamp(group.layout[id] ?? initialWidth, min, max)

  return (
    <div
      data-panel-id={id}
      data-panel-sized={sized ? "" : undefined}
      data-slot="resizable-panel"
      id={domId}
      className={cn("h-full min-w-0 overflow-hidden", className)}
      style={{
        ...style,
        ...(sized ? { flex: "0 0 auto", width } : { flex: "1 1 0px" }),
      }}
      {...props}
    />
  )
}

type ControlledPanel = { panelId: string; inverted: boolean }

function getSizedPanelId(element: Element | null | undefined) {
  if (
    element instanceof HTMLElement &&
    element.dataset.slot === "resizable-panel" &&
    element.dataset.panelSized !== undefined
  ) {
    return element.dataset.panelId
  }
  return undefined
}

type DragState = {
  cleanup: () => void
  panelId: string
  startWidth: number
}

function ResizableHandle({
  "aria-label": ariaLabel = "Resize panel",
  className,
  onKeyDown,
  onPointerDown,
  ref,
  withHandle = false,
  ...props
}: React.ComponentProps<"div"> & {
  withHandle?: boolean
}) {
  const group = useResizableGroup("ResizableHandle")
  const elementRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const [controlled, setControlled] = React.useState<ControlledPanel | null>(
    null
  )
  const [dragging, setDragging] = React.useState(false)

  // Adjacency comes from DOM siblings, which stays correct for nested groups.
  useIsomorphicLayoutEffect(() => {
    const element = elementRef.current
    const previousId = getSizedPanelId(element?.previousElementSibling)
    const nextId = getSizedPanelId(element?.nextElementSibling)
    const next: ControlledPanel | null =
      previousId !== undefined
        ? { panelId: previousId, inverted: false }
        : nextId !== undefined
          ? { panelId: nextId, inverted: true }
          : null
    setControlled((current) =>
      current?.panelId === next?.panelId && current?.inverted === next?.inverted
        ? current
        : next
    )
  })

  // Unmounting mid-drag reverts the uncommitted width and restores the body.
  React.useEffect(() => () => dragRef.current?.cleanup(), [])

  const setRefs = React.useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element
      if (typeof ref === "function") {
        return ref(element)
      }
      if (ref) {
        ref.current = element
      }
    },
    [ref]
  )

  const meta = controlled ? group.panels[controlled.panelId] : undefined
  const width = controlled
    ? resolveWidth(group.layout, meta, controlled.panelId)
    : undefined

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event)
    if (event.defaultPrevented || event.button !== 0 || dragRef.current) {
      return
    }
    if (!controlled) {
      return
    }
    const currentWidth = group.getWidth(controlled.panelId)
    if (currentWidth === undefined) {
      return
    }
    event.preventDefault()

    const startWidth: number = currentWidth

    const element = event.currentTarget
    const { inverted, panelId } = controlled
    const { commit, getWidth, setWidth } = group
    const pointerId = event.pointerId
    const startX = event.clientX
    const body = document.body
    const previousUserSelect = body.style.userSelect
    const previousCursor = body.style.cursor
    body.style.userSelect = "none"
    body.style.cursor = "col-resize"
    if (typeof element.setPointerCapture === "function") {
      try {
        element.setPointerCapture(pointerId)
      } catch {
        // The pointer may already be gone; window listeners still apply.
      }
    }

    const isTrackedPointer = (nativeEvent: PointerEvent) =>
      nativeEvent.pointerId === pointerId

    const end = (outcome: "commit" | "revert") => {
      window.removeEventListener("pointermove", handleMove, true)
      window.removeEventListener("pointerup", handleUp, true)
      window.removeEventListener("pointercancel", handleCancel, true)
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("blur", handleRevert)
      element.removeEventListener("lostpointercapture", handleRevert)
      body.style.userSelect = previousUserSelect
      body.style.cursor = previousCursor
      dragRef.current = null
      setDragging(false)

      if (outcome === "revert") {
        setWidth(panelId, startWidth)
      } else if (getWidth(panelId) !== startWidth) {
        commit()
      }
    }

    function handleMove(nativeEvent: PointerEvent) {
      if (!isTrackedPointer(nativeEvent)) {
        return
      }
      const delta = nativeEvent.clientX - startX
      setWidth(panelId, startWidth + (inverted ? -delta : delta))
    }

    function handleUp(nativeEvent: PointerEvent) {
      if (isTrackedPointer(nativeEvent)) {
        end("commit")
      }
    }

    function handleCancel(nativeEvent: PointerEvent) {
      if (isTrackedPointer(nativeEvent)) {
        end("revert")
      }
    }

    function handleKeyDown(nativeEvent: KeyboardEvent) {
      if (nativeEvent.key === "Escape") {
        nativeEvent.preventDefault()
        nativeEvent.stopPropagation()
        end("revert")
      }
    }

    function handleRevert() {
      end("revert")
    }

    window.addEventListener("pointermove", handleMove, true)
    window.addEventListener("pointerup", handleUp, true)
    window.addEventListener("pointercancel", handleCancel, true)
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("blur", handleRevert)
    element.addEventListener("lostpointercapture", handleRevert)
    dragRef.current = {
      cleanup: () => end("revert"),
      panelId,
      startWidth,
    }
    setDragging(true)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || dragRef.current || !controlled) {
      return
    }
    const panel = group.getPanel(controlled.panelId)
    const current = group.getWidth(controlled.panelId)
    if (!panel || current === undefined) {
      return
    }

    const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP
    const direction = controlled.inverted ? -1 : 1
    let next: number
    switch (event.key) {
      case "ArrowLeft":
        next = current - step * direction
        break
      case "ArrowRight":
        next = current + step * direction
        break
      case "Home":
        next = panel.min
        break
      case "End":
        if (!Number.isFinite(panel.max)) {
          return
        }
        next = panel.max
        break
      default:
        return
    }

    event.preventDefault()
    group.setWidth(controlled.panelId, next)
    if (group.getWidth(controlled.panelId) !== current) {
      group.commit()
    }
  }

  return (
    <div
      ref={setRefs}
      aria-controls={meta?.domId}
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={
        meta && Number.isFinite(meta.max) ? Math.round(meta.max) : undefined
      }
      aria-valuemin={meta ? Math.round(meta.min) : undefined}
      aria-valuenow={width === undefined ? undefined : Math.round(width)}
      data-resize-handle-active={dragging ? "pointer" : undefined}
      data-slot="resizable-handle"
      role="separator"
      tabIndex={0}
      className={cn(
        "relative flex w-px shrink-0 cursor-col-resize touch-none items-center justify-center bg-border select-none after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        className
      )}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-8 w-3 items-center justify-center border border-border bg-background text-muted-foreground">
          <GripVertical className="size-3" />
        </div>
      ) : null}
    </div>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
