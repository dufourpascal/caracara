"use client"

import { useAuth } from "@clerk/nextjs"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"
import { useCallback, useMemo } from "react"

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
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        return await getToken({
          skipCache: forceRefreshToken,
        })
      } catch {
        return null
      }
    },
    [getToken]
  )
  const useAuthState = useMemo(
    () =>
      function useAuthFromClerk() {
        return {
          isLoading: !isLoaded,
          isAuthenticated: isSignedIn ?? false,
          fetchAccessToken,
        }
      },
    [fetchAccessToken, isLoaded, isSignedIn]
  )

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthState}>
      {children}
    </ConvexProviderWithAuth>
  )
}
