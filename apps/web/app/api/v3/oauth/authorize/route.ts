import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

import { routeSchemas } from "@/lib/api-route"
import { issueAuthorizationCode } from "@/lib/oauth-store"

export async function GET(request: Request) {
  const { userId, sessionId, redirectToSignIn } = await auth()
  const url = new URL(request.url)

  const input = routeSchemas.oauthAuthorizeRequestSchema.parse({
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    state: url.searchParams.get("state"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
  })

  if (!userId || !sessionId) {
    return redirectToSignIn({ returnBackUrl: request.url })
  }

  const code = issueAuthorizationCode({
    clientId: input.clientId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    sessionId,
    userId,
  })
  const redirectUrl = new URL(input.redirectUri)
  redirectUrl.searchParams.set("code", code)
  redirectUrl.searchParams.set("state", input.state)

  return NextResponse.redirect(redirectUrl)
}
