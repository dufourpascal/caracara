"use client"

import { useSyncExternalStore, useState } from "react"
import { useTheme } from "next-themes"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { SortableList } from "@workspace/ui/components/sortable-list"
import { cn } from "@workspace/ui/lib/utils"
import { usePersistedPanelLayout } from "@/lib/panel-layout"

const STORAGE_PREFIX = "dev-workspace-fixture"
const ORDER_STORAGE_KEY = `${STORAGE_PREFIX}:phase-order`
const LIST_PANEL_ID = `${STORAGE_PREFIX}:list`
const SUMMARY_PANEL_ID = `${STORAGE_PREFIX}:summary`
const REORDER_DELAY_MS = 400

type FixturePhase = {
  id: string
  name: string
  scenarioCount: number
}

const DEFAULT_PHASES: FixturePhase[] = [
  { id: "phase-setup", name: "Setup", scenarioCount: 3 },
  { id: "phase-auth", name: "Authentication", scenarioCount: 5 },
  { id: "phase-checkout", name: "Checkout", scenarioCount: 8 },
  { id: "phase-teardown", name: "Teardown", scenarioCount: 2 },
]

const FILLER_ROWS = Array.from({ length: 40 }, (_, index) => index + 1)

function readStoredPhases() {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(ORDER_STORAGE_KEY) ?? "null"
    ) as unknown
    if (
      Array.isArray(stored) &&
      stored.length === DEFAULT_PHASES.length &&
      DEFAULT_PHASES.every((phase) => stored.includes(phase.id))
    ) {
      return stored.map((id) =>
        DEFAULT_PHASES.find((phase) => phase.id === id)!
      )
    }
  } catch {
    // Fall through to the default order.
  }
  return DEFAULT_PHASES
}

const subscribeNoop = () => () => {}

export function WorkspaceFixture() {
  // localStorage is only readable on the client; render the fixture after
  // hydration so the stored widths and order do not cause a mismatch.
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  )

  if (!isClient) {
    return (
      <main className="p-6 text-sm text-muted-foreground">
        Loading fixture...
      </main>
    )
  }

  return <WorkspaceFixtureContent />
}

function WorkspaceFixtureContent() {
  const { resolvedTheme, setTheme } = useTheme()
  const [phases, setPhases] = useState(readStoredPhases)
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null)
  const [failNextReorder, setFailNextReorder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const listLayout = usePersistedPanelLayout(`${STORAGE_PREFIX}:layout`, [
    LIST_PANEL_ID,
  ])
  const detailLayout = usePersistedPanelLayout(
    `${STORAGE_PREFIX}:detail-layout`,
    [SUMMARY_PANEL_ID]
  )

  function logEvent(message: string) {
    setEvents((current) =>
      [`${new Date().toLocaleTimeString()} ${message}`, ...current].slice(0, 20)
    )
  }

  async function reorderPhases(items: FixturePhase[]) {
    const order = items.map((item) => item.name).join(", ")
    logEvent(`onReorder called: ${order}`)
    setError(null)
    // Mirrors the workspace: the mutation is async and its errors are caught
    // and shown, leaving the server order unchanged.
    await new Promise((resolve) => setTimeout(resolve, REORDER_DELAY_MS))
    if (failNextReorder) {
      setFailNextReorder(false)
      setError("Simulated reorder failure. The previous order is kept.")
      logEvent("reorder failed")
      return
    }
    window.localStorage.setItem(
      ORDER_STORAGE_KEY,
      JSON.stringify(items.map((item) => item.id))
    )
    setPhases(items)
    logEvent("reorder saved")
  }

  function resetStorage() {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) {
        window.localStorage.removeItem(key)
      }
    }
    window.location.reload()
  }

  return (
    <main className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          Workspace layout fixture
        </p>
        <Badge variant="outline">development only</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={failNextReorder}
              id="fail-next-reorder"
              onCheckedChange={(checked) =>
                setFailNextReorder(checked === true)
              }
            />
            <Label htmlFor="fail-next-reorder">Fail next reorder</Label>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
          </Button>
          <Button size="sm" variant="outline" onClick={resetStorage}>
            Reset stored widths and order
          </Button>
        </div>
      </header>

      <ResizablePanelGroup
        className="min-h-0 flex-1 overflow-hidden"
        defaultLayout={listLayout.defaultLayout}
        onLayoutChanged={(layout) => {
          logEvent(`primary layout committed: ${JSON.stringify(layout)}`)
          listLayout.onLayoutChanged(layout)
        }}
        orientation="horizontal"
      >
        <ResizablePanel
          defaultSize="320px"
          id={LIST_PANEL_ID}
          maxSize="420px"
          minSize="260px"
        >
          <div className="flex h-full flex-col border-r border-border">
            <div className="border-b border-border bg-muted/10 px-4 py-4">
              <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                Phase registry
              </p>
              {error ? (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex-1 overflow-auto px-3 py-3">
              <SortableList
                items={phases}
                onReorder={reorderPhases}
                renderItem={({ dragHandle, isDragging, item }) => (
                  <div
                    aria-pressed={item.id === selectedPhaseId}
                    className={cn(
                      "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border border-border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      item.id === selectedPhaseId
                        ? "bg-muted/40"
                        : "bg-background hover:bg-muted/20",
                      isDragging && "opacity-80"
                    )}
                    onClick={() => {
                      setSelectedPhaseId(item.id)
                      logEvent(`row clicked: ${item.name}`)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setSelectedPhaseId(item.id)
                        logEvent(`row activated: ${item.name}`)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {dragHandle}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        Phase {phases.indexOf(item) + 1}
                      </span>
                    </span>
                    <Badge className="font-mono" variant="outline">
                      {item.scenarioCount}
                    </Badge>
                  </div>
                )}
              />
              <div className="mt-6 grid gap-2">
                {FILLER_ROWS.map((row) => (
                  <div
                    className="border border-border px-3 py-2 text-sm text-muted-foreground"
                    key={row}
                  >
                    Filler scenario {row}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel id={`${STORAGE_PREFIX}:detail`}>
          <ResizablePanelGroup
            className="h-full min-h-0 overflow-hidden"
            defaultLayout={detailLayout.defaultLayout}
            onLayoutChanged={(layout) => {
              logEvent(`nested layout committed: ${JSON.stringify(layout)}`)
              detailLayout.onLayoutChanged(layout)
            }}
            orientation="horizontal"
          >
            <ResizablePanel
              defaultSize="280px"
              id={SUMMARY_PANEL_ID}
              maxSize="360px"
              minSize="220px"
            >
              <div className="flex h-full flex-col border-r border-border">
                <div className="border-b border-border bg-muted/10 px-4 py-4">
                  <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    Run summary
                  </p>
                </div>
                <div className="flex-1 overflow-auto px-3 py-3">
                  <div className="grid gap-2">
                    {FILLER_ROWS.map((row) => (
                      <div
                        className="flex items-center justify-between border border-border px-3 py-2 text-sm"
                        key={row}
                      >
                        <span>Executed scenario {row}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {row % 5}/5
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel id={`${STORAGE_PREFIX}:result`}>
              <div className="flex h-full flex-col">
                <div className="border-b border-border bg-muted/10 px-4 py-4">
                  <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    Event log
                  </p>
                </div>
                <div className="flex-1 overflow-auto px-4 py-3">
                  {events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Resize a panel or reorder a phase to log commits.
                    </p>
                  ) : (
                    <ol
                      className="grid gap-1 font-mono text-xs"
                      data-testid="fixture-event-log"
                    >
                      {events.map((event, index) => (
                        <li key={`${index}:${event}`}>{event}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  )
}
