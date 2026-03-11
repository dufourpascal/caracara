import { createHash, randomBytes } from "node:crypto"

import { OAUTH_CODE_TTL_MS } from "@workspace/contracts"

type AuthorizationCodeRecord = {
  clientId: string
  codeChallenge: string
  redirectUri: string
  sessionId: string
  userId: string
  expiresAt: number
  used: boolean
}

const authorizationCodes = new Map<string, AuthorizationCodeRecord>()

function cleanupExpiredCodes() {
  const now = Date.now()

  for (const [code, record] of authorizationCodes) {
    if (record.expiresAt <= now || record.used) {
      authorizationCodes.delete(code)
    }
  }
}

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function isLoopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
}

function normalizeLoopbackPathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1)
  }

  return pathname
}

function loopbackRedirectUrisMatch(recordRedirectUri: string, inputRedirectUri: string) {
  if (recordRedirectUri === inputRedirectUri) {
    return true
  }

  try {
    const recordUrl = new URL(recordRedirectUri)
    const inputUrl = new URL(inputRedirectUri)

    if (
      !isLoopbackHostname(recordUrl.hostname) ||
      !isLoopbackHostname(inputUrl.hostname)
    ) {
      return false
    }

    return (
      recordUrl.protocol === inputUrl.protocol &&
      recordUrl.port === inputUrl.port &&
      normalizeLoopbackPathname(recordUrl.pathname) ===
        normalizeLoopbackPathname(inputUrl.pathname) &&
      recordUrl.search === inputUrl.search
    )
  } catch {
    return false
  }
}

export function issueAuthorizationCode(input: {
  clientId: string
  codeChallenge: string
  redirectUri: string
  sessionId: string
  userId: string
}) {
  cleanupExpiredCodes()

  const code = toBase64Url(randomBytes(32))
  authorizationCodes.set(code, {
    ...input,
    expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
    used: false,
  })

  return code
}

export function consumeAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
}) {
  cleanupExpiredCodes()
  const record = authorizationCodes.get(input.code)

  if (!record) {
    throw new Error("Invalid or expired authorization code")
  }

  if (record.used) {
    throw new Error("Authorization code has already been used")
  }

  if (
    record.clientId !== input.clientId ||
    !loopbackRedirectUrisMatch(record.redirectUri, input.redirectUri)
  ) {
    throw new Error(
      "Authorization code does not match the client or redirect URI"
    )
  }

  const challenge = toBase64Url(
    createHash("sha256").update(input.codeVerifier).digest()
  )
  if (challenge !== record.codeChallenge) {
    throw new Error("Invalid PKCE code verifier")
  }

  record.used = true

  return record
}
