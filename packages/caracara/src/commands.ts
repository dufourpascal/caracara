import process from "node:process"
import { spawn } from "node:child_process"

import {
  CONVEX_TOKEN_TEMPLATE,
  formatRunName,
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
  submitScenarioResult,
} from "./api.js"
import {
  createPkcePair,
  exchangeAuthorizationCode,
  listenForOAuthCallback,
} from "./auth.js"
import {
  clearAuth,
  readConfig,
  readResolvedConfig,
  writeConfig,
  writeLocalConfig,
} from "./config.js"
import { getRunnerAdapter } from "./execution.js"
import type { InitCommandOptions, RunCommandOptions } from "./types.js"

const CLIENT_ID = "caracara-cli"
const CLI_VERSION = "0.1.0"

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
  const url = new URL(`${config.apiBaseUrl}/api/v1/oauth/authorize`)

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

export async function initCommand(options: InitCommandOptions) {
  const config = await readResolvedConfig(
    {
      apiBaseUrl: options.apiBaseUrl,
      selectedProjectSlug: options.project,
      runner: options.runner,
    },
    process.env
  )

  const configPath = await writeLocalConfig({
    apiBaseUrl: config.apiBaseUrl,
    selectedProjectSlug: config.selectedProjectSlug,
    runner: config.runner,
  })

  process.stdout.write(`Saved local config to ${configPath}\n`)
  process.stdout.write(`  apiBaseUrl: ${config.apiBaseUrl}\n`)
  process.stdout.write(
    `  project: ${config.selectedProjectSlug ?? "(not set)"}\n`
  )
  process.stdout.write(`  runner: ${config.runner}\n`)
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

function resolveRunMode(options: RunCommandOptions) {
  const requestedPhaseOrder = parsePhaseOrder(options.phase, "--phase")
  const requestedThroughPhaseOrder = parsePhaseOrder(
    options.throughPhase,
    "--through-phase"
  )

  if (options.scenario && requestedPhaseOrder !== null) {
    throw new Error("`--scenario` cannot be combined with `--phase`.")
  }

  if (options.scenario && requestedThroughPhaseOrder !== null) {
    throw new Error("`--scenario` cannot be combined with `--through-phase`.")
  }

  if (requestedPhaseOrder !== null && requestedThroughPhaseOrder !== null) {
    throw new Error("`--phase` cannot be combined with `--through-phase`.")
  }

  if (options.scenario) {
    return {
      mode: "single" as const,
      requestedScenarioSlug: options.scenario,
      requestedPhaseOrder: null,
    }
  }

  if (requestedPhaseOrder !== null) {
    return {
      mode: "phase" as const,
      requestedScenarioSlug: null,
      requestedPhaseOrder,
    }
  }

  if (requestedThroughPhaseOrder !== null) {
    return {
      mode: "through_phase" as const,
      requestedScenarioSlug: null,
      requestedPhaseOrder: requestedThroughPhaseOrder,
    }
  }

  return {
    mode: "all" as const,
    requestedScenarioSlug: null,
    requestedPhaseOrder: null,
  }
}

export async function runCommand(options: RunCommandOptions) {
  const cwd = process.cwd()
  const config = await readResolvedConfig(
    {
      apiBaseUrl: options.apiBaseUrl,
      selectedProjectSlug: options.project,
      runner: options.runner,
    },
    process.env
  )
  const accessToken = ensureAccessToken(config)
  const projectSlug = config.selectedProjectSlug

  if (!projectSlug) {
    throw new Error(
      "No project selected. Run `caracara init --project <slug>` or pass --project."
    )
  }

  const runnerType = config.runner
  const runner = getRunnerAdapter(runnerType)
  const runSelection = resolveRunMode(options)
  const executionSource =
    runSelection.mode === "single"
      ? await fetchSingleScenario({
        apiBaseUrl: config.apiBaseUrl,
        accessToken,
        version: CLI_VERSION,
        projectSlug,
        scenarioSlug: runSelection.requestedScenarioSlug,
      }).then((response) => ({
        project: response.project,
        phases: [] as RunnablePhase[],
        unassignedScenarioCount: 0,
        queue: [
          {
            phase: null as RunnablePhase | null,
            scenario: response.scenario,
          },
        ],
      }))
      : await fetchExecutionPlan({
          apiBaseUrl: config.apiBaseUrl,
          accessToken,
          version: CLI_VERSION,
          projectSlug,
        }).then((response) => {
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
            runSelection.mode !== "all" &&
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

  if (executionSource.queue.length === 0) {
    throw new Error(
      runSelection.mode === "phase"
        ? `Phase ${runSelection.requestedPhaseOrder} has no active scenarios to run.`
        : "No runnable scenarios found."
    )
  }

  const createRunResponse = await createRun({
    apiBaseUrl: config.apiBaseUrl,
    accessToken,
    version: CLI_VERSION,
    projectSlug,
    payload: {
      mode: runSelection.mode,
      requestedScenarioSlug: runSelection.requestedScenarioSlug,
      requestedPhaseOrder: runSelection.requestedPhaseOrder,
      runnerType,
      startedAt: Date.now(),
    },
  })

  process.stdout.write(`Run ${createRunResponse.run.name}\n`)

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
    scoringPrompt: args.scenario.scoringPrompt,
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
  let runError: unknown = null
  let runSession: Awaited<ReturnType<typeof runner.startRun>> | null = null
  let activeScenario: ReturnType<typeof buildScenarioSnapshot> | null = null
  let lastPrintedPhaseId: string | null = null

  try {
    for (const [sequenceIndex, item] of executionSource.queue.entries()) {
      const startedAt = Date.now()
      const scenarioSnapshot = buildScenarioSnapshot({
        phase: item.phase,
        scenario: item.scenario,
        sequenceIndex,
        startedAt,
      })

      if (item.phase && item.phase.id !== lastPrintedPhaseId) {
        process.stdout.write(`\nPhase ${item.phase.order}: ${item.phase.name}\n`)
        lastPrintedPhaseId = item.phase.id
      }

      process.stdout.write(
        `Executing ${item.scenario.slug} with ${runnerType}\n`
      )

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
              ...scenarioSnapshot,
              status: "dependency_failed",
              score: null,
              rationale: "Skipped because an earlier scenario failed.",
              improvementInstruction: null,
              executionSummary: null,
              failureDetail:
                "Dependency chain stopped after an earlier failure.",
              finishedAt: Date.now(),
            },
          },
        })
        continue
      }

      await startScenarioExecution({
        apiBaseUrl: config.apiBaseUrl,
        accessToken,
        version: CLI_VERSION,
        projectSlug,
        runId: createRunResponse.run.id,
        payload: {
          runId: createRunResponse.run.id,
          result: scenarioSnapshot,
        },
      })
      activeScenario = scenarioSnapshot

      try {
        runSession ??= await runner.startRun({ cwd })

        const execution = await runSession.executeScenario({
          cwd,
          projectPrompt: executionSource.project.projectPrompt,
          scenario: item.scenario,
        })
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
              ...scenarioSnapshot,
              status: "success",
              score: execution.score,
              rationale: execution.rationale,
              improvementInstruction: execution.improvementInstruction,
              executionSummary: execution.executionSummary,
              failureDetail: null,
              finishedAt,
            },
          },
        })
        activeScenario = null
        process.stdout.write(`  score ${execution.score.toFixed(2)}\n`)
      } catch (error) {
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
              ...scenarioSnapshot,
              status: "runner_failed",
              score: null,
              rationale: null,
              improvementInstruction: null,
              executionSummary: null,
              failureDetail:
                error instanceof Error ? error.message : "Runner failed",
              finishedAt: Date.now(),
            },
          },
        })
        activeScenario = null
        process.stdout.write(
          `  failed: ${error instanceof Error ? error.message : "Runner failed"}\n`
        )
      }
    }
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
              ...activeScenario,
              status: "interrupted",
              score: null,
              rationale: null,
              improvementInstruction: null,
              executionSummary: null,
              failureDetail:
                error instanceof Error
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

    if (finalRunStatus && finalFinishedAt !== null) {
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
      })
    }
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
