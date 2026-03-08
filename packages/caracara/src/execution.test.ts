import { afterEach, describe, expect, it, vi } from "vitest"

import { buildCodexExecArgs } from "./execution.js"

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
})
