import { describe, expect, it, vi } from "vitest"

import { formatTokenBreakdown, formatTokenTotal } from "./project-workspace"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

describe("run token formatting", () => {
  const usage = {
    inputTokens: 12_000,
    cachedInputTokens: 8_000,
    cacheWriteInputTokens: 500,
    outputTokens: 1_234,
    reasoningOutputTokens: 300,
    complete: true,
  }

  it("shows totals and the uncached input / output breakdown", () => {
    expect(formatTokenTotal(usage)).toBe("13,234")
    expect(formatTokenBreakdown(usage)).toBe(
      "3,500 uncached in · 8,000 cached in · 1,234 out"
    )
  })

  it("marks partial usage and handles runs without usage", () => {
    expect(formatTokenTotal({ ...usage, complete: false })).toBe("13,234+")
    expect(formatTokenBreakdown({ ...usage, complete: false })).toMatch(
      /partial$/
    )
    expect(formatTokenTotal(null)).toBe("n/a")
    expect(formatTokenTotal(undefined)).toBe("n/a")
    expect(formatTokenBreakdown(null)).toBeNull()
  })
})
