import { ProjectWorkspace } from "@/components/project-workspace"

export default async function ProjectScenariosPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { projectSlug } = await params
  const { mode } = await searchParams

  return (
    <ProjectWorkspace
      mode={mode === "graph" ? "graph" : "edit"}
      projectSlug={projectSlug}
      workspace="scenarios"
    />
  )
}
