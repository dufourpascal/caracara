import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { consumeAuthorizationCode, issueAuthorizationCode } from "./oauth-store"

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

describe("oauth-store", () => {
  it("accepts loopback redirect aliases for native CLI callbacks", () => {
    const codeVerifier = "abcabcabcabcabcabcabcabcabcabcabcabcabcabcabc"
    const codeChallenge = toBase64Url(
      createHash("sha256").update(codeVerifier).digest(),
    )

    const code = issueAuthorizationCode({
      clientId: "caracara-cli",
      codeChallenge,
      redirectUri: "http://127.0.0.1:4567/callback",
      sessionId: "sess_123",
      userId: "user_123",
    })

    expect(
      consumeAuthorizationCode({
        code,
        clientId: "caracara-cli",
        redirectUri: "http://localhost:4567/callback/",
        codeVerifier,
      }),
    ).toMatchObject({
      clientId: "caracara-cli",
      redirectUri: "http://127.0.0.1:4567/callback",
      sessionId: "sess_123",
      userId: "user_123",
    })
  })

  it("still rejects non-matching loopback ports", () => {
    const codeVerifier = "abcabcabcabcabcabcabcabcabcabcabcabcabcabcabc"
    const codeChallenge = toBase64Url(
      createHash("sha256").update(codeVerifier).digest(),
    )

    const code = issueAuthorizationCode({
      clientId: "caracara-cli",
      codeChallenge,
      redirectUri: "http://127.0.0.1:4567/callback",
      sessionId: "sess_123",
      userId: "user_123",
    })

    expect(() =>
      consumeAuthorizationCode({
        code,
        clientId: "caracara-cli",
        redirectUri: "http://localhost:9999/callback",
        codeVerifier,
      }),
    ).toThrow("Authorization code does not match the client or redirect URI")
  })
})
