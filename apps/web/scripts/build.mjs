import { spawn } from "node:child_process"

const isVercel = process.env.VERCEL === "1"
const hasConvexDeployKey = Boolean(process.env.CONVEX_DEPLOY_KEY)

const command = isVercel && hasConvexDeployKey
  ? [
      "convex",
      "deploy",
      "--cmd",
      "next build",
      "--cmd-url-env-var-name",
      "NEXT_PUBLIC_CONVEX_URL",
    ]
  : ["next", "build"]

const child = spawn(command[0], command.slice(1), {
  stdio: "inherit",
  shell: true,
  env: process.env,
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})

