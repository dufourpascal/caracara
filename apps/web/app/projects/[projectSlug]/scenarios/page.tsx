import { ProjectWorkspace } from "@/components/project-workspace"

export default async function ProjectScenariosPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string }>
  searchParams: Promise<{
    draft?: string
    mode?: string
    phase?: string
    scenario?: string
  }>
}) {
  const { projectSlug } = await params
  const { draft, mode, phase, scenario } = await searchParams

  return (
    <ProjectWorkspace
      creatingScenario={draft === "new"}
      initialScenarioPhaseFilter={phase ?? null}
      mode={mode === "graph" ? "graph" : "edit"}
      projectSlug={projectSlug}
      selectedScenarioSlug={scenario}
      workspace="scenarios"
    />
  )
}
