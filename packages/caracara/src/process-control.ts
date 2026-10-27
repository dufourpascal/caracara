// Process-group aware termination shared by the runners and the Codex
// launcher. Children are spawned detached on POSIX so their own children
// (MCP servers, browsers) die with them.
import { spawn, type ChildProcess } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

function signalChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
  detached: boolean
) {
  if (!child.pid) {
    return
  }
  try {
    if (detached && process.platform !== "win32") {
      process.kill(-child.pid, signal)
    } else {
      child.kill(signal)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error
    }
  }
}

function processGroupExists(pid: number) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false
    }
    throw error
  }
}

export function buildWindowsTaskkillArgs(pid: number) {
  return ["/PID", String(pid), "/T", "/F"]
}

async function terminateWindowsProcessTree(child: ChildProcess) {
  const pid = child.pid
  if (!pid) {
    return
  }
  await new Promise<void>((resolve, reject) => {
    const taskkill = spawn("taskkill.exe", buildWindowsTaskkillArgs(pid), {
      stdio: "ignore",
      windowsHide: true,
    })
    taskkill.once("error", reject)
    taskkill.once("close", (code) => {
      if (code === 0 || child.exitCode !== null || child.signalCode !== null) {
        resolve()
      } else {
        reject(new Error(`taskkill exited with code ${code}.`))
      }
    })
  })
}

async function waitForProcessGroupExit(pid: number) {
  const deadline = Date.now() + 1_000
  while (processGroupExists(pid) && Date.now() < deadline) {
    await delay(10)
  }
  if (processGroupExists(pid)) {
    throw new Error("Failed to terminate child process group.")
  }
}

export async function terminateChildProcess(
  child: ChildProcess,
  detached = false,
  closePromise?: Promise<void>
) {
  if (!child.pid) {
    return
  }
  if (!closePromise && (child.exitCode !== null || child.signalCode !== null)) {
    return
  }

  const waitForClose =
    closePromise ??
    new Promise<void>((resolve) => {
      child.once("close", () => resolve())
    })
  if (process.platform === "win32") {
    await terminateWindowsProcessTree(child)
    const closed = await Promise.race([
      waitForClose.then(() => true),
      delay(1_000).then(() => false),
    ])
    if (!closed) {
      child.stdout?.destroy()
      child.stderr?.destroy()
      await waitForClose
    }
    return
  }
  signalChildProcess(child, "SIGTERM", detached)

  const gracePeriod = delay(1_000)
  const closedBeforeGrace = await Promise.race([
    waitForClose.then(() => true),
    gracePeriod.then(() => false),
  ])
  const hasRemainingProcessGroup = detached && processGroupExists(child.pid)
  if (closedBeforeGrace && !hasRemainingProcessGroup) {
    return
  }

  await gracePeriod
  signalChildProcess(child, "SIGKILL", detached)
  child.stdout?.destroy()
  child.stderr?.destroy()
  if (!closedBeforeGrace) {
    await waitForClose
  }
  if (detached) {
    await waitForProcessGroupExit(child.pid)
  }
}
