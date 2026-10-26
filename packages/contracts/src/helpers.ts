import adjectives from "./adjectives-safe.json" with { type: "json" }
import birds from "./birds-safe.json" with { type: "json" }

export function normalizeSlug(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")

  return normalized || "untitled"
}

export function createUniqueSlug(value: string, existingSlugs: Iterable<string>) {
  const base = normalizeSlug(value)
  const occupied = new Set(existingSlugs)

  if (!occupied.has(base)) {
    return base
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`
    if (!occupied.has(candidate)) {
      return candidate
    }
  }

  throw new Error("Unable to create a unique slug")
}

export function formatRunTimestamp(date: Date) {
  const year = date.getUTCFullYear().toString().padStart(4, "0")
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0")
  const day = `${date.getUTCDate()}`.padStart(2, "0")
  const hours = `${date.getUTCHours()}`.padStart(2, "0")
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0")
  const seconds = `${date.getUTCSeconds()}`.padStart(2, "0")

  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function pickRandom(words: readonly string[]) {
  const word = words[Math.floor(Math.random() * words.length)]
  if (word === undefined) {
    throw new Error("Run name word list is empty")
  }
  return word
}

export function formatRunName(date = new Date()) {
  const base = `${pickRandom(adjectives)}-${pickRandom(birds)}`

  return `${base}-${formatRunTimestamp(date)}`
}
