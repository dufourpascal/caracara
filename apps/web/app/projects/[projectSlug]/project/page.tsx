import { ProjectWorkspace } from "@/components/project-workspace"

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>
}) {
  const { projectSlug } = await params

  return (
    <ProjectWorkspace
      mode="edit"
      projectSlug={projectSlug}
      workspace="project"
    />
  )
}
