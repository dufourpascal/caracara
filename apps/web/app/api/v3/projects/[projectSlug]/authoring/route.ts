import { NextResponse } from "next/server"

import { authoringResponseSchema } from "@workspace/contracts"

import {
  authorProject,
  handleApiError,
  parseJsonBody,
  requireCliVersion,
  requireVerifiedToken,
  routeSchemas,
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
      routeSchemas.authoringRequestSchema
    )
    const response = await authorProject({ token, projectSlug, body })

    return NextResponse.json(authoringResponseSchema.parse(response))
  } catch (error) {
    return handleApiError(error)
  }
}
