"use client"

import type { useMutation } from "convex/react"
import type { api } from "@/convex/_generated/api"
import {
  ArrowDown,
  ArrowUp,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useId, useState } from "react"
import {
  FIXTURE_DESCRIPTION_MAX_LENGTH,
  FIXTURE_DONE_WHEN_MAX_LENGTH,
  FIXTURE_INSTRUCTIONS_MAX_LENGTH,
  FIXTURE_LOCATOR_MAX_LENGTH,
  FIXTURE_MAX_HEALTH_CHECKS,
  FIXTURE_MAX_STEPS,
  FIXTURE_MUTATION_SCOPE_MAX_LENGTH,
  FIXTURE_PROTECTION_MAX_LENGTH,
  fixtureInputSchema,
  fixtureMutationScopeSchema,
  type FixtureAccess,
  type FixtureDetail,
  type FixtureOperation,
} from "@workspace/contracts"
import type { z } from "zod"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import {
  FixtureAccessBadge,
  FixtureHealthTable,
  FixtureOperationList,
} from "@/components/fixture-status"
import { getErrorData, getErrorMessage } from "@/lib/errors"

type StepDraft = {
  key: string
  id: string | null
  name: string
  instructions: string
  doneWhen: string
}

type CheckDraft = {
  key: string
  id: string | null
  name: string
  expectation: string
}

export type FixtureFormState = {
  name: string
  slug: string
  description: string
  locator: string
  protection: string
  resetInstructions: string
  convergeSteps: StepDraft[]
  healthChecks: CheckDraft[]
}

type FieldErrors = Record<string, string>

const TOP_LEVEL_FIELDS = [
  "name",
  "slug",
  "description",
  "locator",
  "protection",
  "resetInstructions",
  "convergeSteps",
  "healthChecks",
] as const

export function createFixtureFormState(fixture: {
  name: string
  slug: string
  description: string
  locator: string
  protection: string
  resetInstructions: string | null
  convergeSteps: Array<{
    id: string
    name: string
    instructions: string
    doneWhen: string
  }>
  healthChecks: Array<{ id: string; name: string; expectation: string }>
}): FixtureFormState {
  return {
    name: fixture.name,
    slug: fixture.slug,
    description: fixture.description,
    locator: fixture.locator,
    protection: fixture.protection,
    resetInstructions: fixture.resetInstructions ?? "",
    convergeSteps: fixture.convergeSteps.map((step) => ({
      key: step.id,
      id: step.id,
      name: step.name,
      instructions: step.instructions,
      doneWhen: step.doneWhen,
    })),
    healthChecks: fixture.healthChecks.map((check) => ({
      key: check.id,
      id: check.id,
      name: check.name,
      expectation: check.expectation,
    })),
  }
}

/** Strips client-only keys. Entries the server has not seen keep `id: null`. */
export function toFixtureInput(form: FixtureFormState) {
  return {
    name: form.name,
    slug: form.slug,
    description: form.description,
    locator: form.locator,
    protection: form.protection,
    resetInstructions: form.resetInstructions,
    convergeSteps: form.convergeSteps.map((step) => ({
      id: step.id,
      name: step.name,
      instructions: step.instructions,
      doneWhen: step.doneWhen,
    })),
    healthChecks: form.healthChecks.map((check) => ({
      id: check.id,
      name: check.name,
      expectation: check.expectation,
    })),
  }
}

function formatIssueMessage(issue: z.core.$ZodIssue) {
  if (issue.code === "too_small" && issue.message.startsWith("Too small")) {
    return "Required."
  }
  if (issue.code === "too_big" && issue.message.startsWith("Too big")) {
    return `Must be ${issue.maximum} characters or fewer.`
  }
  return issue.message
}

function collectFieldErrors(error: z.core.$ZodError): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of error.issues) {
    const path = issue.path.join(".")
    errors[path] ??= formatIssueMessage(issue)
  }
  return errors
}

function readServerFieldErrors(error: unknown): FieldErrors {
  const data = getErrorData(error)
  if (!data || !("fieldErrors" in data)) {
    return {}
  }
  const fieldErrors = data.fieldErrors
  if (typeof fieldErrors !== "object" || fieldErrors === null) {
    return {}
  }

  const errors: FieldErrors = {}
  for (const field of TOP_LEVEL_FIELDS) {
    const messages = (fieldErrors as Record<string, unknown>)[field]
    if (Array.isArray(messages) && typeof messages[0] === "string") {
      errors[field] = messages[0]
    }
  }
  return errors
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) {
    next.splice(to, 0, moved)
  }
  return next
}

function newDraftKey() {
  return `new-${crypto.randomUUID()}`
}

function SectionHeading({
  children,
  count,
}: {
  children: React.ReactNode
  count?: number
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {children}
      </h3>
      {count === undefined ? null : (
        <Badge className="font-mono" variant="outline">
          {count}
        </Badge>
      )}
    </div>
  )
}

function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? (
        <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function InlineError({ message }: { message?: string }) {
  return message ? (
    <p className="text-xs text-destructive" role="alert">
      {message}
    </p>
  ) : null
}

function ReorderButtons({
  baseId,
  index,
  label,
  length,
  onMove,
  onRemove,
}: {
  baseId: string
  index: number
  label: string
  length: number
  onMove: (to: number, direction: "up" | "down") => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center">
      <Button
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        id={`${baseId}-up`}
        onClick={() => onMove(index - 1, "up")}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-label={`Move ${label} down`}
        disabled={index === length - 1}
        id={`${baseId}-down`}
        onClick={() => onMove(index + 1, "down")}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ArrowDown />
      </Button>
      <Button
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2 />
      </Button>
    </div>
  )
}

type RequirementTargetOption = {
  value: string
  label: string
}

function getRequirementTargetValue(requirement: {
  phaseId: string | null
  scenarioId: string | null
}) {
  return requirement.phaseId
    ? `phase:${requirement.phaseId}`
    : `scenario:${requirement.scenarioId}`
}

function FixtureRequirementsSection({
  fixture,
  phases,
  projectId,
  removeRequirement,
  scenarios,
  setRequirement,
}: {
  fixture: FixtureDetail
  phases: Array<{ id: string; name: string; order: number }>
  projectId: string
  removeRequirement: ReturnType<
    typeof useMutation<typeof api.fixtures.removeRequirement>
  >
  scenarios: Array<{ id: string; name: string; slug: string }>
  setRequirement: ReturnType<
    typeof useMutation<typeof api.fixtures.setRequirement>
  >
}) {
  const baseId = useId()
  const [target, setTarget] = useState("")
  const [access, setAccess] = useState<FixtureAccess>("read")
  const [mutationScope, setMutationScope] = useState("")
  const [errors, setErrors] = useState<{
    target?: string
    mutationScope?: string
    form?: string
  }>({})
  const [isPending, setIsPending] = useState(false)
  const phaseOptions: RequirementTargetOption[] = phases.map((phase) => ({
    value: `phase:${phase.id}`,
    label: `Phase ${phase.order}: ${phase.name}`,
  }))
  const scenarioOptions: RequirementTargetOption[] = scenarios.map(
    (scenario) => ({
      value: `scenario:${scenario.id}`,
      label: scenario.name,
    })
  )
  const scenarioSlugById = new Map(
    scenarios.map((scenario) => [scenario.id, scenario.slug])
  )
  const labelByValue = new Map(
    [...phaseOptions, ...scenarioOptions].map((option) => [
      option.value,
      option.label,
    ])
  )
  const existingTargets = new Set(
    fixture.requirements.map(getRequirementTargetValue)
  )

  const toTargetArgs = (value: string) => {
    const [kind, id] = value.split(":") as [string, string]
    return kind === "phase"
      ? { phaseId: id as never }
      : { scenarioId: id as never }
  }

  const submit = async () => {
    const nextErrors: typeof errors = {}
    if (!target) {
      nextErrors.target = "Choose a phase or scenario."
    }
    let scope: string | null = null
    if (access === "mutates") {
      const parsed = fixtureMutationScopeSchema.safeParse(mutationScope)
      if (parsed.success) {
        scope = parsed.data
      } else {
        nextErrors.mutationScope =
          mutationScope.trim() === ""
            ? "Describe what the scenarios may change."
            : `Must be ${FIXTURE_MUTATION_SCOPE_MAX_LENGTH} characters or fewer.`
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setIsPending(true)
    try {
      await setRequirement({
        projectId: projectId as never,
        fixtureId: fixture.id as never,
        ...toTargetArgs(target),
        access,
        ...(scope === null ? {} : { mutationScope: scope }),
      })
      setTarget("")
      setAccess("read")
      setMutationScope("")
    } catch (error) {
      setErrors({ form: getErrorMessage(error) })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className="grid gap-3 border-t border-border pt-5"
    >
      <div id={`${baseId}-heading`}>
        <SectionHeading count={fixture.requirements.length}>
          Used by
        </SectionHeading>
      </div>
      <p className="-mt-1 text-sm text-muted-foreground">
        Runs that include these phases or scenarios check this fixture first.
      </p>
      <div className="border border-border">
        {fixture.requirements.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            No phase or scenario requires this fixture yet.
          </div>
        ) : (
          fixture.requirements.map((requirement) => {
            const value = getRequirementTargetValue(requirement)
            const label =
              labelByValue.get(value) ??
              (requirement.phaseId ? "Unknown phase" : "Unknown scenario")
            const slug = requirement.scenarioId
              ? scenarioSlugById.get(requirement.scenarioId)
              : undefined

            return (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
                key={requirement.id}
              >
                <span className="min-w-0">
                  <span className="block truncate text-foreground">
                    {label}
                  </span>
                  {slug ? (
                    <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                      {slug}
                    </span>
                  ) : null}
                  {requirement.mutationScope ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      May change: {requirement.mutationScope}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <FixtureAccessBadge access={requirement.access} />
                  <Button
                    aria-label={`Remove requirement for ${label}`}
                    onClick={async () => {
                      setErrors({})
                      try {
                        await removeRequirement({
                          projectId: projectId as never,
                          fixtureId: fixture.id as never,
                          ...(requirement.phaseId
                            ? { phaseId: requirement.phaseId as never }
                            : { scenarioId: requirement.scenarioId as never }),
                        })
                      } catch (error) {
                        setErrors({ form: getErrorMessage(error) })
                      }
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </span>
              </div>
            )
          })
        )}
      </div>

      <div className="grid gap-3 border border-border px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-2">
            <Label htmlFor={`${baseId}-target`}>Phase or scenario</Label>
            <select
              aria-invalid={!!errors.target}
              className="h-8 w-full min-w-0 border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              id={`${baseId}-target`}
              onChange={(event) => setTarget(event.target.value)}
              value={target}
            >
              <option value="">Choose a phase or scenario</option>
              {phaseOptions.length > 0 ? (
                <optgroup label="Phases">
                  {phaseOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {scenarioOptions.length > 0 ? (
                <optgroup label="Scenarios">
                  {scenarioOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <InlineError message={errors.target} />
          </div>
          <div className="grid content-start gap-2">
            <Label id={`${baseId}-access`}>Access</Label>
            <ToggleGroup
              aria-labelledby={`${baseId}-access`}
              onValueChange={(value) => {
                if (value === "read" || value === "mutates") {
                  setAccess(value)
                }
              }}
              type="single"
              value={access}
            >
              <ToggleGroupItem className="px-3" value="read">
                Read
              </ToggleGroupItem>
              <ToggleGroupItem className="px-3" value="mutates">
                Mutates
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        {access === "mutates" ? (
          <FormField
            error={errors.mutationScope}
            hint="Required for mutating access. Evaluation runs may change only this part of the fixture."
            id={`${baseId}-scope`}
            label="Mutation scope"
          >
            <Input
              aria-invalid={!!errors.mutationScope}
              id={`${baseId}-scope`}
              maxLength={FIXTURE_MUTATION_SCOPE_MAX_LENGTH}
              onChange={(event) => setMutationScope(event.target.value)}
              placeholder="Adds and deletes slices of animal A1"
              value={mutationScope}
            />
          </FormField>
        ) : null}
        <InlineError message={errors.form} />
        <Button
          className="justify-self-start"
          disabled={isPending}
          onClick={submit}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          {target && existingTargets.has(target)
            ? "Update requirement"
            : "Add requirement"}
        </Button>
      </div>
    </section>
  )
}

export function FixtureEditor({
  fixture,
  onDeleted,
  operations,
  phases,
  projectId,
  removeFixture,
  removeRequirement,
  scenarios,
  setRequirement,
  updateFixture,
}: {
  fixture: FixtureDetail
  onDeleted: () => void
  operations: FixtureOperation[] | undefined
  phases: Array<{ id: string; name: string; order: number }>
  projectId: string
  removeFixture: ReturnType<typeof useMutation<typeof api.fixtures.remove>>
  removeRequirement: ReturnType<
    typeof useMutation<typeof api.fixtures.removeRequirement>
  >
  scenarios: Array<{ id: string; name: string; slug: string }>
  setRequirement: ReturnType<
    typeof useMutation<typeof api.fixtures.setRequirement>
  >
  updateFixture: ReturnType<typeof useMutation<typeof api.fixtures.update>>
}) {
  const baseId = useId()
  const [savedForm, setSavedForm] = useState(() =>
    createFixtureFormState(fixture)
  )
  const [form, setForm] = useState(() => createFixtureFormState(fixture))
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{
    id: string
    fallbackId: string
  } | null>(null)
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  useEffect(() => {
    if (!focusRequest) {
      return
    }
    const target = document.getElementById(focusRequest.id)
    const fallback = document.getElementById(focusRequest.fallbackId)
    const element =
      target && !(target as HTMLButtonElement).disabled ? target : fallback
    element?.focus()
  }, [focusRequest])

  const fieldId = (name: string) => `${baseId}-${name}`
  const reorderId = (list: string, key: string) => `${baseId}-${list}-${key}`

  const requestFocus = (
    list: string,
    key: string,
    direction: "up" | "down"
  ) => {
    const id = reorderId(list, key)
    setFocusRequest({
      id: `${id}-${direction}`,
      fallbackId: `${id}-${direction === "up" ? "down" : "up"}`,
    })
  }

  const updateStep = (key: string, patch: Partial<StepDraft>) =>
    setForm((current) => ({
      ...current,
      convergeSteps: current.convergeSteps.map((step) =>
        step.key === key ? { ...step, ...patch } : step
      ),
    }))
  const updateCheck = (key: string, patch: Partial<CheckDraft>) =>
    setForm((current) => ({
      ...current,
      healthChecks: current.healthChecks.map((check) =>
        check.key === key ? { ...check, ...patch } : check
      ),
    }))

  const save = async () => {
    const parsed = fixtureInputSchema.safeParse(toFixtureInput(form))

    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error))
      setError("Fix the highlighted fields before saving.")
      return
    }

    setFieldErrors({})
    setError(null)
    setIsSaving(true)
    try {
      const updated = await updateFixture({
        projectId: projectId as never,
        fixtureId: fixture.id as never,
        name: parsed.data.name,
        ...(parsed.data.slug === undefined ? {} : { slug: parsed.data.slug }),
        description: parsed.data.description,
        locator: parsed.data.locator,
        protection: parsed.data.protection,
        resetInstructions: parsed.data.resetInstructions,
        convergeSteps: parsed.data.convergeSteps,
        healthChecks: parsed.data.healthChecks,
      })
      const nextForm = createFixtureFormState(updated)
      setSavedForm(nextForm)
      setForm(nextForm)
    } catch (saveError) {
      setFieldErrors(readServerFieldErrors(saveError))
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="grid h-full content-start gap-6 overflow-auto px-6 py-6">
      <div className="flex items-center gap-3">
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete fixture "${fixture.name}"? Its requirements are removed. Operation history is kept.`
                )
              ) {
                return
              }

              setError(null)
              try {
                await removeFixture({
                  projectId: projectId as never,
                  fixtureId: fixture.id as never,
                })
                onDeleted()
              } catch (removeError) {
                setError(getErrorMessage(removeError))
              }
            }}
          >
            <Trash2 />
            Delete
          </Button>
          <Button
            disabled={!isDirty}
            size="sm"
            variant="outline"
            onClick={() => {
              setForm(savedForm)
              setFieldErrors({})
              setError(null)
            }}
          >
            <RotateCcw />
            Revert
          </Button>
          <Button disabled={!isDirty || isSaving} size="sm" onClick={save}>
            <Save />
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={fieldErrors.name} id={fieldId("name")} label="Name">
          <Input
            aria-invalid={!!fieldErrors.name}
            id={fieldId("name")}
            maxLength={120}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            value={form.name}
          />
        </FormField>
        <FormField error={fieldErrors.slug} id={fieldId("slug")} label="Slug">
          <Input
            aria-invalid={!!fieldErrors.slug}
            className="font-mono"
            id={fieldId("slug")}
            maxLength={120}
            onChange={(event) =>
              setForm((current) => ({ ...current, slug: event.target.value }))
            }
            value={form.slug}
          />
        </FormField>
      </div>

      <FormField
        error={fieldErrors.description}
        id={fieldId("description")}
        label="Description"
      >
        <Textarea
          aria-invalid={!!fieldErrors.description}
          className="min-h-20"
          id={fieldId("description")}
          maxLength={FIXTURE_DESCRIPTION_MAX_LENGTH}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          placeholder="What this data is and which scenarios rely on it."
          value={form.description}
        />
      </FormField>

      <FormField
        error={fieldErrors.locator}
        hint="Where the fixture lives in the app."
        id={fieldId("locator")}
        label="How to find it"
      >
        <Textarea
          aria-invalid={!!fieldErrors.locator}
          className="min-h-20"
          id={fieldId("locator")}
          maxLength={FIXTURE_LOCATOR_MAX_LENGTH}
          onChange={(event) =>
            setForm((current) => ({ ...current, locator: event.target.value }))
          }
          value={form.locator}
        />
      </FormField>

      <FormField
        error={fieldErrors.protection}
        hint="Added to the prompt of every evaluation run that uses this fixture."
        id={fieldId("protection")}
        label="Rules for evaluation runs"
      >
        <Textarea
          aria-invalid={!!fieldErrors.protection}
          className="min-h-20"
          id={fieldId("protection")}
          maxLength={FIXTURE_PROTECTION_MAX_LENGTH}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              protection: event.target.value,
            }))
          }
          value={form.protection}
        />
      </FormField>

      <section className="grid gap-3 border-t border-border pt-5">
        <SectionHeading count={form.convergeSteps.length}>
          Converge steps
        </SectionHeading>
        <p className="-mt-1 text-sm text-muted-foreground">
          Ordered, idempotent steps an agent follows to bring the fixture to its
          expected state.
        </p>
        <InlineError message={fieldErrors.convergeSteps} />
        {form.convergeSteps.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No converge steps yet.
          </p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {form.convergeSteps.map((step, index) => {
              const label = `converge step ${index + 1}`
              const errorKey = `convergeSteps.${index}`

              return (
                <div
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-2 gap-y-2 py-3"
                  key={step.key}
                >
                  <span className="pt-2 font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="grid gap-1">
                    <Input
                      aria-invalid={!!fieldErrors[`${errorKey}.name`]}
                      aria-label={`Converge step ${index + 1} name`}
                      maxLength={120}
                      onChange={(event) =>
                        updateStep(step.key, { name: event.target.value })
                      }
                      placeholder="Step name"
                      value={step.name}
                    />
                    <InlineError message={fieldErrors[`${errorKey}.name`]} />
                  </div>
                  <ReorderButtons
                    baseId={reorderId("steps", step.key)}
                    index={index}
                    label={label}
                    length={form.convergeSteps.length}
                    onMove={(to, direction) => {
                      setForm((current) => ({
                        ...current,
                        convergeSteps: moveItem(
                          current.convergeSteps,
                          index,
                          to
                        ),
                      }))
                      requestFocus("steps", step.key, direction)
                    }}
                    onRemove={() =>
                      setForm((current) => ({
                        ...current,
                        convergeSteps: current.convergeSteps.filter(
                          (item) => item.key !== step.key
                        ),
                      }))
                    }
                  />
                  <div className="col-start-2 col-end-4 grid gap-1">
                    <Textarea
                      aria-invalid={!!fieldErrors[`${errorKey}.instructions`]}
                      aria-label={`Converge step ${index + 1} instructions`}
                      className="min-h-20"
                      maxLength={FIXTURE_INSTRUCTIONS_MAX_LENGTH}
                      onChange={(event) =>
                        updateStep(step.key, {
                          instructions: event.target.value,
                        })
                      }
                      placeholder="What to do in the app."
                      value={step.instructions}
                    />
                    <InlineError
                      message={fieldErrors[`${errorKey}.instructions`]}
                    />
                  </div>
                  <div className="col-start-2 col-end-4 grid gap-1">
                    <Textarea
                      aria-invalid={!!fieldErrors[`${errorKey}.doneWhen`]}
                      aria-label={`Converge step ${index + 1} done when`}
                      className="[field-sizing:content] max-h-[4.75rem] min-h-9 resize-none overflow-y-auto"
                      maxLength={FIXTURE_DONE_WHEN_MAX_LENGTH}
                      onChange={(event) =>
                        updateStep(step.key, { doneWhen: event.target.value })
                      }
                      placeholder="Done when: the observable result of this step."
                      value={step.doneWhen}
                    />
                    <InlineError
                      message={fieldErrors[`${errorKey}.doneWhen`]}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <Button
          className="justify-self-start"
          disabled={form.convergeSteps.length >= FIXTURE_MAX_STEPS}
          onClick={() =>
            setForm((current) => ({
              ...current,
              convergeSteps: [
                ...current.convergeSteps,
                {
                  key: newDraftKey(),
                  id: null,
                  name: "",
                  instructions: "",
                  doneWhen: "",
                },
              ],
            }))
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          Add step
        </Button>
      </section>

      <section className="grid gap-3 border-t border-border pt-5">
        <SectionHeading count={form.healthChecks.length}>
          Health checks
        </SectionHeading>
        <p className="-mt-1 text-sm text-muted-foreground">
          A verify passes when every check holds.
        </p>
        <InlineError message={fieldErrors.healthChecks} />
        {form.healthChecks.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No health checks yet.
          </p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {form.healthChecks.map((check, index) => {
              const label = `health check ${index + 1}`
              const errorKey = `healthChecks.${index}`

              return (
                <div
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-2 gap-y-2 py-3"
                  key={check.key}
                >
                  <span className="pt-2 font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="grid gap-1">
                    <Input
                      aria-invalid={!!fieldErrors[`${errorKey}.name`]}
                      aria-label={`Health check ${index + 1} name`}
                      maxLength={120}
                      onChange={(event) =>
                        updateCheck(check.key, { name: event.target.value })
                      }
                      placeholder="Check name"
                      value={check.name}
                    />
                    <InlineError message={fieldErrors[`${errorKey}.name`]} />
                  </div>
                  <ReorderButtons
                    baseId={reorderId("checks", check.key)}
                    index={index}
                    label={label}
                    length={form.healthChecks.length}
                    onMove={(to, direction) => {
                      setForm((current) => ({
                        ...current,
                        healthChecks: moveItem(current.healthChecks, index, to),
                      }))
                      requestFocus("checks", check.key, direction)
                    }}
                    onRemove={() =>
                      setForm((current) => ({
                        ...current,
                        healthChecks: current.healthChecks.filter(
                          (item) => item.key !== check.key
                        ),
                      }))
                    }
                  />
                  <div className="col-start-2 col-end-4 grid gap-1">
                    <Textarea
                      aria-invalid={!!fieldErrors[`${errorKey}.expectation`]}
                      aria-label={`Health check ${index + 1} expectation`}
                      className="[field-sizing:content] max-h-[4.75rem] min-h-9 resize-none overflow-y-auto"
                      maxLength={2000}
                      onChange={(event) =>
                        updateCheck(check.key, {
                          expectation: event.target.value,
                        })
                      }
                      placeholder="Describe the observable condition that must be true."
                      value={check.expectation}
                    />
                    <InlineError
                      message={fieldErrors[`${errorKey}.expectation`]}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <Button
          className="justify-self-start"
          disabled={form.healthChecks.length >= FIXTURE_MAX_HEALTH_CHECKS}
          onClick={() =>
            setForm((current) => ({
              ...current,
              healthChecks: [
                ...current.healthChecks,
                { key: newDraftKey(), id: null, name: "", expectation: "" },
              ],
            }))
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          Add check
        </Button>
      </section>

      <section className="grid gap-3 border-t border-border pt-5">
        <FormField
          error={fieldErrors.resetInstructions}
          hint="Optional. How an agent restores the fixture after a run that mutates it."
          id={fieldId("reset")}
          label="Reset instructions"
        >
          <Textarea
            aria-invalid={!!fieldErrors.resetInstructions}
            className="min-h-20"
            id={fieldId("reset")}
            maxLength={FIXTURE_INSTRUCTIONS_MAX_LENGTH}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                resetInstructions: event.target.value,
              }))
            }
            value={form.resetInstructions}
          />
        </FormField>
      </section>

      <FixtureRequirementsSection
        fixture={fixture}
        phases={phases}
        projectId={projectId}
        removeRequirement={removeRequirement}
        scenarios={scenarios}
        setRequirement={setRequirement}
      />

      <section className="grid gap-3 border-t border-border pt-5">
        <SectionHeading>Health</SectionHeading>
        <p className="-mt-1 text-sm text-muted-foreground">
          The CLI verifies, converges and resets fixtures. A hook configured
          locally in{" "}
          <code className="font-mono text-xs">.caracara/fixtures.json</code>{" "}
          runs instead of an agent; hooks are never stored in Caracara.
        </p>
        <FixtureHealthTable health={fixture.health} />
      </section>

      <section className="grid gap-3 border-t border-border pt-5">
        <SectionHeading>Recent operations</SectionHeading>
        <FixtureOperationList
          emptyText="No operations recorded for this fixture yet."
          operations={operations}
        />
      </section>
    </div>
  )
}
