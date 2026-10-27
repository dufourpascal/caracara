import { useEffect, useState } from "react"

// Panel id -> width in px. Only fixed-size (navigation) panels are stored;
// the flexible detail panel takes the remaining space.
export type PanelLayout = Record<string, number>

// Layouts were stored as percentages under the bare key before the in-house
// resizable panels; they are not comparable to pixel widths, so the key is
// versioned and the old value is dropped once.
const PANEL_LAYOUT_KEY_VERSION = "px-v1"

export function getPanelLayoutStorageKey(baseKey: string) {
  return `${baseKey}:${PANEL_LAYOUT_KEY_VERSION}`
}

export function readStoredPanelLayout(
  storageKey: string,
  panelIds: string[]
): PanelLayout | undefined {
  if (typeof window === "undefined") {
    return undefined
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)

    if (!storedValue) {
      return undefined
    }

    const parsedValue: unknown = JSON.parse(storedValue)

    if (
      !parsedValue ||
      typeof parsedValue !== "object" ||
      Array.isArray(parsedValue)
    ) {
      return undefined
    }

    const nextLayout: PanelLayout = {}
    for (const panelId of panelIds) {
      const storedSize = (parsedValue as Record<string, unknown>)[panelId]
      if (
        typeof storedSize !== "number" ||
        !Number.isFinite(storedSize) ||
        storedSize <= 0
      ) {
        return undefined
      }
      nextLayout[panelId] = storedSize
    }

    return nextLayout
  } catch {
    return undefined
  }
}

export function persistPanelLayout(storageKey: string, layout: PanelLayout) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout))
  } catch {
    // Ignore storage failures and fall back to default sizes.
  }
}

function discardLegacyPanelLayout(baseKey: string) {
  try {
    window.localStorage.removeItem(baseKey)
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Restores the stored layout for `baseKey` and persists committed changes.
 * The returned `defaultLayout` follows the last committed layout, so a group
 * that remounts under the same key (for example when switching between
 * workspaces that share it) starts at the latest width.
 */
export function usePersistedPanelLayout(baseKey: string, panelIds: string[]) {
  const storageKey = getPanelLayoutStorageKey(baseKey)
  const [state, setState] = useState(() => ({
    storageKey,
    layout: readStoredPanelLayout(storageKey, panelIds),
  }))

  let current = state
  if (state.storageKey !== storageKey) {
    current = {
      storageKey,
      layout: readStoredPanelLayout(storageKey, panelIds),
    }
    setState(current)
  }

  useEffect(() => {
    discardLegacyPanelLayout(baseKey)
  }, [baseKey])

  return {
    defaultLayout: current.layout,
    onLayoutChanged: (layout: PanelLayout) => {
      persistPanelLayout(storageKey, layout)
      setState({ storageKey, layout })
    },
    storageKey,
  }
}
