import { GripVertical } from "lucide-react"
import * as React from "react"
import {
  Group,
  Panel,
  Separator,
  type GroupProps,
  type PanelProps,
} from "react-resizable-panels"

import { cn } from "@workspace/ui/lib/utils"

function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
      {...props}
    />
  )
}

function ResizablePanel(props: PanelProps) {
  return <Panel {...props} />
}

function ResizableHandle({
  className,
  withHandle = false,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
}) {
  return (
    <Separator
      className={cn(
        "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2",
        "data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-8 w-3 items-center justify-center border border-border bg-background text-muted-foreground">
          <GripVertical className="size-3" />
        </div>
      ) : null}
    </Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
