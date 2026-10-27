import { describe, expect, it } from "vitest"

import {
  clampZoom,
  computeFitTransform,
  getWheelZoomFactor,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomAroundPoint,
} from "./use-pan-zoom"

describe("clampZoom", () => {
  it("keeps zoom within the allowed range", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(3)).toBe(MAX_ZOOM)
    expect(clampZoom(1)).toBe(1)
  })
})

describe("computeFitTransform", () => {
  it("scales the content to fit with padding and centers it", () => {
    const transform = computeFitTransform(
      { x: 0, y: 0, width: 1000, height: 500 },
      { width: 1180, height: 1000 },
      0.18
    )

    expect(transform.k).toBeCloseTo(1)
    expect(transform.x).toBeCloseTo(90)
    expect(transform.y).toBeCloseTo(250)
  })

  it("centers content that does not start at the origin", () => {
    const transform = computeFitTransform(
      { x: 100, y: 200, width: 200, height: 100 },
      { width: 236, height: 500 },
      0.18
    )

    expect(transform.k).toBeCloseTo(1)
    expect(transform.x + (100 + 100) * transform.k).toBeCloseTo(118)
    expect(transform.y + (200 + 50) * transform.k).toBeCloseTo(250)
  })

  it("clamps the fitted zoom", () => {
    expect(
      computeFitTransform(
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 2000, height: 2000 }
      ).k
    ).toBe(MAX_ZOOM)
    expect(
      computeFitTransform(
        { x: 0, y: 0, width: 10000, height: 10000 },
        { width: 200, height: 200 }
      ).k
    ).toBe(MIN_ZOOM)
  })

  it("returns the identity transform without bounds or a measured viewport", () => {
    expect(computeFitTransform(null, { width: 100, height: 100 })).toEqual({
      x: 0,
      y: 0,
      k: 1,
    })
    expect(
      computeFitTransform({ x: 0, y: 0, width: 10, height: 10 }, null)
    ).toEqual({ x: 0, y: 0, k: 1 })
  })
})

describe("zoomAroundPoint", () => {
  it("keeps the content under the anchor fixed", () => {
    const before = { x: 40, y: -20, k: 0.8 }
    const anchor = { x: 300, y: 150 }
    const after = zoomAroundPoint(before, 1.2, anchor)
    const contentBefore = {
      x: (anchor.x - before.x) / before.k,
      y: (anchor.y - before.y) / before.k,
    }

    expect(after.k).toBe(1.2)
    expect(after.x + contentBefore.x * after.k).toBeCloseTo(anchor.x)
    expect(after.y + contentBefore.y * after.k).toBeCloseTo(anchor.y)
  })

  it("clamps the zoom and leaves the transform unchanged at the limit", () => {
    const atMax = { x: 10, y: 10, k: MAX_ZOOM }

    expect(zoomAroundPoint(atMax, 5, { x: 0, y: 0 })).toBe(atMax)
    expect(zoomAroundPoint({ x: 0, y: 0, k: 1 }, 0.01, { x: 0, y: 0 }).k).toBe(
      MIN_ZOOM
    )
  })
})

describe("getWheelZoomFactor", () => {
  const wheel = { deltaMode: 0, ctrlKey: false, metaKey: false }

  it("zooms in on upward scroll and out on downward scroll", () => {
    expect(getWheelZoomFactor({ ...wheel, deltaY: -100 })).toBeCloseTo(2 ** 0.2)
    expect(getWheelZoomFactor({ ...wheel, deltaY: 100 })).toBeCloseTo(2 ** -0.2)
  })

  it("treats ctrl and meta wheel events as faster pinch zoom", () => {
    expect(
      getWheelZoomFactor({ ...wheel, ctrlKey: true, deltaY: -10 })
    ).toBeCloseTo(2 ** 0.2)
    expect(
      getWheelZoomFactor({ ...wheel, metaKey: true, deltaY: 10 })
    ).toBeCloseTo(2 ** -0.2)
  })
})
