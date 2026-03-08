import { NextResponse } from "next/server"

import {
  getProjectList,
  handleApiError,
  requireCliVersion,
  requireVerifiedToken,
} from "@/lib/api-route"

export async function GET(request: Request) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const response = await getProjectList(token)

    return NextResponse.json(response)
  } catch (error) {
    return handleApiError(error)
  }
}
