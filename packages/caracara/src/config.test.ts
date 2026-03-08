import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  cliPaths,
  findLocalConfigPath,
  readLocalConfig,
  resolveConfig,
  resolveRunner,
  writeLocalConfig,
} from "./config.js"

describe("config", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("prefers explicit overrides over env and stored config", () => {
    vi.stubEnv("CARACARA_API_BASE_URL", "https://env.example.com")
    vi.stubEnv("CARACARA_PROJECT", "env-project")

    const resolved = resolveConfig(
      {
        accessToken: null,
        apiBaseUrl: "https://saved.example.com",
        expiresAt: null,
        selectedProjectSlug: "saved-project",
        userEmail: null,
      },
      {
        apiBaseUrl: "https://local.example.com",
        selectedProjectSlug: "local-project",
        runner: "claude-code",
      },
      {
        apiBaseUrl: "https://flag.example.com",
        selectedProjectSlug: "flag-project",
      },
      process.env,
    )

    expect(resolved.apiBaseUrl).toBe("https://flag.example.com")
    expect(resolved.selectedProjectSlug).toBe("flag-project")
  })

  it("prefers local config over user config", () => {
    const resolved = resolveConfig(
      {
        accessToken: null,
        apiBaseUrl: "https://saved.example.com",
        expiresAt: null,
        selectedProjectSlug: "saved-project",
        userEmail: null,
      },
      {
        apiBaseUrl: "https://local.example.com",
        selectedProjectSlug: "local-project",
      },
      {},
      process.env,
    )

    expect(resolved.apiBaseUrl).toBe("https://local.example.com")
    expect(resolved.selectedProjectSlug).toBe("local-project")
  })

  it("writes and reads local config from a repo-local file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-config-test-"))

    const configPath = await writeLocalConfig(
      {
        apiBaseUrl: "https://local.example.com",
        selectedProjectSlug: "demo-project",
        runner: "claude-code",
      },
      dir,
    )

    expect(configPath).toBe(join(dir, ".caracara", "config.json"))
    await expect(readLocalConfig(dir)).resolves.toEqual({
      apiBaseUrl: "https://local.example.com",
      selectedProjectSlug: "demo-project",
      runner: "claude-code",
    })
  })

  it("finds the nearest local config in an ancestor directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "caracara-config-tree-"))
    const nested = join(root, "apps", "web")

    await mkdir(join(root, ".caracara"), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeFile(
      join(root, ".caracara", "config.json"),
      JSON.stringify({ project: "ignored" }),
      "utf8",
    )
    await writeFile(
      join(root, ".caracara", "config.json"),
      `${JSON.stringify({ selectedProjectSlug: "demo-project" }, null, 2)}\n`,
      "utf8",
    )

    await expect(findLocalConfigPath(nested)).resolves.toBe(
      join(root, ".caracara", "config.json"),
    )
  })

  it("resolves the runner from overrides, env, local config, and defaults", () => {
    vi.stubEnv("CARACARA_RUNNER", "claude-code")

    expect(resolveRunner({}, { runner: "codex" }, process.env)).toBe("codex")
    expect(resolveRunner({}, {}, process.env)).toBe("claude-code")
    expect(
      resolveRunner({ runner: "claude-code" }, {}, {} as NodeJS.ProcessEnv),
    ).toBe("claude-code")
    expect(resolveRunner({}, {}, {} as NodeJS.ProcessEnv)).toBe("codex")
  })

  it("writes config under the user config directory", () => {
    expect(cliPaths.configPath).toContain(".config/caracara/config.json")
    expect(cliPaths.localConfigDirName).toBe(".caracara")
    expect(cliPaths.localConfigFileName).toBe("config.json")
  })
})
