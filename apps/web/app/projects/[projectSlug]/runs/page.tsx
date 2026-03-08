import { ProjectWorkspace } from "@/components/project-workspace"

export default async function RunsPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>
}) {
  const { projectSlug } = await params

  return (
    <ProjectWorkspace mode="edit" projectSlug={projectSlug} workspace="runs" />
  )
}
