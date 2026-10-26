import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import globals from "globals"
import turboPlugin from "eslint-plugin-turbo"
import tseslint from "typescript-eslint"

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    // Build and helper scripts run under Node, not the browser.
    files: ["**/*.{mjs,cjs}", "scripts/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ["dist/**", ".next/**", "**/.turbo/**", "**/coverage/**"],
  },
]

/**
 * React Compiler rules that still fire in existing components. They are kept
 * visible as warnings until the affected code is reworked; new violations
 * should be fixed rather than added to this list.
 */
export const reactCompilerRuleOverrides = {
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/static-components": "warn",
}
