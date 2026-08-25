import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrderedScenario } from "@workspace/contracts"

import {
  buildCodexClientOptions,
  buildCodexChromeMcpArgs,
  buildCodexThreadOptions,
  buildExecutionResultSchema,
  buildMissingScreenshotPrompt,
  buildRunnerPrompt,
  hasWebpSignature,
  redactRunnerExecution,
  redactSecretValues,
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

  it("builds check guidance without asking the model for a score", () => {
    const prompt = buildRunnerPrompt({
      projectPrompt: "Use the seeded demo account.",
      scenario,
    })

    expect(prompt).toContain("Task instructions:\nLog in and create an article")
    expect(prompt).toContain(
      "Valid article slug [00000000-0000-4000-8000-000000000001]"
    )
    expect(prompt).toContain("Use the Chrome DevTools browser tools")
    expect(prompt).toContain("Do not calculate or return a score.")
    expect(prompt).not.toContain("Scoring prompt:")
  })

  it("requires deterministic WebP evidence for failed Codex checks", () => {
    const prompt = buildRunnerPrompt({
      projectPrompt: "Use the seeded demo account.",
      scenario,
      evidenceDirectory: "/tmp/caracara-evidence",
    })
    expect(prompt).toContain(
      "Failure screenshot: /tmp/caracara-evidence/00000000-0000-4000-8000-000000000001.webp"
    )
    expect(prompt).toContain("format webp, quality 80, and fullPage false")
    expect(prompt).toContain("Never include screenshot paths or image bytes")

    const correction = buildMissingScreenshotPrompt({
      scenario,
      evidenceDirectory: "/tmp/caracara-evidence",
      missingCheckIds: ["00000000-0000-4000-8000-000000000001"],
    })
    expect(correction).toContain("Do not repeat the scenario")
    expect(correction).toContain("Valid article slug")
  })

  it("recognizes only WebP file signatures", () => {
    expect(hasWebpSignature(Buffer.from("RIFF0000WEBP", "ascii"))).toBe(true)
    expect(hasWebpSignature(Buffer.from("not-a-webp", "ascii"))).toBe(false)
  })

  it("lists local secret names in the prompt without adding their values", () => {
    const prompt = buildRunnerPrompt({
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
