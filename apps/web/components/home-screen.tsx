"use client"

import Link from "next/link"
import { UserButton, useAuth } from "@clerk/nextjs"
import { ArrowRight } from "lucide-react"

import { AppBrand } from "@/components/app-brand"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

const loopSteps = [
  {
    step: "Define",
    body: "Write the scenario and the grading rubric for the behavior you want to evaluate.",
  },
  {
    step: "Run",
    body: "Send an agent through the deployed dev instance with the `caracara` CLI.",
  },
  {
    step: "Improve",
    body: "Use the score and suggestions to push UI and UX fixes back into development.",
  },
] as const

const principles = [
  "Tests real product behavior, not just isolated functions",
  "Keeps execution instructions separate from the grading logic",
  "Turns quality evaluation into a repeatable agent run",
] as const

const exampleRun = [
  ["project", "dev-storefront"],
  ["scenario", "checkout-cart-recovery"],
  ["runner", "codex"],
  ["target", "localhost:3000"],
  ["score", "82 / 100"],
  ["next", "tighten cart error state and retry copy"],
] as const

export function HomeScreen() {
  return (
    <main className="min-h-svh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <AppBrand labelClassName="text-xs uppercase tracking-[0.3em] text-muted-foreground" />
          <HeaderActions />
        </div>
      </header>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-6 sm:py-20">
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
            <div className="max-w-3xl">
              <Badge variant="outline">Dark factory for app quality</Badge>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                Turn evaluation into a simple agent run.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground">
                Caracara helps developers define scenarios, decide how they
                should be graded, and run agents against a deployed dev
                instance. The output is a scored feedback loop that catches UI
                and UX issues beyond unit tests.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <PrimaryActions />
              </div>
            </div>

            <aside className="border border-border">
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Example run
                </p>
              </div>
              <dl className="grid gap-px bg-border">
                {exampleRun.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3 bg-background px-4 py-3 text-sm"
                  >
                    <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="min-w-0 text-pretty font-mono text-[12px] text-foreground">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>

          <div className="mt-12 grid gap-px border border-border bg-border md:grid-cols-3">
            {loopSteps.map((item, index) => (
              <div key={item.step} className="bg-background px-4 py-5 sm:px-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  0{index + 1}
                </p>
                <h2 className="mt-2 text-sm font-semibold text-foreground">
                  {item.step}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Why it matters
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              Close the gap between passing tests and a good product experience.
            </h2>
          </div>
          <ul className="grid gap-px border border-border bg-border">
            {principles.map((item) => (
              <li
                key={item}
                className="bg-background px-4 py-4 text-sm leading-6 text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  )
}

function HeaderActions() {
  const { isLoaded, isSignedIn } = useAuth()

  if (isLoaded && isSignedIn) {
    return (
      <div className="flex items-center gap-3">
        <Button asChild variant="outline">
          <Link href="/projects">Open projects</Link>
        </Button>
        <UserButton />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <Button asChild variant="ghost">
        <Link href="/sign-in">Sign in</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/sign-up">Create account</Link>
      </Button>
    </div>
  )
}

function PrimaryActions() {
  const { isLoaded, isSignedIn } = useAuth()

  if (isLoaded && isSignedIn) {
    return (
      <Button asChild size="lg">
        <Link href="/projects">
          Open projects
          <ArrowRight />
        </Link>
      </Button>
    )
  }

  return (
    <>
      <Button asChild size="lg">
        <Link href="/sign-up">
          Start evaluating
          <ArrowRight />
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    </>
  )
}
