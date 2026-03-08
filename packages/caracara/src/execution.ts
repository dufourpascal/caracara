import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

import type { OrderedScenario, RunnerType } from "@workspace/contracts"

export type RunnerExecution = {
  executionSummary: string
  score: number
  rationale: string | null
}

export interface RunnerAdapter {
  type: RunnerType
  executeScenario(input: {
    cwd: string
    projectPrompt: string
    scenario: OrderedScenario
  }): Promise<RunnerExecution>
}

const executionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["executionSummary", "score", "rationale"],
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
  },
} as const

const defaultCodexSandbox = "read-only"

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
  ].join("\n")
}

function getCodexSandboxMode() {
  return process.env.CARACARA_CODEX_SANDBOX ?? defaultCodexSandbox
}

export function buildCodexExecArgs(input: {
  cwd: string
  prompt: string
  outputPath: string
  outputSchemaPath?: string
}) {
  return [
    "-a",
    "never",
    "exec",
    "--skip-git-repo-check",
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

class CodexRunner implements RunnerAdapter {
  readonly type = "codex" as const

  async executeScenario(input: {
    cwd: string
    projectPrompt: string
    scenario: OrderedScenario
  }) {
    return withTempFiles(async (dir) => {
      const executionOutputPath = join(dir, "execution.txt")
      const resultSchemaPath = join(dir, "result-schema.json")

      await writeFile(resultSchemaPath, JSON.stringify(executionResultSchema), "utf8")

      await runCommand({
        command: "codex",
        cwd: input.cwd,
        commandArgs: buildCodexExecArgs({
          cwd: input.cwd,
          outputPath: executionOutputPath,
          outputSchemaPath: resultSchemaPath,
          prompt: buildRunnerPrompt(input),
        }),
      })

      const execution = JSON.parse(await readFile(executionOutputPath, "utf8")) as {
        executionSummary: string
        score: number
        rationale: string | null
      }

      return {
        executionSummary: execution.executionSummary.trim(),
        score: execution.score,
        rationale:
          execution.score === 1 ? null : execution.rationale?.trim() ?? null,
      }
    })
  }
}

class ClaudeRunner implements RunnerAdapter {
  readonly type = "claude-code" as const

  async executeScenario(input: {
    cwd: string
    projectPrompt: string
    scenario: OrderedScenario
  }) {
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
    }

    return {
      executionSummary: parsed.executionSummary.trim(),
      score: parsed.score,
      rationale: parsed.score === 1 ? null : parsed.rationale?.trim() ?? null,
    }
  }
}

export function getRunnerAdapter(type: RunnerType) {
  return type === "codex" ? new CodexRunner() : new ClaudeRunner()
}
