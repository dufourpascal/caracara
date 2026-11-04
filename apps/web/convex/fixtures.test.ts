import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  FIXTURE_OPERATION_LEASE_MS,
  FIXTURE_PREFLIGHT_MAX_AGE_MS,
  executionPlanResponseSchema,
  fixtureDetailSchema,
  fixtureOperationSchema,
  singleScenarioResponseSchema,
} from "@workspace/contracts"

import type { Id } from "./_generated/dataModel"
import { call, createFakeCtx } from "./fakeDb.testing"
import * as fixtures from "./fixtures"
import * as phases from "./phases"
import * as projects from "./projects"
import * as runs from "./runs"
import * as scenarios from "./scenarios"

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0)
const PREVIEW = { environment: "preview", targetUrl: "https://preview.example.com/" }

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
}

async function expectError(promise: Promise<unknown>, code: string, message?: RegExp) {
  await expect(promise).rejects.toMatchObject({
    data: {
      code,
      ...(message ? { message: expect.stringMatching(message) } : {}),
    },
  })
}

async function setup() {
  const fake = createFakeCtx()
  const { ctx } = fake
  const projectId = (await ctx.db.insert("projects", {
    ownerUserId: "user-1",
    name: "Demo",
    slug: "demo",
    description: "",
    projectPrompt: "",
    runEnvironmentNames: ["production"],
    createdAt: 1,
    updatedAt: 1,
  })) as Id<"projects">
  const insertPhase = async (name: string, order: number) =>
    (await ctx.db.insert("phases", {
      projectId,
      name,
      order,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"phases">
  const insertScenario = async (slug: string, phaseId: Id<"phases"> | null) =>
    (await ctx.db.insert("scenarios", {
      projectId,
      name: slug,
      slug,
      status: "active",
      instructions: "Do it.",
      evaluationChecks: [{ id: uuid(900), name: "Works", expectation: "Yes." }],
      phaseId,
      updatedAt: 1,
    })) as Id<"scenarios">
  const setupPhase = await insertPhase("Setup", 1)
  const reportPhase = await insertPhase("Reports", 2)
  const analysis = await insertScenario("analysis", setupPhase)
  const report = await insertScenario("report", reportPhase)

  const createFixture = async (name = "Study fixture") =>
    await call(fixtures.create, ctx, {
      projectId,
      name,
      healthChecks: [{ id: null, name: "Animals", expectation: "9 animals." }],
    })

  const startOperation = async (
    fixtureId: string,
    overrides: Partial<{
      kind: "verify" | "converge" | "reset"
      environment: string
      targetUrl: string
      attemptId: string
      runId: Id<"runs"> | null
      interruptedAt: number
    }> = {}
  ) =>
    await call(fixtures.startOperation, ctx, {
      projectId,
      fixtureId: fixtureId as Id<"fixtures">,
      kind: overrides.kind ?? "verify",
      executor: "hook",
      environment: overrides.environment ?? PREVIEW.environment,
      targetUrl: overrides.targetUrl ?? PREVIEW.targetUrl,
      attemptId: overrides.attemptId ?? crypto.randomUUID(),
      ...(overrides.runId === undefined ? {} : { runId: overrides.runId }),
      ...(overrides.interruptedAt === undefined
        ? {}
        : { interruptedAt: overrides.interruptedAt }),
    })

  const finishOperation = async (
    operation: { id: string },
    attemptId: string,
    status: "succeeded" | "failed" | "interrupted" = "succeeded"
  ) =>
    await call(fixtures.finishOperation, ctx, {
      projectId,
      operationId: operation.id as Id<"fixtureOperations">,
      attemptId,
      status,
      checkResults:
        status === "failed"
          ? [{ checkId: "c", name: "Animals", verdict: "failed", evidence: "8." }]
          : [],
      summary: null,
    })

  const verify = async (
    fixtureId: string,
    status: "succeeded" | "failed" = "succeeded",
    environment = PREVIEW
  ) => {
    const attemptId = crypto.randomUUID()
    const operation = await startOperation(fixtureId, { attemptId, ...environment })
    return await finishOperation(operation, attemptId, status)
  }

  const createRun = async (
    overrides: Partial<{
      mode: "all" | "single" | "phase" | "through_phase" | "suite" | "phases"
      requestedScenarioSlug: string
      requestedPhaseOrder: number
      requestedPhaseOrders: number[]
      environment: string
      targetUrl: string
      creationAttemptId: string
      fixturePreflight: Array<{
        fixtureId: string
        outcome: "healthy" | "repaired" | "skipped"
        operationId: string | null
      }>
    }> = {}
  ) =>
    await call(runs.create, ctx, {
      projectId,
      mode: overrides.mode ?? "all",
      runnerType: "codex",
      environment: overrides.environment ?? PREVIEW.environment,
      targetUrl: overrides.targetUrl ?? PREVIEW.targetUrl,
      startedAt: Date.now(),
      ...(overrides.requestedScenarioSlug === undefined
        ? {}
        : { requestedScenarioSlug: overrides.requestedScenarioSlug }),
      ...(overrides.requestedPhaseOrder === undefined
        ? {}
        : { requestedPhaseOrder: overrides.requestedPhaseOrder }),
      ...(overrides.requestedPhaseOrders === undefined
        ? {}
        : { requestedPhaseOrders: overrides.requestedPhaseOrders }),
      ...(overrides.creationAttemptId === undefined
        ? {}
        : { creationAttemptId: overrides.creationAttemptId }),
      ...(overrides.fixturePreflight === undefined
        ? {}
        : { fixturePreflight: overrides.fixturePreflight }),
    })

  const finalize = async (runId: string) =>
    await call(runs.finalize, ctx, {
      projectId,
      runId: runId as Id<"runs">,
      status: "completed",
      finishedAt: Date.now(),
    })

  return {
    fake,
    ctx,
    projectId,
    setupPhase,
    reportPhase,
    analysis,
    report,
    createFixture,
    startOperation,
    finishOperation,
    verify,
    createRun,
    finalize,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("fixture definitions", () => {
  it("creates fixtures in the contract shape and keeps entry IDs across full saves", async () => {
    const { ctx, projectId, createFixture } = await setup()
    const created = await call(fixtures.create, ctx, {
      projectId,
      name: "Study fixture",
      description: "9 animals.",
      convergeSteps: [
        { id: null, name: "Create", instructions: "Create it.", doneWhen: "It exists." },
        { id: null, name: "Fill", instructions: "Fill it.", doneWhen: "It is full." },
      ],
      healthChecks: [{ id: null, name: "Animals", expectation: "9 animals." }],
    })

    expect(fixtureDetailSchema.parse(created)).toMatchObject({
      slug: "study-fixture",
      resetInstructions: null,
      requirements: [],
      health: [
        {
          environment: "production",
          status: "unknown",
          operationId: null,
          checkedAt: null,
          busy: false,
        },
      ],
    })
    const [create, fill] = created.convergeSteps
    expect(create?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(create?.id).not.toBe(fill?.id)

    vi.advanceTimersByTime(1_000)
    const updated = await call(fixtures.update, ctx, {
      projectId,
      fixtureId: created.id,
      name: "Study fixture",
      slug: "",
      description: "9 animals.",
      locator: "Study list",
      protection: "",
      resetInstructions: "  ",
      convergeSteps: [
        { ...fill!, name: "Fill all" },
        { id: null, name: "Calculate", instructions: "Calc.", doneWhen: "Done." },
      ],
      healthChecks: [{ ...created.healthChecks[0]!, expectation: "Nine." }],
    })

    expect(updated.slug).toBe("study-fixture")
    expect(updated.resetInstructions).toBeNull()
    expect(updated.convergeSteps.map((step) => step.id)).toEqual([
      fill?.id,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    ])
    expect(updated.convergeSteps[1]?.id).not.toBe(create?.id)
    expect(updated.healthChecks[0]).toEqual({
      ...created.healthChecks[0],
      expectation: "Nine.",
    })
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt)

    await expectError(
      call(fixtures.update, ctx, {
        ...updated,
        projectId,
        fixtureId: created.id,
        convergeSteps: [{ id: uuid(77), name: "X", instructions: "X", doneWhen: "X" }],
      }),
      "validation_error",
      /does not belong to this fixture/
    )
    await expectError(createFixture(" "), "validation_error", /name/i)
  })

  it("keeps slugs unique per project", async () => {
    const { ctx, projectId, createFixture } = await setup()
    const first = await createFixture("Study fixture")
    const second = await createFixture("Study fixture")
    expect([first.slug, second.slug]).toEqual(["study-fixture", "study-fixture-2"])

    const renamed = await call(fixtures.updateDetails, ctx, {
      projectId,
      fixtureId: second.id,
      slug: "Study Fixture",
    })
    expect(renamed.slug).toBe("study-fixture-2")
    await expectError(
      call(fixtures.updateDetails, ctx, { projectId, fixtureId: second.id }),
      "validation_error",
      /at least one change/
    )
  })

  it("edits steps and checks through the narrow CLI mutations", async () => {
    const { ctx, projectId, createFixture } = await setup()
    const fixture = await createFixture()
    const withStep = await call(fixtures.addStep, ctx, {
      projectId,
      fixtureId: fixture.id,
      name: "Create",
      instructions: "Create it.",
      doneWhen: "It exists.",
    })
    const stepId = withStep.convergeSteps[0]!.id
    const updatedStep = await call(fixtures.updateStep, ctx, {
      projectId,
      fixtureId: fixture.id,
      stepId,
      doneWhen: "It exists twice.",
    })
    expect(updatedStep.convergeSteps).toEqual([
      { id: stepId, name: "Create", instructions: "Create it.", doneWhen: "It exists twice." },
    ])
    const withCheck = await call(fixtures.addCheck, ctx, {
      projectId,
      fixtureId: fixture.id,
      check: { id: uuid(5), name: "Slices", expectation: "12 slices." },
    })
    expect(withCheck.healthChecks.map((check) => check.id)).toContain(uuid(5))
    await expectError(
      call(fixtures.addCheck, ctx, {
        projectId,
        fixtureId: fixture.id,
        check: { id: uuid(5), name: "Again", expectation: "Again." },
      }),
      "validation_error"
    )
    const renamedCheck = await call(fixtures.updateCheck, ctx, {
      projectId,
      fixtureId: fixture.id,
      checkId: uuid(5),
      name: "Slice count",
    })
    expect(renamedCheck.healthChecks[renamedCheck.healthChecks.length - 1]?.name).toBe("Slice count")
    const removed = await call(fixtures.removeCheck, ctx, {
      projectId,
      fixtureId: fixture.id,
      checkId: uuid(5),
    })
    expect(removed.healthChecks).toHaveLength(1)
    const noSteps = await call(fixtures.removeStep, ctx, {
      projectId,
      fixtureId: fixture.id,
      stepId,
    })
    expect(noSteps.convergeSteps).toEqual([])
    await expectError(
      call(fixtures.removeStep, ctx, { projectId, fixtureId: fixture.id, stepId }),
      "not_found"
    )
  })

  it("stays open for authoring while a run is running", async () => {
    const { ctx, projectId, setupPhase, createRun, createFixture } = await setup()
    const fixture = await createFixture()
    await createRun()

    await createFixture("Second fixture")
    await call(fixtures.updateDetails, ctx, {
      projectId,
      fixtureId: fixture.id as Id<"fixtures">,
      description: "Edited during a run.",
    })
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      phaseId: setupPhase,
      access: "read",
    })
    // The running run does not hold this fixture, so it can be deleted.
    await call(fixtures.remove, ctx, {
      projectId,
      fixtureId: fixture.id as Id<"fixtures">,
    })
  })

  it("blocks deleting a fixture that a running run holds until the run ends", async () => {
    const { ctx, projectId, setupPhase, createRun, createFixture, finalize } =
      await setup()
    const fixture = await createFixture()
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      phaseId: setupPhase,
      access: "read",
    })
    const run = await createRun({
      fixturePreflight: [
        { fixtureId: fixture.id, outcome: "skipped", operationId: null },
      ],
    })

    // Other writes to the held fixture stay open.
    await call(fixtures.updateDetails, ctx, {
      projectId,
      fixtureId: fixture.id as Id<"fixtures">,
      locator: "Projects > Moved",
    })
    await expectError(
      call(fixtures.remove, ctx, {
        projectId,
        fixtureId: fixture.id as Id<"fixtures">,
      }),
      "conflict",
      /Fixture deletion is unavailable while run .* is running with fixture study-fixture/
    )

    await finalize(run.id)
    await call(fixtures.remove, ctx, {
      projectId,
      fixtureId: fixture.id as Id<"fixtures">,
    })
  })

  it("rejects fixtures from another owner", async () => {
    const { fake, ctx, projectId, createFixture } = await setup()
    const fixture = await createFixture()
    fake.setUser("user-2")
    await expectError(
      call(fixtures.remove, ctx, { projectId, fixtureId: fixture.id }),
      "unauthorized"
    )
  })
})

describe("fixture requirements", () => {
  it("validates targets, access and mutation scopes and upserts per target", async () => {
    const { ctx, projectId, setupPhase, analysis, createFixture } = await setup()
    const fixture = await createFixture()
    const base = { projectId, fixtureId: fixture.id }

    await expectError(
      call(fixtures.setRequirement, ctx, { ...base, access: "read" }),
      "validation_error",
      /exactly one/
    )
    await expectError(
      call(fixtures.setRequirement, ctx, {
        ...base,
        phaseId: setupPhase,
        scenarioId: analysis,
        access: "read",
      }),
      "validation_error",
      /exactly one/
    )
    await expectError(
      call(fixtures.setRequirement, ctx, {
        ...base,
        phaseId: setupPhase,
        access: "mutates",
      }),
      "validation_error"
    )
    await expectError(
      call(fixtures.setRequirement, ctx, {
        ...base,
        phaseId: setupPhase,
        access: "read",
        mutationScope: "Rename it.",
      }),
      "validation_error",
      /Only a mutating requirement/
    )
    const otherProject = (await ctx.db.insert("projects", {
      ownerUserId: "user-1",
      name: "Other",
      slug: "other",
      description: "",
      projectPrompt: "",
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"projects">
    const foreignPhase = (await ctx.db.insert("phases", {
      projectId: otherProject,
      name: "Foreign",
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"phases">
    await expectError(
      call(fixtures.setRequirement, ctx, {
        ...base,
        phaseId: foreignPhase,
        access: "read",
      }),
      "validation_error",
      /does not belong/
    )

    await call(fixtures.setRequirement, ctx, {
      ...base,
      phaseId: setupPhase,
      access: "read",
    })
    const upserted = await call(fixtures.setRequirement, ctx, {
      ...base,
      phaseId: setupPhase,
      access: "mutates",
      mutationScope: "  Adds analysis results.  ",
    })
    expect(upserted.requirements).toEqual([
      expect.objectContaining({
        phaseId: setupPhase,
        scenarioId: null,
        access: "mutates",
        mutationScope: "Adds analysis results.",
      }),
    ])

    const removed = await call(fixtures.removeRequirement, ctx, {
      ...base,
      phaseId: setupPhase,
    })
    expect(removed.requirements).toEqual([])
    await expectError(
      call(fixtures.removeRequirement, ctx, { ...base, phaseId: setupPhase }),
      "not_found"
    )
  })

  it("merges phase and scenario requirements into execution plans", async () => {
    const { ctx, projectId, setupPhase, analysis, createFixture } = await setup()
    const fixture = await createFixture()
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      phaseId: setupPhase,
      access: "read",
    })
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      scenarioId: analysis,
      access: "mutates",
      mutationScope: "Adds results.",
    })

    const plan = await call(scenarios.executionPlanForProject, ctx, {
      projectSlug: "demo",
    })
    const parsed = executionPlanResponseSchema.parse({
      ...plan,
      project: { ...plan.project, projectPrompt: plan.projectPrompt },
    })
    expect(parsed.phases[0]?.scenarios[0]?.fixtureRequirements).toEqual([
      { fixtureId: fixture.id, access: "mutates", mutationScope: "Adds results." },
    ])
    expect(parsed.phases[1]?.scenarios[0]?.fixtureRequirements).toEqual([])
    expect(parsed.fixtures.map((entry) => entry.slug)).toEqual(["study-fixture"])

    const single = await call(scenarios.executionScenarioForProject, ctx, {
      projectSlug: "demo",
      scenarioSlug: "report",
    })
    expect(
      singleScenarioResponseSchema.parse({
        project: { id: projectId, name: "Demo", slug: "demo", projectPrompt: "" },
        ...single,
      }).fixtures
    ).toEqual([])
  })

  it("cascades when fixtures, phases, scenarios, runs and projects are deleted", async () => {
    const { fake, ctx, projectId, setupPhase, reportPhase, report, createFixture, verify, createRun, finalize } =
      await setup()
    const fixture = await createFixture()
    const other = await createFixture("Other fixture")
    for (const fixtureId of [fixture.id, other.id]) {
      await call(fixtures.setRequirement, ctx, {
        projectId,
        fixtureId,
        phaseId: setupPhase,
        access: "read",
      })
      await call(fixtures.setRequirement, ctx, {
        projectId,
        fixtureId,
        scenarioId: report,
        access: "read",
      })
    }

    await call(phases.remove, ctx, { projectId, phaseId: setupPhase })
    expect(fake.rows("fixtureRequirements").map((row) => row.phaseId)).toEqual([
      null,
      null,
    ])
    await call(scenarios.remove, ctx, { scenarioId: report })
    expect(fake.rows("fixtureRequirements")).toEqual([])

    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      phaseId: reportPhase,
      access: "read",
    })
    const operation = await verify(fixture.id)
    const deleted = await call(fixtures.remove, ctx, {
      projectId,
      fixtureId: fixture.id,
    })
    expect(deleted).toMatchObject({ deletedRequirementCount: 1 })
    expect(fake.rows("fixtureOperations")).toEqual([
      expect.objectContaining({ _id: operation.id, fixtureId: null, fixtureSlug: "study-fixture" }),
    ])

    const otherVerify = await verify(other.id)
    const run = await createRun({ mode: "single", requestedScenarioSlug: "analysis" })
    await finalize(run.id)
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: other.id,
      phaseId: reportPhase,
      access: "read",
    })
    const linkedVerify = await verify(other.id)
    await ctx.db.patch(linkedVerify.id, { runId: run.id })
    await call(runs.remove, ctx, { runId: run.id as Id<"runs"> })
    expect(
      fake.rows("fixtureOperations").find((row) => row._id === linkedVerify.id)
    ).toMatchObject({ runId: null })

    await call(projects.remove, ctx, { projectId, slugConfirmation: "demo" })
    for (const table of ["fixtures", "fixtureRequirements", "fixtureOperations"]) {
      expect(fake.rows(table)).toEqual([])
    }
    expect(otherVerify.id).toBeDefined()
  })
})

describe("fixture operations", () => {
  it("holds one lease per fixture and environment in both directions", async () => {
    const { fake, ctx, projectId, createFixture, startOperation, finishOperation } = await setup()
    const fixture = await createFixture()
    const attemptId = uuid(1)
    const verify = await startOperation(fixture.id, { attemptId })
    expect(fixtureOperationSchema.parse(verify)).toMatchObject({
      status: "running",
      startedAt: T0,
      leaseExpiresAt: T0 + FIXTURE_OPERATION_LEASE_MS,
    })

    await expectError(startOperation(fixture.id, { kind: "converge" }), "conflict", /busy/)
    await expectError(startOperation(fixture.id), "conflict", /busy/)
    const production = await startOperation(fixture.id, {
      environment: "production",
      targetUrl: "https://example.com",
    })
    expect(production.status).toBe("running")

    await expectError(
      call(fixtures.updateDetails, ctx, { projectId, fixtureId: fixture.id, name: "New" }),
      "conflict",
      /being maintained/
    )
    await expectError(
      call(projects.remove, ctx, { projectId, slugConfirmation: "demo" }),
      "conflict",
      /being maintained/
    )

    await finishOperation(verify, attemptId)
    const converge = await startOperation(fixture.id, { kind: "converge" })
    await expectError(startOperation(fixture.id), "conflict", /converge operation is running/)

    vi.advanceTimersByTime(FIXTURE_OPERATION_LEASE_MS + 1)
    const afterExpiry = await startOperation(fixture.id)
    expect(afterExpiry.status).toBe("running")
    expect(
      fake.rows("fixtureOperations").find((row) => row._id === converge.id)
    ).toMatchObject({ status: "interrupted", finishedAt: Date.now() })
  })

  it("blocks converge and reset while a running run holds the fixture", async () => {
    const { ctx, projectId, setupPhase, createFixture, verify, createRun, finalize, startOperation } =
      await setup()
    const fixture = await createFixture()
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      phaseId: setupPhase,
      access: "read",
    })
    const operation = await verify(fixture.id)
    const run = await createRun({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "healthy", operationId: operation.id }],
    })

    await expectError(startOperation(fixture.id, { kind: "reset" }), "conflict", new RegExp(run.name))
    expect((await startOperation(fixture.id)).kind).toBe("verify")
    await finalize(run.id)
    vi.advanceTimersByTime(FIXTURE_OPERATION_LEASE_MS + 1)
    expect(
      (await startOperation(fixture.id, { kind: "reset", runId: run.id as Id<"runs"> })).runId
    ).toBe(run.id)
  })

  it("returns the same operation for a repeated attempt and recovers interrupted starts", async () => {
    const { fake, createFixture, startOperation } = await setup()
    const fixture = await createFixture()
    const other = await createFixture("Other")

    const first = await startOperation(fixture.id, { attemptId: uuid(1) })
    expect(await startOperation(fixture.id, { attemptId: uuid(1) })).toEqual(first)
    await expectError(startOperation(other.id, { attemptId: uuid(1) }), "conflict", /another fixture operation/)

    const recovered = await startOperation(fixture.id, {
      attemptId: uuid(1),
      interruptedAt: Date.now(),
    })
    expect(recovered).toMatchObject({ id: first.id, status: "interrupted" })

    const lost = await startOperation(other.id, { attemptId: uuid(2), interruptedAt: Date.now() })
    expect(lost).toMatchObject({ status: "interrupted", finishedAt: T0 })
    expect(fake.rows("fixtureOperations")).toHaveLength(2)
  })

  it("finishes only the matching attempt and accepts identical retries", async () => {
    const { ctx, projectId, createFixture, startOperation, finishOperation } = await setup()
    const fixture = await createFixture()
    const operation = await startOperation(fixture.id, { attemptId: uuid(1) })

    await expectError(finishOperation(operation, uuid(2)), "conflict", /another attempt/)
    await expectError(
      call(fixtures.finishOperation, ctx, {
        projectId,
        operationId: operation.id as Id<"fixtureOperations">,
        attemptId: uuid(1),
        status: "succeeded",
        checkResults: [{ checkId: "c", name: "Animals", verdict: "failed", evidence: "8." }],
        summary: null,
      }),
      "validation_error",
      /unpassed/
    )
    vi.advanceTimersByTime(5_000)
    const failed = await finishOperation(operation, uuid(1), "failed")
    expect(failed).toMatchObject({ status: "failed", finishedAt: T0 + 5_000 })
    expect(await finishOperation(operation, uuid(1), "failed")).toEqual(failed)
    await expectError(finishOperation(operation, uuid(1), "succeeded"), "conflict", /already finished/)
  })
})

describe("fixture lease expiry", () => {
  it("schedules an expiry that releases the lease for reactive views", async () => {
    const { fake, ctx, createFixture, startOperation } = await setup()
    const fixture = await createFixture()
    const operation = await startOperation(fixture.id)

    expect(fake.scheduled).toEqual([
      expect.objectContaining({
        at: operation.leaseExpiresAt + 1_000,
        args: { operationId: operation.id },
      }),
    ])
    const operationId = operation.id as Id<"fixtureOperations">
    expect(await call(fixtures.expireOperation, ctx, { operationId })).toBe(false)
    expect(fake.scheduled).toHaveLength(2)

    vi.advanceTimersByTime(FIXTURE_OPERATION_LEASE_MS + 1_000)
    expect(await call(fixtures.expireOperation, ctx, { operationId })).toBe(true)
    const detail = await call(fixtures.getBySlugForProject, ctx, {
      projectSlug: "demo",
      fixtureSlug: fixture.slug,
    })
    expect(detail?.health.find((entry) => entry.environment === "preview")).toMatchObject({
      status: "unknown",
      operationId: operation.id,
      busy: false,
    })
  })
})

describe("fixture health", () => {
  it("derives health per environment from operations and mutating runs", async () => {
    const { ctx, projectId, setupPhase, createFixture, verify, startOperation, createRun, finalize } =
      await setup()
    const fixture = await createFixture()
    const health = async () =>
      (await call(fixtures.getBySlugForProject, ctx, {
        projectSlug: "demo",
        fixtureSlug: fixture.slug,
      }))!.health

    const failed = await verify(fixture.id, "failed")
    expect(await health()).toEqual([
      { environment: "preview", status: "unhealthy", operationId: failed.id, checkedAt: T0, busy: false },
      { environment: "production", status: "unknown", operationId: null, checkedAt: null, busy: false },
    ])

    vi.advanceTimersByTime(1_000)
    const healthy = await verify(fixture.id)
    expect((await health())[0]).toMatchObject({ status: "healthy", operationId: healthy.id })

    const running = await startOperation(fixture.id, { kind: "converge" })
    expect((await health())[0]).toMatchObject({ status: "healthy", busy: true })
    await call(fixtures.finishOperation, ctx, {
      projectId,
      operationId: running.id as Id<"fixtureOperations">,
      attemptId: (await ctx.db.get(running.id))!.attemptId as string,
      status: "succeeded",
      checkResults: [],
      summary: null,
    })
    expect((await health())[0]).toMatchObject({ status: "unknown", operationId: running.id })

    vi.advanceTimersByTime(1_000)
    const reverified = await verify(fixture.id)
    expect((await health())[0]).toMatchObject({ status: "healthy" })

    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      phaseId: setupPhase,
      access: "mutates",
      mutationScope: "Adds results.",
    })
    vi.advanceTimersByTime(1_000)
    const run = await createRun({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "healthy", operationId: reverified.id }],
    })
    expect((await health())[0]).toMatchObject({ status: "unknown", operationId: reverified.id })
    await finalize(run.id)
    expect((await health())[0]).toMatchObject({ status: "unknown" })
  })
})

describe("run creation with fixtures", () => {
  async function requiredSetup(access: "read" | "mutates" = "read") {
    const context = await setup()
    const fixture = await context.createFixture()
    await call(fixtures.setRequirement, context.ctx, {
      projectId: context.projectId,
      fixtureId: fixture.id,
      phaseId: context.setupPhase,
      access,
      ...(access === "mutates" ? { mutationScope: "Adds results." } : {}),
    })
    return { ...context, fixture }
  }

  it("leaves selections without fixtures unchanged", async () => {
    const { createRun, fake } = await requiredSetup()
    const run = await createRun({ mode: "phase", requestedPhaseOrder: 2 })
    expect(run.fixturePreflight).toEqual([])
    expect(fake.rows("runs")[0]).not.toHaveProperty("fixturePreflight")

    const plain = await setup()
    expect((await plain.createRun()).status).toBe("running")
  })

  it("rejects old clients and stale selections only when fixtures are required", async () => {
    const { createRun, fixture, createFixture } = await requiredSetup()
    await expectError(createRun(), "conflict", /0\.8\.0 or newer/)
    await expectError(
      createRun({ mode: "single", requestedScenarioSlug: "analysis" }),
      "conflict",
      /0\.8\.0 or newer/
    )
    const other = await createFixture("Other")
    await expectError(
      createRun({
        fixturePreflight: [{ fixtureId: other.id, outcome: "skipped", operationId: null }],
      }),
      "conflict",
      /changed since preflight/
    )
    await expectError(
      createRun({
        mode: "phase",
        requestedPhaseOrder: 2,
        fixturePreflight: [{ fixtureId: fixture.id, outcome: "skipped", operationId: null }],
      }),
      "conflict",
      /changed since preflight/
    )
  })

  it("requires the fixtures of every phase in a phases run", async () => {
    const { ctx, projectId, createRun, fixture } = await requiredSetup()
    const thirdPhase = (await ctx.db.insert("phases", {
      projectId,
      name: "Export",
      order: 3,
      createdAt: 1,
      updatedAt: 1,
    })) as Id<"phases">
    await ctx.db.insert("scenarios", {
      projectId,
      name: "export",
      slug: "export",
      status: "active",
      instructions: "Export.",
      evaluationChecks: [{ id: uuid(901), name: "Works", expectation: "Yes." }],
      phaseId: thirdPhase,
      updatedAt: 1,
    })

    // Phase 1 requires the fixture, so any phases run that includes it does.
    await expectError(
      createRun({ mode: "phases", requestedPhaseOrders: [1, 3] }),
      "conflict",
      /0\.8\.0 or newer/
    )
    const run = await createRun({
      mode: "phases",
      requestedPhaseOrders: [1, 3],
      fixturePreflight: [
        { fixtureId: fixture.id, outcome: "skipped", operationId: null },
      ],
    })
    expect(run.requestedPhaseOrders).toEqual([1, 3])
    expect(run.fixturePreflight).toEqual([
      expect.objectContaining({ fixtureId: fixture.id, access: "read" }),
    ])

    // Phases 2 and 3 require nothing: a preflight entry is stale there.
    await expectError(
      createRun({
        mode: "phases",
        requestedPhaseOrders: [2, 3],
        fixturePreflight: [
          { fixtureId: fixture.id, outcome: "skipped", operationId: null },
        ],
      }),
      "conflict",
      /changed since preflight/
    )
    const plain = await createRun({ mode: "phases", requestedPhaseOrders: [2, 3] })
    expect(plain.fixturePreflight).toEqual([])
  })

  it("accepts skipped fixtures and stores the server-side snapshot", async () => {
    const { createRun, fixture } = await requiredSetup("mutates")
    const run = await createRun({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "skipped", operationId: null }],
    })
    expect(run.fixturePreflight).toEqual([
      {
        fixtureId: fixture.id,
        fixtureSlug: "study-fixture",
        fixtureName: "Study fixture",
        access: "mutates",
        outcome: "skipped",
        operationId: null,
      },
    ])
  })

  it("links a fresh verify to the run exactly once", async () => {
    const { fake, createRun, fixture, verify } = await requiredSetup()
    const operation = await verify(fixture.id)
    const preflight = [{ fixtureId: fixture.id, outcome: "healthy" as const, operationId: operation.id }]
    const run = await createRun({ creationAttemptId: uuid(50), fixturePreflight: preflight })

    expect(fake.rows("fixtureOperations")[0]).toMatchObject({ runId: run.id })
    expect(
      await call(fixtures.listOperationsForRun, fake.ctx, {
        projectSlug: "demo",
        runId: run.id as Id<"runs">,
      })
    ).toEqual([expect.objectContaining({ id: operation.id, runId: run.id })])

    // An idempotent replay returns the run instead of re-validating the used verify.
    expect(
      await createRun({ creationAttemptId: uuid(50), fixturePreflight: preflight })
    ).toMatchObject({ id: run.id })
    await expectError(createRun({ fixturePreflight: preflight }), "conflict", /already belongs to a run/)
  })

  it("rejects foreign, failed, mismatched, stale and outdated verifies", async () => {
    const { ctx, projectId, createRun, fixture, createFixture, verify, startOperation } =
      await requiredSetup()
    const entry = (operationId: string) => ({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "healthy" as const, operationId }],
    })

    const other = await createFixture("Other")
    await expectError(createRun(entry((await verify(other.id)).id)), "validation_error", /verify operation/)
    await expectError(createRun(entry((await verify(fixture.id, "failed")).id)), "validation_error", /did not succeed/)
    const converge = await startOperation(fixture.id, { kind: "converge", attemptId: uuid(9) })
    await call(fixtures.finishOperation, ctx, {
      projectId,
      operationId: converge.id as Id<"fixtureOperations">,
      attemptId: uuid(9),
      status: "succeeded",
      checkResults: [],
      summary: null,
    })
    await expectError(createRun(entry(converge.id)), "validation_error", /verify operation/)
    await expectError(createRun(entry("fixtureOperations:missing")), "validation_error")

    const production = await verify(fixture.id, "succeeded", {
      environment: "production",
      targetUrl: "https://example.com/",
    })
    await expectError(createRun(entry(production.id)), "validation_error", /another environment/)
    const otherUrl = await verify(fixture.id, "succeeded", {
      environment: "preview",
      targetUrl: "https://other.example.com/",
    })
    await expectError(createRun(entry(otherUrl.id)), "validation_error", /another environment/)

    const stale = await verify(fixture.id)
    vi.advanceTimersByTime(FIXTURE_PREFLIGHT_MAX_AGE_MS + 1)
    await expectError(createRun(entry(stale.id)), "conflict", /too old/)

    const outdated = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    await call(fixtures.updateDetails, ctx, { projectId, fixtureId: fixture.id, locator: "Moved" })
    await expectError(createRun(entry(outdated.id)), "conflict", /changed after it was verified/)

    const beforeReset = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    const reset = await startOperation(fixture.id, { kind: "reset", attemptId: uuid(10) })
    await expectError(createRun(entry(beforeReset.id)), "conflict", /newer fixture operation replaced/)
    expect(reset.status).toBe("running")
  })

  it("accepts only the verify that still decides the fixture's health", async () => {
    const { ctx, projectId, createRun, fixture, verify, startOperation } =
      await requiredSetup()
    const entry = (operationId: string) => ({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "healthy" as const, operationId }],
    })

    const superseded = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    await verify(fixture.id, "failed")
    await expectError(createRun(entry(superseded.id)), "conflict", /newer fixture operation replaced/)

    vi.advanceTimersByTime(1)
    const beforeConverge = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    const converge = await startOperation(fixture.id, { kind: "converge", attemptId: uuid(20) })
    await call(fixtures.finishOperation, ctx, {
      projectId,
      operationId: converge.id as Id<"fixtureOperations">,
      attemptId: uuid(20),
      status: "succeeded",
      checkResults: [],
      summary: null,
    })
    await expectError(createRun(entry(beforeConverge.id)), "conflict", /newer fixture operation replaced/)

    vi.advanceTimersByTime(1)
    const interruptedAfter = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    await startOperation(fixture.id, { attemptId: uuid(21), interruptedAt: Date.now() })
    await expectError(createRun(entry(interruptedAfter.id)), "conflict", /newer fixture operation replaced/)
  })

  it("accepts a verify followed only by newer successful verifies", async () => {
    const { createRun, fixture, verify } = await requiredSetup()
    const first = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    await verify(fixture.id)

    const run = await createRun({
      fixturePreflight: [
        { fixtureId: fixture.id, outcome: "healthy", operationId: first.id },
      ],
    })
    expect(run.fixturePreflight).toEqual([
      expect.objectContaining({ operationId: first.id, outcome: "healthy" }),
    ])
  })

  it("accepts a verify that shares its start time with the converge before it", async () => {
    const { createRun, fixture, verify, startOperation, finishOperation } =
      await requiredSetup()
    const attemptId = crypto.randomUUID()
    const converge = await startOperation(fixture.id, { kind: "converge", attemptId })
    await finishOperation(converge, attemptId)
    const healthy = await verify(fixture.id)
    expect(healthy.startedAt).toBe(converge.startedAt)

    const run = await createRun({
      fixturePreflight: [
        { fixtureId: fixture.id, outcome: "repaired", operationId: healthy.id },
      ],
    })
    expect(run.fixturePreflight).toEqual([
      expect.objectContaining({ operationId: healthy.id, outcome: "repaired" }),
    ])
  })

  it("accepts a verify while a newer verify is still running", async () => {
    const { createRun, fixture, verify, startOperation } = await requiredSetup()
    const first = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    const running = await startOperation(fixture.id)
    expect(running.status).toBe("running")

    const run = await createRun({
      fixturePreflight: [
        { fixtureId: fixture.id, outcome: "healthy", operationId: first.id },
      ],
    })
    expect(run.fixturePreflight).toEqual([
      expect.objectContaining({ operationId: first.id }),
    ])
  })

  it("rejects a verify that overlapped the end of a mutating run", async () => {
    const { ctx, createRun, fixture, startOperation, finishOperation, finalize } =
      await requiredSetup("mutates")
    const attemptId = crypto.randomUUID()
    const overlapping = await startOperation(fixture.id, { attemptId })
    vi.advanceTimersByTime(1)
    const mutating = await createRun({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "skipped", operationId: null }],
    })
    vi.advanceTimersByTime(1)
    await finalize(mutating.id)
    vi.advanceTimersByTime(1)
    await finishOperation(overlapping, attemptId)

    const detail = await call(fixtures.getBySlugForProject, ctx, {
      projectSlug: "demo",
      fixtureSlug: fixture.slug,
    })
    expect(
      detail!.health.find((entry) => entry.environment === "preview")
    ).toMatchObject({ status: "unknown", operationId: overlapping.id })
    await expectError(
      createRun({
        fixturePreflight: [
          { fixtureId: fixture.id, outcome: "healthy", operationId: overlapping.id },
        ],
      }),
      "conflict",
      /ran or is running/
    )
  })

  it("keeps mutation evidence when a running mutating run is deleted", async () => {
    const { ctx, createRun, fixture, verify } = await requiredSetup("mutates")
    const running = await createRun({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "skipped", operationId: null }],
    })
    vi.advanceTimersByTime(1)
    const during = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    await call(runs.remove, ctx, { runId: running.id as Id<"runs"> })

    await expectError(
      createRun({
        fixturePreflight: [
          { fixtureId: fixture.id, outcome: "healthy", operationId: during.id },
        ],
      }),
      "conflict",
      /ran or is running/
    )
  })

  it("rejects a verify followed by a run that mutates the fixture", async () => {
    const { ctx, projectId, createRun, fixture, verify, finalize, analysis } =
      await requiredSetup()
    const operation = await verify(fixture.id)
    await call(fixtures.setRequirement, ctx, {
      projectId,
      fixtureId: fixture.id,
      scenarioId: analysis,
      access: "mutates",
      mutationScope: "Adds results.",
    })
    vi.advanceTimersByTime(1)
    const mutating = await createRun({
      mode: "single",
      requestedScenarioSlug: "analysis",
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "skipped", operationId: null }],
    })
    const entry = {
      mode: "phase" as const,
      requestedPhaseOrder: 1,
      fixturePreflight: [
        { fixtureId: fixture.id, outcome: "healthy" as const, operationId: operation.id },
      ],
    }

    await expectError(createRun(entry), "conflict", /ran or is running/)
    vi.advanceTimersByTime(1)
    await finalize(mutating.id)
    await expectError(createRun(entry), "conflict", /ran or is running/)
  })

  it("keeps mutation evidence and consumed verifies after run deletion", async () => {
    const { ctx, fake, projectId, createRun, fixture, verify, finalize } =
      await requiredSetup("mutates")
    const health = async () =>
      (await call(fixtures.getBySlugForProject, ctx, {
        projectSlug: "demo",
        fixtureSlug: fixture.slug,
      }))!.health.find((entry) => entry.environment === "preview")

    const used = await verify(fixture.id)
    vi.advanceTimersByTime(1)
    const run = await createRun({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "healthy", operationId: used.id }],
    })
    vi.advanceTimersByTime(1)
    await finalize(run.id)
    await call(runs.remove, ctx, { runId: run.id as Id<"runs"> })

    expect(fake.rows("fixtureOperations")[0]).toMatchObject({
      runId: null,
      consumedAt: expect.any(Number),
    })
    expect(await health()).toMatchObject({ status: "unknown", operationId: used.id })
    await expectError(
      createRun({
        fixturePreflight: [{ fixtureId: fixture.id, outcome: "healthy", operationId: used.id }],
      }),
      "conflict",
      /already belongs to a run/
    )

    vi.advanceTimersByTime(1)
    const beforeSkippedRun = await verify(fixture.id)
    expect(await health()).toMatchObject({ status: "healthy" })
    vi.advanceTimersByTime(1)
    const skipped = await createRun({
      fixturePreflight: [{ fixtureId: fixture.id, outcome: "skipped", operationId: null }],
    })
    vi.advanceTimersByTime(1)
    await finalize(skipped.id)
    await call(runs.remove, ctx, { runId: skipped.id as Id<"runs"> })

    expect(fake.rows("runs")).toEqual([])
    expect(await health()).toMatchObject({ status: "unknown" })
    await expectError(
      createRun({
        fixturePreflight: [
          { fixtureId: fixture.id, outcome: "healthy", operationId: beforeSkippedRun.id },
        ],
      }),
      "conflict",
      /ran or is running/
    )

    await call(fixtures.remove, ctx, { projectId, fixtureId: fixture.id })
    expect(fake.rows("fixtureEnvironmentStates")).toEqual([])
  })

  it("rejects concurrent runs that share a mutated fixture in one environment", async () => {
    const { createRun, fixture, finalize } = await requiredSetup("mutates")
    const skipped = [{ fixtureId: fixture.id, outcome: "skipped" as const, operationId: null }]
    const first = await createRun({ fixturePreflight: skipped })

    await expectError(createRun({ fixturePreflight: skipped }), "conflict", new RegExp(first.name))
    expect(
      (
        await createRun({
          environment: "production",
          targetUrl: "https://example.com",
          fixturePreflight: skipped,
        })
      ).status
    ).toBe("running")
    await finalize(first.id)
    expect((await createRun({ fixturePreflight: skipped })).status).toBe("running")
  })
})
