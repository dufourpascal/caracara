import { NextResponse } from "next/server"

import {
  getProjectList,
  handleApiError,
  requireLegacyCliVersion,
  requireVerifiedToken,
} from "@/lib/api-route"

export async function GET(request: Request) {
  try {
    requireLegacyCliVersion(request)
    const token = await requireVerifiedToken(request)
    const response = await getProjectList(token)

    return NextResponse.json(response)
  } catch (error) {
    return handleApiError(error)
  }
}
