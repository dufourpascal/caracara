// Spawns the user's own `codex` executable instead of bundling the Codex
// runtime. Argument construction, config serialization and JSONL event
// handling follow @openai/codex-sdk 0.164.0 (Apache-2.0) for the subset of
// options caracara uses.
import { spawn, type ChildProcess } from "node:child_process"
import { accessSync, constants, statSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { setTimeout as delay } from "node:timers/promises"
import { delimiter, join } from "node:path"
import readline from "node:readline"

import { terminateChildProcess } from "./process-control.js"

export const MINIMUM_CODEX_VERSION = "0.164.0"

const INTERNAL_ORIGINATOR_ENV = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE"
const TYPESCRIPT_SDK_ORIGINATOR = "codex_sdk_ts"
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/

export type CodexUsage = {
  input_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}

export type CodexSandboxMode =
  "read-only" | "workspace-write" | "danger-full-access"

export type CodexApprovalPolicy =
  "never" | "on-request" | "on-failure" | "untrusted"

export type CodexReasoningEffort =
  "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type CodexClientOptions = {
  env?: NodeJS.ProcessEnv
  config?: Record<string, unknown>
  executablePath?: string
}

export type CodexThreadOptions = {
  workingDirectory?: string
  skipGitRepoCheck?: boolean
  sandboxMode?: CodexSandboxMode
  approvalPolicy?: CodexApprovalPolicy
  threadSource?: string
  model?: string
  modelReasoningEffort?: CodexReasoningEffort
}

export type CodexTurnOptions = {
  outputSchema?: unknown
  signal?: AbortSignal
}

export type CodexTurn = {
  finalResponse: string
  usage: CodexUsage | null
}

type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "item.completed"; item: { type: string; text?: string } }
  | {
      type: "turn.completed"
      usage: Omit<CodexUsage, "cache_write_input_tokens"> & {
        cache_write_input_tokens?: number
      }
    }
  | { type: "turn.failed"; error: { message: string } }
  | { type: string }

function isFile(filePath: string) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isExecutableFile(filePath: string) {
  if (!isFile(filePath)) {
    return false
  }
  if (process.platform === "win32") {
    return true
  }
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getPathValue(env: NodeJS.ProcessEnv) {
  if (process.platform !== "win32") {
    return env.PATH
  }
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path")
  return key ? env[key] : undefined
}

const WINDOWS_TARGET_TRIPLE: Record<string, string> = {
  x64: "x86_64-pc-windows-msvc",
  arm64: "aarch64-pc-windows-msvc",
}

/**
 * `npm install -g @openai/codex` leaves a `codex.cmd` shim on Windows, which
 * Node refuses to spawn without a shell. Find the native binary it wraps.
 */
function resolveWindowsShimBinary(shimDir: string) {
  const triple = WINDOWS_TARGET_TRIPLE[process.arch]
  if (!triple) {
    return undefined
  }
  const platformPackage = `@openai/codex-win32-${process.arch}`
  const roots = [
    join(shimDir, "node_modules", platformPackage),
    join(
      shimDir,
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      platformPackage
    ),
  ]
  for (const root of roots) {
    for (const candidate of [
      join(root, "vendor", triple, "bin", "codex.exe"),
      join(root, "vendor", triple, "codex", "codex.exe"),
    ]) {
      if (isFile(candidate)) {
        return candidate
      }
    }
  }
  return undefined
}

export function resolveCodexExecutable(env: NodeJS.ProcessEnv = process.env) {
  const override = env.CARACARA_CODEX_PATH
  if (override) {
    if (!isFile(override)) {
      throw new Error(
        `CARACARA_CODEX_PATH points to ${override}, which is not a file.`
      )
    }
    return override
  }

  const names =
    process.platform === "win32" ? ["codex.exe", "codex.cmd"] : ["codex"]
  for (const dir of (getPathValue(env) ?? "").split(delimiter)) {
    if (!dir) {
      continue
    }
    for (const name of names) {
      const candidate = join(dir, name)
      if (!isExecutableFile(candidate)) {
        continue
      }
      if (name === "codex.cmd") {
        const binary = resolveWindowsShimBinary(dir)
        if (binary) {
          return binary
        }
        throw new Error(
          `Found ${candidate}, but not the codex.exe it wraps. Set CARACARA_CODEX_PATH to the Codex executable.`
        )
      }
      return candidate
    }
  }

  throw new Error(
    "Codex CLI not found. Install it with `npm install -g @openai/codex` or set CARACARA_CODEX_PATH."
  )
}

export function parseCodexVersion(output: string) {
  return /(\d+)\.(\d+)\.(\d+)/.exec(output)?.[0]
}

const VERSION_PROBE_TIMEOUT_MS = 10_000

export async function getCodexVersion(
  executablePath: string
): Promise<string | undefined> {
  // Detached so a wrapper script's native child dies with it on timeout.
  const detached = process.platform !== "win32"
  let child: ChildProcess
  try {
    child = spawn(executablePath, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      detached,
      windowsHide: true,
    })
  } catch {
    return undefined
  }
  let output = ""
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8")
  })
  child.on("error", () => undefined)
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve())
  })
  const timedOut = await Promise.race([
    closed.then(() => false),
    delay(VERSION_PROBE_TIMEOUT_MS).then(() => true),
  ])
  if (timedOut) {
    await terminateChildProcess(child, detached, closed).catch(() => undefined)
    return undefined
  }
  return parseCodexVersion(output)
}

function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number)
  const b = right.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

export type CodexVersionProblem = {
  severity: "warning" | "error"
  message: string
}

export function checkCodexVersion(
  version: string | undefined
): CodexVersionProblem | undefined {
  if (!version) {
    return {
      severity: "warning",
      message: `Could not determine the Codex CLI version. Caracara requires ${MINIMUM_CODEX_VERSION} or newer.`,
    }
  }
  if (compareVersions(version, MINIMUM_CODEX_VERSION) < 0) {
    return {
      severity: "error",
      message: `Codex CLI ${version} is older than the supported minimum ${MINIMUM_CODEX_VERSION}. Update it with \`npm install -g @openai/codex\`.`,
    }
  }
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatTomlKey(key: string) {
  return TOML_BARE_KEY.test(key) ? key : JSON.stringify(key)
}

function toTomlValue(value: unknown, path: string): string {
  if (typeof value === "string") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Codex config override at ${path} must be a finite number`
      )
    }
    return `${value}`
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (Array.isArray(value)) {
    const rendered = value.map((item, index) =>
      toTomlValue(item, `${path}[${index}]`)
    )
    return `[${rendered.join(", ")}]`
  }
  if (isPlainObject(value)) {
    const parts: string[] = []
    for (const [key, child] of Object.entries(value)) {
      if (!key) {
        throw new Error("Codex config override keys must be non-empty strings")
      }
      if (child === undefined) {
        continue
      }
      parts.push(
        `${formatTomlKey(key)} = ${toTomlValue(child, `${path}.${key}`)}`
      )
    }
    return `{${parts.join(", ")}}`
  }
  if (value === null) {
    throw new Error(`Codex config override at ${path} cannot be null`)
  }
  throw new Error(
    `Unsupported Codex config override value at ${path}: ${typeof value}`
  )
}

function flattenConfigOverrides(
  value: unknown,
  prefix: string,
  overrides: string[]
) {
  if (!isPlainObject(value)) {
    if (!prefix) {
      throw new Error("Codex config overrides must be a plain object")
    }
    overrides.push(`${prefix}=${toTomlValue(value, prefix)}`)
    return
  }
  const entries = Object.entries(value)
  if (entries.length === 0) {
    if (prefix) {
      overrides.push(`${prefix}={}`)
    }
    return
  }
  for (const [key, child] of entries) {
    if (!key) {
      throw new Error("Codex config override keys must be non-empty strings")
    }
    if (child === undefined) {
      continue
    }
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(child)) {
      flattenConfigOverrides(child, path, overrides)
    } else {
      overrides.push(`${path}=${toTomlValue(child, path)}`)
    }
  }
}

export function serializeConfigOverrides(config: Record<string, unknown>) {
  const overrides: string[] = []
  flattenConfigOverrides(config, "", overrides)
  return overrides
}

export function buildCodexExecArgs(input: {
  config?: Record<string, unknown>
  thread: CodexThreadOptions
  threadId: string | null
  outputSchemaFile?: string
}) {
  const { thread } = input
  const args = ["exec", "--json"]
  if (input.config) {
    for (const override of serializeConfigOverrides(input.config)) {
      args.push("--config", override)
    }
  }
  if (thread.model) {
    args.push("--model", thread.model)
  }
  if (thread.threadSource !== undefined && !input.threadId) {
    args.push("--thread-source", thread.threadSource)
  }
  if (thread.sandboxMode) {
    args.push("--sandbox", thread.sandboxMode)
  }
  if (thread.workingDirectory) {
    args.push("--cd", thread.workingDirectory)
  }
  if (thread.skipGitRepoCheck) {
    args.push("--skip-git-repo-check")
  }
  if (input.outputSchemaFile) {
    args.push("--output-schema", input.outputSchemaFile)
  }
  if (thread.modelReasoningEffort) {
    args.push(
      "--config",
      `model_reasoning_effort="${thread.modelReasoningEffort}"`
    )
  }
  if (thread.approvalPolicy) {
    args.push("--config", `approval_policy="${thread.approvalPolicy}"`)
  }
  if (input.threadId) {
    args.push("resume", input.threadId)
  }
  return args
}

async function createOutputSchemaFile(schema: unknown) {
  if (schema === undefined) {
    return { schemaPath: undefined, cleanup: async () => undefined }
  }
  if (!isPlainObject(schema)) {
    throw new Error("outputSchema must be a plain JSON object")
  }
  const schemaDir = await mkdtemp(join(tmpdir(), "codex-output-schema-"))
  const schemaPath = join(schemaDir, "schema.json")
  const cleanup = async () => {
    await rm(schemaDir, { recursive: true, force: true }).catch(() => undefined)
  }
  try {
    await writeFile(schemaPath, JSON.stringify(schema), "utf8")
    return { schemaPath, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

function buildChildEnv(env: NodeJS.ProcessEnv | undefined) {
  const childEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env ?? process.env)) {
    if (value !== undefined) {
      childEnv[key] = value
    }
  }
  if (!childEnv[INTERNAL_ORIGINATOR_ENV]) {
    childEnv[INTERNAL_ORIGINATOR_ENV] = TYPESCRIPT_SDK_ORIGINATOR
  }
  return childEnv
}

export class CodexThread {
  private threadId: string | null = null

  constructor(
    private readonly client: CodexClientOptions & { executablePath: string },
    private readonly options: CodexThreadOptions
  ) {}

  /** Populated once the first turn reports `thread.started`. */
  get id() {
    return this.threadId
  }

  async run(prompt: string, turnOptions: CodexTurnOptions = {}) {
    const { schemaPath, cleanup } = await createOutputSchemaFile(
      turnOptions.outputSchema
    )
    try {
      return await this.runProcess(prompt, schemaPath, turnOptions.signal)
    } finally {
      await cleanup()
    }
  }

  private async runProcess(
    prompt: string,
    outputSchemaFile: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<CodexTurn> {
    const args = buildCodexExecArgs({
      config: this.client.config,
      thread: this.options,
      threadId: this.threadId,
      outputSchemaFile,
    })
    signal?.throwIfAborted()
    // Detached on POSIX so an abort kills the whole process group, including
    // MCP servers Codex started. Abort handling is ours, not spawn's, so a
    // child that ignores SIGTERM is escalated to SIGKILL.
    const detached = process.platform !== "win32"
    const child = spawn(this.client.executablePath, args, {
      env: buildChildEnv(this.client.env),
      detached,
      windowsHide: true,
    })
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => resolve())
    })
    // The close promise makes the helper kill the whole group even when the
    // leader (npm's launcher script) has exited and its native child still
    // holds stdout open.
    let terminating: Promise<void> | null = null
    const onAbort = () => {
      terminating ??= terminateChildProcess(child, detached, closed).catch(
        () => undefined
      )
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    const failures: { spawn?: Error } = {}
    // Stays attached for the child's whole life: an abort after this turn
    // has settled still emits "error", which must not be unhandled.
    child.on("error", (error) => {
      failures.spawn ??= error
    })
    const stderrChunks: Buffer[] = []
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })
    const exit = new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
    }>((resolve) => {
      child.once("close", (code, exitSignal) => {
        resolve({ code, signal: exitSignal })
      })
    })
    // The child may exit before reading stdin; surface that via the exit code.
    child.stdin.on("error", () => undefined)
    child.stdin.end(prompt)

    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })
    // A destroyed pipe (after a kill) never emits "end", and readline's
    // iterator would wait forever; end it once the child is gone.
    void exit.then(() => lines.close())
    let finalResponse = ""
    let usage: CodexUsage | null = null
    let failure: string | null = null

    try {
      for await (const line of lines) {
        let event: CodexEvent
        try {
          event = JSON.parse(line) as CodexEvent
        } catch (error) {
          throw new Error(`Failed to parse item: ${line}`, { cause: error })
        }
        if (event.type === "thread.started" && "thread_id" in event) {
          this.threadId = event.thread_id
        } else if (event.type === "item.completed" && "item" in event) {
          if (event.item.type === "agent_message") {
            finalResponse = event.item.text ?? ""
          }
        } else if (event.type === "turn.completed" && "usage" in event) {
          usage = {
            ...event.usage,
            cache_write_input_tokens: event.usage.cache_write_input_tokens ?? 0,
          }
        } else if (event.type === "turn.failed" && "error" in event) {
          failure = event.error.message
          break
        }
      }
      if (failure !== null) {
        throw new Error(failure)
      }

      if (failures.spawn) {
        throw failures.spawn
      }
      const result = await exit
      if (failures.spawn) {
        throw failures.spawn
      }
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Codex turn aborted.")
      }
      if (result.code !== 0 || result.signal) {
        const detail = result.signal
          ? `signal ${result.signal}`
          : `code ${result.code ?? 1}`
        throw new Error(
          `Codex Exec exited with ${detail}: ${Buffer.concat(stderrChunks).toString("utf8")}`
        )
      }
      return { finalResponse, usage }
    } finally {
      signal?.removeEventListener("abort", onAbort)
      lines.close()
      if (
        terminating ||
        (child.exitCode === null && child.signalCode === null)
      ) {
        await (
          terminating ?? terminateChildProcess(child, detached, closed)
        ).catch(() => undefined)
      }
    }
  }
}

export class CodexClient {
  private readonly options: CodexClientOptions & { executablePath: string }

  constructor(options: CodexClientOptions = {}) {
    this.options = {
      ...options,
      executablePath:
        options.executablePath ??
        resolveCodexExecutable(options.env ?? process.env),
    }
  }

  startThread(options: CodexThreadOptions = {}) {
    return new CodexThread(this.options, options)
  }
}
