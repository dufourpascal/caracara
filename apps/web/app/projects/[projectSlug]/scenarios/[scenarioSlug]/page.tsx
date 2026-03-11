import { redirect } from "next/navigation"

export default async function ScenarioDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; scenarioSlug: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { projectSlug, scenarioSlug } = await params
  const { mode } = await searchParams

  const nextMode = mode === "graph" ? "graph" : "edit"
  const nextSearchParams = new URLSearchParams({ mode: nextMode })

  if (nextMode === "edit") {
    nextSearchParams.set("scenario", scenarioSlug)
  }

  redirect(`/projects/${projectSlug}/scenarios?${nextSearchParams.toString()}`)
}
