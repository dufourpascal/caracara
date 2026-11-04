import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { writeLocalConfig } from "./config.js"
import {
  collectSecretValues,
  findUnknownHookSlugs,
  getProjectFixtureHooks,
  mapHookResultChecks,
  parseFixtureHooksFile,
  readFixtureHooks,
  runFixtureHook,
  StreamRedactor,
  type FixtureHookInput,
} from "./fixture-hooks.js"

const healthChecks = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Animals",
    expectation: "Nine animals exist.",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Slices",
    expectation: "Twelve slices exist.",
  },
]

describe("fixtures.json", () => {
  it("parses hooks per project and fixture", () => {
    const projects = parseFixtureHooksFile(
      JSON.stringify({
        projects: {
          neuroqp: {
            "het-vs-homo": {
              verify: "./scripts/verify.sh",
              converge: "./scripts/converge.sh",
              timeoutMinutes: 90,
            },
          },
        },
      }),
      "fixtures.json"
    )
    expect(projects.neuroqp?.["het-vs-homo"]).toEqual({
      verify: "./scripts/verify.sh",
      converge: "./scripts/converge.sh",
      timeoutMinutes: 90,
    })
  })

  it.each([
    ["unknown hook keys", { projects: { demo: { fx: { verfy: "x" } } } }],
    ["unknown top-level keys", { projects: {}, hooks: {} }],
    ["a timeout above 180 minutes", { projects: { demo: { fx: { timeoutMinutes: 181 } } } }],
    ["a fractional timeout", { projects: { demo: { fx: { timeoutMinutes: 1.5 } } } }],
    ["an empty command", { projects: { demo: { fx: { verify: "  " } } } }],
    ["an invalid fixture slug", { projects: { demo: { "Bad Slug": {} } } }],
  ])("rejects %s", (_label, value) => {
    expect(() =>
      parseFixtureHooksFile(JSON.stringify(value), "fixtures.json")
    ).toThrow(/fixtures\.json is invalid/)
  })

  it("rejects __proto__ keys at project and fixture level", () => {
    expect(() =>
      parseFixtureHooksFile(
        '{"projects":{"__proto__":{"fx":{"verify":"x"}}}}',
        "fixtures.json"
      )
    ).toThrow(/invalid/)
    expect(() =>
      parseFixtureHooksFile(
        '{"projects":{"demo":{"__proto__":{"verify":"x"}}}}',
        "fixtures.json"
      )
    ).toThrow(/invalid/)
  })

  it("is optional and lives next to config.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-hooks-"))
    await writeLocalConfig({}, dir)
    const nested = join(dir, "nested")
    await mkdir(nested)

    const missing = await readFixtureHooks(nested)
    expect(missing).toEqual({
      path: join(dir, ".caracara", "fixtures.json"),
      rootDir: dir,
      projects: {},
    })

    await writeFile(
      join(dir, ".caracara", "fixtures.json"),
      JSON.stringify({ projects: { demo: { fx: { verify: "true" } } } })
    )
    const found = await readFixtureHooks(nested)
    expect(getProjectFixtureHooks(found, "demo")).toEqual({
      fx: { verify: "true" },
    })
    expect(getProjectFixtureHooks(found, "other")).toEqual({})
    expect(findUnknownHookSlugs({ fx: {}, typo: {} }, ["fx"])).toEqual([
      "typo",
    ])
  })
})

describe("secret redaction", () => {
  it("collects local secrets and inherited CARACARA_SECRET_ values", () => {
    expect(
      collectSecretValues(
        { CARACARA_SECRET_A: "short" },
        { CARACARA_SECRET_B: "much-longer", OTHER: "visible", CARACARA_SECRET_C: "" }
      )
    ).toEqual(["much-longer", "short"])
  })

  it("never splits a secret across chunk boundaries", () => {
    const emitted: string[] = []
    const redactor = new StreamRedactor(["hunter2-secret"], (text) =>
      emitted.push(text)
    )
    redactor.write("password=hunt")
    redactor.write("er2-sec")
    redactor.write("ret ok\nnext hunter2-")
    redactor.write("secret")
    redactor.end()
    expect(emitted.join("")).toBe(
      "password=[REDACTED] ok\nnext [REDACTED]"
    )
    expect(emitted.join("")).not.toContain("hunter2")
    // Complete lines are released immediately.
    expect(emitted[0]).toBe("password=[REDACTED] ok\n")
  })

  it("releases long lines without leaking a secret prefix", () => {
    const emitted: string[] = []
    const secret = "s3cr3t-value"
    const redactor = new StreamRedactor([secret], (text) => emitted.push(text))
    redactor.write(`${"x".repeat(9_000)}s3cr3t`)
    expect(emitted.join("")).not.toContain("s3cr3t")
    redactor.write("-value tail")
    redactor.end()
    expect(emitted.join("")).toBe(`${"x".repeat(9_000)}[REDACTED] tail`)
  })
})

describe("result file mapping", () => {
  it("maps checks by ID or exact name", () => {
    expect(
      mapHookResultChecks(
        [
          { check: "Slices", passed: false, evidence: "Only 11 slices." },
          { check: healthChecks[0]!.id, passed: true, evidence: "9 animals." },
        ],
        healthChecks
      )
    ).toEqual([
      expect.objectContaining({ name: "Animals", verdict: "passed" }),
      expect.objectContaining({ name: "Slices", verdict: "failed" }),
    ])
  })

  it.each([
    [
      "unknown",
      [
        { check: "Animals", passed: true, evidence: "ok" },
        { check: "Slices", passed: true, evidence: "ok" },
        { check: "Results", passed: true, evidence: "ok" },
      ],
      /not a health check/,
    ],
    [
      "duplicate",
      [
        { check: "Animals", passed: true, evidence: "ok" },
        { check: healthChecks[0]!.id, passed: true, evidence: "ok" },
        { check: "Slices", passed: true, evidence: "ok" },
      ],
      /more than once/,
    ],
    [
      "missing",
      [{ check: "Animals", passed: true, evidence: "ok" }],
      /missing "Slices"/,
    ],
  ])("rejects %s checks", (_label, reported, message) => {
    expect(() => mapHookResultChecks(reported, healthChecks)).toThrow(message)
  })

  it("rejects ambiguous names", () => {
    const duplicated = [
      healthChecks[0]!,
      { ...healthChecks[1]!, name: "Animals" },
    ]
    expect(() =>
      mapHookResultChecks(
        [{ check: "Animals", passed: true, evidence: "ok" }],
        duplicated
      )
    ).toThrow(/ambiguous/)
  })
})

describe.skipIf(process.platform === "win32")("hook executor", () => {
  // The developer's own CARACARA_* variables must not leak into these tests.
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("CARACARA_"))
  )
  async function runHook(
    script: string,
    overrides: Partial<FixtureHookInput> = {}
  ) {
    const dir = await mkdtemp(join(tmpdir(), "caracara-hook-test-"))
    const scriptPath = join(dir, "hook.mjs")
    await writeFile(scriptPath, script)
    const stdout: string[] = []
    const stderr: string[] = []
    const result = await runFixtureHook({
      command: `"${process.execPath}" "${scriptPath}"`,
      cwd: dir,
      kind: "verify",
      projectSlug: "demo",
      fixtureSlug: "het-vs-homo",
      healthChecks,
      environment: "development",
      targetUrl: "http://localhost:3000/",
      secrets: {},
      baseEnv: inheritedEnv,
      timeoutMs: 10_000,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      ...overrides,
    })
    return { dir, result, stdout: stdout.join(""), stderr: stderr.join("") }
  }

  it("succeeds on exit 0 and fails on a non-zero exit", async () => {
    const ok = await runHook('console.log("healthy")')
    expect(ok.result).toEqual({
      status: "succeeded",
      checkResults: [],
      summary: "Hook exited with code 0.\nhealthy\n",
    })
    const failed = await runHook('console.error("broken"); process.exit(2)')
    expect(failed.result.status).toBe("failed")
    expect(failed.result.summary).toContain("Hook exited with code 2.")
    expect(failed.stderr).toBe("broken\n")
  })

  it("passes the fixture context, runs in the root dir, and removes the result dir", async () => {
    const { dir, result } = await runHook(
      `import { writeFileSync } from "node:fs"
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("CARACARA_")))
      writeFileSync(process.env.CARACARA_RESULT_FILE, JSON.stringify({ summary: JSON.stringify({ cwd: process.cwd(), env }) }))`,
      { secrets: { CARACARA_SECRET_TOKEN: "local-token-value" } }
    )
    const reported = JSON.parse(result.summary) as {
      cwd: string
      env: Record<string, string>
    }
    expect(reported.cwd).toBe(dir)
    expect(reported.env).toMatchObject({
      CARACARA_ENVIRONMENT: "development",
      CARACARA_TARGET_URL: "http://localhost:3000/",
      CARACARA_PROJECT: "demo",
      CARACARA_FIXTURE: "het-vs-homo",
      CARACARA_FIXTURE_OPERATION: "verify",
    })
    // The secret reaches the hook but is redacted in the summary.
    expect(result.summary).not.toContain("local-token-value")
    expect(result.summary).toContain("[REDACTED]")
    const resultFile = reported.env.CARACARA_RESULT_FILE!
    await expect(readFile(resultFile)).rejects.toMatchObject({ code: "ENOENT" })
    const leftovers = await readdir(join(resultFile, ".."))
      .then(() => true)
      .catch(() => false)
    expect(leftovers).toBe(false)
  })

  it("maps a result file and fails when a check fails", async () => {
    const { result } = await runHook(
      `import { writeFileSync } from "node:fs"
      writeFileSync(process.env.CARACARA_RESULT_FILE, JSON.stringify({
        summary: "Checked via API",
        checks: [
          { check: "Animals", passed: true, evidence: "9 animals" },
          { check: "Slices", passed: false, evidence: "11 slices" },
        ],
      }))`
    )
    expect(result.status).toBe("failed")
    expect(result.summary).toBe("Checked via API")
    expect(result.checkResults.map((check) => check.verdict)).toEqual([
      "passed",
      "failed",
    ])
  })

  it("fails an invalid result file even when the hook exits 0", async () => {
    const { result } = await runHook(
      `import { writeFileSync } from "node:fs"
      writeFileSync(process.env.CARACARA_RESULT_FILE, JSON.stringify({
        checks: [{ check: "Animals", passed: true, evidence: "9 animals" }],
      }))`
    )
    expect(result.status).toBe("failed")
    expect(result.checkResults).toEqual([])
    expect(result.summary).toMatch(/^Invalid result file: missing "Slices"/)

    const malformed = await runHook(
      `import { writeFileSync } from "node:fs"
      writeFileSync(process.env.CARACARA_RESULT_FILE, "{not json")`
    )
    expect(malformed.result.status).toBe("failed")
    expect(malformed.result.summary).toMatch(/^Invalid result file/)
  })

  it("redacts streamed output, including inherited secret env values", async () => {
    const { stdout, result } = await runHook(
      `const parts = ["tok", "en-", "abc", "123"]
      for (const part of parts) { process.stdout.write(part); await new Promise((r) => setTimeout(r, 20)) }
      process.stdout.write(" and " + process.env.CARACARA_SECRET_INHERITED + "\\n")`,
      {
        baseEnv: {
          ...inheritedEnv,
          CARACARA_SECRET_INHERITED: "inherited-value",
        },
        secrets: { CARACARA_SECRET_LOCAL: "token-abc123" },
        outputPrefix: "  [fx] ",
      }
    )
    expect(stdout).toBe("  [fx] [REDACTED] and [REDACTED]\n")
    expect(result.summary).not.toMatch(/token-abc123|inherited-value/)
  })

  it("kills the process tree on timeout", async () => {
    const pidDir = await mkdtemp(join(tmpdir(), "caracara-hook-pid-"))
    const pidFile = join(pidDir, "pid")
    const { result } = await runHook(
      `import { spawn } from "node:child_process"
      import { writeFileSync } from "node:fs"
      const child = spawn("sleep", ["30"], { stdio: "ignore" })
      writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
      console.log("waiting")
      setInterval(() => {}, 1000)`,
      { timeoutMs: 500 }
    )
    expect(result.status).toBe("failed")
    expect(result.summary).toMatch(/^Hook timed out/)
    const grandchild = Number(await readFile(pidFile, "utf8"))
    expect(() => process.kill(grandchild, 0)).toThrow()
  })

  it("does not start the hook when the signal fires during setup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-hook-setup-"))
    const marker = join(dir, "ran")
    const scriptPath = join(dir, "hook.mjs")
    await writeFile(
      scriptPath,
      `import { writeFileSync } from "node:fs"
      writeFileSync(${JSON.stringify(marker)}, "yes")`
    )
    const controller = new AbortController()
    const pending = runFixtureHook({
      command: `"${process.execPath}" "${scriptPath}"`,
      cwd: dir,
      kind: "verify",
      projectSlug: "demo",
      fixtureSlug: "het-vs-homo",
      healthChecks,
      environment: "development",
      targetUrl: "http://localhost:3000/",
      secrets: {},
      baseEnv: inheritedEnv,
      timeoutMs: 10_000,
      signal: controller.signal,
      stdout: () => undefined,
      stderr: () => undefined,
    })
    // The executor is now awaiting its temp directory, past the entry check.
    controller.abort(new Error("Interrupted by SIGTERM."))
    await expect(pending).rejects.toThrow("Interrupted by SIGTERM.")
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects with the abort reason", async () => {
    const controller = new AbortController()
    const pending = runHook("setInterval(() => {}, 1000)", {
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(new Error("Interrupted by SIGINT.")), 200)
    await expect(pending).rejects.toThrow("Interrupted by SIGINT.")
  })
})
