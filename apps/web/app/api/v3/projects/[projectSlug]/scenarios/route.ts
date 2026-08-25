import { fetchQuery } from "convex/nextjs"
import { NextResponse } from "next/server"

import { executionPlanResponseSchema } from "@workspace/contracts"

import { api } from "@/convex/_generated/api"
import {
  getProjectBySlug,
  handleApiError,
  requireCliVersion,
  requireVerifiedToken,
} from "@/lib/api-route"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug } = await params
    const [projectResponse, scenariosResponse] = await Promise.all([
      getProjectBySlug(token, projectSlug),
      fetchQuery(
        api.scenarios.executionPlanForProject,
        { projectSlug },
        { token }
      ),
    ])

    return NextResponse.json(
      executionPlanResponseSchema.parse({
        project: {
          id: projectResponse.project.id,
          name: projectResponse.project.name,
          slug: projectResponse.project.slug,
          projectPrompt: projectResponse.project.projectPrompt,
        },
        phases: scenariosResponse.phases,
        unassignedScenarioCount: scenariosResponse.unassignedScenarioCount,
      })
    )
  } catch (error) {
    return handleApiError(error)
  }
}
