import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"

import { authTokenResponseSchema, oauthTokenRequestSchema } from "@workspace/contracts"

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function createPkcePair() {
  const verifier = toBase64Url(randomBytes(32))
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest())

  return { verifier, challenge }
}

export async function listenForOAuthCallback() {
  return await new Promise<{
    callbackUrl: string
    waitForCode: () => Promise<{ code: string; state: string }>
    close: () => Promise<void>
  }>((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a loopback callback port"))
        return
      }

      const callbackUrl = `http://127.0.0.1:${address.port}/callback`

      const waitForCode = () =>
        new Promise<{ code: string; state: string }>((resolveCode, rejectCode) => {
          server.once("request", (request, response) => {
            try {
              const url = new URL(request.url ?? "/", callbackUrl)
              const code = url.searchParams.get("code")
              const state = url.searchParams.get("state")

              if (!code || !state) {
                response.statusCode = 400
                response.end("Missing OAuth code or state.")
                rejectCode(new Error("Missing OAuth code or state"))
                return
              }

              response.statusCode = 200
              response.setHeader("content-type", "text/html; charset=utf-8")
              response.end(
                "<html><body><p>Login complete. You can close this window.</p></body></html>",
              )

              resolveCode({ code, state })
            } catch (error) {
              rejectCode(error)
            }
          })
        })

      const close = () =>
        new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) {
              rejectClose(error)
              return
            }

            resolveClose()
          })
        })

      resolve({ callbackUrl, waitForCode, close })
    })
  })
}

export async function exchangeAuthorizationCode(args: {
  apiBaseUrl: string
  clientId: string
  code: string
  codeVerifier: string
  redirectUri: string
}) {
  const payload = oauthTokenRequestSchema.parse({
    grantType: "authorization_code",
    clientId: args.clientId,
    code: args.code,
    codeVerifier: args.codeVerifier,
    redirectUri: args.redirectUri,
  })

  const response = await fetch(`${args.apiBaseUrl}/api/${"v1"}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const json = await response.json()

  if (!response.ok) {
    throw new Error(json.message ?? "Token exchange failed")
  }

  return authTokenResponseSchema.parse(json)
}
