import Image from "next/image"

import { cn } from "@workspace/ui/lib/utils"

export function AppBrand({
  className,
  labelClassName,
}: {
  className?: string
  labelClassName?: string
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div className="flex size-8 shrink-0 items-center justify-center">
        <Image
          alt="Caracara"
          className="block size-full object-contain drop-shadow-[0_0_1px_rgba(24,24,27,0.35)] dark:drop-shadow-[0_0_1px_rgba(255,255,255,0.2)]"
          draggable="false"
          height={32}
          src="/caracara-brand-mark-64.png"
          width={32}
        />
      </div>
      <span className={cn("font-medium text-foreground", labelClassName)}>
        caracara
      </span>
    </div>
  )
}
