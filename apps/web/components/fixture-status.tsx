"use client"

import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react"
import { useState } from "react"
import type {
  FixtureAccess,
  FixtureEnvironmentHealth,
  FixtureHealthStatus,
  FixtureOperation,
  FixtureOperationStatus,
  FixturePreflightEntry,
  FixturePreflightOutcome,
} from "@workspace/contracts"

import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

export function formatFixtureTimestamp(value: number | null) {
  return value === null ? "n/a" : new Date(value).toLocaleString()
}

function getHealthBadgeVariant(status: FixtureHealthStatus) {
  switch (status) {
    case "healthy":
      return "success" as const
    case "unhealthy":
      return "warning" as const
    default:
      return "outline" as const
  }
}

function getOperationBadgeVariant(status: FixtureOperationStatus) {
  switch (status) {
    case "succeeded":
      return "success" as const
    case "running":
      return "default" as const
    default:
      return "warning" as const
  }
}

function getPreflightBadgeVariant(outcome: FixturePreflightOutcome) {
  switch (outcome) {
    case "healthy":
    case "repaired":
      return "success" as const
    default:
      return "outline" as const
  }
}

function getVerdictBadgeVariant(verdict: string) {
  return verdict === "passed" ? ("success" as const) : ("warning" as const)
}

export function FixtureAccessBadge({ access }: { access: FixtureAccess }) {
  return (
    <Badge variant={access === "mutates" ? "warning" : "outline"}>
      {access}
    </Badge>
  )
}

function BusyIndicator({ environment }: { environment: string }) {
  const label = `Operation running in ${environment}`

  return (
    <span
      aria-label={label}
      className="inline-flex size-4 shrink-0 items-center justify-center"
      role="img"
      title={label}
    >
      <LoaderCircle
        aria-hidden
        className="size-3.5 text-foreground motion-safe:animate-spin"
      />
    </span>
  )
}

/** Compact per-environment health chips for the fixture registry. */
export function FixtureHealthBadges({
  health,
}: {
  health: FixtureEnvironmentHealth[]
}) {
  if (health.length === 0) {
    return (
      <span className="text-[11px] text-muted-foreground">Not checked yet</span>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {health.map((entry) => (
        <span
          className="inline-flex min-w-0 items-center gap-1"
          key={entry.environment}
        >
          <Badge
            className="max-w-full truncate font-mono tracking-normal normal-case"
            title={`${entry.environment}: ${entry.status}`}
            variant={getHealthBadgeVariant(entry.status)}
          >
            {entry.environment} · {entry.status}
          </Badge>
          {entry.busy ? (
            <BusyIndicator environment={entry.environment} />
          ) : null}
        </span>
      ))}
    </span>
  )
}

/** Per-environment health with the time of the deciding operation. */
export function FixtureHealthTable({
  health,
}: {
  health: FixtureEnvironmentHealth[]
}) {
  if (health.length === 0) {
    return (
      <div className="border border-border px-4 py-4 text-sm text-muted-foreground">
        No operations recorded yet. Run{" "}
        <code className="font-mono text-xs">caracara fixtures:verify</code> to
        check this fixture in an environment.
      </div>
    )
  }

  return (
    <div className="border border-border">
      {health.map((entry) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
          key={entry.environment}
        >
          <span className="min-w-0">
            <span className="block truncate font-mono text-foreground">
              {entry.environment}
            </span>
            <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
              Checked {formatFixtureTimestamp(entry.checkedAt)}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {entry.busy ? (
              <BusyIndicator environment={entry.environment} />
            ) : null}
            <Badge variant={getHealthBadgeVariant(entry.status)}>
              {entry.status}
            </Badge>
          </span>
        </div>
      ))}
    </div>
  )
}

function FixtureOperationItem({
  operation,
  showFixture,
}: {
  operation: FixtureOperation
  showFixture: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const detailId = `fixture-operation-${operation.id}`
  const hasDetail =
    operation.checkResults.length > 0 || operation.summary !== null
  const title = showFixture
    ? `${operation.fixtureName} ${operation.kind}`
    : operation.kind

  return (
    <article className="border-b border-border last:border-b-0">
      <button
        aria-controls={hasDetail ? detailId : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
        disabled={!hasDetail}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="pt-0.5 text-muted-foreground">
          {hasDetail ? (
            expanded ? (
              <ChevronDown aria-hidden className="size-4" />
            ) : (
              <ChevronRight aria-hidden className="size-4" />
            )
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground capitalize">
            {title}
          </span>
          <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
            {operation.executor} · {operation.environment}
          </span>
          <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
            {formatFixtureTimestamp(operation.startedAt)} →{" "}
            {operation.finishedAt === null
              ? "running"
              : formatFixtureTimestamp(operation.finishedAt)}
          </span>
        </span>
        <Badge variant={getOperationBadgeVariant(operation.status)}>
          {operation.status}
        </Badge>
      </button>
      {hasDetail && expanded ? (
        <div className="grid gap-3 px-4 pb-4 pl-11" id={detailId}>
          {operation.checkResults.map((result) => (
            <div className="grid gap-1" key={result.checkId}>
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm text-foreground">{result.name}</span>
                <Badge variant={getVerdictBadgeVariant(result.verdict)}>
                  {result.verdict}
                </Badge>
              </div>
              <p className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
                {result.evidence}
              </p>
            </div>
          ))}
          {operation.summary ? (
            <p className="text-sm whitespace-pre-wrap text-foreground">
              {operation.summary}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function FixtureOperationList({
  emptyText,
  operations,
  showFixture = false,
}: {
  emptyText: string
  operations: FixtureOperation[] | undefined
  showFixture?: boolean
}) {
  if (operations === undefined) {
    return (
      <div className="border border-border px-4 py-4 text-sm text-muted-foreground">
        Loading operations...
      </div>
    )
  }

  if (operations.length === 0) {
    return (
      <div className="border border-border px-4 py-4 text-sm text-muted-foreground">
        {emptyText}
      </div>
    )
  }

  return (
    <div className="border border-border">
      {operations.map((operation) => (
        <FixtureOperationItem
          key={operation.id}
          operation={operation}
          showFixture={showFixture}
        />
      ))}
    </div>
  )
}

export function hasRunFixtures(
  preflight: FixturePreflightEntry[],
  operations: FixtureOperation[] | undefined
) {
  return preflight.length > 0 || (operations?.length ?? 0) > 0
}

/** Number of distinct fixtures a run checked or maintained. */
export function countRunFixtures(
  preflight: FixturePreflightEntry[],
  operations: FixtureOperation[] | undefined
) {
  return new Set([
    ...preflight.map((entry) => entry.fixtureSlug),
    ...(operations ?? []).map((operation) => operation.fixtureSlug),
  ]).size
}

/** Fixture preflight snapshot and the fixture operations linked to one run. */
export function RunFixturesDetail({
  className,
  operations,
  preflight,
}: {
  className?: string
  operations: FixtureOperation[] | undefined
  preflight: FixturePreflightEntry[]
}) {
  return (
    <div
      className={cn(
        "grid h-full min-h-0 content-start gap-6 overflow-y-auto px-6 py-6",
        className
      )}
    >
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Fixtures
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Fixture state checked before the run and maintenance run for it.
          Scenario results are listed separately.
        </p>
      </div>

      <section aria-label="Fixture preflight" className="grid gap-3">
        <h3 className="text-sm font-medium text-foreground">Preflight</h3>
        {preflight.length === 0 ? (
          <div className="border border-border px-4 py-4 text-sm text-muted-foreground">
            This run did not record a fixture preflight.
          </div>
        ) : (
          <div className="border border-border">
            {preflight.map((entry) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
                key={entry.fixtureId}
              >
                <span className="min-w-0">
                  <span className="block truncate text-foreground">
                    {entry.fixtureName}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                    {entry.fixtureSlug}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <FixtureAccessBadge access={entry.access} />
                  <Badge variant={getPreflightBadgeVariant(entry.outcome)}>
                    {entry.outcome}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Fixture operations" className="grid gap-3">
        <h3 className="text-sm font-medium text-foreground">Operations</h3>
        <FixtureOperationList
          emptyText="No fixture operations are linked to this run."
          operations={operations}
          showFixture
        />
      </section>
    </div>
  )
}
