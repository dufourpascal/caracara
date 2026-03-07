"use client"

import Link from "next/link"
import { UserButton } from "@clerk/nextjs"
import { Authenticated, AuthLoading, useQuery } from "convex/react"
import { makeFunctionReference } from "convex/server"
import { Button } from "@workspace/ui/components/button"

const viewerQuery = makeFunctionReference<"query">("users:viewer")

export function ProjectsScreen() {
  return (
    <main className="min-h-svh bg-background px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-6xl border border-border bg-background">
        <div className="flex items-start justify-between gap-6 border-b border-border px-5 py-4 sm:px-6">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Projects
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Protected entrypoint
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
              This route is protected by Clerk in `proxy.ts` and backed by a
              Convex query that reads the authenticated identity.
            </p>
          </div>
          <UserButton />
        </div>

        <AuthLoading>
          <div className="px-5 py-10 text-sm text-muted-foreground sm:px-6">
            Loading Convex auth state...
          </div>
        </AuthLoading>

        <Authenticated>
          <ProjectsContent />
        </Authenticated>
      </div>
    </main>
  )
}

function ProjectsContent() {
  const viewer = useQuery(viewerQuery)

  return (
    <div className="grid lg:grid-cols-[minmax(0,1.25fr)_20rem]">
      <section className="border-b border-border px-5 py-6 sm:px-6 lg:border-b-0 lg:border-r">
        <h2 className="text-lg font-semibold text-foreground">
          First authenticated data
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
          The real projects list comes next. For now this confirms that Clerk
          sessions reach Convex and can be used to scope project ownership.
        </p>
        <dl className="mt-6 grid gap-px border border-border bg-border text-sm text-muted-foreground">
          <div className="bg-background p-4">
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Name
            </dt>
            <dd className="mt-1 text-foreground">{viewer?.name ?? "Loading..."}</dd>
          </div>
          <div className="bg-background p-4">
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Email
            </dt>
            <dd className="mt-1 text-foreground">{viewer?.email ?? "Loading..."}</dd>
          </div>
          <div className="bg-background p-4">
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Token identifier
            </dt>
            <dd className="mt-1 break-all font-mono text-xs text-foreground">
              {viewer?.tokenIdentifier ?? "Loading..."}
            </dd>
          </div>
        </dl>
      </section>

      <aside className="bg-muted/20 px-5 py-6 sm:px-6">
        <p className="text-sm font-medium text-foreground">Next implementation step</p>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          Replace this placeholder with the project list required by the spec,
          then persist owner identifiers directly in Convex.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/">Back to auth overview</Link>
        </Button>
      </aside>
    </div>
  )
}
