import { fileURLToPath } from "node:url"

import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@workspace/contracts": fileURLToPath(
        new URL("../contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Vitest 4 stopped excluding dist/ by default; tsc emits compiled tests there.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
})
