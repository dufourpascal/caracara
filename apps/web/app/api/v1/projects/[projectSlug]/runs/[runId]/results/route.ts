import { NextResponse } from "next/server"

import { submitScenarioResultResponseSchema } from "@workspace/contracts"

import {
  handleApiError,
  parseJsonBody,
  requireCliVersion,
  requireVerifiedToken,
  routeSchemas,
  submitScenarioResult,
} from "@/lib/api-route"

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectSlug: string; runId: string }>
  },
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug, runId } = await params
    const body = await parseJsonBody(request, routeSchemas.submitScenarioResultRequestSchema)
    const response = await submitScenarioResult({
      token,
      projectSlug,
      runId,
      body,
    })

    return NextResponse.json(submitScenarioResultResponseSchema.parse(response))
  } catch (error) {
    return handleApiError(error)
  }
}
