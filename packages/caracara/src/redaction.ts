/** Exact values to redact: local secrets plus inherited CARACARA_SECRET_* values. */
export function collectSecretValues(
  localSecrets: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
) {
  const values = new Set<string>()
  for (const value of Object.values(localSecrets)) {
    if (value !== "") {
      values.add(value)
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("CARACARA_SECRET_") && value) {
      values.add(value)
    }
  }
  return [...values].sort((left, right) => right.length - left.length)
}

export function redactValues(text: string, secretValues: readonly string[]) {
  let redacted = text
  for (const secret of secretValues) {
    if (secret !== "") {
      redacted = redacted.split(secret).join("[REDACTED]")
    }
  }
  return redacted
}
