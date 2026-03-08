import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const invocationCwd = process.env.INIT_CWD ?? repoRoot;

const build = spawnSync(
  "pnpm",
  ["caracara:build"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  },
);

if ((build.status ?? 1) !== 0) {
  process.exit(build.status ?? 1);
}

const rawArgs = process.argv.slice(2);
const forwardedArgs =
  rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

const command = spawnSync(
  "node",
  [resolve(repoRoot, "packages/caracara/dist/bin/caracara.js"), ...forwardedArgs],
  {
    cwd: invocationCwd,
    stdio: "inherit",
    shell: true,
  },
);

process.exit(command.status ?? 1);
