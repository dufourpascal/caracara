import { cp, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const currentDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(currentDir, "..")
const assets = ["adjectives-safe.json", "birds-safe.json"]

await mkdir(resolve(packageDir, "dist"), { recursive: true })
for (const asset of assets) {
  await cp(resolve(packageDir, "src", asset), resolve(packageDir, "dist", asset))
}
