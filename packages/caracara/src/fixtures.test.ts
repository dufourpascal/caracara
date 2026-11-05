import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Fixture, OrderedScenario } from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import { writeLocalConfig } from "./config.js"
import { buildBlockedRetryPrompt, buildRunnerPrompt } from "./execution.js"
import { buildFixtureTaskPrompt } from "./fixture-prompts.js"
import {
  collectRequiredFixtures,
  convergeFixture,
  parseFixtureHooksFile,
  parseFixturePreflightMode,
  readFixtureHooks,
  runHook,
  verifyFixture,
  type FixtureContext,
} from "./fixtures.js"

const STEP_ID = "00000000-0000-4000-8000-0000000000a1"
const HEALTH_ID = "00000000-0000-4000-8000-0000000000b1"

const fixture: Fixture = {
  id: "fixture-1",
  projectId: "project-1",
  name: "Demo user",
  slug: "demo-user",
  description: "A user with two saved articles.",
  locator: "User demo@example.com",
  protection: "Never delete the saved articles.",
  convergeSteps: [
    {
      id: STEP_ID,
      name: "Create user",
      instructions: "Sign up as demo@example.com.",
      doneWhen: "demo@example.com can sign in.",
    },
  ],
  healthChecks: [
    { id: HEALTH_ID, name: "Signs in", expectation: "The user can sign in." },
  ],
  requirements: [],
  createdAt: 1,
  updatedAt: 1,
}

function scenario(
  slug: string,
  fixtureRequirements: OrderedScenario["fixtureRequirements"]
): OrderedScenario {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    status: "active",
    instructions: "Open the articles page.",
    evaluationChecks: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Articles",
        expectation: "Two articles are listed.",
      },
    ],
    dependencyIds: [],
    fixtureRequirements,
  }
}

function sink() {
  const chunks: string[] = []
  return {
    write: (chunk: string | Uint8Array) => chunks.push(String(chunk)),
    text: () => chunks.join(""),
  }
}

function fakeSession(verdict: "passed" | "failed" = "passed"): ReturnType<
  typeof vi.fn
> & {
  session: Awaited<ReturnType<FixtureContext["getSession"]>>
} {
  const runTask = vi.fn(
    async (input: { checks: Array<{ id: string }>; prompt: string }) => ({
      executionSummary: "Done.",
      checkResults: input.checks.map((check) => ({
        checkId: check.id,
        verdict,
        evidence: verdict === "passed" ? "Seen." : "User missing.",
        blockedReason: null,
      })),
    })
  )
  return Object.assign(runTask, {
    session: {
      executeScenario: vi.fn(),
      runTask,
      close: vi.fn(async () => undefined),
    },
  })
}

function context(overrides: Partial<FixtureContext> = {}): FixtureContext {
  return {
    projectSlug: "demo",
    environment: { name: "dev", targetUrl: "http://localhost:3000/" },
    projectPrompt: "Never change demo data.",
    secrets: { CARACARA_SECRET_PASSWORD: "hunter2" },
    hooks: {},
    hookCwd: tmpdir(),
    agentCwd: tmpdir(),
    signal: new AbortController().signal,
    hookOutput: sink(),
    getSession: async () => {
      throw new Error("no session expected")
    },
    ...overrides,
  }
}

describe("fixtures.json", () => {
  it("parses hooks per project and fixture slug", () => {
    expect(
      parseFixtureHooksFile(
        JSON.stringify({
          demo: {
            "demo-user": { verify: "./verify.sh", converge: "make seed" },
          },
        }),
        "fixtures.json"
      )
    ).toEqual({
      demo: { "demo-user": { verify: "./verify.sh", converge: "make seed" } },
    })
  })

  it("rejects unknown keys, bad slugs, __proto__ and invalid JSON", () => {
    const parse = (raw: string) => () =>
      parseFixtureHooksFile(raw, "fixtures.json")
    expect(parse('{"demo":{"user":{"reset":"x"}}}')).toThrow(/fixtures.json/)
    expect(parse('{"Demo Project":{}}')).toThrow(/fixtures.json is invalid/)
    expect(parse('{"__proto__":{}}')).toThrow(/__proto__/)
    expect(parse('{"demo":{"__proto__":{"verify":"x"}}}')).toThrow(/__proto__/)
    expect(parse('{"demo":{"user":{"verify":""}}}')).toThrow(/invalid/)
    expect(parse("{")).toThrow(/not valid JSON/)
  })

  it("reads the project's hooks next to config.json and runs them from its parent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caracara-fixtures-"))
    await writeLocalConfig({}, dir)
    const nested = join(dir, ".caracara")
    expect(await readFixtureHooks("demo", nested)).toEqual({
      cwd: dir,
      hooks: {},
    })

    await writeFile(
      join(dir, ".caracara", "fixtures.json"),
      JSON.stringify({ demo: { "demo-user": { verify: "true" } } })
    )
    expect(await readFixtureHooks("demo", dir)).toEqual({
      cwd: dir,
      hooks: { "demo-user": { verify: "true" } },
    })
    expect((await readFixtureHooks("other", dir)).hooks).toEqual({})
  })
})

describe("hook runner", () => {
  it("returns the exit code and sends stdout and stderr to the output", async () => {
    const output = sink()
    const cwd = await mkdtemp(join(tmpdir(), "caracara-hook-"))

    const code = await runHook({
      command:
        'echo "out $CARACARA_FIXTURE $(pwd)"; echo "err $CARACARA_TARGET_URL" >&2; exit 3',
      cwd,
      env: {
        ...process.env,
        CARACARA_FIXTURE: "demo-user",
        CARACARA_TARGET_URL: "http://localhost:3000/",
      },
      output,
    })

    expect(code).toBe(3)
    expect(output.text()).toContain(`out demo-user ${cwd}`)
    expect(output.text()).toContain("err http://localhost:3000/")
    expect(await runHook({ command: "exit 0", cwd, env: {}, output })).toBe(0)
  })

  it("kills the hook's process group on abort", async () => {
    const controller = new AbortController()
    const output = sink()
    const run = runHook({
      command: "sleep 30 & echo started; wait",
      cwd: tmpdir(),
      env: process.env,
      signal: controller.signal,
      output,
    })
    await vi.waitFor(() => expect(output.text()).toContain("started"))
    const startedAt = Date.now()
    controller.abort(new Error("Interrupted."))

    await expect(run).rejects.toThrow("Interrupted.")
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it("passes server values and secrets to the hook only through the environment", async () => {
    const output = sink()
    const result = await verifyFixture(
      context({
        hooks: {
          "demo-user": {
            verify:
              'echo "$CARACARA_ENVIRONMENT|$CARACARA_TARGET_URL|$CARACARA_PROJECT|$CARACARA_FIXTURE|${#CARACARA_SECRET_PASSWORD}"',
          },
        },
        hookOutput: output,
      }),
      fixture
    )

    expect(result).toEqual({ ok: true, executor: "hook", problems: [] })
    expect(output.text()).toBe("dev|http://localhost:3000/|demo|demo-user|7\n")
  })
})

describe("fixture operations", () => {
  it("prefers the hook, falls back to an inspect-only agent task", async () => {
    const runTask = fakeSession()
    const getSession = vi.fn(async () => runTask.session)

    const viaHook = await verifyFixture(
      context({ hooks: { "demo-user": { verify: "exit 1" } }, getSession }),
      fixture
    )
    expect(viaHook).toMatchObject({ ok: false, executor: "hook" })
    expect(viaHook.problems[0]).toContain("exited with code 1")
    expect(getSession).not.toHaveBeenCalled()

    const viaAgent = await verifyFixture(context({ getSession }), fixture)
    expect(viaAgent).toEqual({ ok: true, executor: "agent", problems: [] })
    const task = runTask.mock.calls[0]![0] as {
      checks: Array<{ id: string }>
      prompt: string
    }
    expect(task.checks).toEqual(fixture.healthChecks)
    expect(task.prompt).toContain("Change nothing")
  })

  it("reports failed health checks and a missing executor as unhealthy", async () => {
    const runTask = fakeSession("failed")
    const failed = await verifyFixture(
      context({ getSession: async () => runTask.session }),
      fixture
    )
    expect(failed).toEqual({
      ok: false,
      executor: "agent",
      problems: ["Signs in: failed. User missing."],
    })

    const missing = await verifyFixture(context(), {
      ...fixture,
      healthChecks: [],
    })
    expect(missing).toMatchObject({ ok: false, executor: null })
    expect(missing.problems[0]).toContain('add a "verify" hook')
  })

  it("converges with one agent task over the steps, then verifies", async () => {
    const runTask = fakeSession()
    const result = await convergeFixture(
      context({ getSession: async () => runTask.session }),
      fixture
    )

    expect(result).toEqual({ ok: true, executor: "agent", problems: [] })
    expect(runTask).toHaveBeenCalledTimes(2)
    const [converge, verify] = runTask.mock.calls.map(
      (call) => call[0] as { checks: Array<{ id: string }>; prompt: string }
    )
    expect(converge!.checks).toEqual([
      {
        id: STEP_ID,
        name: "Create user",
        expectation: "demo@example.com can sign in.",
      },
    ])
    expect(converge!.prompt).toContain("Skip a step whose done-when")
    expect(verify!.checks).toEqual(fixture.healthChecks)
  })

  it("verifies after a converge hook and fails without any converge executor", async () => {
    const output = sink()
    const result = await convergeFixture(
      context({
        hooks: { "demo-user": { converge: "echo seeded", verify: "true" } },
        hookOutput: output,
      }),
      fixture
    )
    expect(result).toEqual({ ok: true, executor: "hook", problems: [] })
    expect(output.text()).toBe("seeded\n")

    const runTask = fakeSession()
    const none = await convergeFixture(
      context({ getSession: async () => runTask.session }),
      { ...fixture, convergeSteps: [] }
    )
    expect(none).toMatchObject({ ok: false, executor: null })
    expect(none.problems[0]).toContain('add a "converge" hook')
    expect(runTask).not.toHaveBeenCalled()
  })

  it("collects required fixtures across the queue; mutating access wins", () => {
    const required = collectRequiredFixtures(
      [
        {
          scenario: scenario("a", [
            { fixtureId: "fixture-1", access: "read", mutationScope: null },
          ]),
        },
        {
          scenario: scenario("b", [
            {
              fixtureId: "fixture-1",
              access: "mutates",
              mutationScope: "its drafts",
            },
          ]),
        },
        { scenario: scenario("c", []) },
      ],
      [fixture]
    )
    expect(required).toEqual([{ fixture, access: "mutates" }])
    expect(() =>
      collectRequiredFixtures(
        [
          {
            scenario: scenario("a", [
              { fixtureId: "missing", access: "read", mutationScope: null },
            ]),
          },
        ],
        []
      )
    ).toThrow(/did not send its definition/)
    expect(parseFixturePreflightMode(undefined)).toBe("check")
    expect(() => parseFixturePreflightMode("reset")).toThrow(/--fixtures/)
  })
})

describe("fixture prompts", () => {
  const protectedScenario = scenario("articles", [
    { fixtureId: "fixture-1", access: "read", mutationScope: null },
  ])

  it("adds a protected fixtures section to the evaluation and blocked-retry prompts", () => {
    const prompts = [
      buildRunnerPrompt({
        environment: "dev",
        targetUrl: "http://localhost:3000/",
        projectPrompt: "Project rules.",
        scenario: protectedScenario,
        fixtures: [fixture],
      }),
      buildBlockedRetryPrompt({
        environment: "dev",
        targetUrl: "http://localhost:3000/",
        projectPrompt: "Project rules.",
        scenario: protectedScenario,
        fixtures: [fixture],
        blockedResults: [
          {
            checkId: "00000000-0000-4000-8000-000000000001",
            verdict: "blocked",
            evidence: "Page did not load.",
            blockedReason: "environment_failure",
          },
        ],
      }),
    ]
    for (const prompt of prompts) {
      expect(prompt).toContain("Protected fixtures:")
      expect(prompt).toContain("- Demo user (demo-user)")
      expect(prompt).toContain("  Find it: User demo@example.com")
      expect(prompt).toContain("  Access: read-only. Do not change it.")
      expect(prompt).toContain("  Protection: Never delete the saved articles.")
      expect(prompt).toContain(
        "This scoped permission is the only exception to project-context rules that protect fixtures."
      )
    }

    const mutating = buildRunnerPrompt({
      environment: "dev",
      targetUrl: "http://localhost:3000/",
      projectPrompt: "Project rules.",
      scenario: scenario("edit", [
        {
          fixtureId: "fixture-1",
          access: "mutates",
          mutationScope: "the title of article 2",
        },
      ]),
      fixtures: [fixture],
    })
    expect(mutating).toContain(
      "  Access: you may change only the title of article 2. Leave the rest of this fixture unchanged."
    )
    expect(
      buildRunnerPrompt({
        environment: "dev",
        targetUrl: "http://localhost:3000/",
        projectPrompt: "Project rules.",
        scenario: scenario("plain", []),
        fixtures: [fixture],
      })
    ).not.toContain("Protected fixtures")
  })

  it("builds the maintenance prompt that exempts only this fixture", () => {
    const converge = buildFixtureTaskPrompt({
      kind: "converge",
      environment: "dev",
      targetUrl: "http://localhost:3000/",
      projectPrompt: "Never change demo data.",
      secretNames: ["CARACARA_SECRET_PASSWORD"],
      fixture,
    })
    expect(converge).toContain("Target environment: dev")
    expect(converge).toContain("Application URL: http://localhost:3000/")
    expect(converge).toContain("Never change demo data.")
    expect(converge).toContain("Description: A user with two saved articles.")
    expect(converge).toContain("Find it: User demo@example.com")
    expect(converge).toContain(
      "project-context rules that protect fixtures do not apply to the fixture Demo user (demo-user) for this task. They still apply to every other fixture and to all other data"
    )
    expect(converge).toContain(`1. Create user [${STEP_ID}]`)
    expect(converge).toContain("Stop at the first step that fails.")
    expect(converge).toContain("- CARACARA_SECRET_PASSWORD")

    const verify = buildFixtureTaskPrompt({
      kind: "verify",
      environment: "dev",
      targetUrl: "http://localhost:3000/",
      projectPrompt: "Never change demo data.",
      fixture,
    })
    expect(verify).toContain("This is inspect-only. Change nothing")
    expect(verify).toContain(`- Signs in [${HEALTH_ID}]`)
    expect(verify).not.toContain("Maintenance permission")
  })
})
