import { spawnSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const usage =
  "Usage: node scripts/install-cli.mjs [--target <dir>] [--skip-global]"

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { target: undefined, skipGlobal: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--") {
      continue
    } else if (arg === "--skip-global") {
      options.skipGlobal = true
    } else if (arg === "--target") {
      const value = argv[index + 1]
      if (!value) {
        fail(`--target needs a directory.\n${usage}`)
      }
      options.target = resolve(process.env.INIT_CWD ?? process.cwd(), value)
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage)
      process.exit(0)
    } else {
      fail(`Unknown argument: ${arg}\n${usage}`)
    }
  }
  return options
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    // npm and npx are .cmd shims on Windows.
    shell: process.platform === "win32",
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`
    )
  }
  return capture ? result.stdout.trim() : ""
}

function directorySize(path) {
  const stats = lstatSync(path)
  if (!stats.isDirectory()) {
    return stats.size
  }
  let total = stats.size
  for (const entry of readdirSync(path)) {
    total += directorySize(join(path, entry))
  }
  return total
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function replaceSymlink(linkPath, targetName) {
  const tempLink = `${linkPath}.tmp-${process.pid}`
  rmSync(tempLink, { force: true })
  symlinkSync(targetName, tempLink, "dir")
  renameSync(tempLink, linkPath)
}

const options = parseArgs(process.argv.slice(2))
const packageManager = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8")
).packageManager
const pnpm = ["-y", packageManager]

const sourceCommit = run("git", ["rev-parse", "HEAD"], { capture: true })
const dirty =
  run("git", ["status", "--porcelain", "--untracked-files=no"], {
    capture: true,
  }) !== ""
const baseDir = join(
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
  "caracara",
  "cli"
)
const target = options.target ?? join(baseDir, sourceCommit)

// Only the commit directory under baseDir is ours to replace.
if (
  options.target &&
  existsSync(options.target) &&
  readdirSync(options.target).length > 0
) {
  fail(`--target ${options.target} must be empty or not exist.`)
}

if (dirty) {
  console.warn(
    `Warning: the working tree has uncommitted changes; ${sourceCommit.slice(0, 12)} will not match the deployed files.`
  )
}

run("npx", [...pnpm, "install", "--frozen-lockfile"])
run("npx", [...pnpm, "caracara:build"])

// pnpm deploy needs an empty directory; deploy beside the target and swap in.
const staging = `${target}.partial-${process.pid}`
rmSync(staging, { recursive: true, force: true })
mkdirSync(dirname(target), { recursive: true })
try {
  run("npx", [
    ...pnpm,
    "--filter",
    "caracara",
    "deploy",
    "--prod",
    "--frozen-lockfile",
    "--config.package-import-method=clone-or-copy",
    staging,
  ])
  const deployedPackage = JSON.parse(
    readFileSync(join(staging, "package.json"), "utf8")
  )
  writeFileSync(
    join(staging, "BUILD-INFO.json"),
    `${JSON.stringify(
      {
        package: deployedPackage.name,
        version: deployedPackage.version,
        sourceCommit,
        dirty,
        builtAt: new Date().toISOString(),
        node: process.version,
        pnpm: run("npx", [...pnpm, "--version"], { capture: true }),
        method:
          "pnpm deploy --prod --config.package-import-method=clone-or-copy",
      },
      null,
      2
    )}\n`
  )
  // Swap so a reinstall of the same commit never leaves the live install missing.
  const previous = `${target}.previous-${process.pid}`
  if (existsSync(target)) {
    renameSync(target, previous)
  }
  try {
    renameSync(staging, target)
  } catch (error) {
    if (existsSync(previous)) {
      renameSync(previous, target)
    }
    throw error
  }
  rmSync(previous, { recursive: true, force: true })
} catch (error) {
  rmSync(staging, { recursive: true, force: true })
  throw error
}

let installPath = target
if (!options.target) {
  const currentLink = join(baseDir, "current")
  replaceSymlink(currentLink, sourceCommit)
  installPath = currentLink
}

if (options.skipGlobal) {
  console.log(
    `Skipped global install. Run \`npm install -g ${installPath}\` to install it.`
  )
  console.log(
    run("node", [join(target, "dist", "bin", "caracara.js"), "--version"], {
      capture: true,
    })
  )
} else {
  run("npm", ["install", "-g", installPath])
  console.log(run("caracara", ["--version"], { capture: true }))
}

console.log(`Deployed ${target} (${formatBytes(directorySize(target))})`)
