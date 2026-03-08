#!/usr/bin/env node

import { Command } from "commander"

import {
  cliVersion,
  initCommand,
  listProjectsCommand,
  loginCommand,
  logoutCommand,
  runCommand,
  whoamiCommand,
} from "../commands.js"

const program = new Command()

program.name("caracara").version(cliVersion)

program
  .command("init")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .option("--runner <runner>", "codex or claude-code")
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
  .command("run")
  .option("--api-base-url <url>")
  .option("--project <slug>")
  .option("--runner <runner>", "codex or claude-code", "codex")
  .option("--scenario <slug>")
  .action(async (options) => {
    await runCommand(options)
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error"
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
