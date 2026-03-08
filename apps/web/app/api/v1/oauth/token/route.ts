import { createClerkClient } from "@clerk/backend"
import { NextResponse } from "next/server"

import {
  authTokenResponseSchema,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
} from "@workspace/contracts"

import { handleApiError, routeSchemas, ApiRouteError } from "@/lib/api-route"
import { consumeAuthorizationCode } from "@/lib/oauth-store"

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
})

export async function POST(request: Request) {
  try {
    const payload = routeSchemas.oauthTokenRequestSchema.parse(await request.json())
    const authorizationCode = consumeAuthorizationCode({
      code: payload.code,
      clientId: payload.clientId,
      redirectUri: payload.redirectUri,
      codeVerifier: payload.codeVerifier,
    })
    const token = await clerk.sessions.getToken(
      authorizationCode.sessionId,
      undefined,
      OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    )

    return NextResponse.json(
      authTokenResponseSchema.parse({
        accessToken: token.jwt,
        tokenType: "Bearer",
        expiresAt: Date.now() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
      }),
    )
  } catch (error) {
    if (error instanceof Error) {
      return handleApiError(
        new ApiRouteError(400, "validation_error", error.message),
      )
    }

    return handleApiError(error)
  }
}
