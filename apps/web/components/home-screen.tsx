"use client"

import Link from "next/link"
import { UserButton } from "@clerk/nextjs"
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react"
import { makeFunctionReference } from "convex/server"
import type { ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"

const viewerQuery = makeFunctionReference<"query">("users:viewer")

export function HomeScreen() {
  return (
    <main className="min-h-svh bg-background px-4 py-4 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] w-full max-w-6xl flex-col border border-border bg-background">
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Caracara Score
            </p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Clerk and Convex are wired. The next surface is the projects app.
            </h1>
          </div>
          <Authenticated>
            <UserButton />
          </Authenticated>
        </header>

        <div className="flex-1">
          <AuthLoading>
            <StatusPanel
              eyebrow="Checking auth"
              title="Waiting for Clerk and Convex to finish the first handshake."
              body="This screen only settles once Clerk has a session and Convex accepts the token template."
            />
          </AuthLoading>

          <Unauthenticated>
            <StatusPanel
              eyebrow="Signed out"
              title="Use the prebuilt Clerk flows to create your first authenticated session."
              body="The projects area stays protected. Once you sign in, Convex-backed queries become available."
              actions={
                <>
                  <Button asChild size="lg">
                    <Link href="/sign-in">Sign in</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/sign-up">Create account</Link>
                  </Button>
                </>
              }
            />
          </Unauthenticated>

          <Authenticated>
            <AuthenticatedHome />
          </Authenticated>
        </div>
      </div>
    </main>
  )
}

function AuthenticatedHome() {
  const viewer = useQuery(viewerQuery)

  return (
    <StatusPanel
      eyebrow="Authenticated"
      title={
        viewer?.email
          ? `Signed in as ${viewer.email}`
          : "Signed in and authenticated against Convex"
      }
      body="Your Clerk session is issuing a Convex token successfully. The next post-login entrypoint is the protected projects view."
      actions={
        <>
          <Button asChild size="lg">
            <Link href="/projects">Open projects</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/sign-in">Switch account</Link>
          </Button>
        </>
      }
      details={
        <dl className="grid gap-px border border-border bg-border text-sm text-muted-foreground sm:grid-cols-2">
          <div className="bg-background p-4">
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Clerk subject
            </dt>
            <dd className="mt-2 font-mono text-xs text-foreground">
              {viewer?.subject ?? "Loading..."}
            </dd>
          </div>
          <div className="bg-background p-4">
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Token identifier
            </dt>
            <dd className="mt-2 font-mono text-xs text-foreground">
              {viewer?.tokenIdentifier ?? "Loading..."}
            </dd>
          </div>
        </dl>
      }
    />
  )
}

function StatusPanel({
  eyebrow,
  title,
  body,
  actions,
  details,
}: {
  eyebrow: string
  title: string
  body: string
  actions?: ReactNode
  details?: ReactNode
}) {
  return (
    <section className="grid border-b border-border lg:grid-cols-[minmax(0,1.35fr)_20rem]">
      <div className="space-y-5 border-b border-border px-5 py-6 sm:px-6 lg:border-b-0 lg:border-r">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
          {eyebrow}
        </p>
        <div className="space-y-3">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{body}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
      <div className="bg-muted/20 px-5 py-6 sm:px-6">
        <p className="text-sm font-medium text-foreground">Current setup target</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          v1 is single-user. Clerk owns authentication, Convex owns product data,
          and the first protected route is the projects list.
        </p>
        {details ? <div className="mt-6">{details}</div> : null}
      </div>
    </section>
  )
}
