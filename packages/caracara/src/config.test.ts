import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_API_BASE_URL,
  cliPaths,
  findLocalConfigPath,
  getLocalSecretsPath,
  readLocalConfig,
  readLocalSecrets,
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

  it("falls back to the production API base URL by default", () => {
    const resolved = resolveConfig(
      {
        accessToken: null,
        apiBaseUrl: DEFAULT_API_BASE_URL,
        expiresAt: null,
        selectedProjectSlug: null,
        userEmail: null,
      },
      {},
      {},
      {} as NodeJS.ProcessEnv,
    )

    expect(resolved.apiBaseUrl).toBe("https://caracara.renaissanceai.com")
  })

  it("writes and reads local config from a repo-local file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-config-test-"))

    const configPath = await writeLocalConfig(
      {
        apiBaseUrl: "https://local.example.com",
        selectedProjectSlug: "demo-project",
        runner: "claude-code",
        model: "gpt-5.6-luna",
        model_reasoning_effort: "low",
      },
      dir,
    )

    expect(configPath).toBe(join(dir, ".caracara", "config.json"))
    await expect(readLocalConfig(dir)).resolves.toEqual({
      apiBaseUrl: "https://local.example.com",
      selectedProjectSlug: "demo-project",
      runner: "claude-code",
      model: "gpt-5.6-luna",
      model_reasoning_effort: "low",
    })

    const secretsPath = getLocalSecretsPath(configPath)
    await expect(readFile(secretsPath, "utf8")).resolves.toContain(
      "# CARACARA_SECRET_USERNAME=",
    )
    await expect(
      readFile(join(dir, ".caracara", ".gitignore"), "utf8"),
    ).resolves.toContain("secrets.env")
    if (process.platform !== "win32") {
      expect((await stat(secretsPath)).mode & 0o077).toBe(0)
    }
  })

  it("loads project secrets from the nearest local config", async () => {
    const root = await mkdtemp(join(tmpdir(), "caracara-secrets-test-"))
    const nested = join(root, "apps", "web")
    const configPath = await writeLocalConfig(
      { selectedProjectSlug: "demo-project" },
      root,
    )
    await mkdir(nested, { recursive: true })
    await writeFile(
      getLocalSecretsPath(configPath),
      [
        "CARACARA_SECRET_USERNAME=test@example.com",
        "CARACARA_SECRET_PASSWORD='correct horse battery staple'",
        "",
      ].join("\n"),
      "utf8",
    )

    await expect(readLocalSecrets(nested)).resolves.toEqual({
      CARACARA_SECRET_USERNAME: "test@example.com",
      CARACARA_SECRET_PASSWORD: "correct horse battery staple",
    })
  })

  it("preserves an existing secrets file when local config is rewritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-secrets-preserve-"))
    const configPath = await writeLocalConfig(
      { selectedProjectSlug: "demo-project" },
      dir,
    )
    const secretsPath = getLocalSecretsPath(configPath)
    await writeFile(secretsPath, "CARACARA_SECRET_PASSWORD=keep-me\n", "utf8")

    await writeLocalConfig({ selectedProjectSlug: "renamed-project" }, dir)

    await expect(readFile(secretsPath, "utf8")).resolves.toBe(
      "CARACARA_SECRET_PASSWORD=keep-me\n",
    )
  })

  it("rejects secret keys without the Caracara prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-secrets-key-"))
    const configPath = await writeLocalConfig({}, dir)
    await writeFile(
      getLocalSecretsPath(configPath),
      "PASSWORD=do-not-load\n",
      "utf8",
    )

    await expect(readLocalSecrets(dir)).rejects.toThrow(
      "Secret names must start with CARACARA_SECRET_",
    )
  })

  it("rejects a secrets file readable by other users", async () => {
    if (process.platform === "win32") {
      return
    }

    const dir = await mkdtemp(join(tmpdir(), "caracara-secrets-mode-"))
    const configPath = await writeLocalConfig({}, dir)
    const secretsPath = getLocalSecretsPath(configPath)
    await chmod(secretsPath, 0o644)

    await expect(readLocalSecrets(dir)).rejects.toThrow("chmod 600")
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

  it("rejects unknown local config keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-config-key-"))
    await mkdir(join(dir, ".caracara"), { recursive: true })
    await writeFile(
      join(dir, ".caracara", "config.json"),
      JSON.stringify({ model_reasoning_effor: "low" }),
      "utf8",
    )

    await expect(readLocalConfig(dir)).rejects.toThrow("Unrecognized key")
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
    expect(cliPaths.localSecretsFileName).toBe("secrets.env")
  })
})
