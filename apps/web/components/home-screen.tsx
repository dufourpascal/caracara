"use client"

import Image from "next/image"
import Link from "next/link"
import { UserButton, useAuth } from "@clerk/nextjs"
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  FileText,
  LockKeyhole,
  RefreshCw,
  Terminal,
  Wrench,
} from "lucide-react"

import { AppBrand } from "@/components/app-brand"
import { Button } from "@workspace/ui/components/button"

const loopSteps = [
  {
    step: "Define",
    body: "Write the scenario and the grading rubric for the behavior you want to evaluate.",
  },
  {
    step: "Run",
    body: "Send an agent through the deployed dev instance with the caracara CLI.",
  },
  {
    step: "Improve",
    body: "Use the score and suggestions to push UI and UX fixes back into development.",
  },
] as const

const flowSteps = [
  {
    icon: FileText,
    label: "Author",
    title: "Write the scenario once",
    body: "Store the task, grading rubric, dependencies, and shared project context in Caracara.",
  },
  {
    icon: Terminal,
    label: "Execute",
    title: "Run against your dev app",
    body: "The caracara CLI fetches the active scenario plan and sends a local agent through your running product.",
  },
  {
    icon: LockKeyhole,
    label: "Anchor",
    title: "Grade against the run snapshot",
    body: "The runner cannot improve its score by rewriting the source scenario during execution; results are tied to the scenario content fetched for that run.",
  },
  {
    icon: RefreshCw,
    label: "Loop",
    title: "Feed changes back to coding agents",
    body: "Scores, rationale, and suggested fixes become the next development prompt instead of another loose bug report.",
  },
] as const

const scenarioFields = [
  ["Instructions", "What the agent should do in the application."],
  ["Scoring prompt", "How the outcome should be judged."],
  ["Dependencies", "Prerequisite scenarios for setup flows and staged tasks."],
  ["Project context", "Shared background prepended to each scenario run."],
  ["Status", "Draft while authoring, active when it should run."],
  ["Slug", "A CLI-friendly identifier for direct execution."],
] as const

const resultFields = [
  {
    label: "Score",
    body: "A compact read on whether the behavior met the rubric.",
  },
  {
    label: "Rationale",
    body: "The evidence behind the score, so teams can inspect the judgment.",
  },
  {
    label: "Failure detail",
    body: "The concrete product behavior that missed the scenario expectation.",
  },
  {
    label: "Improvements",
    body: "Specific change suggestions that can be handed back to Codex, Claude Code, or a developer.",
  },
] as const

const fitItems = [
  "Use it when product behavior depends on UI state, workflows, and judgment that unit tests do not cover well.",
  "Keep unit tests, Playwright tests, and CI for deterministic checks; use Caracara for repeatable agent evaluation.",
  "Run execution locally when the app, credentials, or environment should stay on your machine.",
  "Do not treat it as a hosted runner, infrastructure provisioner, or replacement for human-authored scenarios in v1.",
] as const

const accentBlue = "#00B0FF"
const accentOrange = "#F57C00"
const exampleScore = 0.82 as const

const exampleScenario = [
  ["Project", "dev-storefront"],
  ["Scenario", "checkout-cart-recovery"],
  [
    "Instruction",
    "Act as a user completing checkout. If the session is expired, recover the flow and confirm the cart is preserved.",
  ],
  [
    "Scoring",
    "Score for cart preservation, successful retry, clarity of recovery copy, and how little friction the user experiences.",
  ],
] as const

const exampleEvaluation = [
  ["Runner", "codex"],
  ["Target", "localhost:3000"],
] as const

const exampleObservations = {
  workedWell: "Checkout recovered without losing cart state.",
  issueFound: "Retry copy did not clearly reassure the user.",
} as const

const exampleAgentFeedback =
  "Persist cart line items after session refresh and rewrite the expired-session copy to say retry is safe and returns the user to checkout."

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
          <div className="grid items-stretch gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-10">
            <div className="flex max-w-3xl flex-col">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Dark factory for app quality
              </p>
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

            <aside className="flex items-center justify-center p-4 sm:p-6">
              <Image
                alt="Caracara bird head"
                className="h-auto max-h-[18rem] w-full object-contain lg:max-h-full"
                draggable="false"
                height={1024}
                priority
                src="/caracara-logo.png"
                width={1024}
              />
            </aside>
          </div>

          <aside className="mt-10">
            <div className="relative lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="absolute inset-y-0 left-[calc(50%+3px)] z-10 hidden -translate-x-1/2 lg:flex">
                <div className="flex w-10 items-center justify-center">
                  <span
                    className="flex size-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: accentOrange }}
                  >
                    <ArrowRight className="size-6 text-background" strokeWidth={2.5} />
                  </span>
                </div>
              </div>

              <section className="relative bg-muted/10 pl-4 lg:border-r lg:border-border sm:pl-5">
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 block w-1.5"
                  style={{ backgroundColor: accentBlue }}
                />
                <div className="border-b border-border px-4 py-3 sm:px-5">
                  <p
                    className="text-xs uppercase tracking-[0.2em]"
                    style={{ color: accentBlue }}
                  >
                    Scenario Definition
                  </p>
                </div>
                <dl className="divide-y divide-border">
                  {exampleScenario.map(([label, value]) => (
                    <div key={label} className="px-4 py-4 text-sm sm:px-5">
                      <dt
                        className="font-mono text-[11px] uppercase tracking-[0.16em]"
                        style={{ color: accentBlue }}
                      >
                        {label}
                      </dt>
                      <dd className="mt-2 min-w-0 text-pretty text-sm leading-6 text-foreground/90">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="relative pl-4 bg-background sm:pl-5">
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 block w-1.5"
                  style={{ backgroundColor: accentOrange }}
                />
                <div className="border-t border-border px-4 py-3 sm:px-5 lg:border-t-0 lg:border-b lg:border-border">
                  <p
                    className="text-xs uppercase tracking-[0.2em]"
                    style={{ color: accentOrange }}
                  >
                    Run Results
                  </p>
                </div>
                <div className="grid gap-px bg-border sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="bg-background px-4 py-5 sm:px-5">
                    <ScoreRing value={exampleScore} />
                  </div>
                  <dl className="contents">
                    {exampleEvaluation.map(([label, value]) => (
                      <div
                        key={label}
                        className="flex min-h-0 items-center bg-background px-4 py-5 text-sm sm:px-5"
                      >
                        <div>
                          <dt
                            className="font-mono text-[11px] uppercase tracking-[0.16em]"
                            style={{ color: accentOrange }}
                          >
                            {label}
                          </dt>
                          <dd className="mt-2 min-w-0 text-pretty font-mono text-[13px] text-foreground">
                            {value}
                          </dd>
                        </div>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="border-t border-border px-4 py-3 sm:px-5">
                  <p
                    className="text-xs uppercase tracking-[0.2em]"
                    style={{ color: accentOrange }}
                  >
                    Observed behavior
                  </p>
                </div>
                <div className="border-t border-border px-4 py-4 sm:px-5">
                  <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
                    <p>{exampleObservations.workedWell}</p>
                    <p>{exampleObservations.issueFound}</p>
                  </div>
                </div>

                <div className="border-t border-border px-4 py-3 sm:px-5">
                  <p
                    className="text-xs uppercase tracking-[0.2em]"
                    style={{ color: accentOrange }}
                  >
                    Feedback for coding agent
                  </p>
                </div>
                <div className="border-t border-border bg-muted/5 px-4 py-4 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-6 text-foreground">
                      {exampleAgentFeedback}
                    </p>
                    <Button
                      aria-label="Copy feedback for coding agent"
                      onClick={() => navigator.clipboard.writeText(exampleAgentFeedback)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </aside>

          <div className="mt-12 grid gap-px md:grid-cols-3">
            {loopSteps.map((item, index) => (
              <div key={item.step} className="bg-background px-4 py-5 sm:px-5">
                <p
                  className="font-mono text-[11px] uppercase tracking-[0.16em]"
                  style={{
                    color:
                      index === 0
                        ? accentBlue
                        : index === 1
                          ? accentOrange
                          : "hsl(var(--foreground))",
                  }}
                >
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

      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              How it works
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              The scenario stays fixed while the agent works.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Caracara separates the authored evaluation asset from the local
              execution loop, so the runner is working against a fetched plan
              rather than inventing its own grading target.
            </p>
          </div>

          <ol className="grid gap-px md:grid-cols-2">
            {flowSteps.map((item, index) => {
              const Icon = item.icon

              return (
                <li key={item.label} className="bg-background p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center border border-border">
                        <Icon className="size-4 text-muted-foreground" />
                      </span>
                      <p
                        className="font-mono text-[11px] uppercase tracking-[0.16em]"
                        style={{
                          color:
                            index === 0
                              ? accentBlue
                              : index === 1
                                ? accentOrange
                                : "hsl(var(--muted-foreground))",
                        }}
                      >
                        0{index + 1} / {item.label}
                      </p>
                    </div>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.body}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 sm:py-16">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              What a scenario contains
            </p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-foreground">
              One reusable behavior definition, split into execution and
              scoring.
            </h2>
            <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
              {scenarioFields.map(([label, body]) => (
                <div key={label} className="bg-background p-4">
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: accentBlue }}
                  >
                    {label}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              What you get back
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              A scored result that points directly at the next fix.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              The result is not just pass or fail. It is structured feedback
              that can become the next implementation instruction.
            </p>
          </div>

          <div className="grid gap-6">
            <div className="grid gap-px border border-border bg-border sm:grid-cols-4">
              {resultFields.map((item) => (
                <div key={item.label} className="bg-background p-4">
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: accentOrange }}
                  >
                    {item.label}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>

            <div className="border border-border">
              <div className="grid gap-px bg-border md:grid-cols-[16rem_minmax(0,1fr)]">
                <div className="bg-background p-4">
                  <ScoreRing value={exampleScore} accentColor={accentOrange} />
                </div>
                <div className="bg-background p-4">
                  <div className="flex items-center gap-2">
                    <Wrench className="size-4" style={{ color: accentOrange }} />
                    <h3
                      className="text-sm font-semibold"
                      style={{ color: accentOrange }}
                    >
                      Suggested next change
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Preserve cart line items after session refresh, then update
                    the expired-session copy to explain that retry is safe.
                  </p>
                  <p className="mt-4 font-mono text-xs leading-6 text-foreground">
                    caracara result -&gt; coding agent prompt -&gt; product fix
                    -&gt; rerun
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Where it fits
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              The layer between deterministic tests and manual product review.
            </h2>
          </div>
          <ul className="grid gap-px border border-border bg-border">
            {fitItems.map((item) => (
              <li key={item} className="flex gap-3 bg-background px-4 py-4">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm leading-6 text-muted-foreground">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  )
}

function ScoreRing({
  value,
  accentColor = accentBlue,
}: {
  value: number
  accentColor?: string
}) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - value)

  return (
    <div className="mt-4 flex justify-center sm:justify-start">
      <div className="relative flex size-40 items-center justify-center sm:size-44">
        <svg
          aria-hidden
          className="-rotate-90 size-full overflow-visible"
          viewBox="0 0 140 140"
        >
          <circle
            className="text-border"
            cx="70"
            cy="70"
            fill="none"
            opacity="0.4"
            r={radius}
            stroke="currentColor"
            strokeWidth="8"
          />
          <circle
            cx="70"
            cy="70"
            fill="none"
            r={radius}
            stroke={accentColor}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="8"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-4xl font-semibold tracking-tight text-foreground">
            {value.toFixed(2)}
          </p>
          <p
            className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em]"
            style={{ color: accentColor }}
          >
            Score
          </p>
        </div>
      </div>
    </div>
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
