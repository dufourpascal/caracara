"use client"

import { useRouter } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import { Authenticated, AuthLoading, useMutation } from "convex/react"

import { api } from "@/convex/_generated/api"
import { AppBrand } from "@/components/app-brand"
import { ProjectCreateForm } from "@/components/project-create-form"
import { Button } from "@workspace/ui/components/button"

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

      <ProjectCreateForm
        className="w-full max-w-3xl px-5 py-6 sm:px-6"
        onCreate={async (form) => {
          const project = await createProject(form)
          router.push(`/projects/${project.slug}/scenarios?mode=edit`)
        }}
        secondaryAction={
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/projects")}
          >
            Cancel
          </Button>
        }
      />
    </main>
  )
}
