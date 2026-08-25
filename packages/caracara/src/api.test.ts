import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchProjects, uploadRunEvidence } from "./api.js"

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("includes structured API error details in thrown messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({
          code: "internal_error",
          message: "Unexpected server error.",
          details: {
            reason: "Database insert failed",
          },
        }),
      }))
    )

    await expect(
      fetchProjects("https://example.com", "token", "0.2.0")
    ).rejects.toThrowError(
      /internal_error: Unexpected server error\.\n\{\n {2}"reason": "Database insert failed"\n\}/
    )
  })

  it("uploads WebP evidence with its run identity and digest", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        evidence: {
          id: "evidence-1",
          checkId: "00000000-0000-4000-8000-000000000001",
          contentType: "image/webp",
          byteSize: 12,
          sha256: "a".repeat(64),
        },
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    const bytes = Buffer.from("RIFF0000WEBP", "ascii")

    await uploadRunEvidence({
      uploadUrl: "https://example.convex.site/run-evidence",
      accessToken: "token",
      runId: "run-1",
      scenarioResultId: "result-1",
      checkId: "00000000-0000-4000-8000-000000000001",
      sha256: "a".repeat(64),
      bytes,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.convex.site/run-evidence",
      expect.objectContaining({
        method: "POST",
        body: bytes,
        headers: expect.objectContaining({
          authorization: "Bearer token",
          "content-type": "image/webp",
          "x-caracara-run-id": "run-1",
          "x-caracara-result-id": "result-1",
          "x-caracara-byte-size": "12",
        }),
      })
    )
  })
})
