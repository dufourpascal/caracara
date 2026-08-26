"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_PROMPT_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  projectInputSchema,
  type ProjectInput,
} from "@workspace/contracts"

import { getErrorData, getErrorMessage } from "@/lib/errors"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

type ProjectField = "name" | "slug" | "description" | "projectPrompt"
type ProjectFieldErrors = Partial<Record<ProjectField, string>>

const initialForm = {
  name: "",
  slug: "",
  description: "",
  projectPrompt: "",
}

function getProjectFieldErrors(error: unknown): ProjectFieldErrors {
  const data = getErrorData(error)

  if (!data || !("fieldErrors" in data)) {
    return {}
  }

  const fieldErrors = data.fieldErrors
  if (typeof fieldErrors !== "object" || fieldErrors === null) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(fieldErrors).flatMap(([field, messages]) => {
      if (
        !["name", "slug", "description", "projectPrompt"].includes(field) ||
        !Array.isArray(messages) ||
        typeof messages[0] !== "string"
      ) {
        return []
      }

      return [[field, messages[0]]]
    })
  )
}

export function ProjectCreateForm({
  className,
  onCreate,
  secondaryAction,
}: {
  className?: string
  onCreate: (project: ProjectInput) => Promise<void>
  secondaryAction?: ReactNode
}) {
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState<ProjectFieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField(field: ProjectField, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError(null)
  }

  return (
    <form
      aria-label="Create project"
      className={cn("grid gap-6", className)}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault()
        setSubmitError(null)

        const parsed = projectInputSchema.safeParse(form)
        if (!parsed.success) {
          const fieldErrors = parsed.error.flatten().fieldErrors
          setErrors({
            name: fieldErrors.name?.[0],
            slug: fieldErrors.slug?.[0],
            description: fieldErrors.description?.[0],
            projectPrompt: fieldErrors.projectPrompt?.[0],
          })
          return
        }

        setErrors({})
        setIsSubmitting(true)
        try {
          await onCreate(parsed.data)
        } catch (error) {
          const fieldErrors = getProjectFieldErrors(error)
          setErrors(fieldErrors)
          if (Object.keys(fieldErrors).length === 0) {
            setSubmitError(getErrorMessage(error))
          }
        } finally {
          setIsSubmitting(false)
        }
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="project-name">Project name</Label>
        <Input
          aria-describedby={errors.name ? "project-name-error" : undefined}
          aria-invalid={Boolean(errors.name)}
          id="project-name"
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => updateField("name", event.target.value)}
          value={form.name}
        />
        {errors.name ? (
          <p className="text-sm text-destructive" id="project-name-error">
            {errors.name}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="project-slug">Slug</Label>
        <Input
          aria-describedby={
            errors.slug
              ? "project-slug-hint project-slug-error"
              : "project-slug-hint"
          }
          aria-invalid={Boolean(errors.slug)}
          className="font-mono"
          id="project-slug"
          maxLength={SLUG_MAX_LENGTH}
          onChange={(event) => updateField("slug", event.target.value)}
          placeholder="my-project"
          value={form.slug}
        />
        <p className="text-sm text-muted-foreground" id="project-slug-hint">
          Use lowercase letters, numbers, and hyphens. Leave blank to derive it
          from the project name.
        </p>
        {errors.slug ? (
          <p className="text-sm text-destructive" id="project-slug-error">
            {errors.slug}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="project-description">Description</Label>
        <Textarea
          aria-describedby={
            errors.description ? "project-description-error" : undefined
          }
          aria-invalid={Boolean(errors.description)}
          id="project-description"
          maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => updateField("description", event.target.value)}
          value={form.description}
        />
        {errors.description ? (
          <p
            className="text-sm text-destructive"
            id="project-description-error"
          >
            {errors.description}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="project-prompt">Project prompt</Label>
        <Textarea
          aria-describedby={
            errors.projectPrompt
              ? "project-prompt-hint project-prompt-error"
              : "project-prompt-hint"
          }
          aria-invalid={Boolean(errors.projectPrompt)}
          className="font-mono"
          id="project-prompt"
          maxLength={PROJECT_PROMPT_MAX_LENGTH}
          onChange={(event) => updateField("projectPrompt", event.target.value)}
          value={form.projectPrompt}
        />
        <p className="text-sm text-muted-foreground" id="project-prompt-hint">
          Applied to every scenario run as shared project context.
        </p>
        {errors.projectPrompt ? (
          <p className="text-sm text-destructive" id="project-prompt-error">
            {errors.projectPrompt}
          </p>
        ) : null}
      </div>
      {submitError ? (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Creating..." : "Create project"}
        </Button>
        {secondaryAction}
      </div>
    </form>
  )
}
