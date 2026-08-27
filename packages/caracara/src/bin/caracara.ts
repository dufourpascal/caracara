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
  .action(async (options) => {
    await runCommand(options)
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error"
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
