import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"

import {
  Codex,
  type CodexOptions,
  type SandboxMode,
  type ThreadOptions,
  type Usage,
} from "@openai/codex-sdk"
import type {
  CheckResult,
  OrderedScenario,
  RunnerType,
} from "@workspace/contracts"

import type { ModelReasoningEffort } from "./config.js"

export type RunnerExecution = {
  executionSummary: string
  checkResults: CheckResult[]
  screenshotEvidence?: ScreenshotEvidence[]
  usage?: RunnerUsage
}

export type RunnerUsage = {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  estimatedCostUsd: number | null
}

export type ScreenshotEvidence = {
  checkId: string
  bytes: Uint8Array
  byteSize: number
  sha256: string
}

export type RunnerScenarioInput = {
  cwd: string
  projectPrompt: string
  scenario: OrderedScenario
}

export type RunnerSecrets = Record<string, string>

type RunnerStartInput = {
  cwd: string
  secrets: RunnerSecrets
  model?: string
  modelReasoningEffort?: ModelReasoningEffort
}

export interface RunnerAdapter {
  type: RunnerType
  startRun(input: RunnerStartInput): Promise<RunnerSession>
}

export interface RunnerSession {
  executeScenario(input: RunnerScenarioInput): Promise<RunnerExecution>
  close(): Promise<void>
}

export function buildExecutionResultSchema(scenario: OrderedScenario) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["executionSummary", "checkResults"],
    properties: {
      executionSummary: { type: "string", minLength: 1 },
      checkResults: {
        type: "array",
        minItems: scenario.evaluationChecks.length,
        maxItems: scenario.evaluationChecks.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["checkId", "verdict", "evidence"],
          properties: {
            checkId: {
              type: "string",
              enum: scenario.evaluationChecks.map((check) => check.id),
            },
            verdict: {
              type: "string",
              enum: ["passed", "failed", "not_observed"],
            },
            evidence: { type: "string", minLength: 1, maxLength: 2_000 },
          },
        },
      },
    },
  } as const
}

export function validateRunnerExecution(
  scenario: OrderedScenario,
  execution: RunnerExecution
) {
  const expectedIds = scenario.evaluationChecks.map((check) => check.id)
  const returnedIds = execution.checkResults.map((result) => result.checkId)
  if (
    execution.executionSummary.trim() === "" ||
    returnedIds.length !== expectedIds.length ||
    new Set(returnedIds).size !== returnedIds.length ||
    expectedIds.some((id) => !returnedIds.includes(id)) ||
    execution.checkResults.some((result) => result.evidence.trim() === "")
  ) {
    throw new Error("Runner output did not account for every evaluation check.")
  }

  return {
    executionSummary: execution.executionSummary.trim(),
    checkResults: execution.checkResults.map((result) => ({
      ...result,
      evidence: result.evidence.trim(),
    })),
  }
}

const defaultCodexSandbox = "read-only"
const defaultChromeExecutablePath = "/usr/bin/chromium"
const defaultChromiumStartupTimeoutMs = 15_000

const codexPricingPerMillionTokens: Record<
  string,
  {
    input: number
    cachedInput: number
    cacheWriteInput: number
    output: number
  }
> = {
  "gpt-5.6": { input: 4, cachedInput: 0.4, cacheWriteInput: 5, output: 20 },
  "gpt-5.6-sol": {
    input: 4,
    cachedInput: 0.4,
    cacheWriteInput: 5,
    output: 20,
  },
  "gpt-5.6-terra": {
    input: 2,
    cachedInput: 0.2,
    cacheWriteInput: 2.5,
    output: 12,
  },
  "gpt-5.6-luna": {
    input: 0.2,
    cachedInput: 0.02,
    cacheWriteInput: 0.25,
    output: 1.2,
  },
}

export function toCodexRunnerUsage(
  usage: Usage | null,
  model?: string
): RunnerUsage | undefined {
  if (!usage) {
    return undefined
  }

  const pricing = model ? codexPricingPerMillionTokens[model] : undefined
  const uncachedInputTokens = Math.max(
    0,
    usage.input_tokens -
      usage.cached_input_tokens -
      usage.cache_write_input_tokens
  )
  const estimatedCostUsd = pricing
    ? (uncachedInputTokens * pricing.input +
        usage.cached_input_tokens * pricing.cachedInput +
        usage.cache_write_input_tokens * pricing.cacheWriteInput +
        usage.output_tokens * pricing.output) /
      1_000_000
    : null

  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    cacheWriteInputTokens: usage.cache_write_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    estimatedCostUsd,
  }
}

export function mergeRunnerUsage(
  current: RunnerUsage | undefined,
  next: RunnerUsage | undefined
) {
  if (!current) return next
  if (!next) return current

  return {
    inputTokens: current.inputTokens + next.inputTokens,
    cachedInputTokens: current.cachedInputTokens + next.cachedInputTokens,
    cacheWriteInputTokens:
      current.cacheWriteInputTokens + next.cacheWriteInputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    reasoningOutputTokens:
      current.reasoningOutputTokens + next.reasoningOutputTokens,
    estimatedCostUsd:
      current.estimatedCostUsd === null || next.estimatedCostUsd === null
        ? null
        : current.estimatedCostUsd + next.estimatedCostUsd,
  }
}

const tokenNumber = new Intl.NumberFormat("en-US")

export function formatRunnerUsage(usage: RunnerUsage) {
  const inputDetails = [
    `${tokenNumber.format(usage.cachedInputTokens)} cached`,
    ...(usage.cacheWriteInputTokens > 0
      ? [`${tokenNumber.format(usage.cacheWriteInputTokens)} cache write`]
      : []),
  ].join(", ")
  const outputDetails =
    usage.reasoningOutputTokens > 0
      ? `, ${tokenNumber.format(usage.reasoningOutputTokens)} reasoning`
      : ""
  const totalTokens = usage.inputTokens + usage.outputTokens
  const tokens = `Tokens: ${tokenNumber.format(totalTokens)} total (${tokenNumber.format(usage.inputTokens)} input, ${inputDetails}; ${tokenNumber.format(usage.outputTokens)} output${outputDetails})`
  const cost =
    usage.estimatedCostUsd === null
      ? "Estimated API-equivalent cost: unavailable for this model"
      : `Estimated API-equivalent cost: $${usage.estimatedCostUsd.toFixed(4)}`

  return `${tokens}\n${cost}`
}

type ClaudeJsonResult = {
  structured_output?: unknown
  result?: unknown
  total_cost_usd?: unknown
  usage?: {
    input_tokens?: unknown
    cache_read_input_tokens?: unknown
    cache_creation_input_tokens?: unknown
    output_tokens?: unknown
  }
}

function nonnegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

export function parseClaudeJsonResult(stdout: string) {
  const result = JSON.parse(stdout) as ClaudeJsonResult
  let execution: unknown = result.structured_output ?? result
  if (execution === result && typeof result.result === "string") {
    try {
      execution = JSON.parse(result.result) as unknown
    } catch {
      // The validation error below is more useful than a nested JSON parse error.
    }
  }

  const usage = result.usage
  const cachedInputTokens = nonnegativeNumber(usage?.cache_read_input_tokens)
  const cacheWriteInputTokens = nonnegativeNumber(
    usage?.cache_creation_input_tokens
  )
  const uncachedInputTokens = nonnegativeNumber(usage?.input_tokens)
  const outputTokens = nonnegativeNumber(usage?.output_tokens)
  const estimatedCostUsd =
    typeof result.total_cost_usd === "number" &&
    Number.isFinite(result.total_cost_usd) &&
    result.total_cost_usd >= 0
      ? result.total_cost_usd
      : null

  return {
    execution: execution as RunnerExecution,
    usage: usage
      ? {
          inputTokens:
            uncachedInputTokens + cachedInputTokens + cacheWriteInputTokens,
          cachedInputTokens,
          cacheWriteInputTokens,
          outputTokens,
          reasoningOutputTokens: 0,
          estimatedCostUsd,
        }
      : undefined,
  }
}

export function buildRunnerPrompt(input: {
  projectPrompt: string
  scenario: OrderedScenario
  secretNames?: string[]
  evidenceDirectory?: string
}) {
  const secretNames = [...(input.secretNames ?? [])].sort()

  return [
    "You are executing a Caracara evaluation scenario against a local application.",
    "",
    "Project context:",
    input.projectPrompt.trim(),
    "",
    `Scenario: ${input.scenario.name} (${input.scenario.slug})`,
    "",
    "Task instructions:",
    input.scenario.instructions.trim(),
    "",
    "Evaluation checks:",
    ...input.scenario.evaluationChecks.flatMap((check) => [
      `- ${check.name} [${check.id}]`,
      `  Expected: ${check.expectation}`,
      ...(input.evidenceDirectory
        ? [
            `  Failure screenshot: ${join(input.evidenceDirectory, `${check.id}.webp`)}`,
          ]
        : []),
    ]),
    ...(secretNames.length > 0
      ? [
          "",
          "Local secret environment variables available to this run:",
          ...secretNames.map((name) => `- ${name}`),
          "Read a secret only when the task requires it. Never repeat secret values in the execution summary, evidence, or other user-facing output.",
        ]
      : []),
    "",
    "Use the Chrome DevTools browser tools to perform the task once and inspect the actual frontend.",
    "Return JSON with a concise executionSummary and exactly one checkResults entry per check ID.",
    'Use verdict "passed" when browser evidence confirms the expectation, "failed" when observed behavior contradicts it, and "not_observed" when you could not reach or inspect it.',
    ...(input.evidenceDirectory
      ? [
          "For every failed check, immediately call chrome-devtools take_screenshot with the exact failure screenshot path listed for that check, format webp, quality 80, and fullPage false.",
          "A failed check is incomplete without its screenshot. Do not capture screenshots for passed or not-observed checks. Never include screenshot paths or image bytes in the JSON response.",
        ]
      : []),
    "Every verdict needs concise, concrete browser evidence. Do not calculate or return a score.",
  ].join("\n")
}

export function buildMissingScreenshotPrompt(input: {
  scenario: OrderedScenario
  evidenceDirectory: string
  missingCheckIds: string[]
}) {
  const checks = input.scenario.evaluationChecks.filter((check) =>
    input.missingCheckIds.includes(check.id)
  )
  return [
    "Required screenshot evidence is missing for the failed checks below.",
    "Do not repeat the scenario. Use the current browser state and call chrome-devtools take_screenshot once for each check with format webp, quality 80, and fullPage false.",
    ...checks.map(
      (check) =>
        `- ${check.name} [${check.id}]: ${join(input.evidenceDirectory, `${check.id}.webp`)}`
    ),
    "Do not include secret values, screenshot paths, or image bytes in your response.",
  ].join("\n")
}

const maxScreenshotBytes = 3 * 1024 * 1024

export function hasWebpSignature(bytes: Uint8Array) {
  return (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  )
}

async function readScreenshotEvidence(input: {
  evidenceDirectory: string
  checkIds: string[]
}) {
  const evidence: ScreenshotEvidence[] = []
  const missingCheckIds: string[] = []

  for (const checkId of input.checkIds) {
    const path = join(input.evidenceDirectory, `${checkId}.webp`)
    try {
      const bytes = await readFile(path)
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > maxScreenshotBytes ||
        !hasWebpSignature(bytes)
      ) {
        await rm(path, { force: true })
        missingCheckIds.push(checkId)
        continue
      }
      evidence.push({
        checkId,
        bytes,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
      missingCheckIds.push(checkId)
    }
  }

  return { evidence, missingCheckIds }
}

export function redactSecretValues(text: string, secrets: RunnerSecrets) {
  return [...new Set(Object.values(secrets))]
    .filter((secret) => secret !== "")
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
      text
    )
}

export function redactRunnerExecution(
  execution: RunnerExecution,
  secrets: RunnerSecrets
) {
  return {
    executionSummary: redactSecretValues(execution.executionSummary, secrets),
    checkResults: execution.checkResults.map((result) => ({
      ...result,
      evidence: redactSecretValues(result.evidence, secrets),
    })),
  }
}

function redactEvidenceDirectory(
  execution: RunnerExecution,
  evidenceDirectory: string
) {
  return {
    executionSummary: execution.executionSummary
      .split(evidenceDirectory)
      .join("[LOCAL_EVIDENCE_DIR]"),
    checkResults: execution.checkResults.map((result) => ({
      ...result,
      evidence: result.evidence
        .split(evidenceDirectory)
        .join("[LOCAL_EVIDENCE_DIR]"),
    })),
  }
}

function getCodexSandboxMode(): SandboxMode {
  const sandboxMode = process.env.CARACARA_CODEX_SANDBOX ?? defaultCodexSandbox

  if (
    sandboxMode !== "read-only" &&
    sandboxMode !== "workspace-write" &&
    sandboxMode !== "danger-full-access"
  ) {
    throw new Error(`Invalid CARACARA_CODEX_SANDBOX value: ${sandboxMode}.`)
  }

  return sandboxMode
}

function getChromeExecutablePath() {
  return (
    process.env.CARACARA_CODEX_CHROME_EXECUTABLE_PATH ??
    process.env.CHROME_EXECUTABLE_PATH ??
    defaultChromeExecutablePath
  )
}

export function buildCodexChromeMcpArgs(input: {
  logFilePath: string
  wsEndpoint: string
}) {
  return [
    "-y",
    "chrome-devtools-mcp@latest",
    "--wsEndpoint",
    input.wsEndpoint,
    "--logFile",
    input.logFilePath,
  ]
}

function compactEnvironment(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
}

export function buildCodexClientOptions(input: {
  env: NodeJS.ProcessEnv
  logFilePath: string
  wsEndpoint: string
  modelReasoningEffort?: ModelReasoningEffort
}): CodexOptions {
  return {
    env: compactEnvironment(input.env),
    config: {
      mcp_servers: {
        "chrome-devtools": {
          command: "npx",
          args: buildCodexChromeMcpArgs({
            logFilePath: input.logFilePath,
            wsEndpoint: input.wsEndpoint,
          }),
          required: true,
          default_tools_approval_mode: "approve",
        },
        node_repl: {
          enabled: false,
        },
      },
      ...(input.modelReasoningEffort === "none"
        ? { model_reasoning_effort: "none" }
        : {}),
    },
  }
}

export function buildCodexThreadOptions(input: {
  cwd: string
  model?: string
  modelReasoningEffort?: ModelReasoningEffort
}): ThreadOptions {
  return {
    workingDirectory: input.cwd,
    skipGitRepoCheck: true,
    sandboxMode: getCodexSandboxMode(),
    approvalPolicy: "never",
    threadSource: "caracara",
    model: input.model,
    modelReasoningEffort:
      input.modelReasoningEffort === "none"
        ? undefined
        : input.modelReasoningEffort,
  }
}

async function runCommand(args: {
  command: string
  commandArgs: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  secrets?: RunnerSecrets
}) {
  return await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(args.command, args.commandArgs, {
        cwd: args.cwd,
        env: args.env,
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr })
          return
        }

        reject(
          new Error(
            redactSecretValues(
              `${args.command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
              args.secrets ?? {}
            )
          )
        )
      })
    }
  )
}

async function withTempFiles<T>(work: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "caracara-"))

  try {
    return await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function buildChromiumArgs(input: {
  userDataDir: string
  initialUrl?: string
}) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--ignore-certificate-errors",
    "--remote-debugging-port=0",
    `--user-data-dir=${input.userDataDir}`,
    input.initialUrl ?? "about:blank",
  ]
}

async function waitForDevToolsActivePort(input: {
  userDataDir: string
  browser: ChildProcess
  timeoutMs?: number
}) {
  const devToolsActivePortPath = join(input.userDataDir, "DevToolsActivePort")
  const timeoutMs = input.timeoutMs ?? defaultChromiumStartupTimeoutMs
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (input.browser.exitCode !== null) {
      throw new Error(
        `Chromium exited before DevTools became available (exit code ${input.browser.exitCode}).`
      )
    }

    try {
      const raw = await readFile(devToolsActivePortPath, "utf8")
      const [port, path] = raw.trim().split(/\r?\n/)

      if (port && path) {
        return {
          port,
          wsPath: path,
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    await delay(100)
  }

  throw new Error(
    `Timed out waiting ${timeoutMs}ms for Chromium DevTools at ${devToolsActivePortPath}.`
  )
}

async function terminateBrowserProcess(browser: ChildProcess) {
  if (browser.exitCode !== null || !browser.pid) {
    return
  }

  const waitForExit = new Promise<void>((resolve) => {
    browser.once("exit", () => {
      resolve()
    })
  })

  if (process.platform === "win32") {
    browser.kill("SIGTERM")
  } else {
    process.kill(-browser.pid, "SIGTERM")
  }

  const terminated = await Promise.race([
    waitForExit.then(() => true),
    delay(1_000).then(() => false),
  ])

  if (terminated) {
    return
  }

  if (process.platform === "win32") {
    browser.kill("SIGKILL")
  } else {
    process.kill(-browser.pid, "SIGKILL")
  }

  await waitForExit
}

async function launchSharedChromium(input: { cwd: string }) {
  const runDir = await mkdtemp(join(tmpdir(), "caracara-codex-run-"))
  const userDataDir = join(runDir, "chrome-profile")
  const chromeDevtoolsLogPath = join(runDir, "chrome-devtools-mcp.log")
  await mkdir(userDataDir, { recursive: true })

  const browser = spawn(
    getChromeExecutablePath(),
    buildChromiumArgs({
      userDataDir,
    }),
    {
      cwd: input.cwd,
      detached: process.platform !== "win32",
      stdio: "ignore",
    }
  )

  const browserStartupError = new Promise<never>((_, reject) => {
    browser.once("error", reject)
  })

  try {
    const { port, wsPath } = await Promise.race([
      waitForDevToolsActivePort({
        userDataDir,
        browser,
      }),
      browserStartupError,
    ])

    return {
      wsEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
      chromeDevtoolsLogPath,
      async close() {
        await terminateBrowserProcess(browser)
        await rm(runDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await terminateBrowserProcess(browser).catch(() => undefined)
    await rm(runDir, { recursive: true, force: true })
    throw error
  }
}

class CodexRunner implements RunnerAdapter {
  readonly type = "codex" as const

  async startRun(input: RunnerStartInput) {
    const sharedBrowser = await launchSharedChromium({ cwd: input.cwd })
    const runnerEnv = { ...process.env, ...input.secrets }
    const secretNames = Object.keys(input.secrets)
    let codex: Codex
    try {
      codex = new Codex(
        buildCodexClientOptions({
          env: runnerEnv,
          logFilePath: sharedBrowser.chromeDevtoolsLogPath,
          wsEndpoint: sharedBrowser.wsEndpoint,
          modelReasoningEffort: input.modelReasoningEffort,
        })
      )
    } catch (error) {
      await sharedBrowser.close().catch(() => undefined)
      throw error
    }

    return {
      async executeScenario(scenarioInput: RunnerScenarioInput) {
        return await withTempFiles(async (dir) => {
          const evidenceDirectory = join(dir, "evidence")
          await mkdir(evidenceDirectory)
          try {
            const thread = codex.startThread(
              buildCodexThreadOptions({
                cwd: scenarioInput.cwd,
                model: input.model,
                modelReasoningEffort: input.modelReasoningEffort,
              })
            )
            const turn = await thread.run(
              buildRunnerPrompt({
                ...scenarioInput,
                secretNames,
                evidenceDirectory,
              }),
              {
                outputSchema: buildExecutionResultSchema(
                  scenarioInput.scenario
                ),
              }
            )

            const validated = validateRunnerExecution(
              scenarioInput.scenario,
              JSON.parse(turn.finalResponse) as RunnerExecution
            )
            let usage = toCodexRunnerUsage(turn.usage, input.model)
            const failedCheckIds = validated.checkResults
              .filter((result) => result.verdict === "failed")
              .map((result) => result.checkId)
            let screenshots = await readScreenshotEvidence({
              evidenceDirectory,
              checkIds: failedCheckIds,
            })

            if (screenshots.missingCheckIds.length > 0) {
              const correction = await thread.run(
                buildMissingScreenshotPrompt({
                  scenario: scenarioInput.scenario,
                  evidenceDirectory,
                  missingCheckIds: screenshots.missingCheckIds,
                })
              )
              usage = mergeRunnerUsage(
                usage,
                toCodexRunnerUsage(correction.usage, input.model)
              )
              screenshots = await readScreenshotEvidence({
                evidenceDirectory,
                checkIds: failedCheckIds,
              })
            }

            if (screenshots.missingCheckIds.length > 0) {
              throw new Error(
                `Codex did not capture required screenshot evidence for ${screenshots.missingCheckIds.length} failed check${screenshots.missingCheckIds.length === 1 ? "" : "s"}.`
              )
            }

            return {
              ...redactRunnerExecution(
                redactEvidenceDirectory(validated, evidenceDirectory),
                input.secrets
              ),
              screenshotEvidence: screenshots.evidence,
              usage,
            }
          } catch (error) {
            const message = (
              error instanceof Error ? error.message : "Codex SDK failed."
            )
              .split(evidenceDirectory)
              .join("[LOCAL_EVIDENCE_DIR]")
            throw new Error(redactSecretValues(message, input.secrets))
          }
        })
      },
      async close() {
        await sharedBrowser.close()
      },
    }
  }
}

class ClaudeRunner implements RunnerAdapter {
  readonly type = "claude-code" as const

  async startRun(runInput: RunnerStartInput) {
    const sharedBrowser = await launchSharedChromium({ cwd: runInput.cwd })
    const runnerEnv = { ...process.env, ...runInput.secrets }
    const secretNames = Object.keys(runInput.secrets)
    return {
      async executeScenario(scenarioInput: RunnerScenarioInput) {
        return await withTempFiles(async (dir) => {
          const mcpConfigPath = join(dir, "mcp.json")
          await writeFile(
            mcpConfigPath,
            JSON.stringify({
              mcpServers: {
                "chrome-devtools": {
                  command: "npx",
                  args: buildCodexChromeMcpArgs({
                    logFilePath: sharedBrowser.chromeDevtoolsLogPath,
                    wsEndpoint: sharedBrowser.wsEndpoint,
                  }),
                },
              },
            }),
            "utf8"
          )
          const execution = await runCommand({
            command: "claude",
            cwd: scenarioInput.cwd,
            env: runnerEnv,
            secrets: runInput.secrets,
            commandArgs: [
              "-p",
              "--permission-mode",
              process.env.CARACARA_CLAUDE_PERMISSION_MODE ??
                "bypassPermissions",
              "--output-format",
              "json",
              "--mcp-config",
              mcpConfigPath,
              "--strict-mcp-config",
              "--json-schema",
              JSON.stringify(
                buildExecutionResultSchema(scenarioInput.scenario)
              ),
              buildRunnerPrompt({ ...scenarioInput, secretNames }),
            ],
          })
          const parsed = parseClaudeJsonResult(execution.stdout)
          return {
            ...redactRunnerExecution(
              validateRunnerExecution(scenarioInput.scenario, parsed.execution),
              runInput.secrets
            ),
            screenshotEvidence: [],
            usage: parsed.usage,
          }
        })
      },
      async close() {
        await sharedBrowser.close()
      },
    }
  }
}

export function getRunnerAdapter(type: RunnerType) {
  return type === "codex" ? new CodexRunner() : new ClaudeRunner()
}
