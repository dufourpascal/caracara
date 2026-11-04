import { describe, expect, it } from "vitest"

import { parseFixtureFields } from "./fixtures"
import * as fixtures from "./fixtures"
import * as phases from "./phases"
import * as runs from "./runs"
import * as scenarios from "./scenarios"

type Row = Record<string, unknown> & { _id: string; _creationTime: number }

/** An in-memory database that supports the equality index reads used here. */
function createCtx() {
  const tables = new Map<string, Map<string, Row>>()
  let counter = 0
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)!
  }
  const find = (id: string) => table(id.split(":")[0]!).get(id) ?? null
  const db = {
    async get(id: string) {
      const row = find(id)
      return row ? structuredClone(row) : null
    },
    async insert(name: string, value: Record<string, unknown>) {
      counter += 1
      const _id = `${name}:${counter}`
      table(name).set(_id, {
        ...structuredClone(value),
        _id,
        _creationTime: counter,
      })
      return _id
    },
    async patch(id: string, value: Record<string, unknown>) {
      const row = find(id)!
      table(id.split(":")[0]!).set(id, { ...row, ...structuredClone(value) })
    },
    async delete(id: string) {
      table(id.split(":")[0]!).delete(id)
    },
    query(name: string) {
      const conditions: Array<[string, unknown]> = []
      const rows = () =>
        [...table(name).values()]
          .filter((row) =>
            conditions.every(([field, value]) => row[field] === value)
          )
          .map((row) => structuredClone(row))
      const result = {
        withIndex(_index: string, build?: (query: unknown) => unknown) {
          const builder = {
            eq(field: string, value: unknown) {
              conditions.push([field, value])
              return builder
            },
          }
          build?.(builder)
          return result
        },
        order: () => result,
        collect: async () => rows(),
        first: async () => rows()[0] ?? null,
        unique: async () => rows()[0] ?? null,
      }
      return result
    },
  }
  return {
    ctx: {
      db,
      auth: { getUserIdentity: async () => ({ subject: "user-1" }) },
    },
    insert: db.insert,
  }
}

type Ctx = ReturnType<typeof createCtx>["ctx"]

function call<Args, Result>(
  fn: { _handler?: unknown } & object,
  ctx: Ctx,
  args: Args
): Promise<Result> {
  return (
    fn as unknown as { _handler: (ctx: Ctx, args: Args) => Promise<Result> }
  )._handler(ctx, args)
}

const STEP_ID = "00000000-0000-4000-8000-000000000001"

async function seedProject() {
  const db = createCtx()
  const projectId = await db.insert("projects", {
    ownerUserId: "user-1",
    name: "Demo",
    slug: "demo",
    description: "",
    projectPrompt: "",
    createdAt: 1,
    updatedAt: 1,
  })
  const phaseId = await db.insert("phases", {
    projectId,
    name: "Setup",
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  })
  const scenario = (slug: string, phase: string | null) =>
    db.insert("scenarios", {
      projectId,
      name: slug,
      slug,
      status: "active",
      instructions: "Do it.",
      evaluationChecks: [
        { id: STEP_ID, name: "Works", expectation: "It works." },
      ],
      phaseId: phase,
      updatedAt: 1,
    })
  const checkoutId = await scenario("checkout", phaseId)
  const browseId = await scenario("browse", phaseId)
  return { ...db, projectId, phaseId, checkoutId, browseId }
}

describe("fixture authoring", () => {
  it("assigns missing step and check IDs and keeps given ones", () => {
    const fields = parseFixtureFields({
      name: " Seeded account ",
      convergeSteps: [
        {
          id: STEP_ID,
          name: "Sign up",
          instructions: "Sign up.",
          doneWhen: "Signed in.",
        },
        { name: "Verify", instructions: "Verify.", doneWhen: "Verified." },
      ],
      healthChecks: [{ name: "Exists", expectation: "The account exists." }],
    })

    expect(fields.name).toBe("Seeded account")
    expect(fields.convergeSteps?.[0]?.id).toBe(STEP_ID)
    expect(fields.convergeSteps?.[1]?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(fields.healthChecks?.[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(() =>
      parseFixtureFields({
        healthChecks: [
          { id: STEP_ID, name: "A", expectation: "A." },
          { id: STEP_ID, name: "B", expectation: "B." },
        ],
      })
    ).toThrow("Health check IDs must be unique.")
    expect(() => parseFixtureFields({ name: " " })).toThrow(
      "Check the highlighted fixture fields."
    )
  })

  it("creates fixtures with unique slugs and applies partial updates", async () => {
    const { ctx, projectId } = await seedProject()
    const first = await call<object, { id: string; slug: string }>(
      fixtures.create,
      ctx,
      { projectId, name: "Seeded account" }
    )
    const second = await call<object, { id: string; slug: string }>(
      fixtures.create,
      ctx,
      {
        projectId,
        name: "Seeded account",
        locator: "Admin > Users",
        healthChecks: [{ name: "Exists", expectation: "The user exists." }],
      }
    )
    expect([first.slug, second.slug]).toEqual([
      "seeded-account",
      "seeded-account-2",
    ])

    const updated = await call<object, Record<string, unknown>>(
      fixtures.update,
      ctx,
      {
        projectId,
        fixtureId: second.id,
        slug: "seeded-account",
        healthChecks: [],
      }
    )
    expect(updated).toMatchObject({
      name: "Seeded account",
      slug: "seeded-account-2",
      locator: "Admin > Users",
      healthChecks: [],
      requirements: [],
    })

    await call(fixtures.remove, ctx, { projectId, fixtureId: first.id })
    const listed = await call<object, Array<{ id: string }>>(
      fixtures.listForProject,
      ctx,
      { projectSlug: "demo" }
    )
    expect(listed.map((fixture) => fixture.id)).toEqual([second.id])
  })
})

describe("fixture requirements", () => {
  it("validates targets and upserts one requirement per target", async () => {
    const { ctx, projectId, phaseId, checkoutId, insert } = await seedProject()
    const { id: fixtureId } = await call<object, { id: string }>(
      fixtures.create,
      ctx,
      { projectId, name: "Account" }
    )
    const otherPhase = await insert("phases", {
      projectId: "projects:other",
      name: "Other",
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    })

    await expect(
      call(fixtures.setRequirement, ctx, {
        projectId,
        fixtureId,
        phaseId: otherPhase,
        access: "read",
      })
    ).rejects.toThrow("Phase not found.")
    await expect(
      call(fixtures.setRequirement, ctx, {
        projectId,
        fixtureId,
        scenarioId: checkoutId,
        access: "mutates",
      })
    ).rejects.toThrow("A mutating requirement needs a scope")
    await expect(
      call(fixtures.setRequirement, ctx, {
        projectId,
        fixtureId,
        phaseId,
        scenarioId: checkoutId,
        access: "read",
      })
    ).rejects.toThrow("Name exactly one phase or scenario.")

    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId,
      phaseId,
      access: "read",
    })
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId,
      scenarioId: checkoutId,
      access: "read",
    })
    const result = await call<object, { requirements: unknown[] }>(
      fixtures.setRequirement,
      ctx,
      {
        projectId,
        fixtureId,
        scenarioId: checkoutId,
        access: "mutates",
        mutationScope: "Its cart",
      }
    )
    expect(result.requirements).toEqual([
      { phaseId, scenarioId: null, access: "read", mutationScope: null },
      {
        phaseId: null,
        scenarioId: checkoutId,
        access: "mutates",
        mutationScope: "Its cart",
      },
    ])

    const removed = await call<object, { requirements: unknown[] }>(
      fixtures.removeRequirement,
      ctx,
      { projectId, fixtureId, phaseId }
    )
    expect(removed.requirements).toHaveLength(1)
    await expect(
      call(fixtures.removeRequirement, ctx, { projectId, fixtureId, phaseId })
    ).rejects.toThrow("no requirement")
    await expect(
      call(fixtures.removeRequirement, ctx, {
        projectId,
        fixtureId,
        phaseId: otherPhase,
      })
    ).rejects.toThrow("Phase not found.")
  })

  it("drops requirements on deleted phases and scenarios", async () => {
    const { ctx, projectId, phaseId, checkoutId } = await seedProject()
    const { id: fixtureId } = await call<object, { id: string }>(
      fixtures.create,
      ctx,
      { projectId, name: "Account" }
    )
    for (const target of [{ phaseId }, { scenarioId: checkoutId }]) {
      await call(fixtures.setRequirement, ctx, {
        projectId,
        fixtureId,
        ...target,
        access: "read",
      })
    }

    await call(scenarios.remove, ctx, { scenarioId: checkoutId })
    expect((await ctx.db.get(fixtureId))?.requirements).toEqual([
      { phaseId, scenarioId: null, access: "read", mutationScope: null },
    ])
    await call(phases.remove, ctx, { projectId, phaseId })
    expect((await ctx.db.get(fixtureId))?.requirements).toEqual([])
  })
})

describe("fixtures in the execution plan", () => {
  it("merges phase and scenario requirements and lists required fixtures", async () => {
    const { ctx, projectId, phaseId, checkoutId } = await seedProject()
    const create = (name: string) =>
      call<object, { id: string }>(fixtures.create, ctx, { projectId, name })
    const account = await create("Account")
    const catalog = await create("Catalog")
    await create("Unused")
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: account.id,
      phaseId,
      access: "read",
    })
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: account.id,
      scenarioId: checkoutId,
      access: "mutates",
      mutationScope: "Its cart",
    })
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: catalog.id,
      scenarioId: checkoutId,
      access: "read",
    })

    const plan = await call<
      object,
      {
        phases: Array<{
          scenarios: Array<{ slug: string; fixtureRequirements: unknown[] }>
        }>
        fixtures: Array<{ name: string }>
      }
    >(scenarios.executionPlanForProject, ctx, { projectSlug: "demo" })
    const bySlug = Object.fromEntries(
      plan.phases[0]!.scenarios.map((scenario) => [
        scenario.slug,
        scenario.fixtureRequirements,
      ])
    )
    expect(bySlug.browse).toEqual([
      { fixtureId: account.id, access: "read", mutationScope: null },
    ])
    expect(bySlug.checkout).toEqual(
      expect.arrayContaining([
        { fixtureId: account.id, access: "mutates", mutationScope: "Its cart" },
        { fixtureId: catalog.id, access: "read", mutationScope: null },
      ])
    )
    expect(plan.fixtures.map((fixture) => fixture.name).sort()).toEqual([
      "Account",
      "Catalog",
    ])

    const single = await call<
      object,
      { fixtureRequirements: unknown[]; fixtures: unknown[] }
    >(scenarios.getBySlug, ctx, { projectSlug: "demo", scenarioSlug: "browse" })
    expect(single.fixtureRequirements).toHaveLength(1)
    expect(single.fixtures).toHaveLength(1)
  })
})

describe("run fixture preflight", () => {
  const entry = {
    fixtureId: "fixtures:9",
    fixtureSlug: "account",
    fixtureName: "Account",
    access: "read" as const,
    outcome: "repaired" as const,
    executor: "hook" as const,
  }

  it("stores the reported preflight on the run", async () => {
    const { ctx, projectId } = await seedProject()
    const run = await call<object, { fixturePreflight?: unknown }>(
      runs.create,
      ctx,
      {
        projectId,
        mode: "all",
        runnerType: "codex",
        startedAt: 1,
        fixturePreflight: [entry],
      }
    )
    expect(run.fixturePreflight).toEqual([entry])
  })

  it("rejects malformed preflight entries", () => {
    expect(runs.parseFixturePreflight(undefined)).toBeUndefined()
    expect(() =>
      runs.parseFixturePreflight([{ ...entry, fixtureSlug: "Not a slug" }])
    ).toThrow("Fixture preflight is invalid.")
  })
})
