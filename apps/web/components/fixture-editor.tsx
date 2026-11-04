"use client"

import type { useMutation } from "convex/react"
import { Plus, RotateCcw, Save, Trash2, X } from "lucide-react"
import { useState } from "react"
import {
  fixtureSchema,
  type Fixture,
  type FixtureAccess,
  type FixturePreflightEntry,
} from "@workspace/contracts"
import { z } from "zod"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import type { api } from "@/convex/_generated/api"
import { getErrorMessage } from "@/lib/errors"

type FixtureForm = Pick<
  Fixture,
  | "name"
  | "slug"
  | "description"
  | "locator"
  | "protection"
  | "convergeSteps"
  | "healthChecks"
>
type FormErrors = Partial<Record<keyof FixtureForm, string>>

const fixtureFormSchema = fixtureSchema.pick({
  name: true,
  description: true,
  locator: true,
  protection: true,
  convergeSteps: true,
  healthChecks: true,
})

const selectClassName =
  "h-8 min-w-0 border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"

function toForm(fixture: FixtureForm): FixtureForm {
  return {
    name: fixture.name,
    slug: fixture.slug,
    description: fixture.description,
    locator: fixture.locator,
    protection: fixture.protection,
    convergeSteps: fixture.convergeSteps,
    healthChecks: fixture.healthChecks,
  }
}

function FormField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: (id: string) => React.ReactNode
}) {
  const id = `fixture-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function SectionHeader({
  title,
  description,
  count,
  action,
}: {
  title: string
  description: string
  count: number
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {title}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge className="font-mono" variant="outline">
          {count}
        </Badge>
        {action}
      </div>
    </div>
  )
}

export function FixtureEditor({
  fixture,
  phases,
  scenarios,
  projectId,
  onError,
  onDeleted,
  updateFixture,
  removeFixture,
  setRequirement,
  removeRequirement,
}: {
  fixture: Fixture
  phases: Array<{ id: string; name: string; order: number }>
  scenarios: Array<{ id: string; name: string; slug: string }>
  projectId: string
  onError: (message: string | null) => void
  onDeleted: () => void
  updateFixture: ReturnType<typeof useMutation<typeof api.fixtures.update>>
  removeFixture: ReturnType<typeof useMutation<typeof api.fixtures.remove>>
  setRequirement: ReturnType<
    typeof useMutation<typeof api.fixtures.setRequirement>
  >
  removeRequirement: ReturnType<
    typeof useMutation<typeof api.fixtures.removeRequirement>
  >
}) {
  const [savedForm, setSavedForm] = useState(() => toForm(fixture))
  const [form, setForm] = useState(() => toForm(fixture))
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(fixture.updatedAt)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isPending, setIsPending] = useState(false)
  const [target, setTarget] = useState("")
  const [access, setAccess] = useState<FixtureAccess>("read")
  const [scope, setScope] = useState("")
  const [requirementError, setRequirementError] = useState<string | null>(null)
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)
  const ids = { projectId: projectId as never, fixtureId: fixture.id as never }

  // Requirement changes and edits elsewhere update the fixture; keep any
  // unsaved field edits, otherwise follow the stored definition.
  if (fixture.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(fixture.updatedAt)
    if (!isDirty) {
      setSavedForm(toForm(fixture))
      setForm(toForm(fixture))
    }
  }

  async function pending(action: () => Promise<void>) {
    onError(null)
    setIsPending(true)
    try {
      await action()
    } catch (error) {
      onError(getErrorMessage(error))
    } finally {
      setIsPending(false)
    }
  }

  function setField<Key extends keyof FixtureForm>(
    key: Key,
    value: FixtureForm[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function targetLabel(requirement: Fixture["requirements"][number]) {
    if (requirement.phaseId !== null) {
      const phase = phases.find((item) => item.id === requirement.phaseId)
      return phase ? `Phase ${phase.order}: ${phase.name}` : "Unknown phase"
    }
    const scenario = scenarios.find(
      (item) => item.id === requirement.scenarioId
    )
    return scenario ? `Scenario: ${scenario.name}` : "Unknown scenario"
  }

  async function save() {
    const parsed = fixtureFormSchema.safeParse(form)
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors
      setErrors(
        Object.fromEntries(
          Object.entries(fieldErrors).map(([key, messages]) => [
            key,
            key === "convergeSteps" || key === "healthChecks"
              ? "Every item needs all of its fields filled in."
              : messages?.[0],
          ])
        )
      )
      return
    }
    setErrors({})
    await pending(async () => {
      const updated = await updateFixture({ ...ids, ...form })
      setSavedForm(toForm(updated))
      setForm(toForm(updated))
      setSeenUpdatedAt(updated.updatedAt)
    })
  }

  async function addRequirement() {
    const [kind, id] = target.split(":")
    if (!kind || !id) {
      setRequirementError("Choose a phase or scenario.")
      return
    }
    if (access === "mutates" && scope.trim() === "") {
      setRequirementError("Describe what the scenarios may change.")
      return
    }
    setRequirementError(null)
    await pending(async () => {
      await setRequirement({
        ...ids,
        ...(kind === "phase"
          ? { phaseId: id as never }
          : { scenarioId: id as never }),
        access,
        ...(access === "mutates" ? { mutationScope: scope.trim() } : {}),
      })
      setTarget("")
      setAccess("read")
      setScope("")
    })
  }

  return (
    <div className="grid h-full content-start gap-6 overflow-auto px-6 py-6">
      <div className="flex items-center justify-end gap-2">
        <Button
          disabled={isPending}
          size="sm"
          variant="destructive"
          onClick={async () => {
            if (!window.confirm(`Delete fixture "${fixture.name}"?`)) {
              return
            }
            await pending(async () => {
              await removeFixture(ids)
              onDeleted()
            })
          }}
        >
          <Trash2 />
          Delete
        </Button>
        <Button
          disabled={!isDirty || isPending}
          size="sm"
          variant="outline"
          onClick={() => {
            setForm(savedForm)
            setErrors({})
            onError(null)
          }}
        >
          <RotateCcw />
          Revert
        </Button>
        <Button disabled={!isDirty || isPending} size="sm" onClick={save}>
          <Save />
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>

      <fieldset className="grid min-w-0 gap-6" disabled={isPending}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={errors.name} label="Name">
            {(id) => (
              <Input
                aria-invalid={!!errors.name}
                id={id}
                onChange={(event) => setField("name", event.target.value)}
                value={form.name}
              />
            )}
          </FormField>
          <FormField error={errors.slug} label="Slug">
            {(id) => (
              <Input
                className="font-mono"
                id={id}
                onChange={(event) => setField("slug", event.target.value)}
                value={form.slug}
              />
            )}
          </FormField>
        </div>
        <FormField error={errors.description} label="Description">
          {(id) => (
            <Textarea
              id={id}
              onChange={(event) => setField("description", event.target.value)}
              rows={2}
              value={form.description}
            />
          )}
        </FormField>
        <FormField error={errors.locator} label="How to find it">
          {(id) => (
            <Textarea
              id={id}
              onChange={(event) => setField("locator", event.target.value)}
              placeholder="Where the fixture lives in the application and how to recognize it."
              rows={3}
              value={form.locator}
            />
          )}
        </FormField>
        <FormField error={errors.protection} label="Rules for evaluation runs">
          {(id) => (
            <Textarea
              id={id}
              onChange={(event) => setField("protection", event.target.value)}
              placeholder="What evaluation runs must not change, beyond the read-only default."
              rows={3}
              value={form.protection}
            />
          )}
        </FormField>

        <section className="grid gap-3 border-t border-border pt-5">
          <SectionHeader
            action={
              <Button
                aria-label="Add converge step"
                disabled={form.convergeSteps.length >= 20}
                size="icon-sm"
                variant="outline"
                onClick={() =>
                  setField("convergeSteps", [
                    ...form.convergeSteps,
                    {
                      id: crypto.randomUUID(),
                      name: "",
                      instructions: "",
                      doneWhen: "",
                    },
                  ])
                }
              >
                <Plus />
              </Button>
            }
            count={form.convergeSteps.length}
            description="Create or repair the fixture, in order. Each step is skipped when its done-when already holds."
            title="Converge steps"
          />
          {errors.convergeSteps ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.convergeSteps}
            </p>
          ) : null}
          {form.convergeSteps.map((step, index) => {
            const update = (patch: Partial<typeof step>) =>
              setField(
                "convergeSteps",
                form.convergeSteps.map((item) =>
                  item.id === step.id ? { ...item, ...patch } : item
                )
              )
            return (
              <div
                className="grid gap-2 border border-border p-3"
                key={step.id}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {index + 1}.
                  </span>
                  <Input
                    aria-label={`Step ${index + 1} name`}
                    onChange={(event) => update({ name: event.target.value })}
                    placeholder="Step name"
                    value={step.name}
                  />
                  <Button
                    aria-label={`Remove step ${index + 1}`}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      setField(
                        "convergeSteps",
                        form.convergeSteps.filter((item) => item.id !== step.id)
                      )
                    }
                  >
                    <X />
                  </Button>
                </div>
                <Textarea
                  aria-label={`Step ${index + 1} instructions`}
                  onChange={(event) =>
                    update({ instructions: event.target.value })
                  }
                  placeholder="Instructions"
                  rows={3}
                  value={step.instructions}
                />
                <Input
                  aria-label={`Step ${index + 1} done when`}
                  onChange={(event) => update({ doneWhen: event.target.value })}
                  placeholder="Done when"
                  value={step.doneWhen}
                />
              </div>
            )
          })}
        </section>

        <section className="grid gap-3 border-t border-border pt-5">
          <SectionHeader
            action={
              <Button
                aria-label="Add health check"
                disabled={form.healthChecks.length >= 20}
                size="icon-sm"
                variant="outline"
                onClick={() =>
                  setField("healthChecks", [
                    ...form.healthChecks,
                    { id: crypto.randomUUID(), name: "", expectation: "" },
                  ])
                }
              >
                <Plus />
              </Button>
            }
            count={form.healthChecks.length}
            description="Verify passes only when every check holds."
            title="Health checks"
          />
          {errors.healthChecks ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.healthChecks}
            </p>
          ) : null}
          {form.healthChecks.map((check, index) => {
            const update = (patch: Partial<typeof check>) =>
              setField(
                "healthChecks",
                form.healthChecks.map((item) =>
                  item.id === check.id ? { ...item, ...patch } : item
                )
              )
            return (
              <div
                className="grid gap-2 border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
                key={check.id}
              >
                <Input
                  aria-label={`Check ${index + 1} name`}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder="Check name"
                  value={check.name}
                />
                <Input
                  aria-label={`Check ${index + 1} expectation`}
                  onChange={(event) =>
                    update({ expectation: event.target.value })
                  }
                  placeholder="Expectation"
                  value={check.expectation}
                />
                <Button
                  aria-label={`Remove check ${index + 1}`}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() =>
                    setField(
                      "healthChecks",
                      form.healthChecks.filter((item) => item.id !== check.id)
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            )
          })}
        </section>

        <section className="grid gap-3 border-t border-border pt-5">
          <SectionHeader
            count={fixture.requirements.length}
            description="Phases and scenarios that rely on this fixture. Changes apply immediately."
            title="Used by"
          />
          <div className="border border-border">
            {fixture.requirements.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No phase or scenario requires this fixture yet.
              </div>
            ) : (
              fixture.requirements.map((requirement) => (
                <div
                  className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0"
                  key={requirement.phaseId ?? requirement.scenarioId}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {targetLabel(requirement)}
                  </span>
                  <Badge className="font-mono" variant="outline">
                    {requirement.access}
                  </Badge>
                  {requirement.mutationScope ? (
                    <span
                      className="max-w-[40%] truncate text-xs text-muted-foreground"
                      title={requirement.mutationScope}
                    >
                      {requirement.mutationScope}
                    </span>
                  ) : null}
                  <Button
                    aria-label={`Remove requirement for ${targetLabel(requirement)}`}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      pending(async () => {
                        await removeRequirement({
                          ...ids,
                          ...(requirement.phaseId !== null
                            ? { phaseId: requirement.phaseId as never }
                            : { scenarioId: requirement.scenarioId as never }),
                        })
                      })
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Requirement target"
              className={selectClassName}
              onChange={(event) => setTarget(event.target.value)}
              value={target}
            >
              <option value="">Phase or scenario...</option>
              <optgroup label="Phases">
                {phases.map((phase) => (
                  <option key={phase.id} value={`phase:${phase.id}`}>
                    Phase {phase.order}: {phase.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Scenarios">
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={`scenario:${scenario.id}`}>
                    {scenario.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <select
              aria-label="Requirement access"
              className={selectClassName}
              onChange={(event) =>
                setAccess(event.target.value as FixtureAccess)
              }
              value={access}
            >
              <option value="read">read</option>
              <option value="mutates">mutates</option>
            </select>
            {access === "mutates" ? (
              <Input
                aria-label="Mutation scope"
                className="min-w-48 flex-1"
                onChange={(event) => setScope(event.target.value)}
                placeholder="What the scenarios may change"
                value={scope}
              />
            ) : null}
            <Button size="sm" variant="outline" onClick={addRequirement}>
              <Plus />
              Add
            </Button>
          </div>
          {requirementError ? (
            <p className="text-xs text-destructive" role="alert">
              {requirementError}
            </p>
          ) : null}
        </section>
      </fieldset>
    </div>
  )
}

/** The fixture preflight a run reported, for the run detail summary. */
export function RunFixturePreflight({
  entries,
}: {
  entries: FixturePreflightEntry[] | undefined
}) {
  if (!entries || entries.length === 0) {
    return null
  }

  return (
    <div className="col-span-2 bg-background px-3 py-2">
      <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        Fixtures
      </p>
      <ul className="mt-1 grid gap-1">
        {entries.map((entry) => (
          <li
            className="flex items-center gap-2 text-sm"
            key={entry.fixtureId}
            title={entry.fixtureSlug}
          >
            <span className="min-w-0 flex-1 truncate text-foreground">
              {entry.fixtureName}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {entry.access}
            </span>
            <Badge
              className="font-mono"
              variant={entry.outcome === "skipped" ? "outline" : "success"}
            >
              {entry.outcome}
            </Badge>
            <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">
              {entry.executor ?? "none"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
