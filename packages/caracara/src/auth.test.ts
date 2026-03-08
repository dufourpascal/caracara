import { describe, expect, it } from "vitest"

import { createPkcePair } from "./auth.js"

describe("auth helpers", () => {
  it("creates a verifier and SHA256 challenge pair", () => {
    const pair = createPkcePair()

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(pair.challenge).not.toBe(pair.verifier)
  })
})
