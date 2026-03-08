import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrderedScenario } from "@workspace/contracts"

import { buildCodexExecArgs, buildRunnerPrompt } from "./execution.js"

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
  })
})
