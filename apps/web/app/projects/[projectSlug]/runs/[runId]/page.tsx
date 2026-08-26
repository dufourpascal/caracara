import { ProjectWorkspace } from "@/components/project-workspace"

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; runId: string }>
  searchParams: Promise<{ environment?: string; scenario?: string }>
}) {
  const { projectSlug, runId } = await params
  const { environment, scenario } = await searchParams

  return (
    <ProjectWorkspace
      initialRunEnvironment={environment}
      mode="edit"
      projectSlug={projectSlug}
      selectedRunId={runId}
      selectedRunScenarioSlug={scenario}
      workspace="runs"
    />
  )
}
