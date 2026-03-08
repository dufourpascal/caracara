import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@workspace/ui/lib/utils"

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Label }
