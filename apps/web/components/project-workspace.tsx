"use client"

import "@xyflow/react/dist/style.css"

import { useRouter } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import { Authenticated, AuthLoading, useMutation, useQuery } from "convex/react"
import type { Id } from "@/convex/_generated/dataModel"
import { api } from "@/convex/_generated/api"
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import {
  ArrowUpDown,
  Check,
  Copy,
  GitBranch,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Trash2,
} from "lucide-react"
import { type CSSProperties, useEffect, useRef, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { AppBrand } from "@/components/app-brand"

type WorkspaceKind = "project" | "scenarios" | "runs"

function getWorkspaceHref({
  mode,
  projectSlug,
  workspace,
}: {
  mode: "edit" | "graph"
  projectSlug: string
  workspace: WorkspaceKind
}) {
  switch (workspace) {
    case "project":
      return `/projects/${projectSlug}/project`
    case "runs":
      return `/projects/${projectSlug}/runs`
    case "scenarios":
      return `/projects/${projectSlug}/scenarios?mode=${mode}`
  }
}

function createProjectFormState(project: {
  name: string
  slug: string
  description: string
  projectPrompt: string
}) {
  return {
    name: project.name,
    slug: project.slug,
    description: project.description,
    projectPrompt: project.projectPrompt,
  }
}

function createScenarioFormState(scenario: {
  name: string
  slug: string
  status: "draft" | "active"
  instructions: string
  scoringPrompt: string
  dependencyIds: string[]
}) {
  return {
    name: scenario.name,
    slug: scenario.slug,
    status: scenario.status,
    instructions: scenario.instructions,
    scoringPrompt: scenario.scoringPrompt,
    dependencyIds: scenario.dependencyIds,
  }
}

function formatRunDisplayName(name: string) {
  return name.replace(/-\d{8}-\d{6}$/, "").replaceAll("-", " ")
}

function formatTimestamp(value: number | null) {
  if (value === null) {
    return "n/a"
  }

  return new Date(value).toLocaleString()
}

function formatScore(value: number | null) {
  return value === null ? "n/a" : value.toFixed(2)
}

function getRunStatusBadgeVariant(
  status: string
): "default" | "outline" | "success" | "warning" {
  switch (status) {
    case "completed":
      return "success"
    case "failed":
    case "interrupted":
      return "warning"
    case "pending":
      return "outline"
    case "running":
    default:
      return "default"
  }
}

type ScoreStyle = CSSProperties & {
  "--score-color"?: string
}

function getScoreColor(value: number) {
  const clampedValue = Math.max(0, Math.min(1, value))

  if (clampedValue >= 0.5) {
    const highPercent = Math.round(((clampedValue - 0.5) / 0.5) * 100)
    const midPercent = 100 - highPercent

    return `color-mix(in oklch, var(--score-mid) ${midPercent}%, var(--score-high) ${highPercent}%)`
  }

  const midPercent = Math.round((clampedValue / 0.5) * 100)
  const lowPercent = 100 - midPercent

  return `color-mix(in oklch, var(--score-low) ${lowPercent}%, var(--score-mid) ${midPercent}%)`
}

function getScoreTextStyle(value: number | null): CSSProperties | undefined {
  if (value === null) {
    return undefined
  }

  return {
    color: getScoreColor(value),
  }
}

function getScoreBadgeStyle(value: number | null): ScoreStyle | undefined {
  if (value === null) {
    return undefined
  }

  return {
    "--score-color": getScoreColor(value),
    backgroundColor:
      "color-mix(in oklch, var(--score-color) 12%, var(--background))",
    borderColor: "color-mix(in oklch, var(--score-color) 28%, var(--border))",
    color: "var(--score-color)",
  }
}

function ScoreText({
  className,
  value,
}: {
  className?: string
  value: number | null
}) {
  return (
    <span className={cn(className)} style={getScoreTextStyle(value)}>
      {formatScore(value)}
    </span>
  )
}

function ScoreBadge({
  className,
  value,
}: {
  className?: string
  value: number | null
}) {
  return (
    <Badge
      className={cn("font-mono", className)}
      style={getScoreBadgeStyle(value)}
      variant="outline"
    >
      {formatScore(value)}
    </Badge>
  )
}

type PanelLayout = Record<string, number>

function getPanelLayoutToken({
  projectSlug,
  workspace,
  scope,
}: {
  projectSlug: string
  workspace: WorkspaceKind
  scope: string
}) {
  return `project-workspace:${projectSlug}:${workspace}:${scope}`
}

function readStoredPanelLayout(
  storageKey: string,
  fallbackLayout: PanelLayout
): PanelLayout {
  if (typeof window === "undefined") {
    return fallbackLayout
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)

    if (!storedValue) {
      return fallbackLayout
    }

    const parsedValue = JSON.parse(storedValue)

    if (
      !parsedValue ||
      typeof parsedValue !== "object" ||
      Array.isArray(parsedValue)
    ) {
      return fallbackLayout
    }

    const nextLayout = Object.keys(fallbackLayout).reduce<PanelLayout>(
      (layout, panelId) => {
        const fallbackSize = fallbackLayout[panelId]!
        const storedSize = parsedValue[panelId]

        layout[panelId] =
          typeof storedSize === "number" ? storedSize : fallbackSize

        return layout
      },
      {}
    )

    return nextLayout
  } catch {
    return fallbackLayout
  }
}

function persistPanelLayout(storageKey: string, layout: PanelLayout) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout))
  } catch {
    // Ignore storage failures and fall back to default sizes.
  }
}

function usePersistedPanelLayout(
  storageKey: string,
  fallbackLayout: PanelLayout
) {
  const [defaultLayout] = useState<PanelLayout>(() =>
    readStoredPanelLayout(storageKey, fallbackLayout)
  )

  return {
    defaultLayout,
    onLayoutChanged: (layout: PanelLayout) =>
      persistPanelLayout(storageKey, layout),
  }
}

export function ProjectWorkspace({
  projectSlug,
  workspace,
  selectedScenarioSlug,
  selectedRunId,
  selectedRunScenarioSlug,
  mode,
}: {
  projectSlug: string
  workspace: WorkspaceKind
  selectedScenarioSlug?: string
  selectedRunId?: string
  selectedRunScenarioSlug?: string
  mode: "edit" | "graph"
}) {
  return (
    <>
      <AuthLoading>
        <main className="flex min-h-svh items-center justify-center bg-background px-5 py-6 text-sm text-muted-foreground sm:px-6">
          Waiting for Clerk and Convex...
        </main>
      </AuthLoading>
      <Authenticated>
        <AuthenticatedProjectWorkspace
          mode={mode}
          projectSlug={projectSlug}
          selectedRunId={selectedRunId}
          selectedRunScenarioSlug={selectedRunScenarioSlug}
          selectedScenarioSlug={selectedScenarioSlug}
          workspace={workspace}
        />
      </Authenticated>
    </>
  )
}

function AuthenticatedProjectWorkspace({
  projectSlug,
  workspace,
  selectedScenarioSlug,
  selectedRunId,
  selectedRunScenarioSlug,
  mode,
}: {
  projectSlug: string
  workspace: WorkspaceKind
  selectedScenarioSlug?: string
  selectedRunId?: string
  selectedRunScenarioSlug?: string
  mode: "edit" | "graph"
}) {
  const router = useRouter()
  const projects = useQuery(api.projects.list, {})
  const project = useQuery(api.projects.getBySlug, { slug: projectSlug })
  const updateProject = useMutation(api.projects.update)
  const createScenario = useMutation(api.scenarios.create)
  const updateScenario = useMutation(api.scenarios.update)
  const removeScenario = useMutation(api.scenarios.remove)
  const removeRun = useMutation(api.runs.remove)
  const scenarios = useQuery(api.scenarios.listForProject, {
    projectSlug,
    ascending: workspace === "scenarios" ? mode !== "graph" : true,
  })
  const selectedScenario = useQuery(
    api.scenarios.getBySlug,
    workspace === "scenarios" && selectedScenarioSlug
      ? { projectSlug, scenarioSlug: selectedScenarioSlug }
      : "skip"
  )
  const runs = useQuery(
    api.runs.listForProject,
    workspace === "runs" ? { projectSlug, ascending: false } : "skip"
  )
  const runDetail = useQuery(
    api.runs.getDetail,
    workspace === "runs" && selectedRunId
      ? { projectSlug, runId: selectedRunId as Id<"runs"> }
      : "skip"
  )
  const [scenarioSearch, setScenarioSearch] = useState("")
  const [scenarioSortAscending, setScenarioSortAscending] = useState(true)
  const [runSortAscending, setRunSortAscending] = useState(false)
  const [isDeletingRun, setIsDeletingRun] = useState(false)
  const scenarioListPanelId = getPanelLayoutToken({
    projectSlug,
    workspace: "scenarios",
    scope: "list",
  })
  const scenarioDetailPanelId = getPanelLayoutToken({
    projectSlug,
    workspace: "scenarios",
    scope: "detail",
  })
  const runListPanelId = getPanelLayoutToken({
    projectSlug,
    workspace: "runs",
    scope: "list",
  })
  const runDetailPanelId = getPanelLayoutToken({
    projectSlug,
    workspace: "runs",
    scope: "detail",
  })
  const runSummaryPanelId = getPanelLayoutToken({
    projectSlug,
    workspace: "runs",
    scope: "summary",
  })
  const runResultPanelId = getPanelLayoutToken({
    projectSlug,
    workspace: "runs",
    scope: "result",
  })
  const scenarioPanelLayout = usePersistedPanelLayout(
    getPanelLayoutToken({
      projectSlug,
      workspace: "scenarios",
      scope: "layout",
    }),
    {
      [scenarioListPanelId]: 28,
      [scenarioDetailPanelId]: 72,
    }
  )
  const runPanelLayout = usePersistedPanelLayout(
    getPanelLayoutToken({
      projectSlug,
      workspace: "runs",
      scope: "layout",
    }),
    {
      [runListPanelId]: 28,
      [runDetailPanelId]: 72,
    }
  )
  const runDetailPanelLayout = usePersistedPanelLayout(
    getPanelLayoutToken({
      projectSlug,
      workspace: "runs",
      scope: "detail-layout",
    }),
    {
      [runSummaryPanelId]: 32,
      [runResultPanelId]: 68,
    }
  )

  if (!project) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-5 py-6 text-sm text-muted-foreground sm:px-6">
        Loading project...
      </main>
    )
  }

  const filteredScenarios =
    scenarios?.filter((scenario) =>
      scenario.name.toLowerCase().includes(scenarioSearch.toLowerCase())
    ) ?? []
  const orderedScenarios = [...filteredScenarios].sort((left, right) =>
    scenarioSortAscending
      ? left.slug.localeCompare(right.slug)
      : right.slug.localeCompare(left.slug)
  )
  const orderedRuns = [...(runs ?? [])].sort((left, right) =>
    runSortAscending
      ? left.startedAt - right.startedAt
      : right.startedAt - left.startedAt
  )

  return (
    <main className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <AppBrand labelClassName="text-sm" />
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="text-muted-foreground">/</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  {project.slug}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Projects</DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1 h-px bg-border" />
                {projects?.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onSelect={() =>
                      router.push(
                        getWorkspaceHref({
                          mode,
                          projectSlug: item.slug,
                          workspace,
                        })
                      )
                    }
                  >
                    {item.slug}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="my-1 h-px bg-border" />
                <DropdownMenuItem onSelect={() => router.push("/projects/new")}>
                  + Create New Project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">{workspace}</span>
            {workspace === "scenarios" && selectedScenarioSlug ? (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="font-mono text-xs text-foreground">
                  {selectedScenarioSlug}
                </span>
              </>
            ) : null}
            {workspace === "runs" && selectedRunId && runDetail ? (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-xs text-foreground capitalize">
                  {formatRunDisplayName(runDetail.run.name)}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <UserButton />
      </header>

      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={workspace === "scenarios" ? "default" : "outline"}
            onClick={() =>
              router.push(`/projects/${projectSlug}/scenarios?mode=${mode}`)
            }
          >
            Scenarios
          </Button>
          <Button
            size="sm"
            variant={workspace === "runs" ? "default" : "outline"}
            onClick={() => router.push(`/projects/${projectSlug}/runs`)}
          >
            Runs
          </Button>
          <Button
            size="sm"
            variant={workspace === "project" ? "default" : "outline"}
            onClick={() => router.push(`/projects/${projectSlug}/project`)}
          >
            Project
          </Button>
        </div>

        {workspace === "scenarios" ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={mode === "edit" ? "default" : "outline"}
              onClick={() =>
                router.push(
                  selectedScenarioSlug
                    ? `/projects/${projectSlug}/scenarios/${selectedScenarioSlug}?mode=edit`
                    : `/projects/${projectSlug}/scenarios?mode=edit`
                )
              }
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant={mode === "graph" ? "default" : "outline"}
              onClick={() =>
                router.push(`/projects/${projectSlug}/scenarios?mode=graph`)
              }
            >
              Graph
            </Button>
          </div>
        ) : null}
      </div>

      {workspace === "scenarios" ? (
        <ResizablePanelGroup
          className="flex-1"
          defaultLayout={scenarioPanelLayout.defaultLayout}
          onLayoutChanged={scenarioPanelLayout.onLayoutChanged}
          orientation="horizontal"
        >
          <ResizablePanel
            defaultSize="28%"
            id={scenarioListPanelId}
            maxSize="38%"
            minSize="20%"
          >
            <div className="flex h-full flex-col border-r border-border">
              <div className="border-b border-border px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
                    Scenarios
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setScenarioSortAscending((value) => !value)
                      }
                    >
                      <ArrowUpDown />
                    </Button>
                    <Button
                      size="icon-sm"
                      onClick={async () => {
                        const created = await createScenario({
                          projectId: project.id as never,
                          name: "New scenario",
                          slug: "new-scenario",
                          status: "draft",
                          instructions: "Describe the user flow to execute.",
                          scoringPrompt:
                            "Explain whether the outcome met expectations.",
                          dependsOnScenarioIds: [],
                        })
                        router.push(
                          `/projects/${projectSlug}/scenarios/${created.slug}?mode=edit`
                        )
                      }}
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 border border-border px-3 py-2">
                  <Search className="size-4 text-muted-foreground" />
                  <input
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    onChange={(event) => setScenarioSearch(event.target.value)}
                    placeholder="Search scenarios"
                    value={scenarioSearch}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {orderedScenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    className={cn(
                      "grid w-full gap-2 border-b border-border px-4 py-3 text-left transition-colors",
                      scenario.slug === selectedScenarioSlug
                        ? "bg-muted/40"
                        : "hover:bg-muted/20"
                    )}
                    onClick={() =>
                      router.push(
                        `/projects/${projectSlug}/scenarios/${scenario.slug}?mode=${mode}`
                      )
                    }
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {scenario.name}
                      </span>
                      <Badge
                        variant={
                          scenario.status === "active" ? "success" : "outline"
                        }
                      >
                        {scenario.status}
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {scenario.slug}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize="72%"
            id={scenarioDetailPanelId}
          >
            {mode === "graph" ? (
              <ReactFlowProvider>
                <ScenarioGraph scenarios={orderedScenarios} />
              </ReactFlowProvider>
            ) : selectedScenario ? (
              <ScenarioEditor
                allScenarios={scenarios ?? []}
                key={`${selectedScenario.id}:${selectedScenario.updatedAt}`}
                removeScenario={removeScenario}
                projectSlug={projectSlug}
                scenario={selectedScenario}
                updateScenario={updateScenario}
              />
            ) : (
              <BlankDetailPanel title="Select a scenario" />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : workspace === "project" ? (
        <ProjectSettingsPanel
          key={`${project.id}:${project.updatedAt}`}
          project={project}
          updateProject={updateProject}
        />
      ) : (
        <ResizablePanelGroup
          className="flex-1"
          defaultLayout={runPanelLayout.defaultLayout}
          onLayoutChanged={runPanelLayout.onLayoutChanged}
          orientation="horizontal"
        >
          <ResizablePanel
            defaultSize="28%"
            id={runListPanelId}
            maxSize="38%"
            minSize="20%"
          >
            <div className="flex h-full flex-col border-r border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-4">
                <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
                  Runs
                </p>
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => setRunSortAscending((value) => !value)}
                >
                  <ArrowUpDown />
                </Button>
              </div>
              <div className="flex-1 overflow-auto">
                {orderedRuns.map((run) => (
                  <button
                    key={run.id}
                    className={cn(
                      "grid w-full gap-2 border-b border-border px-4 py-3 text-left transition-colors",
                      run.id === selectedRunId
                        ? "bg-muted/40"
                        : "hover:bg-muted/20"
                    )}
                    onClick={() =>
                      router.push(`/projects/${projectSlug}/runs/${run.id}`)
                    }
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium text-foreground capitalize">
                        {formatRunDisplayName(run.name)}
                      </span>
                      <Badge variant={getRunStatusBadgeVariant(run.status)}>
                        {run.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatTimestamp(run.startedAt)}
                      </span>
                      <ScoreBadge value={run.averageScore} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize="72%"
            id={runDetailPanelId}
          >
            {runDetail ? (
              <ResizablePanelGroup
                className="h-full"
                defaultLayout={runDetailPanelLayout.defaultLayout}
                onLayoutChanged={runDetailPanelLayout.onLayoutChanged}
                orientation="horizontal"
              >
                <ResizablePanel
                  defaultSize="32%"
                  id={runSummaryPanelId}
                  maxSize="40%"
                  minSize="22%"
                >
                  <div className="flex h-full flex-col border-r border-border">
                    <div className="border-b border-border bg-muted/10 px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                            Run summary
                          </p>
                          <h2 className="mt-2 text-lg font-semibold tracking-tight text-foreground capitalize">
                            {formatRunDisplayName(runDetail.run.name)}
                          </h2>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {formatTimestamp(runDetail.run.startedAt)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isDeletingRun}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Delete run "${formatRunDisplayName(runDetail.run.name)}"? This will permanently delete the run and all associated scenario results.`
                              )
                            ) {
                              return
                            }

                            setIsDeletingRun(true)

                            try {
                              await removeRun({
                                runId: runDetail.run.id as never,
                              })
                              router.push(`/projects/${projectSlug}/runs`)
                            } finally {
                              setIsDeletingRun(false)
                            }
                          }}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-px border border-border bg-border">
                        <div className="bg-background px-3 py-2">
                          <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                            Status
                          </p>
                          <p className="mt-1 text-sm text-foreground">
                            {runDetail.run.status}
                          </p>
                        </div>
                        <div className="bg-background px-3 py-2">
                          <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                            Score
                          </p>
                          <ScoreText
                            className="mt-1 font-mono text-sm"
                            value={runDetail.run.averageScore}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto">
                      {runDetail.results.map((result) => (
                        <button
                          key={result.id}
                          className={cn(
                            "grid w-full gap-2 border-b border-border px-4 py-3 text-left transition-colors",
                            result.scenarioSlug === selectedRunScenarioSlug
                              ? "bg-muted/40"
                              : "hover:bg-muted/20"
                          )}
                          onClick={() =>
                            router.push(
                              `/projects/${projectSlug}/runs/${runDetail.run.id}?scenario=${result.scenarioSlug}`
                            )
                          }
                          type="button"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-foreground">
                              {result.scenarioName}
                            </span>
                            <ScoreText
                              className="font-mono text-xs"
                              value={result.score}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                result.status === "success"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {result.status}
                            </Badge>
                            {result.executionSummary ? (
                              <Badge variant="outline">response</Badge>
                            ) : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel
                  defaultSize="68%"
                  id={runResultPanelId}
                >
                  {selectedRunScenarioSlug ? (
                    <RunResultDetail
                      result={
                        runDetail.results.find(
                          (result) =>
                            result.scenarioSlug === selectedRunScenarioSlug
                        ) ?? null
                      }
                    />
                  ) : (
                    <BlankDetailPanel title="Select an executed scenario" />
                  )}
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <BlankDetailPanel title="Select a run" />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </main>
  )
}

function ProjectSettingsPanel({
  project,
  updateProject,
}: {
  project: {
    id: string
    name: string
    slug: string
    description: string
    projectPrompt: string
  }
  updateProject: ReturnType<typeof useMutation<typeof api.projects.update>>
}) {
  const router = useRouter()
  const [savedForm, setSavedForm] = useState(() =>
    createProjectFormState(project)
  )
  const [form, setForm] = useState(() => createProjectFormState(project))

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  return (
    <div className="grid h-full content-start gap-6 overflow-auto px-6 py-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            <Settings2 className="mr-2 inline size-3" />
            Project settings
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {project.name}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
            Edit the shared context that will be prepended to each scenario
            during CLI execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!isDirty}
            onClick={() => setForm(savedForm)}
          >
            <RotateCcw />
            Revert
          </Button>
          <Button
            size="sm"
            disabled={!isDirty}
            onClick={async () => {
              const updatedProject = await updateProject({
                projectId: project.id as never,
                ...form,
              })
              const nextForm = createProjectFormState(updatedProject)
              setSavedForm(nextForm)
              setForm(nextForm)
              router.replace(`/projects/${updatedProject.slug}/project`)
            }}
          >
            <Save />
            Save project
          </Button>
        </div>
      </div>

      <div className="grid gap-5">
        <Field label="Name">
          <Input
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            value={form.name}
          />
        </Field>
        <Field label="Slug">
          <Input
            onChange={(event) =>
              setForm((current) => ({ ...current, slug: event.target.value }))
            }
            value={form.slug}
          />
        </Field>
        <Field label="Description">
          <Textarea
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            value={form.description}
          />
        </Field>
        <Field label="Project prompt">
          <Textarea
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                projectPrompt: event.target.value,
              }))
            }
            value={form.projectPrompt}
          />
        </Field>
      </div>
    </div>
  )
}

function ScenarioEditor({
  scenario,
  allScenarios,
  projectSlug,
  removeScenario,
  updateScenario,
}: {
  scenario: {
    id: string
    name: string
    slug: string
    status: "draft" | "active"
    instructions: string
    scoringPrompt: string
    dependencyIds: string[]
  }
  allScenarios: Array<{
    id: string
    name: string
    slug: string
  }>
  projectSlug: string
  removeScenario: ReturnType<typeof useMutation<typeof api.scenarios.remove>>
  updateScenario: ReturnType<typeof useMutation<typeof api.scenarios.update>>
}) {
  const router = useRouter()
  const [savedForm, setSavedForm] = useState(() =>
    createScenarioFormState(scenario)
  )
  const [form, setForm] = useState(() => createScenarioFormState(scenario))
  const [dependencySearch, setDependencySearch] = useState("")

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  const visibleDependencies = allScenarios.filter(
    (candidate) =>
      candidate.id !== scenario.id &&
      candidate.name.toLowerCase().includes(dependencySearch.toLowerCase())
  )

  return (
    <div className="grid h-full content-start gap-6 px-6 py-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Scenario editor
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {scenario.name}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete scenario "${scenario.name}"? Existing run history will be kept.`
                )
              ) {
                return
              }

              await removeScenario({ scenarioId: scenario.id as never })
              router.push(`/projects/${projectSlug}/scenarios?mode=edit`)
            }}
          >
            <Trash2 />
            Delete
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isDirty}
            onClick={() => setForm(savedForm)}
          >
            <RotateCcw />
            Revert
          </Button>
          <Button
            size="sm"
            disabled={!isDirty}
            onClick={async () => {
              const updated = await updateScenario({
                scenarioId: scenario.id as never,
                name: form.name,
                slug: form.slug,
                status: form.status,
                instructions: form.instructions,
                scoringPrompt: form.scoringPrompt,
                dependsOnScenarioIds: form.dependencyIds.map(
                  (dependencyId) => dependencyId as never
                ),
              })
              setSavedForm(form)
              router.replace(
                `/projects/${projectSlug}/scenarios/${updated.slug}?mode=edit`
              )
            }}
          >
            <Save />
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-5">
        <div className="grid grid-cols-[minmax(0,1fr)_12rem] gap-5">
          <Field label="Name">
            <Input
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              value={form.name}
            />
          </Field>
          <Field label="Status">
            <select
              className="h-9 border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target.value as "draft" | "active",
                }))
              }
              value={form.status}
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
            </select>
          </Field>
        </div>

        <Field label="Slug">
          <Input
            onChange={(event) =>
              setForm((current) => ({ ...current, slug: event.target.value }))
            }
            value={form.slug}
          />
        </Field>

        <Field label="Execution instructions">
          <Textarea
            className="min-h-48"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                instructions: event.target.value,
              }))
            }
            value={form.instructions}
          />
        </Field>

        <Field label="Scoring prompt">
          <Textarea
            className="min-h-48"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                scoringPrompt: event.target.value,
              }))
            }
            value={form.scoringPrompt}
          />
        </Field>

        <div className="grid gap-3">
          <Label>Dependencies</Label>
          <div className="border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <GitBranch className="size-4 text-muted-foreground" />
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => setDependencySearch(event.target.value)}
                placeholder="Search project scenarios"
                value={dependencySearch}
              />
            </div>
            <div className="max-h-56 overflow-auto">
              {visibleDependencies.map((dependency) => {
                const checked = form.dependencyIds.includes(dependency.id)

                return (
                  <label
                    key={dependency.id}
                    className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0"
                  >
                    <span>
                      <span className="block text-foreground">
                        {dependency.name}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {dependency.slug}
                      </span>
                    </span>
                    <input
                      checked={checked}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          dependencyIds: event.target.checked
                            ? [...current.dependencyIds, dependency.id]
                            : current.dependencyIds.filter(
                                (dependencyId) => dependencyId !== dependency.id
                              ),
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ScenarioGraph({
  scenarios,
}: {
  scenarios: Array<{
    id: string
    slug: string
    name: string
    dependencyIds: string[]
  }>
}) {
  const nodes = scenarios.map((scenario, index) => ({
    id: scenario.id,
    position: {
      x: 80 + (index % 3) * 280,
      y: 80 + Math.floor(index / 3) * 180,
    },
    data: {
      label: (
        <div className="min-w-44 border border-border bg-background px-3 py-2 text-left">
          <p className="text-sm font-medium text-foreground">{scenario.name}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {scenario.slug}
          </p>
        </div>
      ),
    },
  }))
  const edges = scenarios.flatMap((scenario) =>
    scenario.dependencyIds.map((dependencyId) => ({
      id: `${dependencyId}->${scenario.id}`,
      source: dependencyId,
      target: scenario.id,
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
    }))
  )

  return (
    <div className="h-full">
      <ReactFlow fitView edges={edges} nodes={nodes}>
        <Background color="var(--color-border)" gap={24} />
        <Controls />
      </ReactFlow>
    </div>
  )
}

function RunResultDetail({
  result,
}: {
  result: {
    scenarioName: string
    scenarioSlug: string
    status: string
    score: number | null
    rationale: string | null
    improvementInstruction: string | null
    executionSummary: string | null
    failureDetail: string | null
    runnerType: string
    startedAt: number
    finishedAt: number
    submittedAt: number
    executionInstructions: string
    scoringPrompt: string
  } | null
}) {
  if (!result) {
    return <BlankDetailPanel title="Select an executed scenario" />
  }

  return (
    <div className="grid h-full content-start gap-6 overflow-auto px-6 py-6">
      <div>
        <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Run result
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {result.scenarioName}
        </h2>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {result.scenarioSlug}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Badge variant={result.status === "success" ? "success" : "warning"}>
            {result.status}
          </Badge>
          <ScoreBadge value={result.score} />
        </div>
      </div>

      <div className="border border-primary/40 bg-primary/5">
        <div className="flex items-center justify-between gap-3 border-b border-primary/30 px-4 py-3">
          <div>
            <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
              Rationale
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Primary explanation for the scenario score.
            </p>
          </div>
          <Badge variant="outline">Primary output</Badge>
        </div>
        <CopyableTextBlock
          className="border-0 bg-transparent"
          emptyText="No rationale stored."
          value={result.rationale ?? result.failureDetail}
        />
      </div>

      <Field label="Improvement instruction">
        <CopyableTextBlock
          emptyText="No improvement instruction stored."
          value={result.improvementInstruction}
        />
      </Field>

      <Field label="Execution summary">
        <CopyableTextBlock
          emptyText="No execution summary stored."
          value={result.executionSummary}
        />
      </Field>

      <div className="grid gap-4 border-t border-border pt-5">
        <div>
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Run data
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Metadata and stored execution details for this result.
          </p>
        </div>
        <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
          <DetailMeta label="Runner" value={result.runnerType} />
          <DetailMeta
            label="Started"
            value={formatTimestamp(result.startedAt)}
          />
          <DetailMeta
            label="Finished"
            value={formatTimestamp(result.finishedAt)}
          />
          <DetailMeta
            label="Submitted"
            value={formatTimestamp(result.submittedAt)}
          />
        </div>
        {result.failureDetail ? (
          <Field label="Failure detail">
            <CopyableTextBlock value={result.failureDetail} />
          </Field>
        ) : null}
      </div>

      <div className="grid gap-5 border-t border-border pt-5">
        <div>
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Scenario definition
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            The inputs captured from the scenario at execution time.
          </p>
        </div>
        <Field label="Instructions">
          <CopyableTextBlock value={result.executionInstructions} />
        </Field>
        <Field label="Scoring prompt">
          <CopyableTextBlock value={result.scoringPrompt} />
        </Field>
      </div>
    </div>
  )
}

function CopyableTextBlock({
  value,
  emptyText = "Nothing to copy.",
  className,
}: {
  value: string | null
  emptyText?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const resetTimeoutRef = useRef<number | null>(null)
  const text = value ?? emptyText
  const canCopy = value !== null

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
    }
  }, [])

  async function handleCopy() {
    if (!canCopy) {
      return
    }

    await navigator.clipboard.writeText(text)
    setCopied(true)

    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current)
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setCopied(false)
      resetTimeoutRef.current = null
    }, 1500)
  }

  return (
    <div
      className={cn(
        "relative border border-border bg-muted/20 text-foreground",
        className
      )}
    >
      <Button
        aria-label={canCopy ? "Copy text" : "Nothing to copy"}
        className="absolute top-2 right-2 z-10"
        disabled={!canCopy}
        onClick={handleCopy}
        size="icon-xs"
        title={canCopy ? "Copy text" : "Nothing to copy"}
        variant="ghost"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <pre className="overflow-auto px-4 py-4 pr-14 text-sm whitespace-pre-wrap text-foreground">
        {text}
      </pre>
    </div>
  )
}

function DetailMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-3 py-2">
      <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  )
}

function BlankDetailPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-6">
      <div className="max-w-md text-center">
        <p className="text-lg font-medium text-foreground">{title}</p>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          The surrounding navigation stays active so you can change the current
          selection without losing context.
        </p>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
