"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import { Authenticated, AuthLoading, useMutation, useQuery } from "convex/react"
import { Plus, Search } from "lucide-react"
import { useState } from "react"

import { api } from "@/convex/_generated/api"
import { AppBrand } from "@/components/app-brand"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"

export function ProjectsScreen() {
  return (
    <>
      <AuthLoading>
        <main className="flex min-h-svh items-center justify-center bg-background px-5 py-6 text-sm text-muted-foreground sm:px-6">
          Waiting for Clerk and Convex...
        </main>
      </AuthLoading>
      <Authenticated>
        <ProjectsContent />
      </Authenticated>
    </>
  )
}

function ProjectsContent() {
  const projects = useQuery(api.projects.list, {})
  const createProject = useMutation(api.projects.create)
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    projectPrompt: "",
  })

  const filteredProjects =
    projects?.filter((project) => {
      const needle = search.toLowerCase()
      return (
        project.name.toLowerCase().includes(needle) ||
        project.slug.toLowerCase().includes(needle) ||
        project.description.toLowerCase().includes(needle)
      )
    }) ?? []

  return (
    <main className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
        <div>
          <AppBrand labelClassName="text-xs uppercase tracking-[0.3em] text-muted-foreground" />
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            Projects
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild variant="outline">
            <Link href="/">Overview</Link>
          </Button>
          <UserButton />
        </div>
      </header>
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1.2fr)_24rem]">
        <section className="border-b border-border px-5 py-6 sm:px-6 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
                Owned apps
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                Select a project to author scenarios, inspect runs, and use the
                CLI against the same owned workspace.
              </p>
            </div>
            <Button asChild>
              <Link href="/projects/new">
                <Plus />
                Create
              </Link>
            </Button>
          </div>

          <div className="mt-6 flex items-center gap-2 border border-border px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by name or slug"
              value={search}
            />
          </div>

          <div className="mt-6 grid gap-px border border-border bg-border">
            {projects === undefined ? (
              <div className="bg-background px-4 py-6 text-sm text-muted-foreground">
                Loading projects...
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="bg-background px-4 py-6 text-sm text-muted-foreground">
                No matching projects yet.
              </div>
            ) : (
              filteredProjects.map((project) => (
                <Link
                  key={project.id}
                  className="grid gap-2 bg-background px-4 py-4 transition-colors hover:bg-muted/30"
                  href={`/projects/${project.slug}/scenarios?mode=edit`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">
                      {project.name}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {project.slug}
                    </p>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {project.description || "No description yet."}
                  </p>
                </Link>
              ))
            )}
          </div>
        </section>

        <aside className="bg-muted/20 px-5 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
                Quick create
              </p>
              <h2 className="mt-2 text-lg font-semibold text-foreground">
                Start a new evaluation workspace
              </h2>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCreating((value) => !value)}
            >
              {isCreating ? "Hide" : "Show"}
            </Button>
          </div>

          {isCreating ? (
            <form
              className="mt-6 grid gap-4"
              onSubmit={async (event) => {
                event.preventDefault()
                const project = await createProject(form)
                router.push(`/projects/${project.slug}/scenarios?mode=edit`)
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="quick-project-name">Project name</Label>
                <Input
                  id="quick-project-name"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  value={form.name}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="quick-project-slug">Slug</Label>
                <Input
                  id="quick-project-slug"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      slug: event.target.value,
                    }))
                  }
                  value={form.slug}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="quick-project-description">Description</Label>
                <Textarea
                  id="quick-project-description"
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
                <Label htmlFor="quick-project-prompt">Project prompt</Label>
                <Textarea
                  id="quick-project-prompt"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      projectPrompt: event.target.value,
                    }))
                  }
                  value={form.projectPrompt}
                />
              </div>
              <Button type="submit">Create project</Button>
            </form>
          ) : (
            <p className="mt-6 text-sm leading-7 text-muted-foreground">
              Use the full form for a new workspace, or expand quick create when
              you already know the basic metadata.
            </p>
          )}
        </aside>
      </div>
    </main>
  )
}
