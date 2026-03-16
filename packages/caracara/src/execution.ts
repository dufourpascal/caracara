import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"

import type { OrderedScenario, RunnerType } from "@workspace/contracts"

export type RunnerExecution = {
  executionSummary: string
  score: number
  rationale: string | null
  improvementInstruction: string | null
}

export type RunnerScenarioInput = {
  cwd: string
  projectPrompt: string
  scenario: OrderedScenario
}

export interface RunnerAdapter {
  type: RunnerType
  startRun(input: { cwd: string }): Promise<RunnerSession>
}

export interface RunnerSession {
  executeScenario(input: RunnerScenarioInput): Promise<RunnerExecution>
  close(): Promise<void>
}

const executionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "executionSummary",
    "score",
    "rationale",
    "improvementInstruction",
  ],
  properties: {
    executionSummary: {
      type: "string",
      minLength: 1,
    },
    score: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    rationale: {
      anyOf: [
        {
          type: "string",
          minLength: 1,
        },
        {
          type: "null",
        },
      ],
    },
    improvementInstruction: {
      anyOf: [
        {
          type: "string",
          minLength: 1,
        },
        {
          type: "null",
        },
      ],
    },
  },
} as const

const defaultCodexSandbox = "read-only"
const defaultChromeExecutablePath = "/usr/bin/chromium"
const defaultChromiumStartupTimeoutMs = 15_000

export function buildRunnerPrompt(input: {
  projectPrompt: string
  scenario: OrderedScenario
}) {
  return [
    "You are executing and scoring a Caracara Score evaluation scenario against a local application.",
    "",
    "Project context:",
    input.projectPrompt.trim(),
    "",
    `Scenario: ${input.scenario.name} (${input.scenario.slug})`,
    "",
    "Task instructions:",
    input.scenario.instructions.trim(),
    "",
    "Scoring prompt:",
    input.scenario.scoringPrompt.trim(),
    "",
    "Execute the task, collect the evidence needed for scoring, then return JSON with:",
    '- "executionSummary": a concise factual summary of what you did and observed, including the evidence needed for review and scoring',
    '- "score": a number from 0 to 1',
    '- "rationale": null when the score is exactly 1, otherwise a short explanation of the quality issues that prevented a perfect score',
    '- "improvementInstruction": null when the score is exactly 1. Otherwise, write a concise, human-readable instruction for the application team using this exact structure:',
    "  Location: [view/page/flow]",
    "  Action taken: [what you did]",
    "  Expected: [expected outcome]",
    "  Actual: [actual outcome]",
    "  Fix next: [specific implementation change]",
    "  Requirements:",
    "  - Be concrete and implementation-oriented.",
    "  - Mention routes, UI elements, fields, or components when known.",
    "  - Do not mention the score.",
    "  - Do not add filler, hedging, or generic advice.",
  ].join("\n")
}

function getCodexSandboxMode() {
  return process.env.CARACARA_CODEX_SANDBOX ?? defaultCodexSandbox
}

function getChromeExecutablePath() {
  return (
    process.env.CARACARA_CODEX_CHROME_EXECUTABLE_PATH ??
    process.env.CHROME_EXECUTABLE_PATH ??
    defaultChromeExecutablePath
  )
}

function encodeTomlValue(value: boolean | string | string[]) {
  return JSON.stringify(value)
}

export function buildCodexChromeMcpArgs(input: {
  logFilePath: string
  wsEndpoint?: string
  browserUrl?: string
}) {
  const args = ["-y", "chrome-devtools-mcp@latest"]

  if (input.wsEndpoint) {
    args.push("--wsEndpoint", input.wsEndpoint)
  } else if (input.browserUrl) {
    args.push("--browserUrl", input.browserUrl)
  } else {
    throw new Error("Either wsEndpoint or browserUrl must be provided.")
  }

  args.push("--logFile", input.logFilePath)

  return args
}

function buildCodexConfigOverrides(input?: {
  logFilePath: string
  wsEndpoint?: string
  browserUrl?: string
}) {
  if (!input) {
    return []
  }

  return [
    "-c",
    `mcp_servers.chrome-devtools.command=${encodeTomlValue("npx")}`,
    "-c",
    `mcp_servers.chrome-devtools.args=${encodeTomlValue(
      buildCodexChromeMcpArgs(input)
    )}`,
  ]
}

export function buildCodexExecArgs(input: {
  cwd: string
  prompt: string
  outputPath: string
  outputSchemaPath?: string
  wsEndpoint?: string
  browserUrl?: string
  chromeDevtoolsLogPath?: string
}) {
  return [
    "-a",
    "never",
    "exec",
    "--skip-git-repo-check",
    ...buildCodexConfigOverrides(
      input.chromeDevtoolsLogPath && (input.wsEndpoint || input.browserUrl)
        ? {
            logFilePath: input.chromeDevtoolsLogPath,
            wsEndpoint: input.wsEndpoint,
            browserUrl: input.browserUrl,
          }
        : undefined
    ),
    "--sandbox",
    getCodexSandboxMode(),
    "--cd",
    input.cwd,
    ...(input.outputSchemaPath
      ? ["--output-schema", input.outputSchemaPath]
      : []),
    "--output-last-message",
    input.outputPath,
    input.prompt,
  ]
}

async function runCommand(args: {
  command: string
  commandArgs: string[]
  cwd: string
}) {
  return await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(args.command, args.commandArgs, {
        cwd: args.cwd,
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
            `${args.command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
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
      browserUrl: `http://127.0.0.1:${port}`,
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

  async startRun(input: { cwd: string }) {
    const sharedBrowser = await launchSharedChromium({ cwd: input.cwd })

    return {
      async executeScenario(scenarioInput: RunnerScenarioInput) {
        return withTempFiles(async (dir) => {
          const executionOutputPath = join(dir, "execution.txt")
          const resultSchemaPath = join(dir, "result-schema.json")

          await writeFile(
            resultSchemaPath,
            JSON.stringify(executionResultSchema),
            "utf8"
          )

          await runCommand({
            command: "codex",
            cwd: scenarioInput.cwd,
            commandArgs: buildCodexExecArgs({
              cwd: scenarioInput.cwd,
              outputPath: executionOutputPath,
              outputSchemaPath: resultSchemaPath,
              prompt: buildRunnerPrompt(scenarioInput),
              wsEndpoint: sharedBrowser.wsEndpoint,
              browserUrl: sharedBrowser.browserUrl,
              chromeDevtoolsLogPath: sharedBrowser.chromeDevtoolsLogPath,
            }),
          })

          const execution = JSON.parse(
            await readFile(executionOutputPath, "utf8")
          ) as {
            executionSummary: string
            score: number
            rationale: string | null
            improvementInstruction: string | null
          }

          return {
            executionSummary: execution.executionSummary.trim(),
            score: execution.score,
            rationale:
              execution.score === 1 ? null : execution.rationale?.trim() ?? null,
            improvementInstruction:
              execution.score === 1
                ? null
                : execution.improvementInstruction?.trim() ?? null,
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

  async startRun() {
    return {
      async executeScenario(input: RunnerScenarioInput) {
        const execution = await runCommand({
          command: "claude",
          cwd: input.cwd,
          commandArgs: [
            "-p",
            "--permission-mode",
            process.env.CARACARA_CLAUDE_PERMISSION_MODE ?? "bypassPermissions",
            "--output-format",
            "json",
            "--json-schema",
            JSON.stringify(executionResultSchema),
            buildRunnerPrompt(input),
          ],
        })
        const parsed = JSON.parse(execution.stdout) as {
          executionSummary: string
          score: number
          rationale: string | null
          improvementInstruction: string | null
        }

        return {
          executionSummary: parsed.executionSummary.trim(),
          score: parsed.score,
          rationale: parsed.score === 1 ? null : parsed.rationale?.trim() ?? null,
          improvementInstruction:
            parsed.score === 1
              ? null
              : parsed.improvementInstruction?.trim() ?? null,
        }
      },
      async close() {},
    }
  }
}

export function getRunnerAdapter(type: RunnerType) {
  return type === "codex" ? new CodexRunner() : new ClaudeRunner()
}
