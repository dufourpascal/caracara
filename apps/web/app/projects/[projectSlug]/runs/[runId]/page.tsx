import { ProjectWorkspace } from "@/components/project-workspace"

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; runId: string }>
  searchParams: Promise<{ scenario?: string }>
}) {
  const { projectSlug, runId } = await params
  const { scenario } = await searchParams

  return (
    <ProjectWorkspace
      mode="edit"
      projectSlug={projectSlug}
      selectedRunId={runId}
      selectedRunScenarioSlug={scenario}
      workspace="runs"
    />
  )
}
