import { API_VERSION, MIN_SUPPORTED_CLI_VERSION } from "./constants.js"

function parseVersion(version: string) {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) {
    return null
  }

  return match.slice(1, 4).map((value) => Number.parseInt(value, 10))
}

export function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)

  if (!leftParts || !rightParts) {
    throw new Error("Invalid semantic version")
  }

  for (let index = 0; index < 3; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    const delta = leftValue - rightValue
    if (delta !== 0) {
      return delta
    }
  }

  return 0
}

export function isCliVersionSupported(version: string) {
  try {
    return compareVersions(version, MIN_SUPPORTED_CLI_VERSION) >= 0
  } catch {
    return false
  }
}

export function createVersionMismatchDetails() {
  return {
    apiVersion: API_VERSION,
    minimumSupportedCliVersion: MIN_SUPPORTED_CLI_VERSION,
  }
}
