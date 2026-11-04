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
  resultsCommand,
  runCommand,
  updateCheckCommand,
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
    "--phases <list>",
    "run several phases as one run, for example 1-7,9,10"
  )
  .option(
    "--keep-going",
    "after an execution error, skip the rest of that phase and continue (default when the run covers several phases)"
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
  .addHelpText(
    "after",
    `
Exit codes:
  0    every scenario ran (failed checks are findings, not errors)
  1    the run stopped on a CLI, configuration or API error
  2    a scenario was recorded as a runner failure or was skipped
  3    --fail-on matched a check verdict
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
