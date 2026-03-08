import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchProjects } from "./api.js"

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
      })),
    )

    await expect(
      fetchProjects("https://example.com", "token", "0.1.0"),
    ).rejects.toThrowError(
      /internal_error: Unexpected server error\.\n\{\n  "reason": "Database insert failed"\n\}/,
    )
  })
})
