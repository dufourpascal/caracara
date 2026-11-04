import process from "node:process"
import { spawn } from "node:child_process"

import {
  CONVEX_TOKEN_TEMPLATE,
  API_NAMESPACE,
  formatRunName,
  MAX_REQUESTED_PHASE_ORDERS,
  type AuthoringRequest,
  type CheckResult,
  type OrderedScenario,
  type RunnablePhase,
} from "@workspace/contracts"

import {
  createRun,
  fetchExecutionPlan,
  finalizeRun,
  fetchProjects,
  fetchSingleScenario,
  fetchWhoAmI,
  startScenarioExecution,
  submitAuthoringOperation,
  submitScenarioResult,
  uploadRunEvidence,
} from "./api.js"
import {
  createPkcePair,
  exchangeAuthorizationCode,
  listenForOAuthCallback,
} from "./auth.js"
import {
  clearAuth,
  getLocalSecretsPath,
  readConfig,
  readLocalSecrets,
  readResolvedConfig,
  resolveEnvironment,
  writeConfig,
  writeLocalConfig,
} from "./config.js"
import { writeDiagnostic } from "./diagnostics.js"
import {
  getRunnerAdapter,
  RunnerExecutionError,
  type RunnerUsageReport,
} from "./execution.js"
import {
  parseHeartbeat,
  resolveOutputMode,
  RunProgress,
  type ProgressIo,
} from "./run-progress.js"
import {
  buildRunReport,
  buildScenarioReport,
  parseFailOn,
  resolveRunExitCode,
  type RunReportScenario,
  type ScenarioOutcome,
} from "./run-report.js"
import type { InitCommandOptions, RunCommandOptions } from "./types.js"

const CLIENT_ID = "caracara-cli"
const CLI_VERSION = "0.7.0"

function ensureAccessToken(config: Awaited<ReturnType<typeof readConfig>>) {
  if (!config.accessToken) {
    throw new Error("Not logged in. Run `caracara login` first.")
  }

  return config.accessToken
}

export async function loginCommand(apiBaseUrl?: string) {
  const current = await readConfig()
  const config = await readResolvedConfig({ apiBaseUrl }, process.env)
  const { verifier, challenge } = createPkcePair()
  const listener = await listenForOAuthCallback()
  const state = crypto.randomUUID()
  const url = new URL(
    `${config.apiBaseUrl}/api/${API_NAMESPACE}/oauth/authorize`
  )

  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("redirect_uri", listener.callbackUrl)
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("scope", CONVEX_TOKEN_TEMPLATE)

  openBrowser(url.toString())

  const callback = await listener.waitForCode()
  await listener.close()

  if (callback.state !== state) {
    throw new Error("OAuth state mismatch")
  }

  const token = await exchangeAuthorizationCode({
    apiBaseUrl: config.apiBaseUrl,
    clientId: CLIENT_ID,
    code: callback.code,
    codeVerifier: verifier,
    redirectUri: listener.callbackUrl,
  })

  const whoami = await fetchWhoAmI(
    config.apiBaseUrl,
    token.accessToken,
    CLI_VERSION
  )

  await writeConfig({
    ...current,
    apiBaseUrl: config.apiBaseUrl,
    accessToken: token.accessToken,
    expiresAt: token.expiresAt,
    userEmail: whoami.email,
  })

  process.stdout.write(`Logged in as ${whoami.email ?? whoami.userId}\n`)
}

export async function logoutCommand() {
  await clearAuth()
  process.stdout.write("Logged out.\n")
}

export async function whoamiCommand() {
  const config = await readResolvedConfig({}, process.env)
  const accessToken = ensureAccessToken(config)
  const whoami = await fetchWhoAmI(config.apiBaseUrl, accessToken, CLI_VERSION)
  process.stdout.write(`${whoami.email ?? whoami.userId}\n`)
}

export async function listProjectsCommand(apiBaseUrl?: string) {
  const config = await readResolvedConfig({ apiBaseUrl }, process.env)
  const accessToken = ensureAccessToken(config)
  const response = await fetchProjects(
    config.apiBaseUrl,
    accessToken,
    CLI_VERSION
  )

  if (response.projects.length === 0) {
    process.stdout.write("No projects found.\n")
    return
  }

  for (const project of response.projects) {
    process.stdout.write(`${project.slug}\t${project.name}\n`)
  }
}

export async function listEnvironmentsCommand(startDir = process.cwd()) {
  const config = await readResolvedConfig({}, process.env, startDir)
  const environments = Object.entries(config.environments).sort(
    ([left], [right]) => left.localeCompare(right)
  )

  if (environments.length === 0) {
    process.stdout.write("No environments configured.\n")
    return
  }

  for (const [name, targetUrl] of environments) {
    const marker = name === config.defaultEnvironment ? "\t(default)" : ""
    process.stdout.write(`${name}\t${targetUrl}${marker}\n`)
  }
}

type AuthoringCommandOptions = {
  apiBaseUrl?: string
  project?: string
}

async function getAuthoringContext(options: AuthoringCommandOptions) {
  const config = await readResolvedConfig(
    {
      apiBaseUrl: options.apiBaseUrl,
      selectedProjectSlug: options.project,
    },
    process.env
  )
  const accessToken = ensureAccessToken(config)

  if (!config.selectedProjectSlug) {
    throw new Error(
      "No project selected. Run `caracara init --project <slug>` or pass --project."
    )
  }

  return {
    apiBaseUrl: config.apiBaseUrl,
    accessToken,
    projectSlug: config.selectedProjectSlug,
  }
}

function printAuthoringResult(result: unknown) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

export function resolvePhaseReference(
  phases: RunnablePhase[],
  reference: string
) {
  const matches = new Map(
    phases
      .filter(
        (phase) =>
          phase.id === reference ||
          phase.name === reference ||
          String(phase.order) === reference
      )
      .map((phase) => [phase.id, phase])
  )

  if (matches.size === 0) {
    throw new Error(`Phase ${JSON.stringify(reference)} was not found.`)
  }

  if (matches.size > 1) {
    throw new Error(
      `Phase ${JSON.stringify(reference)} is ambiguous. Use its phase ID.`
    )
  }

  return [...matches.values()][0]!
}

export function resolveCheckReference(
  scenario: OrderedScenario,
  reference: string
) {
  const matches = new Map(
    scenario.evaluationChecks
      .filter((check) => check.id === reference || check.name === reference)
      .map((check) => [check.id, check])
  )

  if (matches.size === 0) {
    throw new Error(`Check ${JSON.stringify(reference)} was not found.`)
  }

  if (matches.size > 1) {
    throw new Error(
      `Check ${JSON.stringify(reference)} is ambiguous. Use its check ID.`
    )
  }

  return [...matches.values()][0]!
}

async function fetchAuthoringScenario(
  context: Awaited<ReturnType<typeof getAuthoringContext>>,
  scenarioSlug: string
) {
  return (
    await fetchSingleScenario({
      ...context,
      version: CLI_VERSION,
      scenarioSlug,
    })
  ).scenario
}

async function resolvePhaseId(
  context: Awaited<ReturnType<typeof getAuthoringContext>>,
  reference: string
) {
  const plan = await fetchExecutionPlan({
    ...context,
    version: CLI_VERSION,
  })
  return resolvePhaseReference(plan.phases, reference).id
}

async function resolveDependencyIds(
  context: Awaited<ReturnType<typeof getAuthoringContext>>,
  slugs: string[]
) {
  const scenarios = await Promise.all(
    [...new Set(slugs)].map((slug) => fetchAuthoringScenario(context, slug))
  )
  return scenarios.map((scenario) => scenario.id)
}

async function author(
  context: Awaited<ReturnType<typeof getAuthoringContext>>,
  payload: AuthoringRequest
) {
  const response = await submitAuthoringOperation({
    ...context,
    version: CLI_VERSION,
    payload,
  })
  printAuthoringResult(response)
  return response
}

export async function addPhaseCommand(
  options: AuthoringCommandOptions & { name: string }
) {
  const context = await getAuthoringContext(options)
  await author(context, { operation: "addPhase", name: options.name })
}

export async function editPhaseCommand(
  options: AuthoringCommandOptions & { phase: string; name: string }
) {
  const context = await getAuthoringContext(options)
  const phaseId = await resolvePhaseId(context, options.phase)
  await author(context, {
    operation: "editPhase",
    phaseId,
    name: options.name,
  })
}

export async function removePhaseCommand(
  options: AuthoringCommandOptions & { phase: string }
) {
  const context = await getAuthoringContext(options)
  const phaseId = await resolvePhaseId(context, options.phase)
  await author(context, { operation: "removePhase", phaseId })
}

export async function createScenarioCommand(
  options: AuthoringCommandOptions & {
    name: string
    slug?: string
    instructions: string
    phase?: string
    dependsOn?: string[]
  }
) {
  const context = await getAuthoringContext(options)
  const [phaseId, dependsOnScenarioIds] = await Promise.all([
    options.phase ? resolvePhaseId(context, options.phase) : undefined,
    resolveDependencyIds(context, options.dependsOn ?? []),
  ])
  await author(context, {
    operation: "createScenario",
    name: options.name,
    slug: options.slug,
    instructions: options.instructions,
    phaseId,
    dependsOnScenarioIds,
  })
}

export async function updateScenarioCommand(
  options: AuthoringCommandOptions & {
    scenario: string
    name?: string
    slug?: string
    status?: "draft" | "active"
    instructions?: string
    phase?: string
    unassigned?: boolean
    dependsOn?: string[]
    clearDependencies?: boolean
  }
) {
  if (options.phase && options.unassigned) {
    throw new Error("`--phase` cannot be combined with `--unassigned`.")
  }
  if (options.dependsOn && options.clearDependencies) {
    throw new Error(
      "`--depends-on` cannot be combined with `--clear-dependencies`."
    )
  }

  const context = await getAuthoringContext(options)
  const scenario = await fetchAuthoringScenario(context, options.scenario)
  const [phaseId, dependsOnScenarioIds] = await Promise.all([
    options.unassigned
      ? null
      : options.phase
        ? resolvePhaseId(context, options.phase)
        : undefined,
    options.clearDependencies
      ? []
      : options.dependsOn
        ? resolveDependencyIds(context, options.dependsOn)
        : undefined,
  ])
  await author(context, {
    operation: "updateScenario",
    scenarioId: scenario.id,
    name: options.name,
    slug: options.slug,
    status: options.status,
    instructions: options.instructions,
    phaseId,
    dependsOnScenarioIds,
  })
}

export async function addCheckCommand(
  options: AuthoringCommandOptions & {
    scenario: string
    name: string
    expectation: string
  }
) {
  const context = await getAuthoringContext(options)
  const scenario = await fetchAuthoringScenario(context, options.scenario)
  await author(context, {
    operation: "addCheck",
    scenarioId: scenario.id,
    check: {
      id: crypto.randomUUID(),
      name: options.name,
      expectation: options.expectation,
    },
  })
}

export async function removeCheckCommand(
  options: AuthoringCommandOptions & { scenario: string; check: string }
) {
  const context = await getAuthoringContext(options)
  const scenario = await fetchAuthoringScenario(context, options.scenario)
  const check = resolveCheckReference(scenario, options.check)
  await author(context, {
    operation: "removeCheck",
    scenarioId: scenario.id,
    checkId: check.id,
  })
}

export async function updateCheckCommand(
  options: AuthoringCommandOptions & {
    scenario: string
    check: string
    name?: string
    expectation?: string
  }
) {
  const context = await getAuthoringContext(options)
  const scenario = await fetchAuthoringScenario(context, options.scenario)
  const check = resolveCheckReference(scenario, options.check)
  await author(context, {
    operation: "updateCheck",
    scenarioId: scenario.id,
    checkId: check.id,
    name: options.name,
    expectation: options.expectation,
  })
}

export async function initCommand(options: InitCommandOptions) {
  const config = await readResolvedConfig(
    {
      apiBaseUrl: options.apiBaseUrl,
      selectedProjectSlug: options.project,
      runner: options.runner,
      model: options.model,
      model_reasoning_effort: options.modelReasoningEffort,
    },
    process.env
  )

  const configPath = await writeLocalConfig({
    apiBaseUrl: config.apiBaseUrl,
    selectedProjectSlug: config.selectedProjectSlug,
    runner: config.runner,
    model: config.model,
    model_reasoning_effort: config.model_reasoning_effort,
    environments: config.environments,
    defaultEnvironment: config.defaultEnvironment,
  })

  process.stdout.write(`Saved local config to ${configPath}\n`)
  process.stdout.write(`  apiBaseUrl: ${config.apiBaseUrl}\n`)
  process.stdout.write(
    `  project: ${config.selectedProjectSlug ?? "(not set)"}\n`
  )
  process.stdout.write(`  runner: ${config.runner}\n`)
  if (config.model) {
    process.stdout.write(`  model: ${config.model}\n`)
  }
  if (config.model_reasoning_effort) {
    process.stdout.write(
      `  model_reasoning_effort: ${config.model_reasoning_effort}\n`
    )
  }
  if (config.defaultEnvironment) {
    process.stdout.write(`  environment: ${config.defaultEnvironment}\n`)
  }
  process.stdout.write(`  secrets: ${getLocalSecretsPath(configPath)}\n`)
}

function parsePhaseOrder(value: string | undefined, flagName: string) {
  if (value === undefined) {
    return null
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer.`)
  }

  return parsed
}

/**
 * Parses a phase list such as `1-7,9,10` into sorted, unique phase orders.
 * Ranges are checked before they are expanded.
 */
export function parsePhaseList(value: string) {
  const tokens = value.split(",").map((token) => token.trim())
  if (tokens.some((token) => token === "")) {
    throw new Error(
      "--phases must be a comma-separated list of phase numbers or ranges, such as 1-7,9,10."
    )
  }
  const orders = new Set<number>()
  for (const token of tokens) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token)
    if (!match) {
      throw new Error(
        `--phases has an invalid entry "${token}". Use phase numbers or ranges, such as 1-7,9,10.`
      )
    }
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new Error(`--phases entry "${token}" is too large.`)
    }
    if (start <= 0 || end <= 0) {
      throw new Error("--phases entries must be positive phase numbers.")
    }
    if (end < start) {
      throw new Error(`--phases range "${token}" must go from low to high.`)
    }
    if (end - start + 1 > MAX_REQUESTED_PHASE_ORDERS) {
      throw new Error(
        `--phases can select at most ${MAX_REQUESTED_PHASE_ORDERS} phases.`
      )
    }
    for (let order = start; order <= end; order += 1) {
      orders.add(order)
      if (orders.size > MAX_REQUESTED_PHASE_ORDERS) {
        throw new Error(
          `--phases can select at most ${MAX_REQUESTED_PHASE_ORDERS} phases.`
        )
      }
    }
  }
  return [...orders].sort((left, right) => left - right)
}

/** Formats sorted phase orders compactly, for example `1-7, 9, 10`. */
export function formatPhaseList(orders: readonly number[]) {
  const parts: string[] = []
  let index = 0
  while (index < orders.length) {
    let end = index
    while (end + 1 < orders.length && orders[end + 1] === orders[end]! + 1) {
      end += 1
    }
    parts.push(
      end - index >= 2
        ? `${orders[index]}-${orders[end]}`
        : orders.slice(index, end + 1).join(", ")
    )
    index = end + 1
  }
  return parts.join(", ")
}

export function resolveRunMode(options: RunCommandOptions) {
  const requestedPhaseOrder = parsePhaseOrder(options.phase, "--phase")
  const requestedThroughPhaseOrder = parsePhaseOrder(
    options.throughPhase,
    "--through-phase"
  )

  const selectors = [
    options.scenario ? "--scenario" : null,
    options.suite ? "--suite" : null,
    requestedPhaseOrder !== null ? "--phase" : null,
    requestedThroughPhaseOrder !== null ? "--through-phase" : null,
    options.phases !== undefined ? "--phases" : null,
  ].filter((selector): selector is string => selector !== null)

  if (selectors.length > 1) {
    throw new Error(`${selectors.join(", ")} cannot be combined.`)
  }

  const none = {
    requestedScenarioSlug: null,
    requestedPhaseOrder: null,
    requestedPhaseOrders: null,
    requestedSuiteSlug: null,
  }

  if (options.scenario) {
    return {
      ...none,
      mode: "single" as const,
      requestedScenarioSlug: options.scenario,
    }
  }

  if (options.suite) {
    return {
      ...none,
      mode: "suite" as const,
      requestedSuiteSlug: options.suite,
    }
  }

  if (options.phases !== undefined) {
    const orders = parsePhaseList(options.phases)
    return orders.length === 1
      ? { ...none, mode: "phase" as const, requestedPhaseOrder: orders[0]! }
      : { ...none, mode: "phases" as const, requestedPhaseOrders: orders }
  }

  if (requestedPhaseOrder !== null) {
    return {
      ...none,
      mode: "phase" as const,
      requestedPhaseOrder,
    }
  }

  if (requestedThroughPhaseOrder !== null) {
    return {
      ...none,
      mode: "through_phase" as const,
      requestedPhaseOrder: requestedThroughPhaseOrder,
    }
  }

  return { ...none, mode: "all" as const }
}

type RunSelection = ReturnType<typeof resolveRunMode>

export function describeRunSelection(selection: RunSelection) {
  switch (selection.mode) {
    case "single":
      return `scenario ${selection.requestedScenarioSlug}`
    case "suite":
      return `suite ${selection.requestedSuiteSlug}`
    case "phase":
      return `phase ${selection.requestedPhaseOrder}`
    case "through_phase":
      return `phases 1-${selection.requestedPhaseOrder}`
    case "phases":
      return `phases ${formatPhaseList(selection.requestedPhaseOrders)}`
    case "all":
      return "all phases"
  }
}

type SuitePhaseSnapshot = { id: string; name: string; order: number }

const suitePhaseKey = (phase: SuitePhaseSnapshot) =>
  JSON.stringify([phase.id, phase.name, phase.order])

// Suite runs snapshot their phases when the run is created, before the CLI
// fetches the plan. Authoring stays open during runs, so refuse to execute a
// plan whose suite phases (membership, names or order) changed in between
// instead of labeling the run with phases it did not run.
export function assertSuitePlanMatchesRun(args: {
  suiteSlug: string
  runPhases: SuitePhaseSnapshot[]
  planPhases: SuitePhaseSnapshot[]
}) {
  const runPhases = new Set(args.runPhases.map(suitePhaseKey))
  const planPhases = new Set(args.planPhases.map(suitePhaseKey))
  if (
    runPhases.size !== planPhases.size ||
    [...planPhases].some((phase) => !runPhases.has(phase))
  ) {
    throw new Error(
      `Suite "${args.suiteSlug}" changed while the run was starting. Run it again.`
    )
  }
}

export async function runCommand(
  options: RunCommandOptions,
  ioOverrides: Partial<ProgressIo> = {}
) {
  const io: ProgressIo = {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    now: Date.now,
    ...ioOverrides,
  }
  const outputMode = resolveOutputMode({
    json: options.json,
    quiet: options.quiet,
    plain: options.plain,
    stdout: io.stdout,
    stderr: io.stderr,
    env: io.env,
  })
  const heartbeatMs = parseHeartbeat(options.heartbeat)
  const failOn = parseFailOn(options.failOn)
  const runSelection = resolveRunMode(options)
  const selection = describeRunSelection(runSelection)
  const cwd = process.cwd()
  const [config, secrets] = await Promise.all([
    readResolvedConfig(
      {
        apiBaseUrl: options.apiBaseUrl,
        selectedProjectSlug: options.project,
        runner: options.runner,
      },
      process.env
    ),
    readLocalSecrets(cwd),
  ])
  const accessToken = ensureAccessToken(config)
  const projectSlug = config.selectedProjectSlug

  if (!projectSlug) {
    throw new Error(
      "No project selected. Run `caracara init --project <slug>` or pass --project."
    )
  }

  const environment = resolveEnvironment(
    config,
    options.environment,
    process.env
  )

  const runnerType = config.runner
  const runner = getRunnerAdapter(runnerType)
  await runner.preflight?.()
  const runStartedAt = Date.now()
  const creationAttemptId = crypto.randomUUID()
  const finalizationAttemptId = crypto.randomUUID()
  let interruptedScenarioResultId: string | null = null
  let interruptedScenarioAttemptId: string | null = null
  const runAbortController = new AbortController()
  let interruptedSignal: "SIGINT" | "SIGTERM" | null = null
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    interruptedSignal ??= signal
    runAbortController.abort(
      new Error(`Execution interrupted by ${interruptedSignal}.`)
    )
  }
  const onSigint = () => interrupt("SIGINT")
  const onSigterm = () => interrupt("SIGTERM")
  let listeningForInterrupts = false
  const listenForInterrupts = () => {
    if (listeningForInterrupts) {
      return
    }
    listeningForInterrupts = true
    process.on("SIGINT", onSigint)
    process.on("SIGTERM", onSigterm)
  }
  const stopListeningForInterrupts = () => {
    process.off("SIGINT", onSigint)
    process.off("SIGTERM", onSigterm)
    listeningForInterrupts = false
  }
  const setSignalExitCode = () => {
    if (!interruptedSignal) {
      return false
    }
    process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143
    return true
  }
  const reportInterruptedFinalizationError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error"
    writeDiagnostic(`Failed to finalize interrupted run: ${message}\n`)
  }

  const startRun = (signal?: AbortSignal, interruptedAt?: number) =>
    createRun({
      apiBaseUrl: config.apiBaseUrl,
      accessToken,
      version: CLI_VERSION,
      projectSlug,
      payload: {
        mode: runSelection.mode,
        requestedScenarioSlug: runSelection.requestedScenarioSlug,
        requestedPhaseOrder: runSelection.requestedPhaseOrder,
        ...(runSelection.requestedPhaseOrders
          ? { requestedPhaseOrders: runSelection.requestedPhaseOrders }
          : {}),
        requestedSuiteSlug: runSelection.requestedSuiteSlug,
        runnerType,
        environment: environment.name,
        targetUrl: environment.targetUrl,
        startedAt: runStartedAt,
        creationAttemptId,
        ...(interruptedAt === undefined ? {} : { interruptedAt }),
      },
      signal,
    })
  let creationInterruptionFinishedAt: number | null = null
  const startRunWithRecovery = async () => {
    try {
      return await startRun(runAbortController.signal)
    } catch (error) {
      if (!interruptedSignal) {
        throw error
      }
      creationInterruptionFinishedAt = Date.now()
      return await startRun(
        AbortSignal.timeout(10_000),
        creationInterruptionFinishedAt
      )
    }
  }
  const finalizeInterruptedRun = (runId: string, finishedAt = Date.now()) =>
    finalizeRun({
      apiBaseUrl: config.apiBaseUrl,
      accessToken,
      version: CLI_VERSION,
      projectSlug,
      runId,
      payload: {
        status: "interrupted",
        finishedAt,
        finalizationAttemptId,
        ...(interruptedScenarioResultId ? { interruptedScenarioResultId } : {}),
        ...(interruptedScenarioAttemptId
          ? { interruptedScenarioAttemptId }
          : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })
  const signalExitCode = () => (interruptedSignal === "SIGINT" ? 130 : 143)
  // Reports a run that was created but ended before any scenario started,
  // so JSON consumers still get run.finished and text output a summary.
  const reportRunEndedEarly = (
    run: { id: string; name: string },
    exitCode: number,
    queue: ReadonlyArray<{
      phase: { id: string; order: number; name: string } | null
    }> = []
  ) => {
    const progress = new RunProgress(outputMode, io, 0)
    try {
      const finishedAt = Date.now()
      progress.runFinished(
        buildRunReport({
          run: {
            id: run.id,
            name: run.name,
            url: buildRunUrl(config.apiBaseUrl, projectSlug, run.id),
            status: "interrupted",
            mode: runSelection.mode,
            selection,
            environment: environment.name,
            targetUrl: environment.targetUrl,
            runnerType,
            model: config.model ?? null,
            modelReasoningEffort: config.model_reasoning_effort ?? null,
            startedAt: runStartedAt,
            finishedAt,
            exitCode,
          },
          queue: queue.map((item) => ({
            phase: item.phase
              ? {
                  id: item.phase.id,
                  order: item.phase.order,
                  name: item.phase.name,
                }
              : null,
          })),
          scenarios: [],
        })
      )
    } finally {
      progress.dispose()
    }
  }
  const finishSignalInterruption = async (runId: string) => {
    try {
      await finalizeInterruptedRun(
        runId,
        creationInterruptionFinishedAt ?? Date.now()
      )
    } catch (error) {
      reportInterruptedFinalizationError(error)
    } finally {
      stopListeningForInterrupts()
    }
    setSignalExitCode()
  }
  let createRunResponse: Awaited<ReturnType<typeof startRun>> | null = null
  if (runSelection.mode === "suite") {
    listenForInterrupts()
    try {
      createRunResponse = await startRunWithRecovery()
    } catch (error) {
      stopListeningForInterrupts()
      if (setSignalExitCode()) {
        return
      }
      throw error
    }
    if (interruptedSignal) {
      await finishSignalInterruption(createRunResponse.run.id)
      reportRunEndedEarly(createRunResponse.run, signalExitCode())
      return
    }
  }
  const executionSource = await (
    runSelection.mode === "single"
      ? fetchSingleScenario({
          apiBaseUrl: config.apiBaseUrl,
          accessToken,
          version: CLI_VERSION,
          projectSlug,
          scenarioSlug: runSelection.requestedScenarioSlug,
        }).then((response) => {
          runAbortController.signal.throwIfAborted()
          return {
            project: response.project,
            phases: [] as RunnablePhase[],
            suite: null,
            unassignedScenarioCount: 0,
            queue: [
              {
                phase: null as RunnablePhase | null,
                scenario: response.scenario,
              },
            ],
          }
        })
      : fetchExecutionPlan({
          apiBaseUrl: config.apiBaseUrl,
          accessToken,
          version: CLI_VERSION,
          projectSlug,
          suiteSlug: runSelection.requestedSuiteSlug ?? undefined,
          signal: runAbortController.signal,
        }).then((response) => {
          runAbortController.signal.throwIfAborted()
          if (runSelection.mode === "suite" && createRunResponse) {
            assertSuitePlanMatchesRun({
              suiteSlug: runSelection.requestedSuiteSlug,
              runPhases: createRunResponse.run.requestedSuitePhases ?? [],
              planPhases: response.phases,
            })
          }
          const requestedOrders = runSelection.requestedPhaseOrders
          const selectedPhases =
            runSelection.mode === "phase"
              ? response.phases.filter(
                  (phase) => phase.order === runSelection.requestedPhaseOrder
                )
              : runSelection.mode === "through_phase"
                ? response.phases.filter(
                    (phase) => phase.order <= runSelection.requestedPhaseOrder
                  )
                : requestedOrders
                  ? response.phases.filter((phase) =>
                      requestedOrders.includes(phase.order)
                    )
                  : response.phases

          if (requestedOrders) {
            const missing = requestedOrders.filter(
              (order) => !response.phases.some((phase) => phase.order === order)
            )
            if (missing.length > 0) {
              throw new Error(
                `${missing.length === 1 ? "Phase" : "Phases"} ${missing.join(", ")} ${missing.length === 1 ? "does" : "do"} not exist in project ${projectSlug}.`
              )
            }
          }

          if (
            (runSelection.mode === "phase" ||
              runSelection.mode === "through_phase") &&
            !response.phases.some(
              (phase) => phase.order === runSelection.requestedPhaseOrder
            )
          ) {
            throw new Error(
              `Phase ${runSelection.requestedPhaseOrder} does not exist in project ${projectSlug}.`
            )
          }

          return {
            ...response,
            queue: selectedPhases.flatMap((phase) =>
              phase.scenarios.map((scenario) => ({
                phase,
                scenario,
              }))
            ),
          }
        })
  ).catch(async (error) => {
    let finalizationError: unknown = null
    try {
      if (createRunResponse) {
        await finalizeInterruptedRun(createRunResponse.run.id)
      }
    } catch (cleanupError) {
      finalizationError = cleanupError
    } finally {
      stopListeningForInterrupts()
    }
    if (createRunResponse) {
      reportRunEndedEarly(
        createRunResponse.run,
        interruptedSignal ? signalExitCode() : 1
      )
    }
    if (setSignalExitCode()) {
      if (finalizationError) {
        reportInterruptedFinalizationError(finalizationError)
      }
      return null
    }
    if (finalizationError) {
      throw finalizationError
    }
    throw error
  })

  if (!executionSource) {
    return
  }

  if (executionSource.queue.length === 0) {
    let finalizationError: unknown = null
    try {
      if (createRunResponse) {
        await finalizeInterruptedRun(createRunResponse.run.id)
      }
    } catch (error) {
      finalizationError = error
    } finally {
      stopListeningForInterrupts()
    }
    if (createRunResponse) {
      reportRunEndedEarly(
        createRunResponse.run,
        interruptedSignal ? signalExitCode() : 1
      )
    }
    if (setSignalExitCode()) {
      if (finalizationError) {
        reportInterruptedFinalizationError(finalizationError)
      }
      return
    }
    if (finalizationError) {
      throw finalizationError
    }
    throw new Error(
      runSelection.mode === "phase"
        ? `Phase ${runSelection.requestedPhaseOrder} has no active scenarios to run.`
        : runSelection.mode === "phases"
          ? `Phases ${formatPhaseList(runSelection.requestedPhaseOrders)} have no active scenarios to run.`
          : runSelection.mode === "suite"
            ? `Suite "${runSelection.requestedSuiteSlug}" has no active scenarios to run.`
            : "No runnable scenarios found."
    )
  }

  if (!createRunResponse) {
    listenForInterrupts()
    try {
      createRunResponse = await startRunWithRecovery()
    } catch (error) {
      stopListeningForInterrupts()
      if (setSignalExitCode()) {
        return
      }
      throw error
    }
    if (interruptedSignal) {
      await finishSignalInterruption(createRunResponse.run.id)
      reportRunEndedEarly(
        createRunResponse.run,
        signalExitCode(),
        executionSource.queue
      )
      return
    }
  }

  const runId = createRunResponse.run.id
  const queue = executionSource.queue
  const queuePhases = queue.map((item) =>
    item.phase
      ? { id: item.phase.id, order: item.phase.order, name: item.phase.name }
      : null
  )
  const phaseIds = [
    ...new Set(queue.flatMap((item) => (item.phase ? [item.phase.id] : []))),
  ]
  const keepGoing = options.keepGoing ?? true
  const progress = new RunProgress(outputMode, io, heartbeatMs)
  const scenarioReports: RunReportScenario[] = []

  const buildScenarioSnapshot = (args: {
    phase: RunnablePhase | null
    scenario: OrderedScenario
    sequenceIndex: number
    startedAt: number
  }) => ({
    scenarioId: args.scenario.id,
    scenarioSlug: args.scenario.slug,
    scenarioName: args.scenario.name,
    executionInstructions: args.scenario.instructions,
    evaluationChecks: args.scenario.evaluationChecks,
    phaseId: args.phase?.id ?? args.scenario.phaseId ?? null,
    phaseName: args.phase?.name ?? args.scenario.phaseName ?? null,
    phaseOrder: args.phase?.order ?? args.scenario.phaseOrder ?? null,
    sequenceIndex: args.sequenceIndex,
    runnerType,
    startedAt: args.startedAt,
  })
  const recordScenario = (args: {
    sequenceIndex: number
    status: ScenarioOutcome
    startedAt: number
    checkResults?: CheckResult[]
    usage?: RunnerUsageReport | null
    failureDetail?: string | null
  }) => {
    const item = queue[args.sequenceIndex]!
    const snapshot = buildScenarioSnapshot({
      phase: item.phase,
      scenario: item.scenario,
      sequenceIndex: args.sequenceIndex,
      startedAt: args.startedAt,
    })
    const report = buildScenarioReport({
      sequenceIndex: args.sequenceIndex,
      scenario: item.scenario,
      phase:
        snapshot.phaseOrder !== null && snapshot.phaseName !== null
          ? {
              id: snapshot.phaseId,
              order: snapshot.phaseOrder,
              name: snapshot.phaseName,
            }
          : null,
      status: args.status,
      startedAt: args.startedAt,
      finishedAt: Date.now(),
      checkResults: args.checkResults ?? [],
      usage: args.usage ?? null,
      failureDetail: args.failureDetail ?? null,
    })
    scenarioReports.push(report)
    progress.scenarioFinished(report)
  }

  let runFailed = false
  // Every remaining scenario is skipped (no keep-going, or the session broke).
  let stopRemaining = false
  // With keep-going, only scenarios that depend on one that did not complete
  // are skipped. Dependencies never cross phases.
  const unfinishedScenarioSlugs = new Map<string, string>()
  let consecutiveFirstScenarioFailures = 0
  let executedInCurrentPhase = 0
  let finalRunStatus: "completed" | "failed" | "interrupted" | null = null
  let finalFinishedAt: number | null = null
  let closeError: unknown = null
  let finalizationError: unknown = null
  let runError: unknown = null
  let runSession: Awaited<ReturnType<typeof runner.startRun>> | null = null
  let activeScenario: ReturnType<typeof buildScenarioSnapshot> | null = null
  let activeScenarioIndex: number | null = null
  let activeScenarioUsage: RunnerUsageReport | null = null
  let activeScenarioResultId: string | null = null
  let activeScenarioAttemptId: string | null = null
  let lastPhaseId: string | null = null
  let exitCode = 0

  try {
    progress.runStarted({
      runId,
      runName: createRunResponse.run.name,
      runUrl: buildRunUrl(config.apiBaseUrl, projectSlug, runId),
      startedAt: runStartedAt,
      environment: environment.name,
      targetUrl: environment.targetUrl,
      runnerType,
      model: config.model ?? null,
      modelReasoningEffort: config.model_reasoning_effort ?? null,
      suite: executionSource.suite
        ? {
            name: executionSource.suite.name,
            slug: executionSource.suite.slug,
          }
        : null,
      selection,
      scenarioCount: queue.length,
      phaseCount: phaseIds.length,
      keepGoing,
      liveActivity: runnerType === "codex",
    })

    try {
      runAbortController.signal.throwIfAborted()
      for (const [sequenceIndex, item] of queue.entries()) {
        runAbortController.signal.throwIfAborted()
        const startedAt = Date.now()
        const scenarioSnapshot = buildScenarioSnapshot({
          phase: item.phase,
          scenario: item.scenario,
          sequenceIndex,
          startedAt,
        })

        if (item.phase && item.phase.id !== lastPhaseId) {
          lastPhaseId = item.phase.id
          executedInCurrentPhase = 0
          progress.phaseStarted({
            order: item.phase.order,
            name: item.phase.name,
            index: phaseIds.indexOf(item.phase.id) + 1,
            scenarioCount: queue.filter(
              (entry) => entry.phase?.id === item.phase?.id
            ).length,
          })
        }

        progress.scenarioStarted({
          index: sequenceIndex + 1,
          slug: item.scenario.slug,
          phaseOrder: item.phase?.order ?? null,
        })

        activeScenario = scenarioSnapshot
        activeScenarioIndex = sequenceIndex
        activeScenarioUsage = null
        activeScenarioAttemptId = crypto.randomUUID()
        const startedScenario = await startScenarioExecution({
          apiBaseUrl: config.apiBaseUrl,
          accessToken,
          version: CLI_VERSION,
          projectSlug,
          runId,
          payload: {
            runId,
            result: {
              ...scenarioSnapshot,
              executionAttemptId: activeScenarioAttemptId,
            },
          },
          signal: runAbortController.signal,
        })
        activeScenarioResultId = startedScenario.result.id
        runAbortController.signal.throwIfAborted()

        const failedDependencySlug = item.scenario.dependencyIds
          .map((dependencyId) => unfinishedScenarioSlugs.get(dependencyId))
          .find((slug) => slug !== undefined)
        const skipDetail = stopRemaining
          ? "Dependency chain stopped after an earlier failure."
          : failedDependencySlug !== undefined
            ? `Skipped because dependency ${failedDependencySlug} did not complete.`
            : null
        if (skipDetail) {
          await submitScenarioResult({
            apiBaseUrl: config.apiBaseUrl,
            accessToken,
            version: CLI_VERSION,
            projectSlug,
            runId,
            payload: {
              runId,
              result: {
                scenarioId: scenarioSnapshot.scenarioId,
                status: "dependency_failed",
                checkResults: [],
                executionSummary: null,
                failureDetail: skipDetail,
                finishedAt: Date.now(),
                ...(activeScenarioAttemptId
                  ? { executionAttemptId: activeScenarioAttemptId }
                  : {}),
              },
            },
            signal: runAbortController.signal,
          })
          runAbortController.signal.throwIfAborted()
          unfinishedScenarioSlugs.set(item.scenario.id, item.scenario.slug)
          activeScenario = null
          activeScenarioIndex = null
          activeScenarioResultId = null
          activeScenarioAttemptId = null
          recordScenario({
            sequenceIndex,
            status: "dependency_failed",
            startedAt,
            failureDetail: skipDetail,
          })
          continue
        }

        const firstInPhase = executedInCurrentPhase === 0
        executedInCurrentPhase += 1
        try {
          runSession ??= await runner.startRun({
            cwd,
            secrets,
            targetUrl: environment.targetUrl,
            model: config.model,
            modelReasoningEffort: config.model_reasoning_effort,
            signal: runAbortController.signal,
          })
          runAbortController.signal.throwIfAborted()

          activeScenarioUsage = { complete: false }
          const execution = await runSession.executeScenario({
            cwd,
            environment: environment.name,
            targetUrl: environment.targetUrl,
            projectPrompt: executionSource.project.projectPrompt,
            scenario: item.scenario,
            signal: runAbortController.signal,
            onActivity: (activity) => progress.activity(activity),
          })
          activeScenarioUsage = execution.usage ?? { complete: false }

          if (
            createRunResponse.run.evidencePolicy === "failed_check_screenshot"
          ) {
            if (!createRunResponse.evidenceUploadUrl) {
              throw new Error("Screenshot evidence upload is not configured.")
            }
            const screenshots = execution.screenshotEvidence ?? []
            for (const screenshot of screenshots) {
              await uploadRunEvidence({
                uploadUrl: createRunResponse.evidenceUploadUrl,
                accessToken,
                runId,
                scenarioResultId: startedScenario.result.id,
                checkId: screenshot.checkId,
                sha256: screenshot.sha256,
                bytes: screenshot.bytes,
                signal: runAbortController.signal,
              })
            }
          }
          const finishedAt = Date.now()

          await submitScenarioResult({
            apiBaseUrl: config.apiBaseUrl,
            accessToken,
            version: CLI_VERSION,
            projectSlug,
            runId,
            payload: {
              runId,
              result: {
                scenarioId: scenarioSnapshot.scenarioId,
                status: "completed",
                checkResults: execution.checkResults,
                executionSummary: execution.executionSummary,
                failureDetail: null,
                finishedAt,
                ...(activeScenarioAttemptId
                  ? { executionAttemptId: activeScenarioAttemptId }
                  : {}),
              },
            },
            signal: runAbortController.signal,
          })
          runAbortController.signal.throwIfAborted()
          activeScenario = null
          activeScenarioIndex = null
          activeScenarioResultId = null
          activeScenarioAttemptId = null
          // A completed scenario shows the run is not broken as a whole.
          consecutiveFirstScenarioFailures = 0
          recordScenario({
            sequenceIndex,
            status: "completed",
            startedAt,
            checkResults: execution.checkResults,
            usage: activeScenarioUsage,
          })
          activeScenarioUsage = null
        } catch (error) {
          if (error instanceof RunnerExecutionError) {
            activeScenarioUsage = error.usage
          }
          if (runAbortController.signal.aborted) {
            throw error
          }
          runFailed = true
          unfinishedScenarioSlugs.set(item.scenario.id, item.scenario.slug)
          if (item.phase && firstInPhase) {
            consecutiveFirstScenarioFailures += 1
          }
          const sessionBroken =
            runSession === null || runSession.isHealthy?.() === false
          if (
            !keepGoing ||
            sessionBroken ||
            consecutiveFirstScenarioFailures >= 2
          ) {
            stopRemaining = true
          }
          const failureDetail =
            error instanceof Error ? error.message : "Runner failed"
          await submitScenarioResult({
            apiBaseUrl: config.apiBaseUrl,
            accessToken,
            version: CLI_VERSION,
            projectSlug,
            runId,
            payload: {
              runId,
              result: {
                scenarioId: scenarioSnapshot.scenarioId,
                status: "runner_failed",
                checkResults: [],
                executionSummary: null,
                failureDetail,
                finishedAt: Date.now(),
                ...(activeScenarioAttemptId
                  ? { executionAttemptId: activeScenarioAttemptId }
                  : {}),
              },
            },
            signal: runAbortController.signal,
          })
          runAbortController.signal.throwIfAborted()
          activeScenario = null
          activeScenarioIndex = null
          activeScenarioResultId = null
          activeScenarioAttemptId = null
          recordScenario({
            sequenceIndex,
            status: "runner_failed",
            startedAt,
            usage: activeScenarioUsage,
            failureDetail,
          })
          activeScenarioUsage = null
        }
      }
      runAbortController.signal.throwIfAborted()
      finalRunStatus = runFailed ? "failed" : "completed"
      finalFinishedAt = Date.now()
    } catch (error) {
      runError = error
      if (activeScenario) {
        interruptedScenarioResultId = activeScenarioResultId
        interruptedScenarioAttemptId = activeScenarioAttemptId
        const failureDetail = interruptedSignal
          ? `Execution interrupted by ${interruptedSignal}.`
          : error instanceof Error
            ? error.message
            : "Execution interrupted"
        try {
          await submitScenarioResult({
            apiBaseUrl: config.apiBaseUrl,
            accessToken,
            version: CLI_VERSION,
            projectSlug,
            runId,
            payload: {
              runId,
              result: {
                scenarioId: activeScenario.scenarioId,
                status: "interrupted",
                checkResults: [],
                executionSummary: null,
                failureDetail,
                finishedAt: Date.now(),
                ...(activeScenarioAttemptId
                  ? { executionAttemptId: activeScenarioAttemptId }
                  : {}),
              },
            },
            signal: AbortSignal.timeout(10_000),
          })
        } catch {
          // Preserve the original interruption error from the run loop.
        }
        if (activeScenarioIndex !== null) {
          recordScenario({
            sequenceIndex: activeScenarioIndex,
            status: "interrupted",
            startedAt: activeScenario.startedAt,
            usage: activeScenarioUsage,
            failureDetail,
          })
        }
        activeScenario = null
        activeScenarioIndex = null
        activeScenarioResultId = null
        activeScenarioAttemptId = null
        activeScenarioUsage = null
      }
      finalRunStatus = "interrupted"
      finalFinishedAt = Date.now()
    } finally {
      try {
        await runSession?.close()
      } catch (error) {
        closeError = error
      }

      if (interruptedSignal) {
        finalRunStatus = "interrupted"
        finalFinishedAt = Date.now()
      }

      try {
        if (finalRunStatus && finalFinishedAt !== null) {
          try {
            await finalizeRun({
              apiBaseUrl: config.apiBaseUrl,
              accessToken,
              version: CLI_VERSION,
              projectSlug,
              runId,
              payload: {
                status: finalRunStatus,
                finishedAt: finalFinishedAt,
                finalizationAttemptId,
                ...(interruptedScenarioResultId
                  ? { interruptedScenarioResultId }
                  : {}),
                ...(interruptedScenarioAttemptId
                  ? { interruptedScenarioAttemptId }
                  : {}),
              },
              signal: runAbortController.signal,
            })
            if (interruptedSignal && finalRunStatus !== "interrupted") {
              await finalizeInterruptedRun(runId)
            }
          } catch (error) {
            if (!interruptedSignal) {
              finalizationError = error
            } else {
              try {
                await finalizeInterruptedRun(
                  runId,
                  finalRunStatus === "interrupted" ? finalFinishedAt : undefined
                )
              } catch (correctionError) {
                finalizationError = correctionError
              }
            }
          }
        }
      } finally {
        stopListeningForInterrupts()
      }
    }

    exitCode = interruptedSignal
      ? signalExitCode()
      : finalizationError || runError || closeError
        ? 1
        : resolveRunExitCode({ scenarios: scenarioReports, failOn })
    progress.runFinished(
      buildRunReport({
        run: {
          id: runId,
          name: createRunResponse.run.name,
          url: buildRunUrl(config.apiBaseUrl, projectSlug, runId),
          status: interruptedSignal
            ? "interrupted"
            : (finalRunStatus ?? "interrupted"),
          mode: runSelection.mode,
          selection,
          environment: environment.name,
          targetUrl: environment.targetUrl,
          runnerType,
          model: config.model ?? null,
          modelReasoningEffort: config.model_reasoning_effort ?? null,
          startedAt: runStartedAt,
          finishedAt: finalFinishedAt ?? Date.now(),
          exitCode,
        },
        queue: queuePhases.map((phase) => ({ phase })),
        scenarios: scenarioReports,
      })
    )
  } finally {
    progress.dispose()
  }

  if (setSignalExitCode()) {
    if (finalizationError) {
      reportInterruptedFinalizationError(finalizationError)
    }
    return
  }

  if (finalizationError) {
    throw finalizationError
  }

  if (runError) {
    throw runError
  }

  if (closeError) {
    throw closeError
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode
  }
}

/** Web app page for a run. The API is served by the web app's origin. */
export function buildRunUrl(
  apiBaseUrl: string,
  projectSlug: string,
  runId: string
) {
  try {
    return new URL(
      `projects/${encodeURIComponent(projectSlug)}/runs/${encodeURIComponent(runId)}`,
      apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`
    ).toString()
  } catch {
    return null
  }
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]

  const [bin, ...args] = command

  if (!bin) {
    throw new Error("Unable to determine a browser open command")
  }

  spawn(bin, args, {
    detached: true,
    stdio: "ignore",
  }).unref()
}

export const cliVersion = CLI_VERSION
export const clientId = CLIENT_ID
export const sampleRunName = () => formatRunName()
