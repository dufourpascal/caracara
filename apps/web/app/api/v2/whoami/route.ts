import { NextResponse } from "next/server"

import {
  getViewer,
  handleApiError,
  requireLegacyCliVersion,
  requireVerifiedToken,
} from "@/lib/api-route"

export async function GET(request: Request) {
  try {
    requireLegacyCliVersion(request)
    const token = await requireVerifiedToken(request)
    const viewer = await getViewer(token)

    return NextResponse.json(viewer)
  } catch (error) {
    return handleApiError(error)
  }
}
