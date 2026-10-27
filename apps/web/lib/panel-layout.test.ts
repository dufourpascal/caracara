// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  getPanelLayoutStorageKey,
  readStoredPanelLayout,
  usePersistedPanelLayout,
} from "./panel-layout"

afterEach(() => {
  window.localStorage.clear()
})

describe("readStoredPanelLayout", () => {
  it("restores only complete pixel layouts", () => {
    window.localStorage.setItem(
      "complete",
      JSON.stringify({ list: 340, other: "ignored" })
    )
    window.localStorage.setItem("incomplete", JSON.stringify({ detail: 600 }))

    expect(readStoredPanelLayout("complete", ["list"])).toEqual({ list: 340 })
    expect(readStoredPanelLayout("incomplete", ["list"])).toBeUndefined()
    expect(readStoredPanelLayout("missing", ["list"])).toBeUndefined()
  })

  it("rejects malformed layouts", () => {
    const malformed = [
      "not json",
      "null",
      "[320]",
      "320",
      JSON.stringify({ list: "320" }),
      JSON.stringify({ list: 0 }),
      JSON.stringify({ list: -12 }),
      // JSON has no Infinity; an overflowing literal parses to it.
      '{"list": 1e999}',
    ]

    for (const value of malformed) {
      window.localStorage.setItem("layout", value)
      expect(readStoredPanelLayout("layout", ["list"]), value).toBeUndefined()
    }
  })
})

describe("usePersistedPanelLayout", () => {
  it("ignores and drops percentage layouts from the unversioned key", () => {
    window.localStorage.setItem("workspace", JSON.stringify({ list: 25 }))

    const { result } = renderHook(() =>
      usePersistedPanelLayout("workspace", ["list"])
    )

    expect(result.current.defaultLayout).toBeUndefined()
    expect(result.current.storageKey).toBe(
      getPanelLayoutStorageKey("workspace")
    )
    expect(window.localStorage.getItem("workspace")).toBeNull()
  })

  it("persists committed layouts under the versioned key", () => {
    const { result, unmount } = renderHook(() =>
      usePersistedPanelLayout("workspace", ["list"])
    )

    act(() => result.current.onLayoutChanged({ list: 380 }))

    expect(result.current.defaultLayout).toEqual({ list: 380 })
    expect(
      JSON.parse(
        window.localStorage.getItem(getPanelLayoutStorageKey("workspace"))!
      )
    ).toEqual({ list: 380 })

    unmount()
    const remounted = renderHook(() =>
      usePersistedPanelLayout("workspace", ["list"])
    )
    expect(remounted.result.current.defaultLayout).toEqual({ list: 380 })
  })

  it("re-reads storage when the key changes", () => {
    window.localStorage.setItem(
      getPanelLayoutStorageKey("project-a"),
      JSON.stringify({ list: 300 })
    )
    window.localStorage.setItem(
      getPanelLayoutStorageKey("project-b"),
      JSON.stringify({ list: 400 })
    )

    const { result, rerender } = renderHook(
      ({ baseKey }) => usePersistedPanelLayout(baseKey, ["list"]),
      { initialProps: { baseKey: "project-a" } }
    )
    expect(result.current.defaultLayout).toEqual({ list: 300 })

    rerender({ baseKey: "project-b" })
    expect(result.current.defaultLayout).toEqual({ list: 400 })
  })
})
