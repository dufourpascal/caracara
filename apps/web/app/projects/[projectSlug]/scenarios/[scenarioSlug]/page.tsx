import { ProjectWorkspace } from "@/components/project-workspace"

export default async function ScenarioDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; scenarioSlug: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { projectSlug, scenarioSlug } = await params
  const { mode } = await searchParams

  return (
    <ProjectWorkspace
      mode={mode === "graph" ? "graph" : "edit"}
      projectSlug={projectSlug}
      selectedScenarioSlug={scenarioSlug}
      workspace="scenarios"
    />
  )
}
