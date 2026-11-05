#!/usr/bin/env node

import { Command } from "commander"

import {
  addCheckCommand,
  addPhaseCommand,
  cliVersion,
  createFixtureCommand,
  createScenarioCommand,
  editPhaseCommand,
  fixtureOperationCommand,
  initCommand,
  listEnvironmentsCommand,
  listProjectsCommand,
  loginCommand,
  logoutCommand,
  removeCheckCommand,
  removePhaseCommand,
  requireFixtureCommand,
  resultsCommand,
  runCommand,
  unrequireFixtureCommand,
  updateCheckCommand,
  updateFixtureCommand,
  updateScenarioCommand,
  whoamiCommand,
} from "../commands.js"

const program = new Command()

program.name("caracara").version(cliVersion)

program
  .command("init")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .option("--runner <runner>", "codex or claude-code")
  .option("--model <model>", "Codex model")
  .option("--model-reasoning-effort <effort>", "Codex reasoning effort")
  .action(async (options) => {
    await initCommand(options)
  })

program
  .command("login")
  .option("--api-base-url <url>")
  .action(async (options) => {
    await loginCommand(options.apiBaseUrl)
  })

program.command("logout").action(async () => {
  await logoutCommand()
})

program.command("whoami").action(async () => {
  await whoamiCommand()
})

program
  .command("projects:list")
  .option("--api-base-url <url>")
  .action(async (options) => {
    await listProjectsCommand(options.apiBaseUrl)
  })

program
  .command("environments:list")
  .description("list configured target environments")
  .action(async () => {
    await listEnvironmentsCommand()
  })

program
  .command("addPhase")
  .requiredOption("--name <name>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(addPhaseCommand)

program
  .command("editPhase")
  .requiredOption("--phase <reference>", "phase ID, order, or exact name")
  .requiredOption("--name <name>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(editPhaseCommand)

program
  .command("removePhase")
  .requiredOption("--phase <reference>", "phase ID, order, or exact name")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(removePhaseCommand)

program
  .command("createScenario")
  .requiredOption("--name <name>")
  .requiredOption("--instructions <instructions>")
  .option("--slug <slug>")
  .option("--phase <reference>", "phase ID, order, or exact name")
  .option("--depends-on <slugs...>", "scenario dependency slugs")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(createScenarioCommand)

program
  .command("updateScenario")
  .requiredOption("--scenario <slug>")
  .option("--name <name>")
  .option("--slug <slug>")
  .option("--status <status>", "draft or active")
  .option("--instructions <instructions>")
  .option("--phase <reference>", "phase ID, order, or exact name")
  .option("--unassigned", "remove the phase assignment")
  .option("--depends-on <slugs...>", "replace scenario dependency slugs")
  .option("--clear-dependencies")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(updateScenarioCommand)

program
  .command("addCheck")
  .requiredOption("--scenario <slug>")
  .requiredOption("--name <name>")
  .requiredOption("--expectation <expectation>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(addCheckCommand)

program
  .command("removeCheck")
  .requiredOption("--scenario <slug>")
  .requiredOption("--check <reference>", "check ID or exact name")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(removeCheckCommand)

program
  .command("updateCheck")
  .requiredOption("--scenario <slug>")
  .requiredOption("--check <reference>", "check ID or exact name")
  .option("--name <name>")
  .option("--expectation <expectation>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(updateCheckCommand)

const fixtureFieldOptions = (command: Command) =>
  command
    .option("--slug <slug>")
    .option("--description <text>")
    .option("--locator <text>", "how to find the fixture in the application")
    .option("--protection <text>", "extra rules for runs that use it")
    .option(
      "--steps-file <path>",
      "JSON array of converge steps: { name, instructions, doneWhen }"
    )
    .option(
      "--checks-file <path>",
      "JSON array of health checks: { name, expectation }"
    )
    .option("--api-base-url <url>")
    .option("--project <slug>")

fixtureFieldOptions(
  program.command("createFixture").requiredOption("--name <name>")
).action(createFixtureCommand)

fixtureFieldOptions(
  program
    .command("updateFixture")
    .requiredOption("--fixture <slug>")
    .option("--name <name>")
).action(updateFixtureCommand)

program
  .command("requireFixture")
  .description("make a phase or scenario depend on a fixture")
  .requiredOption("--fixture <slug>")
  .option("--phase <reference>", "phase ID, order, or exact name")
  .option("--scenario <slug>")
  .option("--access <access>", "read or mutates", "read")
  .option("--mutation-scope <text>", "what a mutating scenario may change")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(requireFixtureCommand)

program
  .command("unrequireFixture")
  .requiredOption("--fixture <slug>")
  .option("--phase <reference>", "phase ID, order, or exact name")
  .option("--scenario <slug>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(unrequireFixtureCommand)

const fixtureExitCodes = `
Exit codes:
  0    the fixture is healthy
  1    a CLI, configuration or API error
  4    the fixture is unhealthy
  130  interrupted (SIGINT), 143 terminated (SIGTERM)`

for (const operation of ["verify", "converge"] as const) {
  program
    .command(`fixtures:${operation}`)
    .description(
      operation === "verify"
        ? "check a fixture with its verify hook or an inspect-only agent task"
        : "create or repair a fixture with its converge hook or an agent task, then verify it"
    )
    .argument("<slug>", "fixture slug")
    .option("--environment <name>")
    .option("--api-base-url <url>")
    .option("--project <slug>")
    .addHelpText("after", fixtureExitCodes)
    .action(async (slug: string, options) => {
      await fixtureOperationCommand(operation, slug, options)
    })
}

program
  .command("run")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .option("--runner <runner>", "codex or claude-code", "codex")
  .option("--environment <name>")
  .option(
    "--model <model>",
    "Codex model for this run (default: model in .caracara/config.json)"
  )
  .option(
    "--model-reasoning-effort <effort>",
    "Codex reasoning effort for this run: none, minimal, low, medium, high, xhigh or max (default: model_reasoning_effort in .caracara/config.json)"
  )
  .option("--scenario <slug>")
  .option("--suite <slug>")
  .option("--phase <number>")
  .option("--through-phase <number>")
  .option(
    "--phases <list>",
    "run several phases as one run, for example 1-7,9,10"
  )
  .option(
    "--keep-going",
    "after an execution error, skip only the scenarios that depend on it and continue (default)"
  )
  .option("--no-keep-going", "stop the run after the first execution error")
  .option("--plain", "print timestamped lines instead of the live status panel")
  .option("-q, --quiet", "print only the final summary")
  .option("--json", "print JSON lines events instead of text")
  .option(
    "--heartbeat <duration>",
    "in plain output, report a running scenario every 30s, 5m, 1h (0 turns it off)",
    "5m"
  )
  .option(
    "--fail-on <verdicts>",
    "exit with code 3 when checks have these verdicts: failed, blocked or failed,blocked"
  )
  .option(
    "--fixtures <mode>",
    "before the run, check (default) the required fixtures, repair them, or skip the preflight"
  )
  .addHelpText(
    "after",
    `
Exit codes:
  0    every scenario ran (failed checks are findings, not errors)
  1    the run stopped on a CLI, configuration or API error
  2    a scenario was recorded as a runner failure or was skipped
  3    --fail-on matched a check verdict
  4    a required fixture is unhealthy; no run was created
  130  interrupted (SIGINT), 143 terminated (SIGTERM)`
  )
  .action(async (options) => {
    await runCommand(options)
  })

program
  .command("results")
  .description("print a run's results, verdicts, durations and token usage")
  .argument("[run]", 'run ID, run name, or "latest"', "latest")
  .option("--json", "print machine-readable JSON")
  .option(
    "--environment <name>",
    'with "latest": the latest run in this environment'
  )
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(async (run: string, options) => {
    await resultsCommand(run, options)
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error"
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
