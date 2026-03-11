"use client"

import * as React from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
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

function SortableListRow<T extends SortableEntity>({
  item,
  renderItem,
}: {
  item: T
  renderItem: (args: SortableListRenderArgs<T>) => React.ReactNode
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: item.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {renderItem({
        item,
        isDragging,
        dragHandle: (
          <button
            {...attributes}
            {...listeners}
            ref={setActivatorNodeRef}
            aria-label={`Reorder ${"name" in item ? String(item.name) : "item"}`}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            )}
            type="button"
          >
            <GripVertical className="size-3.5" />
          </button>
        ),
      })}
    </div>
  )
}

export function SortableList<T extends SortableEntity>({
  className,
  items,
  onReorder,
  renderItem,
}: {
  className?: string
  items: T[]
  onReorder: (items: T[]) => void
  renderItem: (args: SortableListRenderArgs<T>) => React.ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    const oldIndex = items.findIndex((item) => item.id === active.id)
    const newIndex = items.findIndex((item) => item.id === over.id)

    if (oldIndex === -1 || newIndex === -1) {
      return
    }

    onReorder(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={cn("grid gap-2", className)}>
          {items.map((item) => (
            <SortableListRow item={item} key={item.id} renderItem={renderItem} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
