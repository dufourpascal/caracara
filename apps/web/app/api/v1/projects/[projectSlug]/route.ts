import { NextResponse } from "next/server"

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
    const response = await getProjectBySlug(token, projectSlug)

    return NextResponse.json(response)
  } catch (error) {
    return handleApiError(error)
  }
}
