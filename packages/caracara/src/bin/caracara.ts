#!/usr/bin/env node

import { Command } from "commander"

import {
  addCheckCommand,
  addPhaseCommand,
  cliVersion,
  createScenarioCommand,
  editPhaseCommand,
  initCommand,
  listEnvironmentsCommand,
  listProjectsCommand,
  loginCommand,
  logoutCommand,
  removeCheckCommand,
  removePhaseCommand,
  runCommand,
  updateCheckCommand,
  updateScenarioCommand,
  whoamiCommand,
} from "../commands.js"
import {
  addFixtureCheckCommand,
  addFixtureStepCommand,
  createFixtureCommand,
  fixturesConvergeCommand,
  fixturesListCommand,
  fixturesResetCommand,
  fixturesVerifyCommand,
  removeFixtureCheckCommand,
  removeFixtureStepCommand,
  requireFixtureCommand,
  unrequireFixtureCommand,
  updateFixtureCheckCommand,
  updateFixtureCommand,
  updateFixtureStepCommand,
} from "../fixture-commands.js"

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

program
  .command("createFixture")
  .requiredOption("--name <name>")
  .option("--slug <slug>")
  .option("--description <text>")
  .option("--locator <text>", "how to find the fixture in the application")
  .option("--protection <text>", "extra rules for evaluation runs")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(createFixtureCommand)

program
  .command("updateFixture")
  .requiredOption("--fixture <slug>")
  .option("--name <name>")
  .option("--slug <slug>")
  .option("--description <text>")
  .option("--locator <text>")
  .option("--protection <text>")
  .option("--reset-instructions <text>")
  .option("--clear-reset", "remove the reset instructions")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(updateFixtureCommand)

program
  .command("addFixtureStep")
  .requiredOption("--fixture <slug>")
  .requiredOption("--name <name>")
  .requiredOption("--instructions <text>")
  .requiredOption("--done-when <text>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(addFixtureStepCommand)

program
  .command("updateFixtureStep")
  .requiredOption("--fixture <slug>")
  .requiredOption("--step <reference>", "step ID or exact name")
  .option("--name <name>")
  .option("--instructions <text>")
  .option("--done-when <text>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(updateFixtureStepCommand)

program
  .command("removeFixtureStep")
  .requiredOption("--fixture <slug>")
  .requiredOption("--step <reference>", "step ID or exact name")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(removeFixtureStepCommand)

program
  .command("addFixtureCheck")
  .requiredOption("--fixture <slug>")
  .requiredOption("--name <name>")
  .requiredOption("--expectation <expectation>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(addFixtureCheckCommand)

program
  .command("updateFixtureCheck")
  .requiredOption("--fixture <slug>")
  .requiredOption("--check <reference>", "check ID or exact name")
  .option("--name <name>")
  .option("--expectation <expectation>")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(updateFixtureCheckCommand)

program
  .command("removeFixtureCheck")
  .requiredOption("--fixture <slug>")
  .requiredOption("--check <reference>", "check ID or exact name")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(removeFixtureCheckCommand)

program
  .command("requireFixture")
  .requiredOption("--fixture <slug>")
  .option("--phase <reference>", "phase ID, order, or exact name")
  .option("--scenario <slug>")
  .option("--access <access>", "read or mutates", "read")
  .option("--mutation-scope <text>", "what a mutating requirement may change")
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

program
  .command("fixtures:list")
  .description("list fixtures with their health and local hooks")
  .option("--environment <name>", "show health for one environment")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(async (options) => {
    await fixturesListCommand(options)
  })

program
  .command("fixtures:verify")
  .description("verify fixtures (all when no slug is given); exit 3 if unhealthy")
  .argument("[slugs...]")
  .option("--environment <name>")
  .option("--runner <runner>", "codex or claude-code")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(async (slugs: string[], options) => {
    await fixturesVerifyCommand(slugs, options)
  })

program
  .command("fixtures:converge")
  .description("converge a fixture, then verify it; exit 3 if unhealthy")
  .argument("<slug>")
  .option("--environment <name>")
  .option("--runner <runner>", "codex or claude-code")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(async (slug: string, options) => {
    await fixturesConvergeCommand(slug, options)
  })

program
  .command("fixtures:reset")
  .description("reset a fixture, then verify it; exit 3 if unhealthy")
  .argument("<slug>")
  .option("--environment <name>")
  .option("--runner <runner>", "codex or claude-code")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .action(async (slug: string, options) => {
    await fixturesResetCommand(slug, options)
  })

program
  .command("run")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .option("--runner <runner>", "codex or claude-code", "codex")
  .option("--environment <name>")
  .option("--scenario <slug>")
  .option("--suite <slug>")
  .option("--phase <number>")
  .option("--through-phase <number>")
  .option(
    "--fixtures <mode>",
    "fixture preflight: check (default), repair, or skip",
    "check"
  )
  .action(async (options) => {
    await runCommand(options)
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error"
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
