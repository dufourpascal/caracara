import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Vitest 4 stopped excluding dist/ by default; tsc emits compiled tests there.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
})
