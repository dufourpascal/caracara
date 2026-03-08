import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrderedScenario } from "@workspace/contracts"

import {
  buildCodexChromeMcpArgs,
  buildCodexExecArgs,
  buildRunnerPrompt,
} from "./execution.js"

const scenario: OrderedScenario = {
  id: "scenario_1",
  name: "Create article",
  slug: "create-article",
  status: "active",
  instructions: "Log in and create an article titled Hello World.",
  scoringPrompt:
    "Verify that the generated slug is a valid URL slug and appears in the final URL.",
  dependencyIds: [],
}

describe("Codex runner args", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses global approval flags, keeps Codex config-backed MCP access, and defaults to read-only", () => {
    const args = buildCodexExecArgs({
      cwd: "/tmp/project",
      outputPath: "/tmp/output.txt",
      prompt: "Run the scenario",
    })

    expect(args).toEqual([
      "-a",
      "never",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/project",
      "--output-last-message",
      "/tmp/output.txt",
      "Run the scenario",
    ])
    expect(args).not.toContain("--ask-for-approval")
  })

  it("honors CARACARA_CODEX_SANDBOX when explicitly configured", () => {
    vi.stubEnv("CARACARA_CODEX_SANDBOX", "workspace-write")

    const args = buildCodexExecArgs({
      cwd: "/tmp/project",
      outputPath: "/tmp/output.txt",
      outputSchemaPath: "/tmp/schema.json",
      prompt: "Score the scenario",
    })

    expect(args).toEqual([
      "-a",
      "never",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--cd",
      "/tmp/project",
      "--output-schema",
      "/tmp/schema.json",
      "--output-last-message",
      "/tmp/output.txt",
      "Score the scenario",
    ])
  })

  it("overrides Chrome DevTools MCP to connect to a run-scoped browser", () => {
    const args = buildCodexExecArgs({
      cwd: "/tmp/project",
      outputPath: "/tmp/output.txt",
      outputSchemaPath: "/tmp/schema.json",
      prompt: "Score the scenario",
      browserUrl: "http://127.0.0.1:9222",
      chromeDevtoolsLogPath: "/tmp/chrome-devtools-mcp.log",
    })

    expect(args).toEqual([
      "-a",
      "never",
      "exec",
      "--skip-git-repo-check",
      "-c",
      'mcp_servers.chrome-devtools.command="npx"',
      "-c",
      'mcp_servers.chrome-devtools.args=["chrome-devtools-mcp@latest","--browserUrl","http://127.0.0.1:9222","--logFile","/tmp/chrome-devtools-mcp.log"]',
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/project",
      "--output-schema",
      "/tmp/schema.json",
      "--output-last-message",
      "/tmp/output.txt",
      "Score the scenario",
    ])
  })

  it("builds chrome devtools args that attach to the shared browser", () => {
    expect(
      buildCodexChromeMcpArgs({
        browserUrl: "http://127.0.0.1:9222",
        logFilePath: "/tmp/chrome-devtools.log",
      })
    ).toEqual([
      "chrome-devtools-mcp@latest",
      "--browserUrl",
      "http://127.0.0.1:9222",
      "--logFile",
      "/tmp/chrome-devtools.log",
    ])
  })

  it("builds a single runner prompt with execution and scoring guidance", () => {
    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain("You are executing and scoring a Caracara Score evaluation scenario")

    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain("Task instructions:\nLog in and create an article titled Hello World.")

    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain(
      "Scoring prompt:\nVerify that the generated slug is a valid URL slug and appears in the final URL."
    )

    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain('"executionSummary": a concise factual summary')

    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain('"rationale": null when the score is exactly 1')

    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain(
      '"improvementInstruction": null when the score is exactly 1'
    )

    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain("where in the app the issue happened")

    expect(
      buildRunnerPrompt({
        projectPrompt: "Use the seeded demo account.",
        scenario,
      })
    ).toContain(
      'Format it like: "In the application [view/page/flow], when I [action], I expected [expected outcome], but instead [actual outcome]. Fix this by [specific implementation instruction]."'
    )
  })
})
