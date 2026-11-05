import { NextResponse } from "next/server"

import {
  getFixtureList,
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

    return NextResponse.json(await getFixtureList(token, projectSlug))
  } catch (error) {
    return handleApiError(error)
  }
}
