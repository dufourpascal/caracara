import { afterEach, describe, expect, it, vi } from "vitest"
import { spawn } from "node:child_process"
import { once } from "node:events"

import type { OrderedScenario } from "@workspace/contracts"

import {
  buildCodexClientOptions,
  buildCodexChromeMcpArgs,
  buildChromiumArgs,
  buildCodexThreadOptions,
  buildExecutionResultSchema,
  buildMissingScreenshotPrompt,
  buildRunnerPrompt,
  buildWindowsTaskkillArgs,
  formatRunnerUsage,
  hasWebpSignature,
  mergeRunnerUsage,
  parseClaudeJsonResult,
  redactRunnerExecution,
  redactSecretValues,
  terminateChildProcess,
  toCodexRunnerUsage,
  validateRunnerExecution,
} from "./execution.js"

const scenario: OrderedScenario = {
  id: "scenario_1",
  name: "Create article",
  slug: "create-article",
  status: "active",
  instructions: "Log in and create an article titled Hello World.",
  evaluationChecks: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Valid article slug",
      expectation: "The generated slug is valid and appears in the final URL.",
    },
  ],
  dependencyIds: [],
}

function processGroupExistsForTest(pid: number) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false
    }
    throw error
  }
}

describe("child command termination", () => {
  it("builds a forced Windows process-tree termination command", () => {
    expect(buildWindowsTaskkillArgs(1234)).toEqual([
      "/PID",
      "1234",
      "/T",
      "/F",
    ])
  })

  it.skipIf(process.platform === "win32")(
    "waits for an aborted child and force-kills it after the grace period",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1_000)',
        ],
        { stdio: ["ignore", "pipe", "ignore"] }
      )

      try {
        await once(child.stdout, "data")
        await terminateChildProcess(child)

        expect(child.signalCode).toBe("SIGKILL")
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL")
        }
      }
    }
  )

  it.skipIf(process.platform === "win32")(
    "terminates descendants that keep pipes open after the leader exits",
    async () => {
      const descendantScript =
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1_000)'
      const leaderScript =
        'require("node:child_process").spawn(process.execPath, ["-e", ' +
        JSON.stringify(descendantScript) +
        '], { stdio: ["ignore", process.stdout, "ignore"] }).unref()'
      const child = spawn(process.execPath, ["-e", leaderScript], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      })
      const closed = once(child, "close").then(() => undefined)

      try {
        await once(child, "exit")
        await terminateChildProcess(child, true, closed)
        await closed
      } finally {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            // The process group is already gone.
          }
        }
      }
    }
  )

  it.skipIf(process.platform === "win32")(
    "terminates descendants after the leader closes its own pipes",
    async () => {
      const descendantScript =
        'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1_000)'
      const leaderScript =
        'const child = require("node:child_process").spawn(process.execPath, ["-e", ' +
        JSON.stringify(descendantScript) +
        '], { stdio: ["ignore", "pipe", "ignore"] }); ' +
        'child.stdout.once("data", () => { process.stdout.write("ready"); child.stdout.destroy() }); child.unref()'
      const child = spawn(process.execPath, ["-e", leaderScript], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      })
      const closed = once(child, "close").then(() => undefined)

      try {
        await once(child.stdout, "data")
        const pid = child.pid
        expect(pid).toBeDefined()
        await terminateChildProcess(child, true, closed)
        expect(processGroupExistsForTest(pid!)).toBe(false)
      } finally {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {
            // The process group is already gone.
          }
        }
      }
    }
  )
})

describe("Codex SDK configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses unattended approval, a fresh thread source, and read-only sandboxing", () => {
    expect(
      buildCodexThreadOptions({
        cwd: "/tmp/project",
      })
    ).toMatchObject({
      approvalPolicy: "never",
      workingDirectory: "/tmp/project",
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      threadSource: "caracara",
    })
  })

  it("honors CARACARA_CODEX_SANDBOX when explicitly configured", () => {
    vi.stubEnv("CARACARA_CODEX_SANDBOX", "workspace-write")

    expect(
      buildCodexThreadOptions({
        cwd: "/tmp/project",
      }).sandboxMode
    ).toBe("workspace-write")
  })

  it("rejects an unsupported Codex sandbox mode", () => {
    vi.stubEnv("CARACARA_CODEX_SANDBOX", "unsafe")

    expect(() =>
      buildCodexThreadOptions({
        cwd: "/tmp/project",
      })
    ).toThrow("Invalid CARACARA_CODEX_SANDBOX value")
  })

  it("passes the configured model and reasoning effort to the thread", () => {
    expect(
      buildCodexThreadOptions({
        cwd: "/tmp/project",
        model: "gpt-5.6-luna",
        modelReasoningEffort: "low",
      })
    ).toMatchObject({
      workingDirectory: "/tmp/project",
      model: "gpt-5.6-luna",
      modelReasoningEffort: "low",
    })
  })

  it("configures the run-scoped Chrome MCP without interactive approval", () => {
    expect(
      buildCodexClientOptions({
        env: {
          PATH: "/bin",
          CARACARA_SECRET_USERNAME: "test@example.com",
          OMIT_ME: undefined,
        },
        logFilePath: "/tmp/chrome-devtools-mcp.log",
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
      })
    ).toEqual({
      env: {
        PATH: "/bin",
        CARACARA_SECRET_USERNAME: "test@example.com",
      },
      config: {
        mcp_servers: {
          "chrome-devtools": {
            command: "npx",
            args: [
              "-y",
              "chrome-devtools-mcp@latest",
              "--wsEndpoint",
              "ws://127.0.0.1:9222/devtools/browser/test",
              "--logFile",
              "/tmp/chrome-devtools-mcp.log",
            ],
            required: true,
            default_tools_approval_mode: "approve",
          },
          node_repl: {
            enabled: false,
          },
        },
      },
    })
  })

  it("preserves the existing none reasoning setting as a client override", () => {
    const clientOptions = buildCodexClientOptions({
      env: {},
      logFilePath: "/tmp/chrome-devtools-mcp.log",
      wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
      modelReasoningEffort: "none",
    })
    const threadOptions = buildCodexThreadOptions({
      cwd: "/tmp/project",
      modelReasoningEffort: "none",
    })

    expect(clientOptions.config).toMatchObject({
      model_reasoning_effort: "none",
    })
    expect(threadOptions.modelReasoningEffort).toBeUndefined()
  })

  it("builds chrome devtools args that attach to the shared browser", () => {
    expect(
      buildCodexChromeMcpArgs({
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
        logFilePath: "/tmp/chrome-devtools.log",
      })
    ).toEqual([
      "-y",
      "chrome-devtools-mcp@latest",
      "--wsEndpoint",
      "ws://127.0.0.1:9222/devtools/browser/test",
      "--logFile",
      "/tmp/chrome-devtools.log",
    ])
  })

  it("opens the shared browser at the selected target URL", () => {
    const args = buildChromiumArgs({
      userDataDir: "/tmp/profile",
      initialUrl: "https://preview.example.com/",
    })

    expect(args.at(-1)).toBe("https://preview.example.com/")
  })

  it("builds check guidance without asking the model for a score", () => {
    const prompt = buildRunnerPrompt({
      environment: "preview",
      targetUrl: "https://preview.example.com/",
      projectPrompt: "Use the seeded demo account.",
      scenario,
    })

    expect(prompt).toContain("Task instructions:\nLog in and create an article")
    expect(prompt).toContain("Target environment: preview")
    expect(prompt).toContain("Application URL: https://preview.example.com/")
    expect(prompt).toContain(
      "Valid article slug [00000000-0000-4000-8000-000000000001]"
    )
    expect(prompt).toContain("Use the Chrome DevTools browser tools")
    expect(prompt).toContain("Do not calculate or return a score.")
    expect(prompt).not.toContain("Scoring prompt:")
  })

  it("requires visually verified WebP evidence for failed Codex checks", () => {
    const prompt = buildRunnerPrompt({
      environment: "preview",
      targetUrl: "https://preview.example.com/",
      projectPrompt: "Use the seeded demo account.",
      scenario,
      evidenceDirectory: "/tmp/caracara-evidence",
    })
    expect(prompt).toContain(
      "Failure screenshot: /tmp/caracara-evidence/00000000-0000-4000-8000-000000000001.webp"
    )
    expect(prompt).toContain("format webp, quality 80, and fullPage false")
    expect(prompt).toContain("without a filePath")
    expect(prompt).toContain("same visible viewport without a uid")
    expect(prompt).toContain("Inspect the image itself")
    expect(prompt).toContain("Only after visually confirming the image")
    expect(prompt).toContain(
      "Attempted: <specific action and expected result>. Failed: <exact observed behavior"
    )
    expect(prompt).toContain("Do not merely restate the check")
    expect(prompt).toContain("Never include screenshot paths or image bytes")

    const correction = buildMissingScreenshotPrompt({
      scenario,
      evidenceDirectory: "/tmp/caracara-evidence",
      missingCheckIds: ["00000000-0000-4000-8000-000000000001"],
    })
    expect(correction).toContain("Do not repeat the scenario")
    expect(correction).toContain("without a filePath")
    expect(correction).toContain("same visible viewport without a uid")
    expect(correction).toContain("visually inspect the returned image")
    expect(correction).toContain("Only after visually confirming the image")
    expect(correction).toContain("Valid article slug")
  })

  it("recognizes only WebP file signatures", () => {
    expect(hasWebpSignature(Buffer.from("RIFF0000WEBP", "ascii"))).toBe(true)
    expect(hasWebpSignature(Buffer.from("not-a-webp", "ascii"))).toBe(false)
  })

  it("lists local secret names in the prompt without adding their values", () => {
    const prompt = buildRunnerPrompt({
      environment: "development",
      targetUrl: "http://localhost:3055/",
      projectPrompt: "Open http://localhost:3055.",
      scenario,
      secretNames: ["CARACARA_SECRET_PASSWORD", "CARACARA_SECRET_USERNAME"],
    })

    expect(prompt).toContain("- CARACARA_SECRET_USERNAME")
    expect(prompt).toContain("- CARACARA_SECRET_PASSWORD")
    expect(prompt).toContain("Never repeat secret values")
    expect(prompt).not.toContain("test@example.com")
  })

  it("redacts secret values from runner summaries and evidence", () => {
    const secrets = {
      CARACARA_SECRET_USERNAME: "test@example.com",
      CARACARA_SECRET_PASSWORD: "correct horse battery staple",
    }

    expect(
      redactSecretValues(
        "Signed in as test@example.com with correct horse battery staple.",
        secrets
      )
    ).toBe("Signed in as [REDACTED] with [REDACTED].")
    expect(
      redactRunnerExecution(
        {
          executionSummary: "Signed in as test@example.com.",
          checkResults: [
            {
              checkId: "00000000-0000-4000-8000-000000000001",
              verdict: "passed",
              evidence: "The password was correct horse battery staple.",
            },
          ],
        },
        secrets
      )
    ).toEqual({
      executionSummary: "Signed in as [REDACTED].",
      checkResults: [
        {
          checkId: "00000000-0000-4000-8000-000000000001",
          verdict: "passed",
          evidence: "The password was [REDACTED].",
        },
      ],
    })
  })

  it("builds and validates an exact result contract", () => {
    const schema = buildExecutionResultSchema(scenario)
    expect(schema.properties.checkResults.minItems).toBe(1)
    expect(
      validateRunnerExecution(scenario, {
        executionSummary: " Created the article. ",
        checkResults: [
          {
            checkId: "00000000-0000-4000-8000-000000000001",
            verdict: "passed",
            evidence: " The URL ended in /hello-world. ",
          },
        ],
      })
    ).toEqual({
      executionSummary: "Created the article.",
      checkResults: [
        {
          checkId: "00000000-0000-4000-8000-000000000001",
          verdict: "passed",
          evidence: "The URL ended in /hello-world.",
        },
      ],
    })
  })
})

describe("runner usage", () => {
  it("calculates and formats GPT-5.6 Luna usage", () => {
    const usage = toCodexRunnerUsage(
      {
        input_tokens: 1_000_000,
        cached_input_tokens: 400_000,
        cache_write_input_tokens: 100_000,
        output_tokens: 100_000,
        reasoning_output_tokens: 25_000,
      },
      "gpt-5.6-luna"
    )

    expect(usage).toMatchObject({
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      cacheWriteInputTokens: 100_000,
      outputTokens: 100_000,
      reasoningOutputTokens: 25_000,
      estimatedCostUsd: 0.253,
    })
    expect(formatRunnerUsage({ usage, complete: true })).toBe(
      "Tokens: 1,100,000 total (1,000,000 input, 400,000 cached, 100,000 cache write; 100,000 output, 25,000 reasoning)\nEstimated API-equivalent cost: $0.2530"
    )
  })

  it("aggregates turns without inventing a partial cost", () => {
    expect(
      mergeRunnerUsage(
        {
          usage: {
            inputTokens: 100,
            cachedInputTokens: 20,
            cacheWriteInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 2,
            estimatedCostUsd: 0.01,
          },
          complete: true,
        },
        {
          usage: {
            inputTokens: 200,
            cachedInputTokens: 40,
            cacheWriteInputTokens: 5,
            outputTokens: 20,
            reasoningOutputTokens: 4,
            estimatedCostUsd: null,
          },
          complete: false,
        }
      )
    ).toEqual({
      usage: {
        inputTokens: 300,
        cachedInputTokens: 60,
        cacheWriteInputTokens: 5,
        outputTokens: 30,
        reasoningOutputTokens: 6,
        estimatedCostUsd: null,
      },
      complete: false,
    })
  })

  it("labels partial usage and withholds its cost", () => {
    expect(
      formatRunnerUsage({
        usage: {
          inputTokens: 100,
          cachedInputTokens: 20,
          cacheWriteInputTokens: 0,
          outputTokens: 10,
          reasoningOutputTokens: 0,
          estimatedCostUsd: 0.01,
        },
        complete: false,
      })
    ).toBe(
      "Tokens: 110 total (partial) (100 input, 20 cached; 10 output)\nEstimated API-equivalent cost: unavailable because token usage is incomplete"
    )

    expect(formatRunnerUsage({ complete: false })).toBe(
      "Tokens: unavailable (runner usage incomplete)\nEstimated API-equivalent cost: unavailable"
    )
  })

  it("reads Claude structured output and its reported cost", () => {
    const parsed = parseClaudeJsonResult(
      JSON.stringify({
        structured_output: {
          executionSummary: "Created the article.",
          checkResults: [
            {
              checkId: "00000000-0000-4000-8000-000000000001",
              verdict: "passed",
              evidence: "The article is visible.",
            },
          ],
        },
        total_cost_usd: 0.0123,
        usage: {
          input_tokens: 1_000,
          cache_read_input_tokens: 8_000,
          cache_creation_input_tokens: 2_000,
          output_tokens: 500,
        },
      })
    )

    expect(parsed.execution).toMatchObject({
      executionSummary: "Created the article.",
    })
    expect(parsed.usage).toEqual({
      inputTokens: 11_000,
      cachedInputTokens: 8_000,
      cacheWriteInputTokens: 2_000,
      outputTokens: 500,
      reasoningOutputTokens: 0,
      estimatedCostUsd: 0.0123,
    })
  })
})
