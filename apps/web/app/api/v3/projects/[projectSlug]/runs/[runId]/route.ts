import { NextResponse } from "next/server"

import { runResultsResponseSchema } from "@workspace/contracts"

import {
  getRunResults,
  handleApiError,
  requireCliVersion,
  requireVerifiedToken,
} from "@/lib/api-route"

// `runId` is a run reference: a run ID, an exact run name, or "latest".
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectSlug: string; runId: string }>
  }
) {
  try {
    requireCliVersion(request)
    const token = await requireVerifiedToken(request)
    const { projectSlug, runId } = await params
    const environment =
      new URL(request.url).searchParams.get("environment") ?? undefined
    const response = await getRunResults({
      token,
      projectSlug,
      runRef: runId,
      environment,
    })

    return NextResponse.json(runResultsResponseSchema.parse(response))
  } catch (error) {
    return handleApiError(error)
  }
}
