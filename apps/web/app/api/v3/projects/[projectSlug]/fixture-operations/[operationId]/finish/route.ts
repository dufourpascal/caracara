import { NextResponse } from "next/server"

import {
  finishFixtureOperation,
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
    params: Promise<{ projectSlug: string; operationId: string }>
  }
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug, operationId } = await params
    const body = await parseJsonBody(
      request,
      routeSchemas.finishFixtureOperationRequestSchema
    )

    return NextResponse.json(
      await finishFixtureOperation({ token, projectSlug, operationId, body })
    )
  } catch (error) {
    return handleApiError(error)
  }
}
