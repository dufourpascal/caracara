import { auth } from "@clerk/nextjs/server"
import { fetchQuery } from "convex/nextjs"

import { api } from "@/convex/_generated/api"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  const { userId, getToken } = await auth()
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const token = await getToken({ template: "convex" })
  if (!token) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { artifactId } = await params
  let evidence
  try {
    evidence = await fetchQuery(
      api.runEvidence.getForServing,
      { evidenceId: artifactId as never },
      { token }
    )
  } catch {
    return new Response("Not found", { status: 404 })
  }
  if (!evidence) {
    return new Response("Not found", { status: 404 })
  }

  const stored = await fetch(evidence.url, { cache: "no-store" })
  if (!stored.ok || !stored.body) {
    return new Response("Not found", { status: 404 })
  }

  return new Response(stored.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-length": String(evidence.byteSize),
      "content-type": evidence.contentType,
      "x-content-type-options": "nosniff",
    },
  })
}
