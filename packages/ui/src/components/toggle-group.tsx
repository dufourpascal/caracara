"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@workspace/ui/lib/utils"

const toggleGroupItemVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1 border-l border-border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none first:border-l-0 focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=off]:bg-background data-[state=off]:text-muted-foreground hover:data-[state=off]:bg-muted hover:data-[state=off]:text-foreground dark:data-[state=off]:bg-input/30 dark:hover:data-[state=off]:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      size: {
        default: "h-8",
        sm: "h-7",
        lg: "h-9",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "inline-flex items-center border border-border bg-background",
        className
      )}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
