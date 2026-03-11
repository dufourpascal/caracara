import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import {
  cliConfigSchema,
  runnerTypeSchema,
  slugSchema,
  type CliConfig,
  type RunnerType,
} from "@workspace/contracts"
import { z } from "zod"

const USER_CONFIG_DIR = join(homedir(), ".config", "caracara")
const USER_CONFIG_PATH = join(USER_CONFIG_DIR, "config.json")
const LOCAL_CONFIG_DIR_NAME = ".caracara"
const LOCAL_CONFIG_FILE_NAME = "config.json"
export const DEFAULT_API_BASE_URL = "https://caracara.renaissanceai.com"

const localConfigSchema = z.object({
  apiBaseUrl: z.string().url().optional(),
  selectedProjectSlug: slugSchema.nullable().optional(),
  runner: runnerTypeSchema.optional(),
})

const defaultConfig: CliConfig = {
  accessToken: null,
  apiBaseUrl: DEFAULT_API_BASE_URL,
  expiresAt: null,
  selectedProjectSlug: null,
  userEmail: null,
}

const defaultLocalConfig: LocalConfig = {}

export type LocalConfig = z.infer<typeof localConfigSchema>
export type ResolvedConfig = CliConfig & {
  runner: RunnerType
}

export async function ensureConfigDir() {
  await mkdir(USER_CONFIG_DIR, { recursive: true })
}

export async function readConfig() {
  await ensureConfigDir()

  try {
    const raw = await readFile(USER_CONFIG_PATH, "utf8")
    return cliConfigSchema.parse(JSON.parse(raw))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig
    }

    throw error
  }
}

export async function writeConfig(config: CliConfig) {
  await ensureConfigDir()
  await writeFile(USER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  await chmod(USER_CONFIG_PATH, 0o600)
}

export async function clearAuth() {
  const current = await readConfig()
  await writeConfig({
    ...current,
    accessToken: null,
    expiresAt: null,
    userEmail: null,
  })
}

export function resolveConfig(
  userConfig: CliConfig,
  localConfig: LocalConfig,
  overrides: Partial<ResolvedConfig>,
  env: NodeJS.ProcessEnv,
) {
  return cliConfigSchema.parse({
    apiBaseUrl:
      overrides.apiBaseUrl ??
      env.CARACARA_API_BASE_URL ??
      localConfig.apiBaseUrl ??
      userConfig.apiBaseUrl,
    accessToken: overrides.accessToken ?? userConfig.accessToken,
    expiresAt: overrides.expiresAt ?? userConfig.expiresAt,
    selectedProjectSlug:
      overrides.selectedProjectSlug ??
      env.CARACARA_PROJECT ??
      localConfig.selectedProjectSlug ??
      userConfig.selectedProjectSlug,
    userEmail: overrides.userEmail ?? userConfig.userEmail,
  })
}

export function resolveRunner(
  localConfig: LocalConfig,
  overrides: { runner?: RunnerType },
  env: NodeJS.ProcessEnv,
) {
  const candidate =
    overrides.runner ?? env.CARACARA_RUNNER ?? localConfig.runner ?? "codex"

  return runnerTypeSchema.parse(candidate)
}

export async function findLocalConfigPath(startDir = process.cwd()) {
  let currentDir = startDir

  while (true) {
    const candidate = join(
      currentDir,
      LOCAL_CONFIG_DIR_NAME,
      LOCAL_CONFIG_FILE_NAME,
    )

    try {
      await access(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

export function getDefaultLocalConfigPath(startDir = process.cwd()) {
  return join(startDir, LOCAL_CONFIG_DIR_NAME, LOCAL_CONFIG_FILE_NAME)
}

export async function readLocalConfig(startDir = process.cwd()) {
  const configPath = await findLocalConfigPath(startDir)

  if (!configPath) {
    return defaultLocalConfig
  }

  const raw = await readFile(configPath, "utf8")
  return localConfigSchema.parse(JSON.parse(raw))
}

export async function writeLocalConfig(
  config: LocalConfig,
  startDir = process.cwd(),
) {
  const configPath =
    (await findLocalConfigPath(startDir)) ?? getDefaultLocalConfigPath(startDir)
  const configDir = dirname(configPath)

  await mkdir(configDir, { recursive: true })
  await writeFile(
    configPath,
    `${JSON.stringify(localConfigSchema.parse(config), null, 2)}\n`,
    "utf8",
  )
  return configPath
}

export async function readResolvedConfig(
  overrides: Partial<ResolvedConfig>,
  env: NodeJS.ProcessEnv,
  startDir = process.cwd(),
) {
  const [userConfig, localConfig] = await Promise.all([
    readConfig(),
    readLocalConfig(startDir),
  ])

  const config = resolveConfig(userConfig, localConfig, overrides, env)

  return {
    ...config,
    runner: resolveRunner(localConfig, { runner: overrides.runner }, env),
  }
}

export const cliPaths = {
  configDir: USER_CONFIG_DIR,
  configPath: USER_CONFIG_PATH,
  localConfigDirName: LOCAL_CONFIG_DIR_NAME,
  localConfigFileName: LOCAL_CONFIG_FILE_NAME,
}
