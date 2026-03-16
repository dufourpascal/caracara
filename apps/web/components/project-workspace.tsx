"use client"

import { useRouter } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import { Authenticated, AuthLoading, useMutation, useQuery } from "convex/react"
import type { Id } from "@/convex/_generated/dataModel"
import { api } from "@/convex/_generated/api"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  CircleDashed,
  CircleHelp,
  Copy,
  FolderCode,
  GitBranch,
  History,
  LoaderCircle,
  PauseCircle,
  Pencil,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  Search,
  Settings2,
  TableOfContents,
  Target,
  Trash2,
  Wrench,
} from "lucide-react"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { normalizeSlug } from "@workspace/contracts"

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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@workspace/ui/components/pagination"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"
import { SortableList } from "@workspace/ui/components/sortable-list"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { AppBrand } from "@/components/app-brand"
import { ScenarioGraph } from "@/components/scenario-graph"

type WorkspaceKind = "project" | "scenarios" | "runs" | "phases"
const UNASSIGNED_SCENARIO_PHASE_FILTER = "__unassigned__"
const SIDEBAR_PAGE_SIZES = [10, 20, 50] as const
const UNTITLED_SCENARIO_SLUG_PATTERN = /^untitled(?:-\d+)?$/
const WORKSPACE_NAVIGATION_ORDER = [
  "project",
  "phases",
  "scenarios",
  "runs",
] as const satisfies WorkspaceKind[]

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
    case "phases":
      return `/projects/${projectSlug}/phases`
    case "scenarios":
      return `/projects/${projectSlug}/scenarios?mode=${mode}`
  }
}

function formatWorkspaceLabel(workspace: WorkspaceKind) {
  return workspace.charAt(0).toUpperCase() + workspace.slice(1)
}

function getWorkspaceIcon(workspace: WorkspaceKind) {
  switch (workspace) {
    case "project":
      return FolderCode
    case "phases":
      return TableOfContents
    case "scenarios":
      return Pencil
    case "runs":
      return Rocket
  }
}

function getScenarioModeHref({
  mode,
  phaseFilter,
  projectSlug,
  selectedScenarioSlug,
}: {
  mode: "edit" | "graph"
  phaseFilter: string | null
  projectSlug: string
  selectedScenarioSlug?: string
}) {
  const searchParams = new URLSearchParams({ mode })

  if (phaseFilter) {
    searchParams.set("phase", phaseFilter)
  }

  if (mode === "edit" && selectedScenarioSlug) {
    searchParams.set("scenario", selectedScenarioSlug)
  }

  return `/projects/${projectSlug}/scenarios?${searchParams.toString()}`
}

function getNewScenarioHref({
  projectSlug,
  phaseFilter,
}: {
  projectSlug: string
  phaseFilter: string | null
}) {
  const searchParams = new URLSearchParams({ mode: "edit" })

  if (phaseFilter) {
    searchParams.set("phase", phaseFilter)
  }

  searchParams.set("draft", "new")

  return `/projects/${projectSlug}/scenarios?${searchParams.toString()}`
}

function getScenarioLibraryHref({
  mode,
  projectSlug,
  phaseFilter,
}: {
  mode: "edit" | "graph"
  projectSlug: string
  phaseFilter: string | null
}) {
  const searchParams = new URLSearchParams({ mode })

  if (phaseFilter) {
    searchParams.set("phase", phaseFilter)
  }

  return `/projects/${projectSlug}/scenarios?${searchParams.toString()}`
}

function getScenarioSelectionHref({
  mode,
  phaseFilter,
  projectSlug,
  scenarioSlug,
}: {
  mode: "edit" | "graph"
  phaseFilter: string | null
  projectSlug: string
  scenarioSlug: string
}) {
  const searchParams = new URLSearchParams({ mode })

  if (phaseFilter) {
    searchParams.set("phase", phaseFilter)
  }

  if (mode === "edit") {
    searchParams.set("scenario", scenarioSlug)
  }

  return `/projects/${projectSlug}/scenarios?${searchParams.toString()}`
}

function formatScenarioModeLabel(mode: "edit" | "graph") {
  return mode === "edit" ? "Edit" : "Graph"
}

function getScenarioPhaseFilterLabel(filter: string | null, phases: Array<{
  id: Id<"phases">
  order: number
  name: string
}>) {
  if (filter === UNASSIGNED_SCENARIO_PHASE_FILTER) {
    return "Unassigned"
  }

  const phase = phases.find((item) => item.id === filter)

  if (!phase) {
    return "Choose phase"
  }

  return `${phase.order}. ${phase.name}`
}

function normalizeScenarioPhaseFilter({
  initialFilter,
  phases,
}: {
  initialFilter: string | null | undefined
  phases: Array<{ id: Id<"phases"> }>
}) {
  if (initialFilter === UNASSIGNED_SCENARIO_PHASE_FILTER) {
    return UNASSIGNED_SCENARIO_PHASE_FILTER
  }

  if (initialFilter && phases.some((phase) => phase.id === initialFilter)) {
    return initialFilter
  }

  return null
}

function getDefaultScenarioPhaseFilter(phases: Array<{ id: Id<"phases"> }>) {
  return phases.length > 0
    ? phases[0]?.id ?? null
    : UNASSIGNED_SCENARIO_PHASE_FILTER
}

function getScenarioPhaseIdForCreation({
  phases,
  selectedFilter,
}: {
  phases: Array<{ id: Id<"phases"> }>
  selectedFilter: string | null
}) {
  if (selectedFilter === UNASSIGNED_SCENARIO_PHASE_FILTER) {
    return null
  }

  const selectedPhase =
    selectedFilter !== null
      ? phases.find((phase) => phase.id === selectedFilter) ?? null
      : null

  if (selectedPhase) {
    return selectedPhase.id
  }

  return phases.length > 0 ? phases[phases.length - 1]?.id ?? null : null
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

function createPhaseFormState(phase: { name: string }) {
  return {
    name: phase.name,
  }
}

function createScenarioFormState(scenario: {
  name: string
  slug: string
  status: "draft" | "active"
  instructions: string
  scoringPrompt: string
  phaseId?: string | null
  dependencyIds: string[]
}) {
  const shouldHideGeneratedSlug =
    scenario.name.trim() === "" &&
    scenario.instructions.trim() === "" &&
    scenario.scoringPrompt.trim() === "" &&
    UNTITLED_SCENARIO_SLUG_PATTERN.test(scenario.slug)

  return {
    name: scenario.name,
    slug: shouldHideGeneratedSlug ? "" : scenario.slug,
    status: scenario.status,
    instructions: scenario.instructions,
    scoringPrompt: scenario.scoringPrompt,
    phaseId: scenario.phaseId ?? null,
    dependencyIds: scenario.dependencyIds,
  }
}

function createEmptyScenarioDraft({ phaseId }: { phaseId: Id<"phases"> | null }) {
  return {
    name: "",
    slug: "",
    status: "draft" as const,
    instructions: "",
    scoringPrompt: "",
    phaseId,
    dependencyIds: [],
  }
}

function formatRunDisplayName(name: string) {
  return name.replace(/-\d{8}-\d{6}$/, "").replaceAll("-", " ")
}

function isScenarioStatus(value: string): value is "draft" | "active" {
  return value === "draft" || value === "active"
}

function getAutoScenarioSlug(name: string) {
  return name.trim() === "" ? "" : normalizeSlug(name)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}

function formatTimestamp(value: number | null) {
  if (value === null) {
    return "n/a"
  }

  return new Date(value).toLocaleString()
}

function formatDateLabel(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}

function formatTimeLabel(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function getLocalDayToken(value: number) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

function formatScore(value: number | null) {
  return value === null ? "n/a" : value.toFixed(2)
}

function useCursorPager(resetKey: string) {
  const [pageState, setPageState] = useState<{
    key: string
    starts: Array<string | null>
  }>({
    key: resetKey,
    starts: [null],
  })
  const pageStarts =
    pageState.key === resetKey ? pageState.starts : ([null] as Array<string | null>)

  return {
    canGoPrevious: pageStarts.length > 1,
    currentCursor: pageStarts[pageStarts.length - 1] ?? null,
    goToNextPage(cursor: string) {
      setPageState({
        key: resetKey,
        starts: [...pageStarts, cursor],
      })
    },
    goToPreviousPage() {
      setPageState({
        key: resetKey,
        starts: pageStarts.length > 1 ? pageStarts.slice(0, -1) : pageStarts,
      })
    },
    pageNumber: pageStarts.length,
  }
}

function SidebarPaginationControls({
  canGoNext,
  canGoPrevious,
  itemLabel,
  onNext,
  onPageSizeChange,
  onPrevious,
  pageNumber,
  pageSize,
}: {
  canGoNext: boolean
  canGoPrevious: boolean
  itemLabel: string
  onNext: () => void
  onPageSizeChange: (value: 10 | 20 | 50) => void
  onPrevious: () => void
  pageNumber: number
  pageSize: 10 | 20 | 50
}) {
  return (
    <div className="border-t border-border bg-muted/10 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
          Page {pageNumber} · {pageSize} {itemLabel}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-7 px-2.5 font-mono text-[11px]" size="sm" variant="outline">
              {pageSize} / page
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SIDEBAR_PAGE_SIZES.map((size) => (
              <DropdownMenuItem key={size} onSelect={() => onPageSizeChange(size)}>
                <span className="font-mono">{size}</span>
                {size === pageSize ? <Check className="ml-2 size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Pagination className="mt-3 justify-start">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious disabled={!canGoPrevious} onClick={onPrevious} />
          </PaginationItem>
          <PaginationItem>
            <Button
              className="h-7 min-w-16 px-2.5 font-mono text-[11px]"
              disabled
              size="sm"
              variant="secondary"
            >
              {pageNumber}
            </Button>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext disabled={!canGoNext} onClick={onNext} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
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

function formatStatusLabel(status: string) {
  return status.replaceAll("_", " ")
}

function getScenarioResultBadgeVariant(status: string) {
  if (status === "success") {
    return "success" as const
  }

  if (status === "running") {
    return "default" as const
  }

  return "warning" as const
}

function getRunStatusIcon(status: string) {
  switch (status) {
    case "failed":
      return {
        icon: AlertCircle,
        iconClassName: "text-destructive",
        label: "Failed",
      }
    case "interrupted":
      return {
        icon: PauseCircle,
        iconClassName: "text-destructive",
        label: "Interrupted",
      }
    case "pending":
      return {
        icon: CircleDashed,
        iconClassName: "text-muted-foreground",
        label: "Pending",
      }
    case "running":
    default:
      return {
        icon: LoaderCircle,
        iconClassName: "text-foreground motion-safe:animate-spin",
        label: "Running",
      }
  }
}

function getScenarioStatusIcon(status: "draft" | "active") {
  switch (status) {
    case "active":
      return {
        icon: CheckCircle2,
        iconClassName: "text-primary",
        label: "Active",
      }
    case "draft":
    default:
      return {
        icon: CircleDashed,
        iconClassName: "text-muted-foreground",
        label: "Draft",
      }
  }
}

function getScenarioResultStatusIcon(status: string) {
  switch (status) {
    case "running":
      return {
        icon: LoaderCircle,
        iconClassName: "text-foreground motion-safe:animate-spin",
        label: "Running",
      }
    case "success":
      return {
        icon: CheckCircle2,
        iconClassName: "text-primary",
        label: "Success",
      }
    case "interrupted":
      return {
        icon: PauseCircle,
        iconClassName: "text-destructive",
        label: "Interrupted",
      }
    case "dependency_failed":
      return {
        icon: AlertCircle,
        iconClassName: "text-destructive",
        label: "Dependency failed",
      }
    case "runner_failed":
      return {
        icon: AlertCircle,
        iconClassName: "text-destructive",
        label: "Runner failed",
      }
    case "scoring_failed":
    default:
      return {
        icon: AlertCircle,
        iconClassName: "text-destructive",
        label: "Scoring failed",
      }
  }
}

function isScenarioResultFailure(status: string) {
  return (
    status === "dependency_failed" ||
    status === "runner_failed" ||
    status === "scoring_failed" ||
    status === "interrupted"
  )
}

function StatusIcon({
  icon: Icon,
  iconClassName,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconClassName?: string
  label: string
}) {
  return (
    <span
      aria-label={label}
      className="inline-flex size-5 shrink-0 items-center justify-center"
      title={label}
    >
      <Icon aria-hidden className={cn("size-4", iconClassName)} />
    </span>
  )
}

function TimelineDot({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex size-5 shrink-0 items-center justify-center"
      title={label}
    >
      <span className="size-2 rounded-full bg-muted-foreground/65" />
    </span>
  )
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "completed" || status === "pending") {
    return <TimelineDot label={formatStatusLabel(status)} />
  }

  return <StatusIcon {...getRunStatusIcon(status)} />
}

function ScenarioStatusIcon({ status }: { status: "draft" | "active" }) {
  return <StatusIcon {...getScenarioStatusIcon(status)} />
}

function ScenarioResultStatusIcon({ status }: { status: string }) {
  return <StatusIcon {...getScenarioResultStatusIcon(status)} />
}

function ScenarioResultValue({
  score,
  status,
}: {
  score: number | null
  status: string
}) {
  if (status === "running" || isScenarioResultFailure(status)) {
    return <ScenarioResultStatusIcon status={status} />
  }

  return <ScoreText className="font-mono text-xs" value={score} />
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
  initialScenarioPhaseFilter,
  creatingScenario = false,
  mode,
}: {
  projectSlug: string
  workspace: WorkspaceKind
  selectedScenarioSlug?: string
  selectedRunId?: string
  selectedRunScenarioSlug?: string
  initialScenarioPhaseFilter?: string | null
  creatingScenario?: boolean
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
          creatingScenario={creatingScenario}
          initialScenarioPhaseFilter={initialScenarioPhaseFilter}
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
  initialScenarioPhaseFilter,
  creatingScenario = false,
  mode,
}: {
  projectSlug: string
  workspace: WorkspaceKind
  selectedScenarioSlug?: string
  selectedRunId?: string
  selectedRunScenarioSlug?: string
  initialScenarioPhaseFilter?: string | null
  creatingScenario?: boolean
  mode: "edit" | "graph"
}) {
  const router = useRouter()
  const [hasDeletedProject, setHasDeletedProject] = useState(false)
  const projects = useQuery(api.projects.list, {})
  const project = useQuery(
    api.projects.getBySlug,
    hasDeletedProject ? "skip" : { slug: projectSlug }
  )
  const updateProject = useMutation(api.projects.update)
  const removeProject = useMutation(api.projects.remove)
  const createPhase = useMutation(api.phases.create)
  const updatePhase = useMutation(api.phases.update)
  const reorderPhases = useMutation(api.phases.reorder)
  const removePhase = useMutation(api.phases.remove)
  const createScenario = useMutation(api.scenarios.create)
  const ensureScenarioNavigationMetadata = useMutation(
    api.scenarios.ensureNavigationMetadataForProject
  )
  const updateScenario = useMutation(api.scenarios.update)
  const removeScenario = useMutation(api.scenarios.remove)
  const removeRun = useMutation(api.runs.remove)
  const phases = useQuery(
    api.phases.listForProject,
    hasDeletedProject ? "skip" : { projectSlug }
  )
  const [scenarioSearch, setScenarioSearch] = useState("")
  const [scenarioSortAscending, setScenarioSortAscending] = useState(true)
  const [scenarioPageSize, setScenarioPageSize] = useState<10 | 20 | 50>(20)
  const [runSortAscending, setRunSortAscending] = useState(false)
  const [runPageSize, setRunPageSize] = useState<10 | 20 | 50>(20)
  const [isDeletingRun, setIsDeletingRun] = useState(false)
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null)
  const normalizedScenarioSearch = scenarioSearch.trim()
  const isScenarioSearchActive = normalizedScenarioSearch.length > 0
  const scenarioSortDirection = scenarioSortAscending ? "asc" : "desc"
  const runSortDirection = runSortAscending ? "asc" : "desc"
  const normalizedInitialScenarioPhaseFilter = normalizeScenarioPhaseFilter({
    initialFilter: initialScenarioPhaseFilter,
    phases: phases ?? [],
  })
  const selectedScenarioPhaseFilter =
    normalizedInitialScenarioPhaseFilter ??
    (phases === undefined ? null : getDefaultScenarioPhaseFilter(phases))
  const scenarioPager = useCursorPager(
    `${selectedScenarioPhaseFilter ?? "pending"}:${scenarioSortDirection}:${scenarioPageSize}:${normalizedScenarioSearch}`
  )
  const runPager = useCursorPager(`${runSortDirection}:${runPageSize}`)
  const scenarioPage = useQuery(
    api.scenarios.listPageForProject,
    !hasDeletedProject &&
      workspace === "scenarios" &&
      selectedScenarioPhaseFilter !== null
      ? {
          projectSlug,
          phaseFilter: selectedScenarioPhaseFilter,
          searchQuery: normalizedScenarioSearch || undefined,
          sortDirection: scenarioSortDirection,
          paginationOpts: {
            cursor: scenarioPager.currentCursor,
            numItems: scenarioPageSize,
          },
        }
      : "skip"
  )
  const scenarioNavigationSummary = useQuery(
    api.scenarios.getNavigationSummaryForProject,
    !hasDeletedProject && workspace === "scenarios" ? { projectSlug } : "skip"
  )
  const scenarioSummaries = useQuery(
    api.scenarios.listSummariesForProject,
    !hasDeletedProject &&
      (workspace === "phases" || (workspace === "scenarios" && mode === "edit"))
      ? { projectSlug }
      : "skip"
  )
  const graphScenarios = useQuery(
    api.scenarios.listForProject,
    !hasDeletedProject && workspace === "scenarios" && mode === "graph"
      ? { projectSlug, ascending: true }
      : "skip"
  )
  const selectedScenario = useQuery(
    api.scenarios.getBySlug,
    !hasDeletedProject &&
      workspace === "scenarios" &&
      selectedScenarioSlug &&
      !creatingScenario
      ? { projectSlug, scenarioSlug: selectedScenarioSlug }
      : "skip"
  )
  const runPage = useQuery(
    api.runs.listPageForProject,
    !hasDeletedProject && workspace === "runs"
      ? {
          projectSlug,
          sortDirection: runSortDirection,
          paginationOpts: {
            cursor: runPager.currentCursor,
            numItems: runPageSize,
          },
        }
      : "skip"
  )
  const runDetail = useQuery(
    api.runs.getDetail,
    !hasDeletedProject && workspace === "runs" && selectedRunId
      ? { projectSlug, runId: selectedRunId as Id<"runs"> }
      : "skip"
  )
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
  const hasTriggeredScenarioMetadataEnsure = useRef(false)

  useEffect(() => {
    if (workspace !== "phases" || phases === undefined) {
      return
    }

    if (phases.length === 0) {
      if (selectedPhaseId !== null) {
        setSelectedPhaseId(null)
      }
      return
    }

    if (!selectedPhaseId || !phases.some((phase) => phase.id === selectedPhaseId)) {
      setSelectedPhaseId(phases[0]?.id ?? null)
    }
  }, [phases, selectedPhaseId, workspace])

  useEffect(() => {
    if (workspace !== "scenarios" || creatingScenario || !selectedScenarioSlug) {
      return
    }

    if (selectedScenario === undefined) {
      return
    }

    const scenarioPhaseFilter = selectedScenario
      ? (selectedScenario.phaseId ?? UNASSIGNED_SCENARIO_PHASE_FILTER)
      : null

    if (
      scenarioPhaseFilter !== null &&
      scenarioPhaseFilter !== normalizedInitialScenarioPhaseFilter
    ) {
      router.replace(
        getScenarioSelectionHref({
          mode,
          phaseFilter: scenarioPhaseFilter,
          projectSlug,
          scenarioSlug: selectedScenarioSlug,
        })
      )
    }
  }, [
    creatingScenario,
    mode,
    normalizedInitialScenarioPhaseFilter,
    projectSlug,
    router,
    selectedScenario,
    selectedScenarioSlug,
    workspace,
  ])

  const pagedScenarios = scenarioPage?.page ?? []
  const pagedRuns = runPage?.page ?? []
  const unassignedScenarioCount =
    scenarioNavigationSummary?.unassignedScenarioCount ?? 0

  useEffect(() => {
    if (
      workspace !== "scenarios" ||
      hasTriggeredScenarioMetadataEnsure.current ||
      phases === undefined ||
      scenarioPage === undefined ||
      isScenarioSearchActive
    ) {
      return
    }

    const expectedCount =
      selectedScenarioPhaseFilter === UNASSIGNED_SCENARIO_PHASE_FILTER
        ? unassignedScenarioCount
        : selectedScenarioPhaseFilter
          ? (phases.find((phase) => phase.id === selectedScenarioPhaseFilter)
              ?.scenarioCount ?? 0)
          : 0

    if (expectedCount === 0 || pagedScenarios.length > 0) {
      return
    }

    hasTriggeredScenarioMetadataEnsure.current = true
    void ensureScenarioNavigationMetadata({ projectSlug })
  }, [
    ensureScenarioNavigationMetadata,
    isScenarioSearchActive,
    pagedScenarios.length,
    phases,
    projectSlug,
    scenarioPage,
    selectedScenarioPhaseFilter,
    unassignedScenarioCount,
    workspace,
  ])

  if (hasDeletedProject) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-5 py-6 text-sm text-muted-foreground sm:px-6">
        Redirecting to projects...
      </main>
    )
  }

  if (!project) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-5 py-6 text-sm text-muted-foreground sm:px-6">
        Loading project...
      </main>
    )
  }

  const groupedRuns = pagedRuns.reduce<
    Array<{
      dayKey: string
      startedAt: number
      runs: Array<(typeof pagedRuns)[number]>
    }>
  >((groups, run) => {
    const dayKey = getLocalDayToken(run.startedAt)
    const currentGroup = groups.length > 0 ? groups[groups.length - 1] : null

    if (!currentGroup || currentGroup.dayKey !== dayKey) {
      groups.push({
        dayKey,
        startedAt: run.startedAt,
        runs: [run],
      })
      return groups
    }

    currentGroup.runs.push(run)
    return groups
  }, [])
  const selectedPhase =
    phases?.find((phase) => phase.id === selectedPhaseId) ?? null
  const selectedScenarioListFilterLabel = getScenarioPhaseFilterLabel(
    selectedScenarioPhaseFilter,
    phases ?? []
  )
  const createScenarioForCurrentPhase = async () => {
    router.push(
      getNewScenarioHref({
        projectSlug,
        phaseFilter: selectedScenarioPhaseFilter,
      })
    )
  }

  return (
    <main className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <AppBrand labelClassName="text-sm" />
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="text-muted-foreground">/</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="min-w-0 gap-1.5" size="sm" variant="ghost">
                  <span className="truncate font-mono">{project.slug}</span>
                  <ChevronsUpDown
                    aria-hidden
                    className="size-3.5 text-muted-foreground"
                  />
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="min-w-0 gap-1.5 px-2 font-medium text-foreground"
                  size="sm"
                  variant="ghost"
                >
                  {(() => {
                    const WorkspaceIcon = getWorkspaceIcon(workspace)

                    return (
                      <WorkspaceIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )
                  })()}
                  <span>{formatWorkspaceLabel(workspace)}</span>
                  <ChevronsUpDown
                    aria-hidden
                    className="size-3.5 text-muted-foreground"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {WORKSPACE_NAVIGATION_ORDER.map((item) => {
                  const WorkspaceIcon = getWorkspaceIcon(item)

                  return (
                    <DropdownMenuItem
                      key={item}
                      onSelect={() =>
                        router.push(
                          getWorkspaceHref({
                            mode,
                            projectSlug,
                            workspace: item,
                          })
                        )
                      }
                    >
                      <WorkspaceIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      {formatWorkspaceLabel(item)}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {workspace === "scenarios" ? (
              <>
                <span className="text-muted-foreground">/</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="min-w-0 gap-1.5 px-2 font-medium text-foreground"
                      size="sm"
                      variant="ghost"
                    >
                      <span>{formatScenarioModeLabel(mode)}</span>
                      <ChevronsUpDown
                        aria-hidden
                        className="size-3.5 text-muted-foreground"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(["edit", "graph"] as const).map((item) => (
                      <DropdownMenuItem
                        key={item}
                        onSelect={() =>
                          router.push(
                            getScenarioModeHref({
                              mode: item,
                              phaseFilter: selectedScenarioPhaseFilter,
                              projectSlug,
                              selectedScenarioSlug,
                            })
                          )
                        }
                      >
                        {formatScenarioModeLabel(item)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
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
              <div className="border-b border-border bg-muted/10 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    <GitBranch className="mr-2 inline size-3.5" />
                    Scenario library
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      aria-label={
                        isScenarioSearchActive
                          ? "Scenario search uses relevance ordering"
                          : scenarioSortAscending
                            ? "Sort scenarios descending"
                            : "Sort scenarios ascending"
                      }
                      disabled={isScenarioSearchActive}
                      size="icon-sm"
                      title={
                        isScenarioSearchActive
                          ? "Scenario search uses relevance ordering"
                          : scenarioSortAscending
                            ? "Sort scenarios descending"
                            : "Sort scenarios ascending"
                      }
                      variant="outline"
                      onClick={() =>
                        setScenarioSortAscending((value) => !value)
                      }
                    >
                      {scenarioSortAscending ? <ArrowUp /> : <ArrowDown />}
                    </Button>
                    <Button
                      size="icon-sm"
                      onClick={createScenarioForCurrentPhase}
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                        Phase
                      </Label>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {selectedScenarioPhaseFilter ===
                        UNASSIGNED_SCENARIO_PHASE_FILTER
                          ? unassignedScenarioCount
                          : selectedScenarioPhaseFilter
                            ? (phases ?? []).find(
                                (phase) => phase.id === selectedScenarioPhaseFilter
                              )?.scenarioCount ?? 0
                            : "All"}
                      </span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="h-10 w-full justify-between rounded-none border-border bg-background px-3 font-normal text-foreground shadow-none"
                          variant="outline"
                        >
                          <span className="truncate text-sm">
                            {selectedScenarioListFilterLabel}
                          </span>
                          <ChevronsUpDown
                            aria-hidden
                            className="size-3.5 text-muted-foreground"
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        <DropdownMenuLabel>Filter Scenarios</DropdownMenuLabel>
                        <DropdownMenuSeparator className="my-1 h-px bg-border" />
                        {(phases ?? []).map((phase) => (
                          <DropdownMenuItem
                            key={phase.id}
                            className="justify-between gap-3"
                            onSelect={() => {
                              if (
                                !selectedScenarioSlug &&
                                selectedScenarioPhaseFilter === phase.id
                              ) {
                                return
                              }

                              router.push(
                                getScenarioLibraryHref({
                                  mode,
                                  projectSlug,
                                  phaseFilter: phase.id,
                                })
                              )
                            }}
                          >
                            <span className="truncate text-sm">
                              {phase.order}. {phase.name}
                            </span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{phase.scenarioCount ?? 0}</span>
                              {selectedScenarioPhaseFilter === phase.id ? (
                                <Check className="size-3.5 text-foreground" />
                              ) : null}
                            </span>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator className="my-1 h-px bg-border" />
                        <DropdownMenuItem
                          className="justify-between gap-3"
                          onSelect={() => {
                            if (
                              !selectedScenarioSlug &&
                              selectedScenarioPhaseFilter ===
                                UNASSIGNED_SCENARIO_PHASE_FILTER
                            ) {
                              return
                            }

                            router.push(
                              getScenarioLibraryHref({
                                mode,
                                projectSlug,
                                phaseFilter: UNASSIGNED_SCENARIO_PHASE_FILTER,
                              })
                            )
                          }}
                        >
                          <span className="inline-flex items-center gap-2 text-sm">
                            <AlertCircle className="size-3.5 text-amber-700 dark:text-amber-300" />
                            Unassigned
                          </span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{unassignedScenarioCount}</span>
                            {selectedScenarioPhaseFilter ===
                            UNASSIGNED_SCENARIO_PHASE_FILTER ? (
                              <Check className="size-3.5 text-foreground" />
                            ) : null}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-2 border border-border px-3 py-2">
                    <Search className="size-4 text-muted-foreground" />
                    <input
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      onChange={(event) => setScenarioSearch(event.target.value)}
                      placeholder="Search scenarios"
                      value={scenarioSearch}
                    />
                  </div>
                  {isScenarioSearchActive ? (
                    <p className="text-[11px] text-muted-foreground">
                      Search uses relevance order. Phase filtering and paging still run on Convex.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {scenarioPage === undefined ? (
                  <div className="px-4 py-5 text-sm text-muted-foreground">
                    Loading scenarios...
                  </div>
                ) : pagedScenarios.length === 0 ? (
                  <NavigationEmptyState
                    action={
                      scenarioSearch ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setScenarioSearch("")}
                        >
                          Clear search
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={createScenarioForCurrentPhase}
                        >
                          <Plus />
                          Create scenario
                        </Button>
                      )
                    }
                    description={
                      scenarioSearch
                        ? "Adjust the query or clear it to see the authored scenario library again."
                        : selectedScenarioPhaseFilter ===
                            UNASSIGNED_SCENARIO_PHASE_FILTER
                          ? "Create an unassigned scenario or move scenarios here when they should stay outside normal phase execution."
                          : "Create the first scenario in this phase to continue shaping the execution flow."
                    }
                    icon={GitBranch}
                    title={
                      scenarioSearch
                        ? "No matching scenarios"
                        : selectedScenarioPhaseFilter ===
                            UNASSIGNED_SCENARIO_PHASE_FILTER
                          ? "No unassigned scenarios"
                          : "No scenarios in this phase"
                    }
                  />
                ) : (
                  pagedScenarios.map((scenario) => (
                    <button
                      key={scenario.id}
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors",
                        scenario.slug === selectedScenarioSlug
                          ? "bg-muted/40"
                          : "hover:bg-muted/20"
                      )}
                      onClick={() =>
                        router.push(
                          getScenarioSelectionHref({
                            mode,
                            phaseFilter:
                              scenario.phaseId ?? UNASSIGNED_SCENARIO_PHASE_FILTER,
                            projectSlug,
                            scenarioSlug: scenario.slug,
                          })
                        )
                      }
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {scenario.name || "Untitled scenario"}
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          {scenario.phaseId ? (
                            <Badge className="px-1.5 py-0 text-[10px]" variant="outline">
                              {scenario.phaseOrder}. {scenario.phaseName}
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                              <AlertCircle className="size-3.5" />
                              Unassigned
                            </span>
                          )}
                        </span>
                      </span>
                      {scenario.dependencyCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                          <GitBranch className="size-3.5" />
                          {scenario.dependencyCount}
                        </span>
                      ) : (
                        <span aria-hidden className="w-0" />
                      )}
                      {scenario.phaseId ? (
                        <span aria-hidden className="w-0" />
                      ) : (
                        <span
                          aria-label="Scenario will not run in phase execution"
                          className="inline-flex items-center text-amber-700 dark:text-amber-300"
                          title="This scenario has no phase and will not run in phase execution."
                        >
                          <AlertCircle className="size-4" />
                        </span>
                      )}
                      <ScenarioStatusIcon status={scenario.status} />
                    </button>
                  ))
                )}
              </div>
              <SidebarPaginationControls
                canGoNext={!!scenarioPage && !scenarioPage.isDone}
                canGoPrevious={scenarioPager.canGoPrevious}
                itemLabel="shown"
                onNext={() => {
                  const nextCursor = scenarioPage?.continueCursor

                  if (scenarioPage && !scenarioPage.isDone && nextCursor) {
                    scenarioPager.goToNextPage(nextCursor)
                  }
                }}
                onPageSizeChange={setScenarioPageSize}
                onPrevious={scenarioPager.goToPreviousPage}
                pageNumber={scenarioPager.pageNumber}
                pageSize={scenarioPageSize}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="72%" id={scenarioDetailPanelId}>
            {mode === "graph" ? (
              <ScenarioGraph scenarios={graphScenarios ?? []} />
            ) : creatingScenario ? (
              <ScenarioEditor
                allScenarios={scenarioSummaries ?? []}
                allPhases={phases ?? []}
                createScenario={createScenario}
                projectId={project.id}
                projectSlug={projectSlug}
                scenario={createEmptyScenarioDraft({
                  phaseId: getScenarioPhaseIdForCreation({
                    phases: phases ?? [],
                    selectedFilter: selectedScenarioPhaseFilter,
                  }),
                })}
                updateScenario={updateScenario}
              />
            ) : selectedScenarioSlug && selectedScenario === undefined ? (
              <ScenarioEditorSkeleton />
            ) : selectedScenario ? (
              <ScenarioEditor
                allScenarios={scenarioSummaries ?? []}
                allPhases={phases ?? []}
                createScenario={createScenario}
                key={`${selectedScenario.id}:${selectedScenario.updatedAt}`}
                projectId={project.id}
                removeScenario={removeScenario}
                projectSlug={projectSlug}
                scenario={selectedScenario}
                updateScenario={updateScenario}
              />
            ) : (
              <BlankDetailPanel
                description="Choose a scenario from the library to edit instructions, scoring, and dependencies without leaving the current workspace."
                icon={GitBranch}
                title="Select a scenario"
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : workspace === "phases" ? (
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
              <div className="border-b border-border bg-muted/10 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    Phase registry
                  </p>
                  <Button
                    size="icon-sm"
                    onClick={async () => {
                      const created = await createPhase({
                        projectId: project.id as never,
                        name: `Phase ${(phases?.length ?? 0) + 1}`,
                      })
                      setSelectedPhaseId(created.id)
                    }}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto px-3 py-3">
                {phases === undefined ? (
                  <div className="px-2 py-2 text-sm text-muted-foreground">
                    Loading phases...
                  </div>
                ) : phases.length === 0 ? (
                  <NavigationEmptyState
                    description="Create the first phase to organize scenario execution into ordered stages."
                    icon={Target}
                    title="No phases yet"
                    action={
                      <Button
                        size="sm"
                        onClick={async () => {
                          const created = await createPhase({
                            projectId: project.id as never,
                            name: "Phase 1",
                          })
                          setSelectedPhaseId(created.id)
                        }}
                      >
                        <Plus />
                        Create phase
                      </Button>
                    }
                  />
                ) : (
                  <SortableList
                    items={phases}
                    onReorder={async (items) => {
                      const updated = await reorderPhases({
                        projectId: project.id as never,
                        phaseIds: items.map((item) => item.id as never),
                      })
                      if (!selectedPhaseId) {
                        setSelectedPhaseId(updated[0]?.id ?? null)
                      }
                    }}
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
                        onClick={() => setSelectedPhaseId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setSelectedPhaseId(item.id)
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
                            Phase {item.order}
                          </span>
                        </span>
                        <Badge className="font-mono" variant="outline">
                          {item.scenarioCount ?? 0}
                        </Badge>
                      </div>
                    )}
                  />
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="72%" id={scenarioDetailPanelId}>
            {selectedPhase ? (
              <PhaseEditor
                allScenarios={scenarioSummaries ?? []}
                key={`${selectedPhase.id}:${selectedPhase.updatedAt}`}
                phase={selectedPhase}
                removePhase={removePhase}
                setSelectedPhaseId={setSelectedPhaseId}
                updatePhase={updatePhase}
              />
            ) : (
              <BlankDetailPanel
                description="Choose a phase to rename it, inspect its assigned scenarios, or change the execution order by dragging phases in the list."
                icon={Target}
                title="Select a phase"
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : workspace === "project" ? (
        <ProjectSettingsPanel
          key={`${project.id}:${project.updatedAt}`}
          onProjectDeleted={() => {
            setHasDeletedProject(true)
            router.replace("/projects")
          }}
          project={project}
          removeProject={removeProject}
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
              <div className="border-b border-border bg-muted/10 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    <History className="mr-2 inline size-3.5" />
                    Run log
                  </p>
                  <Button
                    aria-label={
                      runSortAscending
                        ? "Sort runs descending"
                        : "Sort runs ascending"
                    }
                    size="icon-sm"
                    title={
                      runSortAscending
                        ? "Sort runs descending"
                        : "Sort runs ascending"
                    }
                    variant="outline"
                    onClick={() => setRunSortAscending((value) => !value)}
                  >
                    {runSortAscending ? <ArrowUp /> : <ArrowDown />}
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                {runPage === undefined ? (
                  <div className="px-4 py-5 text-sm text-muted-foreground">
                    Loading runs...
                  </div>
                ) : pagedRuns.length === 0 ? (
                  <NavigationEmptyState
                    description="Run the CLI against this project and each execution will appear here as a dated log entry."
                    icon={History}
                    title="No runs recorded yet"
                  />
                ) : (
                  groupedRuns.map((group) => (
                    <div
                      key={group.dayKey}
                      className="border-b border-border last:border-b-0"
                    >
                      <div className="border-b border-border bg-muted/15 px-4 py-2">
                        <p className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                          {formatDateLabel(group.startedAt)}
                        </p>
                      </div>
                      {group.runs.map((run, index) => (
                        <button
                          key={run.id}
                          className={cn(
                            "grid w-full grid-cols-[1.5rem_minmax(0,1fr)] gap-3 px-4 py-3 text-left transition-colors",
                            run.id === selectedRunId
                              ? "bg-muted/40"
                              : "hover:bg-muted/20",
                            index !== group.runs.length - 1 &&
                              "border-b border-border/70"
                          )}
                          onClick={() =>
                            router.push(
                              `/projects/${projectSlug}/runs/${run.id}`
                            )
                          }
                          type="button"
                        >
                          <span className="relative flex justify-center pt-0.5">
                            {index !== group.runs.length - 1 ? (
                              <span className="absolute top-4 bottom-0 w-px bg-border" />
                            ) : null}
                            <span className="relative z-10">
                              <RunStatusIcon status={run.status} />
                            </span>
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center justify-between gap-3">
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {formatTimeLabel(run.startedAt)}
                              </span>
                              <ScoreText
                                className="font-mono text-xs"
                                value={run.averageScore}
                              />
                            </span>
                            <span className="mt-1 block text-sm font-medium text-foreground capitalize">
                              {formatRunDisplayName(run.name)}
                            </span>
                            {run.mode === "single" &&
                            run.requestedScenarioSlug ? (
                              <span
                                className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
                                title={`Single scenario: ${run.requestedScenarioSlug}`}
                              >
                                <Target className="size-3.5" />
                                <span className="font-mono">
                                  {run.requestedScenarioSlug}
                                </span>
                              </span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
              <SidebarPaginationControls
                canGoNext={!!runPage && !runPage.isDone}
                canGoPrevious={runPager.canGoPrevious}
                itemLabel="runs"
                onNext={() => {
                  const nextCursor = runPage?.continueCursor

                  if (runPage && !runPage.isDone && nextCursor) {
                    runPager.goToNextPage(nextCursor)
                  }
                }}
                onPageSizeChange={setRunPageSize}
                onPrevious={runPager.goToPreviousPage}
                pageNumber={runPager.pageNumber}
                pageSize={runPageSize}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize="72%" id={runDetailPanelId}>
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
                            {formatStatusLabel(runDetail.run.status)}
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
                            "grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors",
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
                          <div className="flex size-5 items-center justify-center text-muted-foreground">
                            {result.improvementInstruction ? (
                              <span
                                aria-label="Improvement instruction available"
                                className="inline-flex size-5 shrink-0 items-center justify-center"
                                title="Improvement instruction available"
                              >
                                <Wrench aria-hidden className="size-4" />
                              </span>
                            ) : (
                              <span aria-hidden className="size-5 shrink-0" />
                            )}
                          </div>
                          <span className="truncate text-sm text-foreground">
                            {result.scenarioName}
                          </span>
                          <div className="flex justify-end">
                            <ScenarioResultValue
                              score={result.score}
                              status={result.status}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel defaultSize="68%" id={runResultPanelId}>
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
                    <BlankDetailPanel
                      description="Choose a scenario result from this run to inspect rationale, summary, stored prompts, and failure details."
                      icon={Wrench}
                      title="Select an executed scenario"
                    />
                  )}
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <BlankDetailPanel
                description="Pick a run from the log to inspect aggregate status, average score, and scenario-by-scenario execution results."
                icon={History}
                title="Select a run"
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </main>
  )
}

function ProjectSettingsPanel({
  onProjectDeleted,
  project,
  removeProject,
  updateProject,
}: {
  onProjectDeleted: () => void
  project: {
    id: string
    name: string
    slug: string
    description: string
    projectPrompt: string
  }
  removeProject: ReturnType<typeof useMutation<typeof api.projects.remove>>
  updateProject: ReturnType<typeof useMutation<typeof api.projects.update>>
}) {
  const router = useRouter()
  const [savedForm, setSavedForm] = useState(() =>
    createProjectFormState(project)
  )
  const [form, setForm] = useState(() => createProjectFormState(project))
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeletingProject, setIsDeletingProject] = useState(false)

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)
  const isDeleteConfirmed = deleteConfirmation.trim() === project.slug

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

      <section className="border border-destructive/40">
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-4">
          <p className="text-[11px] tracking-[0.2em] text-destructive uppercase">
            <AlertCircle className="mr-2 inline size-3.5" />
            Danger zone
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
            Delete project
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            This permanently deletes the project, all associated scenarios, and
            all associated runs and scenario results. There is no recovery path
            once the deletion is confirmed.
          </p>
        </div>
        <div className="grid gap-5 px-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="project-delete-confirmation">
              Type the project slug to confirm deletion
            </Label>
            <Input
              id="project-delete-confirmation"
              aria-invalid={deleteConfirmation.length > 0 && !isDeleteConfirmed}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              placeholder={project.slug}
              spellCheck={false}
              value={deleteConfirmation}
              onChange={(event) => {
                setDeleteConfirmation(event.target.value)
                setDeleteError(null)
              }}
            />
            <p className="text-xs leading-6 text-muted-foreground">
              Enter{" "}
              <span className="font-mono text-foreground">{project.slug}</span>{" "}
              to unlock deletion.
            </p>
            {deleteConfirmation.length > 0 && !isDeleteConfirmed ? (
              <p className="text-sm text-destructive">
                The entered slug does not match the current project slug.
              </p>
            ) : null}
            {deleteError ? (
              <p className="text-sm text-destructive">{deleteError}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-4 border-t border-destructive/20 pt-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Delete this project only if you are certain you no longer need its
              configuration or history.
            </p>
            <Button
              size="sm"
              variant="destructive"
              disabled={!isDeleteConfirmed || isDeletingProject}
              onClick={async () => {
                if (!isDeleteConfirmed) {
                  return
                }

                setDeleteError(null)
                setIsDeletingProject(true)

                try {
                  await removeProject({
                    projectId: project.id as never,
                    slugConfirmation: deleteConfirmation,
                  })
                  onProjectDeleted()
                } catch (error) {
                  setDeleteError(getErrorMessage(error))
                } finally {
                  setIsDeletingProject(false)
                }
              }}
            >
              {isDeletingProject ? (
                <LoaderCircle className="motion-safe:animate-spin" />
              ) : (
                <Trash2 />
              )}
              Delete project
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function ScenarioEditor({
  scenario,
  allScenarios,
  allPhases,
  projectId,
  projectSlug,
  createScenario,
  removeScenario,
  updateScenario,
}: {
  scenario: {
    id?: string
    name: string
    slug: string
    status: "draft" | "active"
    instructions: string
    scoringPrompt: string
    phaseId?: string | null
    phaseName?: string | null
    phaseOrder?: number | null
    dependencyIds: string[]
  }
  allScenarios: Array<{
    id: string
    name: string
    slug: string
    phaseId?: string | null
  }>
  allPhases: Array<{
    id: string
    name: string
    order: number
  }>
  projectId: Id<"projects">
  projectSlug: string
  createScenario: ReturnType<typeof useMutation<typeof api.scenarios.create>>
  removeScenario?: ReturnType<typeof useMutation<typeof api.scenarios.remove>>
  updateScenario: ReturnType<typeof useMutation<typeof api.scenarios.update>>
}) {
  const router = useRouter()
  const [savedForm, setSavedForm] = useState(() =>
    createScenarioFormState(scenario)
  )
  const [form, setForm] = useState(() => createScenarioFormState(scenario))
  const [dependencySearch, setDependencySearch] = useState("")
  const isDraftScenario = !scenario.id

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  const visibleDependencies = allScenarios.filter(
    (candidate) =>
      candidate.id !== scenario.id &&
      candidate.phaseId === form.phaseId &&
      candidate.name.toLowerCase().includes(dependencySearch.toLowerCase())
  )
  const selectedPhase =
    allPhases.find((phase) => phase.id === form.phaseId) ?? null

  return (
    <div className="grid h-full content-start gap-6 px-6 py-6">
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          {isDraftScenario ? null : (
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Delete scenario "${scenario.name || "Untitled scenario"}"? Existing run history will be kept.`
                  )
                ) {
                  return
                }

                await removeScenario?.({ scenarioId: scenario.id as never })
                router.push(`/projects/${projectSlug}/scenarios?mode=edit`)
              }}
            >
              <Trash2 />
              Delete
            </Button>
          )}
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
              if (isDraftScenario) {
                const created = await createScenario({
                  projectId: projectId as never,
                  name: form.name,
                  slug: form.slug.trim() === "" ? undefined : form.slug,
                  status: form.status,
                  instructions: form.instructions,
                  scoringPrompt: form.scoringPrompt,
                  phaseId: form.phaseId ? (form.phaseId as never) : null,
                  dependsOnScenarioIds: form.dependencyIds.map(
                    (dependencyId) => dependencyId as never
                  ),
                })
                router.replace(
                  getScenarioSelectionHref({
                    mode: "edit",
                    phaseFilter:
                      created.phaseId ?? UNASSIGNED_SCENARIO_PHASE_FILTER,
                    projectSlug,
                    scenarioSlug: created.slug,
                  })
                )
                return
              }

              const updated = await updateScenario({
                scenarioId: scenario.id as never,
                name: form.name,
                slug: form.slug,
                status: form.status,
                instructions: form.instructions,
                scoringPrompt: form.scoringPrompt,
                phaseId: form.phaseId ? (form.phaseId as never) : null,
                dependsOnScenarioIds: form.dependencyIds.map(
                  (dependencyId) => dependencyId as never
                ),
              })
              setSavedForm(form)
              router.replace(
                getScenarioSelectionHref({
                  mode: "edit",
                  phaseFilter:
                    updated.phaseId ?? UNASSIGNED_SCENARIO_PHASE_FILTER,
                  projectSlug,
                  scenarioSlug: updated.slug,
                })
              )
            }}
          >
            <Save />
            {isDraftScenario ? "Create" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <Field label="Name">
            <Input
              onChange={(event) =>
                setForm((current) => {
                  const name = event.target.value

                  return {
                    ...current,
                    name,
                    slug: getAutoScenarioSlug(name),
                  }
                })
              }
              placeholder="Scenario name"
              value={form.name}
            />
          </Field>
          <Field label="Status">
            <ToggleGroup
              aria-label="Scenario status"
              className="w-full"
              onValueChange={(value) => {
                if (!value || !isScenarioStatus(value)) {
                  return
                }

                setForm((current) => ({
                  ...current,
                  status: value,
                }))
              }}
              type="single"
              value={form.status}
            >
              <ToggleGroupItem
                aria-label="Set scenario status to draft"
                className="flex-1 justify-center gap-1.5 px-3 text-[11px] tracking-[0.16em] uppercase"
                size="lg"
                value="draft"
              >
                <ScenarioStatusIcon status="draft" />
                Draft
              </ToggleGroupItem>
              <ToggleGroupItem
                aria-label="Set scenario status to active"
                className="flex-1 justify-center gap-1.5 px-3 text-[11px] tracking-[0.16em] uppercase"
                size="lg"
                value="active"
              >
                <ScenarioStatusIcon status="active" />
                Active
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </div>

        <Field label="Slug">
          <Input
            onChange={(event) =>
              setForm((current) => ({ ...current, slug: event.target.value }))
            }
            placeholder="scenario-slug"
            value={form.slug}
          />
        </Field>

        <Field label="Phase">
          <div className="grid gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="justify-between" variant="outline">
                  <span>
                    {selectedPhase
                      ? `${selectedPhase.order}. ${selectedPhase.name}`
                      : "Unassigned"}
                  </span>
                  <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() =>
                    setForm((current) => ({
                      ...current,
                      phaseId: null,
                      dependencyIds: [],
                    }))
                  }
                >
                  Unassigned
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 h-px bg-border" />
                {allPhases.map((phase) => (
                  <DropdownMenuItem
                    key={phase.id}
                    onSelect={() =>
                      setForm((current) => ({
                        ...current,
                        phaseId: phase.id,
                        dependencyIds: current.dependencyIds.filter((dependencyId) =>
                          allScenarios.some(
                            (candidate) =>
                              candidate.id === dependencyId &&
                              candidate.phaseId === phase.id
                          )
                        ),
                      }))
                    }
                  >
                    {phase.order}. {phase.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {form.phaseId ? null : (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                This scenario is not assigned to a phase. It will appear in the
                library, but it will not run in normal phase execution.
              </p>
            )}
          </div>
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
            placeholder="Describe the user flow to execute."
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
            placeholder="Explain how the outcome should be judged."
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
              {!form.phaseId ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  Assign this scenario to a phase before selecting dependencies.
                </div>
              ) : visibleDependencies.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  No same-phase scenarios match the current filter.
                </div>
              ) : visibleDependencies.map((dependency) => {
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

function PhaseEditor({
  phase,
  allScenarios,
  removePhase,
  setSelectedPhaseId,
  updatePhase,
}: {
  phase: {
    id: string
    name: string
    order: number
    updatedAt: number
  }
  allScenarios: Array<{
    id: string
    name: string
    slug: string
    phaseId?: string | null
  }>
  removePhase: ReturnType<typeof useMutation<typeof api.phases.remove>>
  setSelectedPhaseId: (value: string | null) => void
  updatePhase: ReturnType<typeof useMutation<typeof api.phases.update>>
}) {
  const [savedForm, setSavedForm] = useState(() => createPhaseFormState(phase))
  const [form, setForm] = useState(() => createPhaseFormState(phase))
  const assignedScenarios = allScenarios.filter(
    (scenario) => scenario.phaseId === phase.id
  )
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  return (
    <div className="grid h-full content-start gap-6 overflow-auto px-6 py-6">
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete phase "${phase.name}"? Scenarios in this phase will become unassigned and will not run in normal phase execution.`
                )
              ) {
                return
              }

              await removePhase({ phaseId: phase.id as never })
              setSelectedPhaseId(null)
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
              const updated = await updatePhase({
                phaseId: phase.id as never,
                name: form.name,
              })
              const nextForm = createPhaseFormState(updated)
              setSavedForm(nextForm)
              setForm(nextForm)
            }}
          >
            <Save />
            Save
          </Button>
        </div>
      </div>

      <Field label="Name">
        <Input
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
          value={form.name}
        />
      </Field>

      <section className="grid gap-3 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Assigned scenarios
          </p>
          <Badge className="font-mono" variant="outline">
            {assignedScenarios.length}
          </Badge>
        </div>
        <div className="border border-border">
          {assignedScenarios.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              No scenarios are assigned to this phase yet.
            </div>
          ) : (
            assignedScenarios.map((scenario) => (
              <div
                className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
                key={scenario.id}
              >
                <span>
                  <span className="block text-foreground">{scenario.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {scenario.slug}
                  </span>
                </span>
                <Badge variant="outline">Scenario</Badge>
              </div>
            ))
          )}
        </div>
      </section>
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
    finishedAt: number | null
    submittedAt: number
    executionInstructions: string
    scoringPrompt: string
  } | null
}) {
  if (!result) {
    return (
      <BlankDetailPanel
        description="Choose a scenario result from this run to inspect rationale, summary, stored prompts, and failure details."
        icon={Wrench}
        title="Select an executed scenario"
      />
    )
  }

  const rationale = result.rationale ?? result.failureDetail

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
          <Badge variant={getScenarioResultBadgeVariant(result.status)}>
            {formatStatusLabel(result.status)}
          </Badge>
          <ScoreBadge value={result.score} />
        </div>
        <dl className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-3 border-t border-border pt-4">
          <RunHeaderMeta label="Runner" value={result.runnerType} />
          <RunHeaderMeta
            label="Started"
            value={formatTimestamp(result.startedAt)}
          />
          <RunHeaderMeta
            label="Finished"
            value={
              result.finishedAt === null
                ? "In progress"
                : formatTimestamp(result.finishedAt)
            }
          />
        </dl>
      </div>

      {result.improvementInstruction ? (
        <RunInsightPanel
          description="Most actionable follow-up instruction based on this result."
          title="Improvement instruction"
          value={result.improvementInstruction}
        />
      ) : null}

      {rationale ? (
        <RunInsightPanel
          description="Most relevant explanation for the scenario score."
          title="Rationale"
          value={rationale}
        />
      ) : null}

      <Field label="Execution summary">
        <CopyableTextBlock
          emptyText="No execution summary stored."
          value={result.executionSummary}
        />
      </Field>

      <div className="grid gap-5 border-t border-border pt-5">
        {result.failureDetail ? (
          <Field label="Failure detail">
            <CopyableTextBlock value={result.failureDetail} />
          </Field>
        ) : null}

        <Field
          description="Execution instructions captured from the scenario when this run started."
          label="Instructions"
        >
          <CopyableTextBlock value={result.executionInstructions} />
        </Field>
        <Field
          description="Scoring prompt captured from the scenario when this run started."
          label="Scoring prompt"
        >
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
        className="absolute top-2 right-2 z-10 text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:bg-transparent dark:hover:bg-transparent"
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

function RunInsightPanel({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: string
}) {
  return (
    <div className="border border-primary/40 bg-primary/5">
      <RunSectionHeader
        className="border-b border-primary/30 px-4 py-3"
        description={description}
        title={title}
      />
      <CopyableTextBlock className="border-0 bg-transparent" value={value} />
    </div>
  )
}

function RunSectionHeader({
  title,
  description,
  className,
}: {
  title: string
  description: string
  className?: string
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <p className="pt-1 text-xs tracking-[0.2em] text-muted-foreground uppercase">
        {title}
      </p>
      <HelpHintButton
        className="-mt-1 -mr-2"
        description={description}
        title={title}
      />
    </div>
  )
}

function useCoarsePointer() {
  const [coarsePointer, setCoarsePointer] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)")

    const update = () => {
      setCoarsePointer(mediaQuery.matches)
    }

    update()
    mediaQuery.addEventListener("change", update)

    return () => {
      mediaQuery.removeEventListener("change", update)
    }
  }, [])

  return coarsePointer
}

function RunHeaderMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[10rem]">
      <dt className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[12px] leading-5 text-foreground">
        {value}
      </dd>
    </div>
  )
}

function NavigationEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-6">
      <div className="max-w-xs text-center">
        <span className="inline-flex size-10 items-center justify-center border border-border bg-muted/20 text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {action ? (
          <div className="mt-4 flex justify-center">{action}</div>
        ) : null}
      </div>
    </div>
  )
}

function BlankDetailPanel({
  title,
  description,
  icon: Icon = CircleHelp,
}: {
  title: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-6">
      <div className="max-w-md text-center">
        <span className="inline-flex size-12 items-center justify-center border border-border bg-muted/20 text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <p className="mt-4 text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          Workspace detail
        </p>
        <p className="mt-2 text-lg font-medium text-foreground">{title}</p>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {description ??
            "The surrounding navigation stays active so you can change the current selection without losing context."}
        </p>
      </div>
    </div>
  )
}

function ScenarioEditorSkeleton() {
  return (
    <div className="grid h-full content-start gap-6 overflow-auto px-6 py-6">
      <div className="flex items-center justify-end gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-24" />
      </div>

      <div className="grid gap-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-8 w-full" />
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-9 w-full" />
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="min-h-48 w-full" />
        </div>

        <div className="grid gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="min-h-48 w-full" />
        </div>

        <div className="grid gap-3">
          <Skeleton className="h-4 w-24" />
          <div className="border border-border">
            <div className="border-b border-border px-3 py-2">
              <Skeleton className="h-4 w-full" />
            </div>
            <div className="space-y-3 px-3 py-3">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <Label>{label}</Label>
        {description ? (
          <HelpHintButton
            className="-mt-1 mr-2"
            description={description}
            title={label}
          />
        ) : null}
      </div>
      {children}
    </div>
  )
}

function HelpHintButton({
  title,
  description,
  className,
}: {
  title: string
  description: string
  className?: string
}) {
  const coarsePointer = useCoarsePointer()

  const button = (
    <Button
      aria-label={`${title} help`}
      className={cn(
        "text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:bg-transparent dark:hover:bg-transparent",
        className
      )}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <CircleHelp className="size-3.5" />
    </Button>
  )

  if (coarsePointer) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72 p-3">
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            {title}
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {description}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent align="end">
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            {title}
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">
            {description}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
