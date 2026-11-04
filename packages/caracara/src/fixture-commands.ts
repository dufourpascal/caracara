import process from "node:process"

import type {
  EvaluationCheck,
  FixtureDetail,
  FixtureStep,
  RunnerType,
} from "@workspace/contracts"

import { fetchExecutionPlan, fetchFixtures } from "./api.js"
import {
  author,
  ensureAccessToken,
  fetchAuthoringScenario,
  getAuthoringContext,
  resolvePhaseId,
  type AuthoringCommandOptions,
} from "./commands.js"
import {
  readLocalSecrets,
  readResolvedConfig,
  resolveEnvironment,
} from "./config.js"
import {
  formatRunnerUsage,
  getRunnerAdapter,
  mergeRunnerUsage,
  type RunnerUsageReport,
} from "./execution.js"
import {
  findUnknownHookSlugs,
  getFixtureHook,
  getProjectFixtureHooks,
  readFixtureHooks,
  type ProjectFixtureHooks,
} from "./fixture-hooks.js"
import {
  createFixtureOperationApi,
  createLazyRunnerSession,
  FixtureOperationUnavailableError,
  maintainFixture,
  selectFixtureExecutor,
  unavailableOperationMessage,
  verifyFixture,
  type FixtureRuntime,
} from "./fixtures.js"
import { CLI_VERSION } from "./version.js"

type FixtureCommandOptions = {
  apiBaseUrl?: string
  project?: string
  environment?: string
  runner?: RunnerType
}

/** Warns about hook keys that name no fixture of the project. */
export function formatUnknownHookWarning(
  hooks: ProjectFixtureHooks,
  fixtureSlugs: string[],
  hooksPath: string | null,
  projectSlug: string
) {
  const unknown = findUnknownHookSlugs(hooks, fixtureSlugs)
  if (unknown.length === 0) {
    return null
  }
  return `Warning: ${hooksPath ?? ".caracara/fixtures.json"} configures hooks for ${unknown.join(", ")}, which ${unknown.length === 1 ? "is not a fixture" : "are not fixtures"} of project ${projectSlug}.\n`
}

const HOOK_KINDS = ["verify", "converge", "reset"] as const

export function formatFixtureList(
  fixtures: FixtureDetail[],
  hooks: ProjectFixtureHooks,
  environment?: string
) {
  return fixtures
    .map((fixture) => {
      const health = environment
        ? [
            fixture.health.find((entry) => entry.environment === environment) ?? {
              environment,
              status: "unknown" as const,
              busy: false,
            },
          ]
        : [...fixture.health].sort((left, right) =>
            left.environment.localeCompare(right.environment)
          )
      const healthText =
        health.length === 0
          ? "none"
          : health
              .map(
                (entry) =>
                  `${entry.environment}=${entry.status}${entry.busy ? " (busy)" : ""}`
              )
              .join(", ")
      const hook = getFixtureHook(hooks, fixture.slug)
      const hookKinds = HOOK_KINDS.filter((kind) => hook?.[kind])
      return [
        fixture.slug,
        fixture.name,
        `requirements: ${fixture.requirements.length}`,
        `health: ${healthText}`,
        `hooks: ${hookKinds.length > 0 ? hookKinds.join(", ") : "none"}`,
      ].join("\t")
    })
    .map((line) => `${line}\n`)
    .join("")
}

async function getFixtureCommandContext(options: FixtureCommandOptions) {
  const cwd = process.cwd()
  const [config, secrets, hooksConfig] = await Promise.all([
    readResolvedConfig(
      {
        apiBaseUrl: options.apiBaseUrl,
        selectedProjectSlug: options.project,
        runner: options.runner,
      },
      process.env
    ),
    readLocalSecrets(cwd),
    readFixtureHooks(cwd),
  ])
  const accessToken = ensureAccessToken(config)
  const projectSlug = config.selectedProjectSlug
  if (!projectSlug) {
    throw new Error(
      "No project selected. Run `caracara init --project <slug>` or pass --project."
    )
  }
  return {
    cwd,
    config,
    secrets,
    accessToken,
    projectSlug,
    hooksConfig,
    hooks: getProjectFixtureHooks(hooksConfig, projectSlug),
  }
}

export async function fixturesListCommand(
  options: Omit<FixtureCommandOptions, "runner">
) {
  const context = await getFixtureCommandContext(options)
  const { fixtures } = await fetchFixtures({
    apiBaseUrl: context.config.apiBaseUrl,
    accessToken: context.accessToken,
    version: CLI_VERSION,
    projectSlug: context.projectSlug,
  })
  const warning = formatUnknownHookWarning(
    context.hooks,
    fixtures.map((fixture) => fixture.slug),
    context.hooksConfig.path,
    context.projectSlug
  )
  if (warning) {
    process.stderr.write(warning)
  }
  if (fixtures.length === 0) {
    process.stdout.write("No fixtures found.\n")
    return
  }
  process.stdout.write(
    formatFixtureList(fixtures, context.hooks, options.environment)
  )
}

/**
 * Runs `work` with SIGINT and SIGTERM turned into an abort. A signal ends
 * the command with the conventional exit code instead of an error.
 */
export async function withInterruptSignal(
  work: (signal: AbortSignal) => Promise<void>
) {
  const controller = new AbortController()
  let received: "SIGINT" | "SIGTERM" | null = null
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    received ??= signal
    controller.abort(new Error(`Interrupted by ${received}.`))
  }
  const onSigint = () => interrupt("SIGINT")
  const onSigterm = () => interrupt("SIGTERM")
  process.on("SIGINT", onSigint)
  process.on("SIGTERM", onSigterm)
  try {
    await work(controller.signal)
  } catch (error) {
    if (!received) {
      throw error
    }
  } finally {
    process.off("SIGINT", onSigint)
    process.off("SIGTERM", onSigterm)
  }
  if (received) {
    process.exitCode = received === "SIGINT" ? 130 : 143
  }
}

/** Runs fixture operations outside a run, with a runner session started on demand. */
async function withFixtureRuntime(
  options: FixtureCommandOptions,
  work: (
    runtime: FixtureRuntime,
    fixtures: FixtureDetail[],
    context: Awaited<ReturnType<typeof getFixtureCommandContext>>
  ) => Promise<void>
) {
  const context = await getFixtureCommandContext(options)
  const environment = resolveEnvironment(
    context.config,
    options.environment,
    process.env
  )
  const apiArgs = {
    apiBaseUrl: context.config.apiBaseUrl,
    accessToken: context.accessToken,
    projectSlug: context.projectSlug,
  }
  const { fixtures } = await fetchFixtures({ ...apiArgs, version: CLI_VERSION })
  const warning = formatUnknownHookWarning(
    context.hooks,
    fixtures.map((fixture) => fixture.slug),
    context.hooksConfig.path,
    context.projectSlug
  )
  if (warning) {
    process.stderr.write(warning)
  }

  await withInterruptSignal(async (signal) => {
    const runner = getRunnerAdapter(context.config.runner)
    const sessions = createLazyRunnerSession(async () => {
      await runner.preflight?.()
      return await runner.startRun({
        cwd: context.cwd,
        secrets: context.secrets,
        targetUrl: environment.targetUrl,
        model: context.config.model,
        modelReasoningEffort: context.config.model_reasoning_effort,
        signal,
      })
    })
    let projectPrompt: string | null = null
    let usage: RunnerUsageReport = { complete: true }
    let agentUsed = false
    const runtime: FixtureRuntime = {
      api: createFixtureOperationApi(apiArgs),
      projectSlug: context.projectSlug,
      environment,
      hooks: context.hooks,
      hookCwd: context.hooksConfig.rootDir,
      secrets: context.secrets,
      signal,
      async getAgent() {
        agentUsed = true
        projectPrompt ??= (
          await fetchExecutionPlan({ ...apiArgs, version: CLI_VERSION, signal })
        ).project.projectPrompt
        const session = await sessions.get()
        return {
          cwd: context.cwd,
          projectPrompt,
          secretNames: Object.keys(context.secrets),
          executeFixtureTask: (input) => session.executeFixtureTask(input),
        }
      },
      recordUsage(next) {
        usage = mergeRunnerUsage(usage, next)
      },
      write(text) {
        process.stdout.write(text)
      },
    }
    try {
      await work(runtime, fixtures, context)
    } finally {
      await sessions.close()
      if (agentUsed && (usage.usage || !usage.complete)) {
        process.stdout.write(`\n${formatRunnerUsage(usage)}\n`)
      }
    }
  })
}

function findFixturesBySlug(fixtures: FixtureDetail[], slugs: string[]) {
  return slugs.map((slug) => {
    const fixture = fixtures.find((candidate) => candidate.slug === slug)
    if (!fixture) {
      throw new Error(`Fixture ${JSON.stringify(slug)} was not found.`)
    }
    return fixture
  })
}

const UNHEALTHY_EXIT_CODE = 3

export async function fixturesVerifyCommand(
  slugs: string[],
  options: FixtureCommandOptions
) {
  await withFixtureRuntime(options, async (runtime, fixtures, context) => {
    const explicit = slugs.length > 0
    const selected = explicit ? findFixturesBySlug(fixtures, slugs) : fixtures
    if (selected.length === 0) {
      runtime.write("No fixtures found.\n")
      return
    }
    const unavailable = selected.filter(
      (fixture) =>
        selectFixtureExecutor(
          fixture,
          "verify",
          getFixtureHook(runtime.hooks, fixture.slug)
        ) === null
    )
    if (explicit && unavailable.length > 0) {
      throw new FixtureOperationUnavailableError(
        unavailable
          .map((fixture) =>
            unavailableOperationMessage(
              fixture,
              "verify",
              context.hooksConfig.path
            )
          )
          .join("\n")
      )
    }
    let unhealthy = 0
    for (const fixture of selected) {
      if (unavailable.includes(fixture)) {
        runtime.write(
          `  ${unavailableOperationMessage(fixture, "verify", context.hooksConfig.path)} Skipped.\n`
        )
        continue
      }
      const verify = await verifyFixture(runtime, fixture, {
        hooksPath: context.hooksConfig.path,
      })
      if (verify.status !== "succeeded") {
        unhealthy += 1
      }
    }
    if (unhealthy > 0) {
      process.exitCode = UNHEALTHY_EXIT_CODE
    }
  })
}

async function maintainFixtureCommand(
  kind: "converge" | "reset",
  slug: string,
  options: FixtureCommandOptions
) {
  await withFixtureRuntime(options, async (runtime, fixtures, context) => {
    const [fixture] = findFixturesBySlug(fixtures, [slug])
    const hook = getFixtureHook(runtime.hooks, fixture!.slug)
    for (const required of [kind, "verify"] as const) {
      if (selectFixtureExecutor(fixture!, required, hook) === null) {
        throw new FixtureOperationUnavailableError(
          unavailableOperationMessage(
            fixture!,
            required,
            context.hooksConfig.path
          )
        )
      }
    }
    const result = await maintainFixture(runtime, fixture!, kind, {
      hooksPath: context.hooksConfig.path,
    })
    if (!result.healthy) {
      process.exitCode = UNHEALTHY_EXIT_CODE
    }
  })
}

export async function fixturesConvergeCommand(
  slug: string,
  options: FixtureCommandOptions
) {
  await maintainFixtureCommand("converge", slug, options)
}

export async function fixturesResetCommand(
  slug: string,
  options: FixtureCommandOptions
) {
  await maintainFixtureCommand("reset", slug, options)
}

// Narrow authoring commands.

function resolveByIdOrName<T extends { id: string; name: string }>(
  items: T[],
  reference: string,
  label: "Step" | "Check"
) {
  const matches = items.filter(
    (item) => item.id === reference || item.name === reference
  )
  const byId = matches.find((item) => item.id === reference)
  if (byId) {
    return byId
  }
  if (matches.length === 0) {
    throw new Error(`${label} ${JSON.stringify(reference)} was not found.`)
  }
  if (matches.length > 1) {
    throw new Error(
      `${label} ${JSON.stringify(reference)} is ambiguous. Use its ${label.toLowerCase()} ID.`
    )
  }
  return matches[0]!
}

export function resolveFixtureStepReference(
  fixture: { convergeSteps: FixtureStep[] },
  reference: string
) {
  return resolveByIdOrName(fixture.convergeSteps, reference, "Step")
}

export function resolveFixtureCheckReference(
  fixture: { healthChecks: EvaluationCheck[] },
  reference: string
) {
  return resolveByIdOrName(fixture.healthChecks, reference, "Check")
}

export function resolveFixtureReference<T extends { id: string; slug: string }>(
  fixtures: T[],
  reference: string
) {
  const fixture =
    fixtures.find((candidate) => candidate.slug === reference) ??
    fixtures.find((candidate) => candidate.id === reference)
  if (!fixture) {
    throw new Error(`Fixture ${JSON.stringify(reference)} was not found.`)
  }
  return fixture
}

async function fetchAuthoringFixture(
  context: Awaited<ReturnType<typeof getAuthoringContext>>,
  reference: string
) {
  const { fixtures } = await fetchFixtures({ ...context, version: CLI_VERSION })
  return resolveFixtureReference(fixtures, reference)
}

type UpdateFixtureOptions = AuthoringCommandOptions & {
  fixture: string
  name?: string
  slug?: string
  description?: string
  locator?: string
  protection?: string
  resetInstructions?: string
  clearReset?: boolean
}

export function validateUpdateFixtureOptions(options: UpdateFixtureOptions) {
  if (options.resetInstructions !== undefined && options.clearReset) {
    throw new Error(
      "`--reset-instructions` cannot be combined with `--clear-reset`."
    )
  }
  if (
    options.name === undefined &&
    options.slug === undefined &&
    options.description === undefined &&
    options.locator === undefined &&
    options.protection === undefined &&
    options.resetInstructions === undefined &&
    !options.clearReset
  ) {
    throw new Error("updateFixture requires at least one change.")
  }
}

type RequirementTargetOptions = {
  phase?: string
  scenario?: string
}

type RequireFixtureOptions = AuthoringCommandOptions &
  RequirementTargetOptions & {
    fixture: string
    access?: string
    mutationScope?: string
  }

function validateRequirementTarget(options: RequirementTargetOptions) {
  if ((options.phase === undefined) === (options.scenario === undefined)) {
    throw new Error("Pass exactly one of `--phase` or `--scenario`.")
  }
}

export function validateRequireFixtureOptions(options: RequireFixtureOptions) {
  validateRequirementTarget(options)
  const access = options.access ?? "read"
  if (access !== "read" && access !== "mutates") {
    throw new Error("`--access` must be read or mutates.")
  }
  if (access === "mutates" && !options.mutationScope?.trim()) {
    throw new Error(
      "`--access mutates` requires `--mutation-scope` describing what the scenario may change."
    )
  }
  if (access === "read" && options.mutationScope !== undefined) {
    throw new Error("`--mutation-scope` requires `--access mutates`.")
  }
  return access
}

export function validateUnrequireFixtureOptions(
  options: RequirementTargetOptions
) {
  validateRequirementTarget(options)
}

async function resolveRequirementTarget(
  context: Awaited<ReturnType<typeof getAuthoringContext>>,
  options: RequirementTargetOptions
) {
  return options.phase !== undefined
    ? { phaseId: await resolvePhaseId(context, options.phase) }
    : {
        scenarioId: (await fetchAuthoringScenario(context, options.scenario!))
          .id,
      }
}

export async function createFixtureCommand(
  options: AuthoringCommandOptions & {
    name: string
    slug?: string
    description?: string
    locator?: string
    protection?: string
  }
) {
  const context = await getAuthoringContext(options)
  await author(context, {
    operation: "createFixture",
    name: options.name,
    slug: options.slug,
    description: options.description ?? "",
    locator: options.locator ?? "",
    protection: options.protection ?? "",
  })
}

export async function updateFixtureCommand(options: UpdateFixtureOptions) {
  validateUpdateFixtureOptions(options)
  const context = await getAuthoringContext(options)
  const fixture = await fetchAuthoringFixture(context, options.fixture)
  await author(context, {
    operation: "updateFixture",
    fixtureId: fixture.id,
    name: options.name,
    slug: options.slug,
    description: options.description,
    locator: options.locator,
    protection: options.protection,
    resetInstructions: options.clearReset ? null : options.resetInstructions,
  })
}

export async function addFixtureStepCommand(
  options: AuthoringCommandOptions & {
    fixture: string
    name: string
    instructions: string
    doneWhen: string
  }
) {
  const context = await getAuthoringContext(options)
  const fixture = await fetchAuthoringFixture(context, options.fixture)
  await author(context, {
    operation: "addFixtureStep",
    fixtureId: fixture.id,
    name: options.name,
    instructions: options.instructions,
    doneWhen: options.doneWhen,
  })
}

export async function updateFixtureStepCommand(
  options: AuthoringCommandOptions & {
    fixture: string
    step: string
    name?: string
    instructions?: string
    doneWhen?: string
  }
) {
  if (
    options.name === undefined &&
    options.instructions === undefined &&
    options.doneWhen === undefined
  ) {
    throw new Error(
      "updateFixtureStep requires `--name`, `--instructions`, or `--done-when`."
    )
  }
  const context = await getAuthoringContext(options)
  const fixture = await fetchAuthoringFixture(context, options.fixture)
  const step = resolveFixtureStepReference(fixture, options.step)
  await author(context, {
    operation: "updateFixtureStep",
    fixtureId: fixture.id,
    stepId: step.id,
    name: options.name,
    instructions: options.instructions,
    doneWhen: options.doneWhen,
  })
}

export async function removeFixtureStepCommand(
  options: AuthoringCommandOptions & { fixture: string; step: string }
) {
  const context = await getAuthoringContext(options)
  const fixture = await fetchAuthoringFixture(context, options.fixture)
  const step = resolveFixtureStepReference(fixture, options.step)
  await author(context, {
    operation: "removeFixtureStep",
    fixtureId: fixture.id,
    stepId: step.id,
  })
}

export async function addFixtureCheckCommand(
  options: AuthoringCommandOptions & {
    fixture: string
    name: string
    expectation: string
  }
) {
  const context = await getAuthoringContext(options)
  const fixture = await fetchAuthoringFixture(context, options.fixture)
  await author(context, {
    operation: "addFixtureCheck",
    fixtureId: fixture.id,
    check: {
      id: crypto.randomUUID(),
      name: options.name,
      expectation: options.expectation,
    },
  })
}

export async function updateFixtureCheckCommand(
  options: AuthoringCommandOptions & {
    fixture: string
    check: string
    name?: string
    expectation?: string
  }
) {
  if (options.name === undefined && options.expectation === undefined) {
    throw new Error("updateFixtureCheck requires `--name` or `--expectation`.")
  }
  const context = await getAuthoringContext(options)
  const fixture = await fetchAuthoringFixture(context, options.fixture)
  const check = resolveFixtureCheckReference(fixture, options.check)
  await author(context, {
    operation: "updateFixtureCheck",
    fixtureId: fixture.id,
    checkId: check.id,
    name: options.name,
    expectation: options.expectation,
  })
}

export async function removeFixtureCheckCommand(
  options: AuthoringCommandOptions & { fixture: string; check: string }
) {
  const context = await getAuthoringContext(options)
  const fixture = await fetchAuthoringFixture(context, options.fixture)
  const check = resolveFixtureCheckReference(fixture, options.check)
  await author(context, {
    operation: "removeFixtureCheck",
    fixtureId: fixture.id,
    checkId: check.id,
  })
}

export async function requireFixtureCommand(options: RequireFixtureOptions) {
  const access = validateRequireFixtureOptions(options)
  const context = await getAuthoringContext(options)
  const [fixture, target] = await Promise.all([
    fetchAuthoringFixture(context, options.fixture),
    resolveRequirementTarget(context, options),
  ])
  await author(context, {
    operation: "requireFixture",
    fixtureId: fixture.id,
    ...target,
    access,
    ...(access === "mutates"
      ? { mutationScope: options.mutationScope!.trim() }
      : {}),
  })
}

export async function unrequireFixtureCommand(
  options: AuthoringCommandOptions &
    RequirementTargetOptions & { fixture: string }
) {
  validateUnrequireFixtureOptions(options)
  const context = await getAuthoringContext(options)
  const [fixture, target] = await Promise.all([
    fetchAuthoringFixture(context, options.fixture),
    resolveRequirementTarget(context, options),
  ])
  await author(context, {
    operation: "unrequireFixture",
    fixtureId: fixture.id,
    ...target,
  })
}
