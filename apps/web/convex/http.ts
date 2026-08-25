import { httpRouter } from "convex/server"

import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"

const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function errorResponse(error: unknown) {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error as { data?: unknown }).data
      : null
  if (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    "message" in data &&
    typeof data.code === "string" &&
    typeof data.message === "string"
  ) {
    const status =
      data.code === "unauthenticated"
        ? 401
        : data.code === "unauthorized"
          ? 403
          : data.code === "not_found"
            ? 404
            : data.code === "conflict"
              ? 409
              : 400
    return json({ code: data.code, message: data.message }, status)
  }

  console.error("Run evidence upload failed", error)
  return json(
    { code: "internal_error", message: "Evidence upload failed." },
    500
  )
}

function hasWebpSignature(bytes: Uint8Array) {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

const uploadRunEvidence = httpAction(async (ctx, request) => {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    return json(
      { code: "unauthenticated", message: "Invalid bearer token." },
      401
    )
  }

  const runId = request.headers.get("x-caracara-run-id")
  const scenarioResultId = request.headers.get("x-caracara-result-id")
  const checkId = request.headers.get("x-caracara-check-id")
  const expectedByteSize = Number(request.headers.get("x-caracara-byte-size"))
  const expectedSha256 = request.headers.get("x-caracara-sha256")
  if (
    !runId ||
    !scenarioResultId ||
    !checkId ||
    !expectedSha256 ||
    !Number.isSafeInteger(expectedByteSize)
  ) {
    return json(
      { code: "validation_error", message: "Missing evidence headers." },
      400
    )
  }
  if (request.headers.get("content-type") !== "image/webp") {
    return json(
      { code: "validation_error", message: "Evidence must be WebP." },
      400
    )
  }

  const buffer = await request.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_SCREENSHOT_BYTES ||
    bytes.byteLength !== expectedByteSize ||
    !hasWebpSignature(bytes)
  ) {
    return json(
      { code: "validation_error", message: "Invalid WebP evidence." },
      400
    )
  }

  const sha256 = await sha256Hex(buffer)
  if (sha256 !== expectedSha256) {
    return json(
      { code: "validation_error", message: "Evidence digest mismatch." },
      400
    )
  }

  const target = {
    ownerUserId: identity.subject,
    runId: runId as never,
    scenarioResultId: scenarioResultId as never,
    checkId,
    byteSize: bytes.byteLength,
    sha256,
  }

  try {
    const existing = await ctx.runQuery(
      internal.runEvidence.validateUpload,
      target
    )
    if (existing) {
      return json({ evidence: existing }, 200)
    }

    const storageId = await ctx.storage.store(
      new Blob([buffer], { type: "image/webp" })
    )
    try {
      const attached = await ctx.runMutation(internal.runEvidence.attach, {
        ...target,
        storageId,
      })
      if (attached.replacedStorageId) {
        await ctx.storage.delete(attached.replacedStorageId)
      }
      return json({ evidence: attached.evidence }, 200)
    } catch (error) {
      await ctx.storage.delete(storageId)
      throw error
    }
  } catch (error) {
    return errorResponse(error)
  }
})

const http = httpRouter()
http.route({
  path: "/run-evidence",
  method: "POST",
  handler: uploadRunEvidence,
})

export default http
