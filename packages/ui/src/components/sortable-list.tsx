"use client"

import * as React from "react"
import { GripVertical } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

type SortableEntity = {
  id: string
}

type SortableListRenderArgs<T extends SortableEntity> = {
  dragHandle: React.ReactNode
  isDragging: boolean
  item: T
}

type RowRect = {
  top: number
  height: number
}

type DragSession = {
  id: string
  mode: "keyboard" | "pointer"
  // Display order when the drag started; rows keep their DOM position until drop.
  ids: string[]
  origin: number
  target: number
  // Row geometry relative to the list's top edge, measured without transforms.
  rects: Map<string, RowRect>
  // How far a displaced row moves: the dragged row's height plus the gap.
  shift: number
  pointer: {
    clientX: number
    clientY: number
    grabOffset: number
    // The press is still down, so a click will follow its release.
    held: boolean
    id: number
    inside: boolean
    y: number
  } | null
  restore: () => void
}

type PendingCommit = {
  ids: string[]
  token: number
}

type PendingSettle = {
  focusId: string | null
  raisedId: string
  tops: Map<string, number>
}

// Pointer travel before a press on the handle turns into a drag.
const ACTIVATION_DISTANCE = 4
// How far a pointer may stray sideways past the list and still drop.
const DROP_TOLERANCE_X = 48
const SETTLE_DURATION = 150
const TRANSITION_ATTRIBUTE = "data-sortable-transition"
const ROW_TRANSITION_CLASSES =
  "motion-safe:data-[sortable-transition=on]:transition-transform motion-safe:data-[sortable-transition=on]:duration-150"
const INSTRUCTIONS =
  "Press Space or Enter to pick up. Use the arrow keys to move, Space or Enter to drop, Escape to cancel."

function getItemLabel(item: SortableEntity | undefined) {
  return item && "name" in item ? String(item.name) : "item"
}

function moveId(ids: string[], from: number, to: number) {
  const next = ids.slice()
  const [id] = next.splice(from, 1)

  if (id !== undefined) {
    next.splice(to, 0, id)
  }

  return next
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  )
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  )
}

function setTranslate(row: HTMLElement, offset: number) {
  row.style.transform = offset ? `translateY(${offset}px)` : ""
}

function setTransition(row: HTMLElement, enabled: boolean) {
  if (enabled) {
    row.setAttribute(TRANSITION_ATTRIBUTE, "on")
  } else {
    row.removeAttribute(TRANSITION_ATTRIBUTE)
  }
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

function measureRows(
  list: HTMLElement | null,
  rows: Map<string, HTMLElement>,
  ids: string[]
) {
  const listTop = list?.getBoundingClientRect().top ?? 0
  const rects = new Map<string, RowRect>()

  for (const id of ids) {
    const rect = rows.get(id)?.getBoundingClientRect()

    if (rect) {
      rects.set(id, { top: rect.top - listTop, height: rect.height })
    }
  }

  return rects
}

function getShift(session: DragSession) {
  const dragged = session.rects.get(session.id)
  const first = session.rects.get(session.ids[0] ?? "")
  const second = session.rects.get(session.ids[1] ?? "")
  const gap =
    first && second ? Math.max(0, second.top - first.top - first.height) : 0

  return (dragged?.height ?? 0) + gap
}

function getDraggedOffset(session: DragSession) {
  const dragged = session.rects.get(session.id)

  if (!dragged) {
    return 0
  }

  if (session.pointer) {
    return session.pointer.y - session.pointer.grabOffset - dragged.top
  }

  const slot = session.rects.get(session.ids[session.target] ?? "")

  if (!slot || session.target === session.origin) {
    return 0
  }

  return session.target > session.origin
    ? slot.top + slot.height - dragged.top - dragged.height
    : slot.top - dragged.top
}

function applyPreview(session: DragSession, rows: Map<string, HTMLElement>) {
  const { id, ids, origin, shift, target } = session

  ids.forEach((rowId, index) => {
    const row = rows.get(rowId)

    if (!row) {
      return
    }

    if (rowId === id) {
      // The pointer-dragged row tracks the pointer 1:1, so it never eases.
      setTransition(row, session.mode === "keyboard")
      setTranslate(row, getDraggedOffset(session))
      return
    }

    let offset = 0

    if (origin < target && index > origin && index <= target) {
      offset = -shift
    } else if (target < origin && index >= target && index < origin) {
      offset = shift
    }

    setTransition(row, true)
    setTranslate(row, offset)
  })
}

export function SortableList<T extends SortableEntity>({
  className,
  items,
  onReorder,
  renderItem,
}: {
  className?: string
  items: T[]
  onReorder: (items: T[]) => void | Promise<void>
  renderItem: (args: SortableListRenderArgs<T>) => React.ReactNode
}) {
  const instructionsId = React.useId()
  const listRef = React.useRef<HTMLDivElement>(null)
  const rowsRef = React.useRef(new Map<string, HTMLDivElement>())
  const handlesRef = React.useRef(new Map<string, HTMLButtonElement>())
  const sessionRef = React.useRef<DragSession | null>(null)
  const pointerRef = React.useRef<{ detach: () => void } | null>(null)
  const settleRef = React.useRef<PendingSettle | null>(null)
  const settleCleanupRef = React.useRef<(() => void) | null>(null)
  const swallowCleanupRef = React.useRef<(() => void) | null>(null)
  const mountedRef = React.useRef(false)
  const commitTokenRef = React.useRef(0)
  const latestRef = React.useRef({ items, onReorder })
  const [active, setActive] = React.useState<{
    id: string
    mode: DragSession["mode"]
  } | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  // Committed orders whose onReorder has not settled, oldest first. The newest
  // is shown until the parent's items catch up or every newer one settles.
  const [pending, setPending] = React.useState<PendingCommit[]>([])
  const itemsKey = JSON.stringify(items.map((item) => item.id))
  const [previousItemsKey, setPreviousItemsKey] = React.useState(itemsKey)

  if (previousItemsKey !== itemsKey) {
    const ids = items.map((item) => item.id)
    // Items matching a pending order confirm it and supersede older ones, so
    // later drops stay on screen. Any other order is news and wins outright.
    const confirmed = pending.findIndex((commit) => sameIds(commit.ids, ids))

    setPreviousItemsKey(itemsKey)
    setPending(confirmed === -1 ? [] : pending.slice(confirmed + 1))
  }

  const optimistic = pending.at(-1)

  const displayItems = React.useMemo(() => {
    if (!optimistic) {
      return items
    }

    const byId = new Map(items.map((item) => [item.id, item]))
    const ordered = optimistic.ids.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })

    return ordered.length === items.length ? ordered : items
  }, [items, optimistic])

  function getState() {
    const current = latestRef.current.items

    return { ids: current.map((item) => item.id), items: current }
  }

  function startDrag(id: string, mode: DragSession["mode"]) {
    const { ids, items: current } = getState()
    const origin = ids.indexOf(id)

    if (origin === -1) {
      return null
    }

    settleCleanupRef.current?.()
    settleRef.current = null

    const session: DragSession = {
      id,
      mode,
      ids,
      origin,
      target: origin,
      rects: measureRows(listRef.current, rowsRef.current, ids),
      shift: 0,
      pointer: null,
      restore: () => {},
    }

    session.shift = getShift(session)
    sessionRef.current = session
    applyPreview(session, rowsRef.current)
    setActive({ id, mode })
    setAnnouncement(
      `Picked up ${getItemLabel(current[origin])}. Position ${origin + 1} of ${ids.length}.`
    )

    return session
  }

  function setTarget(session: DragSession, target: number) {
    const changed = target !== session.target

    session.target = target
    applyPreview(session, rowsRef.current)

    if (changed) {
      const { items: current } = getState()
      const item = current.find((entry) => entry.id === session.id)

      setAnnouncement(
        `${getItemLabel(item)} moved to position ${target + 1} of ${session.ids.length}.`
      )
    }
  }

  function trackPointer(
    session: DragSession,
    clientX: number,
    clientY: number
  ) {
    const list = listRef.current
    const pointer = session.pointer

    if (!list || !pointer) {
      return
    }

    const listRect = list.getBoundingClientRect()
    const y = clientY - listRect.top

    pointer.clientX = clientX
    pointer.clientY = clientY
    pointer.y = y
    // Overshooting an edge by up to a row, or drifting off the narrow grip
    // column, still drops; the target clamps to the first or last slot.
    pointer.inside =
      clientX >= listRect.left - DROP_TOLERANCE_X &&
      clientX <= listRect.right + DROP_TOLERANCE_X &&
      clientY >= listRect.top - session.shift &&
      clientY <= listRect.bottom + session.shift

    let target = session.origin

    // Well outside the list the preview falls back to the origin, matching the cancel on drop.
    if (pointer.inside) {
      target = 0

      for (const id of session.ids) {
        const rect = session.rects.get(id)

        if (id !== session.id && rect && rect.top + rect.height / 2 < y) {
          target += 1
        }
      }
    }

    setTarget(session, target)
  }

  // Eats the click that ends a drag. It follows the release, so a drag that
  // ended while the pointer was still down waits for that pointer to lift.
  function swallowNextClick(heldPointerId: number | null) {
    swallowCleanupRef.current?.()

    let timer: number | undefined

    const swallow = (event: MouseEvent) => {
      // Keyboard and programmatic clicks have detail 0 and never end a drag.
      if (event.detail === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      cleanup()
    }
    const expire = () => {
      window.removeEventListener("pointerup", onUp, true)
      timer = window.setTimeout(() => cleanup(), 0)
    }
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === heldPointerId) {
        expire()
      }
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener("click", swallow, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointerdown", cleanup, true)

      if (swallowCleanupRef.current === cleanup) {
        swallowCleanupRef.current = null
      }
    }

    window.addEventListener("click", swallow, true)

    if (heldPointerId === null) {
      expire()
    } else {
      window.addEventListener("pointerup", onUp, true)
      // A new press means the release was missed, say off-window: stand down.
      window.addEventListener("pointerdown", cleanup, true)
    }

    swallowCleanupRef.current = cleanup
  }

  function commit(nextIds: string[], current: T[]) {
    const byId = new Map(current.map((item) => [item.id, item]))
    const nextItems = nextIds.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
    const token = commitTokenRef.current + 1
    const clear = () => {
      if (mountedRef.current) {
        setPending((value) => value.filter((entry) => entry.token !== token))
      }
    }

    commitTokenRef.current = token
    setPending((value) => [...value, { ids: nextIds, token }])

    let result: void | Promise<void>

    try {
      result = latestRef.current.onReorder(nextItems)
    } catch (error) {
      clear()
      throw error
    }

    // Once a commit settles it stops being shown: a failed latest drop falls
    // back to the next pending order, or to props when none is left. A
    // synchronous caller has already updated (or ignored) its items, which
    // land in the same render, so the optimistic order is not needed.
    if (isPromiseLike(result)) {
      result.then(clear, clear)
    } else {
      clear()
    }
  }

  // "reset" cancels a drag whose list changed underneath it.
  function endDrag(outcome: "cancel" | "drop" | "reset", restoreFocus = false) {
    const session = sessionRef.current

    if (!session) {
      return
    }

    sessionRef.current = null
    session.restore()

    if (session.mode === "pointer") {
      pointerRef.current?.detach()
      swallowNextClick(session.pointer?.held ? session.pointer.id : null)
    }

    // Record where every row is drawn so the layout effect can ease it into place.
    const tops = new Map<string, number>()

    for (const [id, row] of rowsRef.current) {
      tops.set(id, row.getBoundingClientRect().top)
      setTransition(row, false)
      setTranslate(row, 0)
    }

    settleRef.current = {
      focusId: restoreFocus ? session.id : null,
      raisedId: session.id,
      tops,
    }
    setActive(null)

    if (outcome === "reset") {
      setAnnouncement("Reorder cancelled because the list changed.")
      return
    }

    const { ids, items: current } = getState()
    const origin = ids.indexOf(session.id)
    const label = getItemLabel(current[origin])

    if (origin === -1) {
      setAnnouncement("Reorder cancelled.")
      return
    }

    if (outcome === "cancel") {
      setAnnouncement(
        `Reorder cancelled. ${label} returned to position ${origin + 1} of ${ids.length}.`
      )
      return
    }

    // The list cannot change under a live drag: the layout effect cancels it.
    const next = moveId(ids, session.origin, session.target)

    if (sameIds(next, ids)) {
      setAnnouncement(
        `${label} dropped. Position ${origin + 1} of ${ids.length} unchanged.`
      )
      return
    }

    setAnnouncement(
      `${label} dropped at position ${next.indexOf(session.id) + 1} of ${ids.length}.`
    )
    commit(next, current)
  }

  function handlePointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    id: string
  ) {
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      sessionRef.current ||
      pointerRef.current
    ) {
      return
    }

    const handle = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY

    const activate = (clientX: number, clientY: number) => {
      const session = startDrag(id, "pointer")

      if (!session) {
        detach()
        return
      }

      const body = document.body
      const previous = {
        cursor: body.style.cursor,
        userSelect: body.style.userSelect,
        webkitUserSelect: body.style.getPropertyValue("-webkit-user-select"),
      }
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault()
          keyEvent.stopPropagation()
          endDrag("cancel")
        }
      }
      const onBlur = () => endDrag("cancel")

      body.style.cursor = "grabbing"
      body.style.userSelect = "none"
      body.style.setProperty("-webkit-user-select", "none")
      window.getSelection()?.removeAllRanges()
      window.addEventListener("keydown", onKeyDown, true)
      window.addEventListener("blur", onBlur)
      session.restore = () => {
        window.removeEventListener("keydown", onKeyDown, true)
        window.removeEventListener("blur", onBlur)
        body.style.cursor = previous.cursor
        body.style.userSelect = previous.userSelect

        if (previous.webkitUserSelect) {
          body.style.setProperty(
            "-webkit-user-select",
            previous.webkitUserSelect
          )
        } else {
          body.style.removeProperty("-webkit-user-select")
        }
      }

      const listTop = listRef.current?.getBoundingClientRect().top ?? 0

      session.pointer = {
        clientX: startX,
        clientY: startY,
        grabOffset: startY - listTop - (session.rects.get(id)?.top ?? 0),
        held: true,
        id: pointerId,
        inside: true,
        y: startY - listTop,
      }
      trackPointer(session, clientX, clientY)
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return
      }

      const session = sessionRef.current

      if (session?.mode === "pointer") {
        moveEvent.preventDefault()
        trackPointer(session, moveEvent.clientX, moveEvent.clientY)
      } else if (
        !session &&
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >=
          ACTIVATION_DISTANCE
      ) {
        moveEvent.preventDefault()
        activate(moveEvent.clientX, moveEvent.clientY)
      }
    }

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return
      }

      const session = sessionRef.current

      if (session?.mode !== "pointer") {
        // Never activated: leave the click to bubble as a normal press.
        detach()
        return
      }

      if (session.pointer) {
        session.pointer.held = false
      }

      trackPointer(session, upEvent.clientX, upEvent.clientY)
      endDrag(session.pointer?.inside ? "drop" : "cancel")
    }

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return
      }

      const session = sessionRef.current

      if (session?.mode === "pointer") {
        // A cancelled pointer produces no click.
        if (session.pointer && cancelEvent.type === "pointercancel") {
          session.pointer.held = false
        }

        endDrag("cancel")
      } else {
        detach()
      }
    }

    const detach = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      handle.removeEventListener("lostpointercapture", onCancel)

      try {
        if (handle.hasPointerCapture?.(pointerId)) {
          handle.releasePointerCapture(pointerId)
        }
      } catch {
        // The pointer may already be gone.
      }

      if (pointerRef.current?.detach === detach) {
        pointerRef.current = null
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    handle.addEventListener("lostpointercapture", onCancel)
    pointerRef.current = { detach }

    try {
      handle.setPointerCapture?.(pointerId)
    } catch {
      // Capture is an optimisation; window listeners still see the pointer.
    }
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: string
  ) {
    if (pointerRef.current) {
      return
    }

    const session = sessionRef.current
    const toggles = event.key === " " || event.key === "Enter"

    if (!session) {
      if (toggles) {
        event.preventDefault()
        event.stopPropagation()

        if (!event.repeat) {
          startDrag(id, "keyboard")
        }
      }

      return
    }

    if (session.id !== id || session.mode !== "keyboard") {
      return
    }

    if (toggles) {
      event.preventDefault()
      event.stopPropagation()

      if (!event.repeat) {
        endDrag("drop", true)
      }
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      endDrag("cancel", true)
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      setTarget(
        session,
        Math.min(
          session.ids.length - 1,
          Math.max(0, session.target + (event.key === "ArrowUp" ? -1 : 1))
        )
      )
    }
  }

  // Runs after every commit: track the latest props and drop a drag whose
  // list changed underneath it, since its slots no longer mean anything.
  React.useLayoutEffect(() => {
    latestRef.current = { items: displayItems, onReorder }

    const session = sessionRef.current
    const ids = displayItems.map((item) => item.id)

    if (!session || sameIds(ids, session.ids)) {
      return
    }

    endDrag("reset", session.mode === "keyboard")
  })

  // FLIP: ease rows from where they were drawn at drop or cancel into their slots.
  React.useLayoutEffect(() => {
    const settle = settleRef.current

    if (!settle) {
      return
    }

    settleRef.current = null

    const animate = !prefersReducedMotion()
    const moved: HTMLElement[] = []

    for (const [id, row] of rowsRef.current) {
      const from = settle.tops.get(id)

      if (!animate || from === undefined) {
        continue
      }

      const delta = from - row.getBoundingClientRect().top

      if (Math.abs(delta) >= 0.5) {
        setTranslate(row, delta)
        moved.push(row)
      }
    }

    if (moved.length > 0) {
      const raised = rowsRef.current.get(settle.raisedId)

      if (raised) {
        raised.style.position = "relative"
        raised.style.zIndex = "10"
      }

      // Flush the start position before enabling the transition.
      listRef.current?.getBoundingClientRect()

      for (const row of moved) {
        setTransition(row, true)
        setTranslate(row, 0)
      }

      const timer = window.setTimeout(() => cleanup(), SETTLE_DURATION + 50)
      const cleanup = () => {
        window.clearTimeout(timer)

        for (const row of moved) {
          setTransition(row, false)
          setTranslate(row, 0)
        }

        if (raised) {
          raised.style.position = ""
          raised.style.zIndex = ""
        }

        if (settleCleanupRef.current === cleanup) {
          settleCleanupRef.current = null
        }
      }

      settleCleanupRef.current?.()
      settleCleanupRef.current = cleanup
    }

    if (settle.focusId) {
      const handle = handlesRef.current.get(settle.focusId)

      if (handle && document.activeElement !== handle) {
        handle.focus({ preventScroll: true })
      }
    }
  })

  React.useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false

      const session = sessionRef.current

      sessionRef.current = null
      session?.restore()
      pointerRef.current?.detach()
      settleCleanupRef.current?.()
      swallowCleanupRef.current?.()
    }
  }, [])

  return (
    <div
      className={cn("grid gap-2", className)}
      data-slot="sortable-list"
      ref={listRef}
    >
      {displayItems.map((item) => {
        const isDragging = active?.id === item.id

        return (
          <div
            className={cn(
              ROW_TRANSITION_CLASSES,
              isDragging && "relative z-10"
            )}
            data-slot="sortable-list-item"
            key={item.id}
            ref={(node) => {
              if (node) {
                rowsRef.current.set(item.id, node)
              } else {
                rowsRef.current.delete(item.id)
              }
            }}
          >
            {renderItem({
              item,
              isDragging,
              dragHandle: (
                <button
                  aria-describedby={instructionsId}
                  aria-label={`Reorder ${getItemLabel(item)}`}
                  aria-pressed={
                    isDragging && active?.mode === "keyboard" ? true : undefined
                  }
                  aria-roledescription="sortable"
                  className={cn(
                    "inline-flex size-6 shrink-0 touch-none items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  )}
                  onBlur={() => {
                    const session = sessionRef.current

                    if (
                      session?.mode === "keyboard" &&
                      session.id === item.id
                    ) {
                      endDrag("cancel")
                    }
                  }}
                  onClick={(event) => {
                    // Keyboard-synthesised clicks belong to the handle, not the row.
                    if (event.detail === 0) {
                      event.stopPropagation()
                    }
                  }}
                  onKeyDown={(event) => handleKeyDown(event, item.id)}
                  onKeyUp={(event) => {
                    if (event.key === " ") {
                      event.preventDefault()
                      event.stopPropagation()
                    }
                  }}
                  onPointerDown={(event) => handlePointerDown(event, item.id)}
                  ref={(node) => {
                    if (node) {
                      handlesRef.current.set(item.id, node)
                    } else {
                      handlesRef.current.delete(item.id)
                    }
                  }}
                  type="button"
                >
                  <GripVertical className="size-3.5" />
                </button>
              ),
            })}
          </div>
        )
      })}
      <span className="sr-only" id={instructionsId}>
        {INSTRUCTIONS}
      </span>
      <div aria-atomic="true" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
