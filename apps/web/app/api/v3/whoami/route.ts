import { NextResponse } from "next/server"

import {
  getViewer,
  handleApiError,
  requireCliVersion,
  requireVerifiedToken,
} from "@/lib/api-route"

export async function GET(request: Request) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const viewer = await getViewer(token)

    return NextResponse.json(viewer)
  } catch (error) {
    return handleApiError(error)
  }
}
