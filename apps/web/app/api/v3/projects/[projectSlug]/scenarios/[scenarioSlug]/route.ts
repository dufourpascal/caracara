import { fetchQuery } from "convex/nextjs"
import { NextResponse } from "next/server"

import { singleScenarioResponseSchema } from "@workspace/contracts"

import { api } from "@/convex/_generated/api"
import {
  getProjectBySlug,
  handleApiError,
  requireCliVersion,
  requireVerifiedToken,
  ApiRouteError,
} from "@/lib/api-route"

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectSlug: string; scenarioSlug: string }>
  }
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug, scenarioSlug } = await params
    const projectResponse = await getProjectBySlug(token, projectSlug)
    const execution = await fetchQuery(
      api.scenarios.executionScenarioForProject,
      {
        projectSlug,
        scenarioSlug,
      },
      { token }
    )

    if (!execution) {
      throw new ApiRouteError(404, "not_found", "Scenario not found.")
    }

    return NextResponse.json(
      singleScenarioResponseSchema.parse({
        project: {
          id: projectResponse.project.id,
          name: projectResponse.project.name,
          slug: projectResponse.project.slug,
          projectPrompt: projectResponse.project.projectPrompt,
        },
        scenario: execution.scenario,
        fixtures: execution.fixtures,
      })
    )
  } catch (error) {
    return handleApiError(error)
  }
}
