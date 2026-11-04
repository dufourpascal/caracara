import { NextResponse } from "next/server"

import {
  handleApiError,
  parseJsonBody,
  requireCliVersion,
  requireVerifiedToken,
  routeSchemas,
  startFixtureOperation,
} from "@/lib/api-route"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string }> }
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug } = await params
    const body = await parseJsonBody(
      request,
      routeSchemas.startFixtureOperationRequestSchema
    )

    return NextResponse.json(
      await startFixtureOperation({ token, projectSlug, body })
    )
  } catch (error) {
    return handleApiError(error)
  }
}
