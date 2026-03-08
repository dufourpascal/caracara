import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

import type { OrderedScenario, RunnerType } from "@workspace/contracts"

export type RunnerExecution = {
  output: string
  score: number
  rationale: string
}

export interface RunnerAdapter {
  type: RunnerType
  executeScenario(input: {
    cwd: string
    projectPrompt: string
    scenario: OrderedScenario
  }): Promise<RunnerExecution>
}

const scoreSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "rationale"],
  properties: {
    score: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    rationale: {
      type: "string",
      minLength: 1,
    },
  },
} as const

const defaultCodexSandbox = "read-only"

function buildExecutionPrompt(input: {
  projectPrompt: string
  scenario: OrderedScenario
}) {
  return [
    "You are executing a Caracara Score evaluation scenario against a local application.",
    "",
    "Project context:",
    input.projectPrompt.trim(),
    "",
    `Scenario: ${input.scenario.name} (${input.scenario.slug})`,
    "",
    "Task instructions:",
    input.scenario.instructions.trim(),
    "",
    "Return only the execution output and observations needed to judge the scenario.",
  ].join("\n")
}

function buildScoringPrompt(input: {
  projectPrompt: string
  scenario: OrderedScenario
  executionOutput: string
}) {
  return [
    "You are scoring the result of an executed Caracara Score scenario.",
    "",
    "Project context:",
    input.projectPrompt.trim(),
    "",
    `Scenario: ${input.scenario.name} (${input.scenario.slug})`,
    "",
    "Scenario instructions:",
    input.scenario.instructions.trim(),
    "",
    "Scoring prompt:",
    input.scenario.scoringPrompt.trim(),
    "",
    "Execution output:",
    input.executionOutput.trim(),
    "",
    "Return JSON with a numeric score from 0 to 1 and a short rationale.",
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
      const scoringSchemaPath = join(dir, "score-schema.json")
      const scoringOutputPath = join(dir, "score.json")

      await writeFile(scoringSchemaPath, JSON.stringify(scoreSchema), "utf8")

      await runCommand({
        command: "codex",
        cwd: input.cwd,
        commandArgs: buildCodexExecArgs({
          cwd: input.cwd,
          outputPath: executionOutputPath,
          prompt: buildExecutionPrompt(input),
        }),
      })

      const executionOutput = (
        await readFile(executionOutputPath, "utf8")
      ).trim()

      await runCommand({
        command: "codex",
        cwd: input.cwd,
        commandArgs: buildCodexExecArgs({
          cwd: input.cwd,
          outputPath: scoringOutputPath,
          outputSchemaPath: scoringSchemaPath,
          prompt: buildScoringPrompt({
            projectPrompt: input.projectPrompt,
            scenario: input.scenario,
            executionOutput,
          }),
        }),
      })

      const scoring = JSON.parse(await readFile(scoringOutputPath, "utf8")) as {
        score: number
        rationale: string
      }

      return {
        output: executionOutput,
        score: scoring.score,
        rationale: scoring.rationale,
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
        buildExecutionPrompt(input),
      ],
    })
    const scoring = await runCommand({
      command: "claude",
      cwd: input.cwd,
      commandArgs: [
        "-p",
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(scoreSchema),
        buildScoringPrompt({
          projectPrompt: input.projectPrompt,
          scenario: input.scenario,
          executionOutput: execution.stdout.trim(),
        }),
      ],
    })
    const parsed = JSON.parse(scoring.stdout) as {
      score: number
      rationale: string
    }

    return {
      output: execution.stdout.trim(),
      score: parsed.score,
      rationale: parsed.rationale,
    }
  }
}

export function getRunnerAdapter(type: RunnerType) {
  return type === "codex" ? new CodexRunner() : new ClaudeRunner()
}
