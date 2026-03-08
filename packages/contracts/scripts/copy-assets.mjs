import { cp, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const currentDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(currentDir, "..")
const sourceFile = resolve(packageDir, "src/birds-safe.json")
const destinationFile = resolve(packageDir, "dist/birds-safe.json")

await mkdir(dirname(destinationFile), { recursive: true })
await cp(sourceFile, destinationFile)
