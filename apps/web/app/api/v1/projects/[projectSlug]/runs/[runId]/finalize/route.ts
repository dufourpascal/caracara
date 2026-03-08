import { NextResponse } from "next/server"

import { finalizeRunResponseSchema } from "@workspace/contracts"

import {
  finalizeRun,
  handleApiError,
  parseJsonBody,
  requireCliVersion,
  requireVerifiedToken,
  routeSchemas,
} from "@/lib/api-route"

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectSlug: string; runId: string }>
  }
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug, runId } = await params
    const body = await parseJsonBody(request, routeSchemas.finalizeRunRequestSchema)
    const response = await finalizeRun({
      token,
      projectSlug,
      runId,
      body,
    })

    return NextResponse.json(finalizeRunResponseSchema.parse(response))
  } catch (error) {
    return handleApiError(error)
  }
}
