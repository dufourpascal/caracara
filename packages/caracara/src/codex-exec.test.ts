import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { setTimeout as delay } from "node:timers/promises"
import { delimiter, dirname, join } from "node:path"

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  checkCodexVersion,
  CodexClient,
  getCodexVersion,
  MINIMUM_CODEX_VERSION,
  parseCodexVersion,
  resolveCodexExecutable,
  serializeConfigOverrides,
} from "./codex-exec.js"
import {
  buildCodexClientOptions,
  buildCodexThreadOptions,
} from "./execution.js"

const fakeCodexSource = `#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync } = require("node:fs")
const args = process.argv.slice(2)
if (args[0] === "--version") {
  process.stdout.write(process.env.FAKE_CODEX_VERSION_OUTPUT ?? "codex-cli 0.164.0\\n")
  process.exit(0)
}
const stdin = readFileSync(0, "utf8")
const schemaIndex = args.indexOf("--output-schema")
const schemaPath = schemaIndex === -1 ? null : args[schemaIndex + 1]
writeFileSync(
  process.env.FAKE_CODEX_RECORD,
  JSON.stringify({
    args,
    stdin,
    originator: process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? null,
    schemaPath,
    schema: schemaPath && existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : null,
  })
)
const mode = process.env.FAKE_CODEX_MODE ?? "ok"
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n")
if (mode === "hang") {
  // Ignores SIGTERM like a stuck CLI; only SIGKILL ends it.
  process.on("SIGTERM", () => {})
  emit({ type: "thread.started", thread_id: "thread_hang" })
  setInterval(() => {}, 1000)
  return
}
if (mode === "exit") {
  process.stderr.write("codex exploded")
  process.exit(2)
}
emit({ type: "thread.started", thread_id: "thread_123" })
emit({ type: "turn.started" })
if (mode === "failed") {
  emit({ type: "turn.failed", error: { message: "model refused" } })
  process.exit(1)
}
emit({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking" } })
emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: '{"ok":true}' } })
emit({
  type: "turn.completed",
  usage: {
    input_tokens: 100,
    cached_input_tokens: 40,
    output_tokens: 20,
    reasoning_output_tokens: 5,
  },
})
`

let tempDir: string
let binDir: string
let fakeCodexPath: string
let recordPath: string

function fakeEnv(mode = "ok"): NodeJS.ProcessEnv {
  return {
    // Lets the fake's `#!/usr/bin/env node` shebang find the running Node.
    PATH: dirname(process.execPath),
    FAKE_CODEX_RECORD: recordPath,
    FAKE_CODEX_MODE: mode,
  }
}

async function readRecord() {
  return JSON.parse(await readFile(recordPath, "utf8")) as {
    args: string[]
    stdin: string
    originator: string | null
    schemaPath: string | null
    schema: string | null
  }
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "caracara-codex-exec-test-"))
  binDir = join(tempDir, "bin")
  fakeCodexPath = join(binDir, "codex")
  recordPath = join(tempDir, "record.json")
  mkdirSync(binDir)
  // A package.json without "type" keeps the fake CLI in CommonJS mode.
  writeFileSync(join(binDir, "package.json"), "{}")
  writeFileSync(fakeCodexPath, fakeCodexSource)
  chmodSync(fakeCodexPath, 0o755)
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

// The thread option assertions expect the default sandbox.
beforeEach(() => {
  vi.stubEnv("CARACARA_CODEX_SANDBOX", undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.skipIf(process.platform === "win32")("resolveCodexExecutable", () => {
  it("prefers CARACARA_CODEX_PATH", () => {
    expect(
      resolveCodexExecutable({ CARACARA_CODEX_PATH: fakeCodexPath, PATH: "" })
    ).toBe(fakeCodexPath)
  })

  it("rejects a CARACARA_CODEX_PATH that is not a file", () => {
    expect(() =>
      resolveCodexExecutable({ CARACARA_CODEX_PATH: join(tempDir, "missing") })
    ).toThrow("CARACARA_CODEX_PATH")
  })

  it("finds codex on PATH", () => {
    expect(
      resolveCodexExecutable({
        PATH: [join(tempDir, "empty"), "", binDir].join(delimiter),
      })
    ).toBe(fakeCodexPath)
  })

  it("explains how to install Codex when it is missing", () => {
    expect(() =>
      resolveCodexExecutable({ PATH: join(tempDir, "empty") })
    ).toThrow(
      "Codex CLI not found. Install it with `npm install -g @openai/codex` or set CARACARA_CODEX_PATH."
    )
  })
})

describe("Codex version checks", () => {
  it("parses the CLI version output", () => {
    expect(parseCodexVersion("codex-cli 0.164.0\n")).toBe("0.164.0")
    expect(parseCodexVersion("codex-cli 1.2.3-alpha.4")).toBe("1.2.3")
    expect(parseCodexVersion("unknown")).toBeUndefined()
  })

  it("compares versions numerically", () => {
    expect(MINIMUM_CODEX_VERSION).toBe("0.164.0")
    expect(checkCodexVersion("0.164.0")).toBeUndefined()
    expect(checkCodexVersion("0.1000.0")).toBeUndefined()
    expect(checkCodexVersion("1.0.0")).toBeUndefined()
    expect(checkCodexVersion("0.99.9")).toMatchObject({
      severity: "error",
      message: expect.stringContaining("older than"),
    })
    expect(checkCodexVersion("0.163.12")?.severity).toBe("error")
    expect(checkCodexVersion(undefined)).toMatchObject({
      severity: "warning",
      message: expect.stringContaining("Could not determine"),
    })
  })

  it.skipIf(process.platform === "win32")(
    "reads the version from the executable",
    async () => {
      await expect(getCodexVersion(fakeCodexPath)).resolves.toBe("0.164.0")
      await expect(
        getCodexVersion(join(tempDir, "missing"))
      ).resolves.toBeUndefined()
    }
  )
})

describe("serializeConfigOverrides", () => {
  it("serializes nested values as TOML overrides", () => {
    expect(
      serializeConfigOverrides({
        a: { b: "x", "c.d": { e: 1 }, empty: {}, skip: undefined },
        list: ["one", 2, true],
        inline: [{ "bad key": "v", ok: false }],
      })
    ).toEqual([
      'a.b="x"',
      "a.c.d.e=1",
      "a.empty={}",
      'list=["one", 2, true]',
      'inline=[{"bad key" = "v", ok = false}]',
    ])
  })

  it("rejects null and non-finite values", () => {
    expect(() => serializeConfigOverrides({ a: null })).toThrow(
      "cannot be null"
    )
    expect(() => serializeConfigOverrides({ a: Infinity })).toThrow(
      "finite number"
    )
  })
})

describe.skipIf(process.platform === "win32")("CodexClient", () => {
  const chromeConfigArgs = [
    "--config",
    'mcp_servers.chrome-devtools.command="npx"',
    "--config",
    'mcp_servers.chrome-devtools.args=["-y", "chrome-devtools-mcp@latest", "--wsEndpoint", "ws://127.0.0.1:9222/devtools/browser/test", "--logFile", "/tmp/chrome-devtools-mcp.log"]',
    "--config",
    "mcp_servers.chrome-devtools.required=true",
    "--config",
    'mcp_servers.chrome-devtools.default_tools_approval_mode="approve"',
    "--config",
    "mcp_servers.node_repl.enabled=false",
  ]

  function createClient(mode = "ok", modelReasoningEffort?: "none" | "high") {
    return new CodexClient({
      ...buildCodexClientOptions({
        env: fakeEnv(mode),
        logFilePath: "/tmp/chrome-devtools-mcp.log",
        wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/test",
        modelReasoningEffort,
      }),
      executablePath: fakeCodexPath,
    })
  }

  it("runs codex exec with the SDK-compatible arguments", async () => {
    const thread = createClient("ok", "high").startThread(
      buildCodexThreadOptions({
        cwd: "/tmp/project",
        model: "gpt-5.6-luna",
        modelReasoningEffort: "high",
      })
    )
    const schema = { type: "object", properties: {} }

    const turn = await thread.run("Test the app.", { outputSchema: schema })

    const record = await readRecord()
    expect(record.args).toEqual([
      "exec",
      "--json",
      ...chromeConfigArgs,
      "--model",
      "gpt-5.6-luna",
      "--thread-source",
      "caracara",
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/project",
      "--skip-git-repo-check",
      "--output-schema",
      record.schemaPath,
      "--config",
      'model_reasoning_effort="high"',
      "--config",
      'approval_policy="never"',
    ])
    expect(record.stdin).toBe("Test the app.")
    expect(record.originator).toBe("codex_sdk_ts")
    expect(record.schemaPath).toMatch(/codex-output-schema-.*schema\.json$/)
    expect(JSON.parse(record.schema ?? "null")).toEqual(schema)
    expect(existsSync(record.schemaPath ?? "")).toBe(false)
    expect(thread.id).toBe("thread_123")
    expect(turn).toEqual({
      finalResponse: '{"ok":true}',
      usage: {
        input_tokens: 100,
        cached_input_tokens: 40,
        cache_write_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 5,
      },
    })
  })

  it("passes the none reasoning effort as a config override", async () => {
    const thread = createClient("ok", "none").startThread(
      buildCodexThreadOptions({
        cwd: "/tmp/project",
        modelReasoningEffort: "none",
      })
    )

    await thread.run("Test the app.")

    const record = await readRecord()
    expect(record.args).toEqual([
      "exec",
      "--json",
      ...chromeConfigArgs,
      "--config",
      'model_reasoning_effort="none"',
      "--thread-source",
      "caracara",
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/project",
      "--skip-git-repo-check",
      "--config",
      'approval_policy="never"',
    ])
    expect(record.schemaPath).toBeNull()
  })

  it("resumes the same thread on follow-up turns", async () => {
    const thread = createClient().startThread({
      threadSource: "caracara",
      workingDirectory: "/tmp/project",
    })

    await thread.run("First turn.")
    expect((await readRecord()).args).toContain("--thread-source")

    await thread.run("Second turn.")
    const record = await readRecord()
    expect(record.stdin).toBe("Second turn.")
    expect(record.args).not.toContain("--thread-source")
    expect(record.args.slice(-2)).toEqual(["resume", "thread_123"])
  })

  it("keeps a caller-provided originator", async () => {
    const thread = new CodexClient({
      env: { ...fakeEnv(), CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "custom" },
      executablePath: fakeCodexPath,
    }).startThread()

    await thread.run("Hi.")

    expect((await readRecord()).originator).toBe("custom")
  })

  it("rejects when the turn fails", async () => {
    const thread = createClient("failed").startThread()

    await expect(
      thread.run("Hi.", { outputSchema: { type: "object" } })
    ).rejects.toThrow("model refused")
    expect(existsSync((await readRecord()).schemaPath ?? "")).toBe(false)
  })

  it("rejects with stderr when codex exits non-zero", async () => {
    const thread = createClient("exit").startThread()

    await expect(thread.run("Hi.")).rejects.toThrow(
      "Codex Exec exited with code 2: codex exploded"
    )
  })

  it("kills a Codex that ignores SIGTERM when the turn is aborted", async () => {
    const controller = new AbortController()
    const thread = createClient("hang").startThread(
      buildCodexThreadOptions({ cwd: "/tmp/project" })
    )
    const started = Date.now()
    const run = thread.run("Hang.", { signal: controller.signal })
    await delay(300)
    controller.abort(new Error("interrupted by test"))

    await expect(run).rejects.toThrow("interrupted by test")
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it("rejects when the executable cannot be spawned", async () => {
    const thread = new CodexClient({
      env: fakeEnv(),
      executablePath: join(tempDir, "missing-codex"),
    }).startThread()

    await expect(thread.run("Hi.")).rejects.toThrow("ENOENT")
  })

  it("rejects non-object output schemas", async () => {
    const thread = createClient().startThread()

    await expect(
      thread.run("Hi.", { outputSchema: ["not", "an", "object"] })
    ).rejects.toThrow("outputSchema must be a plain JSON object")
  })

  it("resolves the executable from the provided environment", () => {
    expect(
      () => new CodexClient({ env: { PATH: join(tempDir, "empty") } })
    ).toThrow("Codex CLI not found")
    expect(
      new CodexClient({ env: { PATH: binDir } }).startThread()
    ).toBeDefined()
  })
})
