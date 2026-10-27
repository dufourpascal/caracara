import { useEffect, useRef, useState, type PointerEvent } from "react"

import type { GraphPoint, GraphRect } from "@/lib/scenario-graph-geometry"

export type PanZoomTransform = {
  x: number
  y: number
  k: number
}

export type ViewportSize = {
  width: number
  height: number
}

export const MIN_ZOOM = 0.35
export const MAX_ZOOM = 1.4
export const FIT_VIEW_PADDING = 0.18
const BUTTON_ZOOM_STEP = 1.2
const IDENTITY_TRANSFORM: PanZoomTransform = { x: 0, y: 0, k: 1 }

export function clampZoom(k: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
}

/**
 * Scale and center `bounds` inside the viewport. Padding follows React Flow's
 * fitView semantics: the content occupies 1 / (1 + padding) of the viewport.
 */
export function computeFitTransform(
  bounds: GraphRect | null,
  viewport: ViewportSize | null,
  padding = FIT_VIEW_PADDING
): PanZoomTransform {
  if (
    !bounds ||
    !viewport ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return IDENTITY_TRANSFORM
  }

  const k = clampZoom(
    Math.min(
      viewport.width / (bounds.width * (1 + padding)),
      viewport.height / (bounds.height * (1 + padding))
    )
  )

  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * k,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * k,
    k,
  }
}

/** Zoom to `nextK` while keeping the content under `anchor` fixed on screen. */
export function zoomAroundPoint(
  transform: PanZoomTransform,
  nextK: number,
  anchor: GraphPoint
): PanZoomTransform {
  const k = clampZoom(nextK)

  if (k === transform.k) {
    return transform
  }

  const contentX = (anchor.x - transform.x) / transform.k
  const contentY = (anchor.y - transform.y) / transform.k

  return {
    x: anchor.x - contentX * k,
    y: anchor.y - contentY * k,
    k,
  }
}

/**
 * Multiplicative zoom factor for a wheel event, matching d3-zoom's default
 * wheel delta. Ctrl/Meta wheel events (trackpad pinch) zoom ten times faster.
 */
export function getWheelZoomFactor(event: {
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
}) {
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002
  const pinch = event.ctrlKey || event.metaKey ? 10 : 1
  const exponent = Math.max(-1, Math.min(1, -event.deltaY * unit * pinch))

  return 2 ** exponent
}

type ManualView = {
  fitKey: string
  transform: PanZoomTransform
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  origin: PanZoomTransform
}

/**
 * Pan/zoom state for a measured viewport. The view is fitted to `bounds`
 * until the user pans or zooms; a change in content bounds discards the
 * manual view and refits, a viewport resize keeps it.
 */
export function usePanZoom(bounds: GraphRect | null) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<ViewportSize | null>(null)
  const [manualView, setManualView] = useState<ManualView | null>(null)
  const dragRef = useRef<DragState | null>(null)

  // The manual view is keyed on the content bounds only: new content refits,
  // but a viewport resize keeps the user's pan/zoom, as React Flow did.
  const fitKey = [bounds?.x, bounds?.y, bounds?.width, bounds?.height].join(":")
  const fitTransform = computeFitTransform(bounds, size)
  const transform =
    manualView?.fitKey === fitKey ? manualView.transform : fitTransform
  const latestRef = useRef({ fitKey, fitTransform })

  useEffect(() => {
    latestRef.current = { fitKey, fitTransform }
  })

  useEffect(() => {
    const element = viewportRef.current

    if (!element) {
      return
    }

    const measure = () => {
      const width = element.clientWidth
      const height = element.clientHeight

      setSize((current) =>
        current?.width === width && current.height === height
          ? current
          : { width, height }
      )
    }
    const observer = new ResizeObserver(measure)

    observer.observe(element)

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()

      if (dragRef.current) {
        return
      }

      const { fitKey: currentFitKey, fitTransform: currentFit } =
        latestRef.current
      const rect = element.getBoundingClientRect()
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const factor = getWheelZoomFactor(event)

      setManualView((current) => {
        const base =
          current?.fitKey === currentFitKey ? current.transform : currentFit

        return {
          fitKey: currentFitKey,
          transform: zoomAroundPoint(base, base.k * factor, anchor),
        }
      })
    }

    element.addEventListener("wheel", onWheel, { passive: false })

    return () => {
      observer.disconnect()
      element.removeEventListener("wheel", onWheel)
    }
  }, [])

  const setTransform = (next: PanZoomTransform) => {
    setManualView({ fitKey, transform: next })
  }

  const zoomBy = (factor: number) => {
    const center = size
      ? { x: size.width / 2, y: size.height / 2 }
      : { x: 0, y: 0 }

    setTransform(zoomAroundPoint(transform, transform.k * factor, center))
  }

  const handlers = {
    onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) {
        return
      }

      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: transform,
      }
    },
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current

      if (!drag || drag.pointerId !== event.pointerId) {
        return
      }

      if (event.buttons === 0) {
        // No button or contact is held: the pointerup never reached us.
        dragRef.current = null
        return
      }

      setTransform({
        x: drag.origin.x + event.clientX - drag.startX,
        y: drag.origin.y + event.clientY - drag.startY,
        k: drag.origin.k,
      })
    },
    onPointerUp: (event: PointerEvent<SVGSVGElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) {
        return
      }

      dragRef.current = null

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
  }

  return {
    canZoomIn: transform.k < MAX_ZOOM,
    canZoomOut: transform.k > MIN_ZOOM,
    fitView: () => setManualView(null),
    handlers: {
      ...handlers,
      onLostPointerCapture: handlers.onPointerUp,
      onPointerCancel: handlers.onPointerUp,
    },
    size,
    transform,
    viewportRef,
    zoomIn: () => zoomBy(BUTTON_ZOOM_STEP),
    zoomOut: () => zoomBy(1 / BUTTON_ZOOM_STEP),
  }
}
