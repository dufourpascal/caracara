import { NextRequest, NextResponse } from "next/server"

import { startScenarioExecutionResponseSchema } from "@workspace/contracts"

import {
  handleApiError,
  parseJsonBody,
  requireCliVersion,
  requireVerifiedToken,
  routeSchemas,
  startScenarioExecution,
} from "@/lib/api-route"

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<unknown>
  }
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug, runId } = (await params) as {
      projectSlug: string
      runId: string
    }
    const body = await parseJsonBody(
      request,
      routeSchemas.startScenarioExecutionRequestSchema
    )
    const response = await startScenarioExecution({
      token,
      projectSlug,
      runId,
      body,
    })

    return NextResponse.json(
      startScenarioExecutionResponseSchema.parse(response)
    )
  } catch (error) {
    return handleApiError(error)
  }
}
