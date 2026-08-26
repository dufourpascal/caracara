import { ProjectWorkspace } from "@/components/project-workspace"

export default async function RunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>
  searchParams: Promise<{ environment?: string }>
}) {
  const { projectSlug } = await params
  const { environment } = await searchParams

  return (
    <ProjectWorkspace
      initialRunEnvironment={environment}
      mode="edit"
      projectSlug={projectSlug}
      workspace="runs"
    />
  )
}
