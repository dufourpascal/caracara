import process from "node:process"
import { spawn } from "node:child_process"

import {
  CONVEX_TOKEN_TEMPLATE,
  API_NAMESPACE,
  formatRunName,
  type AuthoringRequest,
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
import {
  formatRunnerUsage,
  getRunnerAdapter,
  mergeRunnerUsage,
  RunnerExecutionError,
  type RunnerUsageReport,
} from "./execution.js"
import type { InitCommandOptions, RunCommandOptions } from "./types.js"

const CLIENT_ID = "caracara-cli"
const CLI_VERSION = "0.6.1"

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
  ].filter((selector): selector is string => selector !== null)

  if (selectors.length > 1) {
    throw new Error(`${selectors.join(", ")} cannot be combined.`)
  }

  if (options.scenario) {
    return {
      mode: "single" as const,
      requestedScenarioSlug: options.scenario,
      requestedPhaseOrder: null,
      requestedSuiteSlug: null,
    }
  }

  if (options.suite) {
    return {
      mode: "suite" as const,
      requestedScenarioSlug: null,
      requestedPhaseOrder: null,
      requestedSuiteSlug: options.suite,
    }
  }

  if (requestedPhaseOrder !== null) {
    return {
      mode: "phase" as const,
      requestedScenarioSlug: null,
      requestedPhaseOrder,
      requestedSuiteSlug: null,
    }
  }

  if (requestedThroughPhaseOrder !== null) {
    return {
      mode: "through_phase" as const,
      requestedScenarioSlug: null,
      requestedPhaseOrder: requestedThroughPhaseOrder,
      requestedSuiteSlug: null,
    }
  }

  return {
    mode: "all" as const,
    requestedScenarioSlug: null,
    requestedPhaseOrder: null,
    requestedSuiteSlug: null,
  }
}

export async function runCommand(options: RunCommandOptions) {
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
  const runSelection = resolveRunMode(options)
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
    process.once("SIGINT", onSigint)
    process.once("SIGTERM", onSigterm)
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
    process.stderr.write(`Failed to finalize interrupted run: ${message}\n`)
  }

  const startRun = () =>
    createRun({
      apiBaseUrl: config.apiBaseUrl,
      accessToken,
      version: CLI_VERSION,
      projectSlug,
      payload: {
        mode: runSelection.mode,
        requestedScenarioSlug: runSelection.requestedScenarioSlug,
        requestedPhaseOrder: runSelection.requestedPhaseOrder,
        requestedSuiteSlug: runSelection.requestedSuiteSlug,
        runnerType,
        environment: environment.name,
        targetUrl: environment.targetUrl,
        startedAt: Date.now(),
      },
    })
  const finalizeInterruptedRun = (runId: string) =>
    finalizeRun({
      apiBaseUrl: config.apiBaseUrl,
      accessToken,
      version: CLI_VERSION,
      projectSlug,
      runId,
      payload: { status: "interrupted", finishedAt: Date.now() },
    })
  const finishSignalInterruption = async (runId: string) => {
    try {
      await finalizeInterruptedRun(runId)
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
      createRunResponse = await startRun()
    } catch (error) {
      stopListeningForInterrupts()
      throw error
    }
    if (interruptedSignal) {
      await finishSignalInterruption(createRunResponse.run.id)
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
        }).then((response) => {
          runAbortController.signal.throwIfAborted()
          const selectedPhases =
            runSelection.mode === "phase"
              ? response.phases.filter(
                  (phase) => phase.order === runSelection.requestedPhaseOrder
                )
              : runSelection.mode === "through_phase"
                ? response.phases.filter(
                    (phase) => phase.order <= runSelection.requestedPhaseOrder
                  )
                : response.phases

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
    if (createRunResponse && interruptedSignal) {
      await finishSignalInterruption(createRunResponse.run.id)
      return null
    }
    if (createRunResponse) {
      await finalizeInterruptedRun(createRunResponse.run.id)
    }
    stopListeningForInterrupts()
    throw error
  })

  if (!executionSource) {
    return
  }

  if (executionSource.queue.length === 0) {
    if (createRunResponse) {
      await finalizeInterruptedRun(createRunResponse.run.id)
    }
    stopListeningForInterrupts()
    throw new Error(
      runSelection.mode === "phase"
        ? `Phase ${runSelection.requestedPhaseOrder} has no active scenarios to run.`
        : runSelection.mode === "suite"
          ? `Suite "${runSelection.requestedSuiteSlug}" has no active scenarios to run.`
          : "No runnable scenarios found."
    )
  }

  if (!createRunResponse) {
    listenForInterrupts()
    try {
      createRunResponse = await startRun()
    } catch (error) {
      stopListeningForInterrupts()
      throw error
    }
    if (interruptedSignal) {
      await finishSignalInterruption(createRunResponse.run.id)
      return
    }
  }

  process.stdout.write(`Run ${createRunResponse.run.name}\n`)
  process.stdout.write(
    `Environment ${environment.name} (${environment.targetUrl})\n`
  )
  if (executionSource.suite) {
    process.stdout.write(
      `Suite ${executionSource.suite.name} (${executionSource.suite.slug})\n`
    )
  }

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

  let runFailed = false
  let finalRunStatus: "completed" | "failed" | "interrupted" | null = null
  let finalFinishedAt: number | null = null
  let closeError: unknown = null
  let finalizationError: unknown = null
  let runError: unknown = null
  let runUsage: RunnerUsageReport = { complete: true }
  let runSession: Awaited<ReturnType<typeof runner.startRun>> | null = null
  let activeScenario: ReturnType<typeof buildScenarioSnapshot> | null = null
  let lastPrintedPhaseId: string | null = null

  try {
    runAbortController.signal.throwIfAborted()
    for (const [sequenceIndex, item] of executionSource.queue.entries()) {
      runAbortController.signal.throwIfAborted()
      const startedAt = Date.now()
      const scenarioSnapshot = buildScenarioSnapshot({
        phase: item.phase,
        scenario: item.scenario,
        sequenceIndex,
        startedAt,
      })

      if (item.phase && item.phase.id !== lastPrintedPhaseId) {
        process.stdout.write(
          `\nPhase ${item.phase.order}: ${item.phase.name}\n`
        )
        lastPrintedPhaseId = item.phase.id
      }

      process.stdout.write(
        `Executing ${item.scenario.slug} with ${runnerType}\n`
      )

      activeScenario = scenarioSnapshot
      const startedScenario = await startScenarioExecution({
        apiBaseUrl: config.apiBaseUrl,
        accessToken,
        version: CLI_VERSION,
        projectSlug,
        runId: createRunResponse.run.id,
        payload: {
          runId: createRunResponse.run.id,
          result: scenarioSnapshot,
        },
        signal: runAbortController.signal,
      })
      runAbortController.signal.throwIfAborted()

      if (runFailed) {
        await submitScenarioResult({
          apiBaseUrl: config.apiBaseUrl,
          accessToken,
          version: CLI_VERSION,
          projectSlug,
          runId: createRunResponse.run.id,
          payload: {
            runId: createRunResponse.run.id,
            result: {
              scenarioId: scenarioSnapshot.scenarioId,
              status: "dependency_failed",
              checkResults: [],
              executionSummary: null,
              failureDetail:
                "Dependency chain stopped after an earlier failure.",
              finishedAt: Date.now(),
            },
          },
          signal: runAbortController.signal,
        })
        runAbortController.signal.throwIfAborted()
        activeScenario = null
        continue
      }

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

        const execution = await runSession.executeScenario({
          cwd,
          environment: environment.name,
          targetUrl: environment.targetUrl,
          projectPrompt: executionSource.project.projectPrompt,
          scenario: item.scenario,
          signal: runAbortController.signal,
        })
        runUsage = mergeRunnerUsage(
          runUsage,
          execution.usage ?? { complete: false }
        )

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
              runId: createRunResponse.run.id,
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
          runId: createRunResponse.run.id,
          payload: {
            runId: createRunResponse.run.id,
            result: {
              scenarioId: scenarioSnapshot.scenarioId,
              status: "completed",
              checkResults: execution.checkResults,
              executionSummary: execution.executionSummary,
              failureDetail: null,
              finishedAt,
            },
          },
          signal: runAbortController.signal,
        })
        runAbortController.signal.throwIfAborted()
        activeScenario = null
        const passed = execution.checkResults.filter(
          (result) => result.verdict === "passed"
        ).length
        process.stdout.write(
          `  ${passed}/${execution.checkResults.length} checks passed\n`
        )
      } catch (error) {
        if (error instanceof RunnerExecutionError) {
          runUsage = mergeRunnerUsage(runUsage, error.usage)
        }
        if (runAbortController.signal.aborted) {
          throw error
        }
        runFailed = true
        await submitScenarioResult({
          apiBaseUrl: config.apiBaseUrl,
          accessToken,
          version: CLI_VERSION,
          projectSlug,
          runId: createRunResponse.run.id,
          payload: {
            runId: createRunResponse.run.id,
            result: {
              scenarioId: scenarioSnapshot.scenarioId,
              status: "runner_failed",
              checkResults: [],
              executionSummary: null,
              failureDetail:
                error instanceof Error ? error.message : "Runner failed",
              finishedAt: Date.now(),
            },
          },
          signal: runAbortController.signal,
        })
        runAbortController.signal.throwIfAborted()
        activeScenario = null
        process.stdout.write(
          `  failed: ${error instanceof Error ? error.message : "Runner failed"}\n`
        )
      }
    }
    runAbortController.signal.throwIfAborted()
    finalRunStatus = runFailed ? "failed" : "completed"
    finalFinishedAt = Date.now()
  } catch (error) {
    runError = error
    if (activeScenario) {
      try {
        await submitScenarioResult({
          apiBaseUrl: config.apiBaseUrl,
          accessToken,
          version: CLI_VERSION,
          projectSlug,
          runId: createRunResponse.run.id,
          payload: {
            runId: createRunResponse.run.id,
            result: {
              scenarioId: activeScenario.scenarioId,
              status: "interrupted",
              checkResults: [],
              executionSummary: null,
              failureDetail: interruptedSignal
                ? `Execution interrupted by ${interruptedSignal}.`
                : error instanceof Error
                  ? error.message
                  : "Execution interrupted",
              finishedAt: Date.now(),
            },
          },
        })
      } catch {
        // Preserve the original interruption error from the run loop.
      }
      activeScenario = null
    }
    finalRunStatus = "interrupted"
    finalFinishedAt = Date.now()
  } finally {
    try {
      await runSession?.close()
    } catch (error) {
      closeError = error
    }

    if (runUsage.usage || !runUsage.complete) {
      process.stdout.write(`\n${formatRunnerUsage(runUsage)}\n`)
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
            runId: createRunResponse.run.id,
            payload: {
              status: finalRunStatus,
              finishedAt: finalFinishedAt,
            },
            signal: runAbortController.signal,
          })
          if (interruptedSignal && finalRunStatus !== "interrupted") {
            await finalizeInterruptedRun(createRunResponse.run.id)
          }
        } catch (error) {
          if (!interruptedSignal) {
            finalizationError = error
          } else {
            try {
              await finalizeInterruptedRun(createRunResponse.run.id)
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
