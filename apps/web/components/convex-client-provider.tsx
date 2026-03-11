"use client"

import { useAuth } from "@clerk/nextjs"
import { ConvexReactClient } from "convex/react"
import { ConvexProviderWithClerk } from "convex/react-clerk"
import type { ReactNode } from "react"
import { useMemo } from "react"

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL")
}

const convex = new ConvexReactClient(convexUrl)

export function ConvexClientProvider({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  const useAuthState = useMemo(
    () => useAuth,
    []
  )

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuthState}>
      {children}
    </ConvexProviderWithClerk>
  )
}
