"use client"

import { useRouter } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import { Authenticated, AuthLoading, useMutation } from "convex/react"
import { useState } from "react"

import { api } from "@/convex/_generated/api"
import { AppBrand } from "@/components/app-brand"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"

export function ProjectCreateScreen() {
  return (
    <>
      <AuthLoading>
        <main className="flex min-h-svh items-center justify-center bg-background px-5 py-6 text-sm text-muted-foreground sm:px-6">
          Waiting for Clerk and Convex...
        </main>
      </AuthLoading>
      <Authenticated>
        <ProjectCreateContent />
      </Authenticated>
    </>
  )
}

function ProjectCreateContent() {
  const router = useRouter()
  const createProject = useMutation(api.projects.create)
  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    projectPrompt: "",
  })

  return (
    <main className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
        <div>
          <AppBrand labelClassName="text-xs uppercase tracking-[0.3em] text-muted-foreground" />
          <p className="mt-2 text-xs tracking-[0.3em] text-muted-foreground uppercase">
            Projects / New
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            Create project
          </h1>
        </div>
        <UserButton />
      </header>

      <form
        className="grid gap-6 px-5 py-6 sm:px-6"
        onSubmit={async (event) => {
          event.preventDefault()
          const project = await createProject(form)
          router.push(`/projects/${project.slug}/scenarios?mode=edit`)
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="project-name">Project name</Label>
          <Input
            id="project-name"
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            value={form.name}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="project-slug">Slug</Label>
          <Input
            id="project-slug"
            onChange={(event) =>
              setForm((current) => ({ ...current, slug: event.target.value }))
            }
            value={form.slug}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            value={form.description}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="project-prompt">Project prompt</Label>
          <Textarea
            id="project-prompt"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                projectPrompt: event.target.value,
              }))
            }
            value={form.projectPrompt}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit">Create project</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/projects")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </main>
  )
}
