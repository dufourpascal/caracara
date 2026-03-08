import { NextResponse } from "next/server"

import { createRunResponseSchema } from "@workspace/contracts"

import {
  createRun,
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
      routeSchemas.createRunRequestSchema
    )
    const response = await createRun(token, { projectSlug, body })

    return NextResponse.json(createRunResponseSchema.parse(response))
  } catch (error) {
    return handleApiError(error)
  }
}
