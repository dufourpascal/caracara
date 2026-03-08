import process from "node:process"
import { spawn } from "node:child_process"

import { CONVEX_TOKEN_TEMPLATE, formatRunName } from "@workspace/contracts"

import {
  createRun,
  finalizeRun,
  fetchOrderedScenarios,
  fetchProjects,
  fetchSingleScenario,
  fetchWhoAmI,
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
    process.env,
  )

  const configPath = await writeLocalConfig({
    apiBaseUrl: config.apiBaseUrl,
    selectedProjectSlug: config.selectedProjectSlug,
    runner: config.runner,
  })

  process.stdout.write(`Saved local config to ${configPath}\n`)
  process.stdout.write(`  apiBaseUrl: ${config.apiBaseUrl}\n`)
  process.stdout.write(
    `  project: ${config.selectedProjectSlug ?? "(not set)"}\n`,
  )
  process.stdout.write(`  runner: ${config.runner}\n`)
}

export async function runCommand(options: RunCommandOptions) {
  const cwd = process.cwd()
  const config = await readResolvedConfig(
    {
      apiBaseUrl: options.apiBaseUrl,
      selectedProjectSlug: options.project,
      runner: options.runner,
    },
    process.env,
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
  const ordered = options.scenario
    ? await fetchSingleScenario({
        apiBaseUrl: config.apiBaseUrl,
        accessToken,
        version: CLI_VERSION,
        projectSlug,
        scenarioSlug: options.scenario,
      }).then((response) => ({
        project: response.project,
        scenarios: [response.scenario],
      }))
    : await fetchOrderedScenarios({
        apiBaseUrl: config.apiBaseUrl,
        accessToken,
        version: CLI_VERSION,
        projectSlug,
      })

  const createRunResponse = await createRun({
    apiBaseUrl: config.apiBaseUrl,
    accessToken,
    version: CLI_VERSION,
    projectSlug,
    payload: {
      mode: options.scenario ? "single" : "all",
      requestedScenarioSlug: options.scenario ?? null,
      runnerType,
      startedAt: Date.now(),
    },
  })

  process.stdout.write(`Run ${createRunResponse.run.name}\n`)

  let runFailed = false
  let finalRunStatus: "completed" | "failed" | "interrupted" | null = null
  let finalFinishedAt: number | null = null
  let closeError: unknown = null
  let runError: unknown = null
  let runSession: Awaited<ReturnType<typeof runner.startRun>> | null = null

  try {
    for (const [sequenceIndex, scenario] of ordered.scenarios.entries()) {
      const startedAt = Date.now()
      process.stdout.write(`Executing ${scenario.slug} with ${runnerType}\n`)

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
              scenarioId: scenario.id,
              scenarioSlug: scenario.slug,
              scenarioName: scenario.name,
              executionInstructions: scenario.instructions,
              scoringPrompt: scenario.scoringPrompt,
              sequenceIndex,
              status: "dependency_failed",
              runnerType,
              score: null,
              rationale: "Skipped because an earlier scenario failed.",
              improvementInstruction: null,
              executionSummary: null,
              failureDetail: "Dependency chain stopped after an earlier failure.",
              startedAt,
              finishedAt: Date.now(),
            },
          },
        })
        continue
      }

      try {
        runSession ??= await runner.startRun({ cwd })

        const execution = await runSession.executeScenario({
          cwd,
          projectPrompt: ordered.project.projectPrompt,
          scenario,
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
              scenarioId: scenario.id,
              scenarioSlug: scenario.slug,
              scenarioName: scenario.name,
              executionInstructions: scenario.instructions,
              scoringPrompt: scenario.scoringPrompt,
              sequenceIndex,
              status: "success",
              runnerType,
              score: execution.score,
              rationale: execution.rationale,
              improvementInstruction: execution.improvementInstruction,
              executionSummary: execution.executionSummary,
              failureDetail: null,
              startedAt,
              finishedAt,
            },
          },
        })
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
              scenarioId: scenario.id,
              scenarioSlug: scenario.slug,
              scenarioName: scenario.name,
              executionInstructions: scenario.instructions,
              scoringPrompt: scenario.scoringPrompt,
              sequenceIndex,
              status: "runner_failed",
              runnerType,
              score: null,
              rationale: null,
              improvementInstruction: null,
              executionSummary: null,
              failureDetail:
                error instanceof Error ? error.message : "Runner failed",
              startedAt,
              finishedAt: Date.now(),
            },
          },
        })
        process.stdout.write(
          `  failed: ${error instanceof Error ? error.message : "Runner failed"}\n`
        )
      }
    }
    finalRunStatus = runFailed ? "failed" : "completed"
    finalFinishedAt = Date.now()
  } catch (error) {
    runError = error
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
