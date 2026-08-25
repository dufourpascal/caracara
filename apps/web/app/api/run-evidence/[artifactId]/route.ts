import { auth } from "@clerk/nextjs/server"

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
  const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  const siteUrl =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    (deploymentUrl?.endsWith(".convex.cloud")
      ? deploymentUrl.replace(/\.convex\.cloud$/, ".convex.site")
      : null)
  if (!siteUrl) {
    return new Response("Not found", { status: 404 })
  }
  const stored = await fetch(
    `${siteUrl.replace(/\/$/, "")}/run-evidence/${encodeURIComponent(artifactId)}`,
    {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    }
  )
  if (!stored.ok || !stored.body) {
    return new Response("Not found", { status: 404 })
  }

  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": stored.headers.get("content-type") ?? "image/webp",
    "x-content-type-options": "nosniff",
  })
  const contentLength = stored.headers.get("content-length")
  if (contentLength) {
    headers.set("content-length", contentLength)
  }

  return new Response(stored.body, {
    headers,
  })
}
