# Monorepo and Packages

### REPO_01
The codebase is organized as a pnpm and Turborepo monorepo.

The repository should use a single monorepo structure so the web app, CLI package, and shared libraries can evolve together with consistent tooling and dependency management.

### REPO_02
The monorepo uses `apps/` and `packages/` as the top-level layout.

Application entry points should live under `apps/`, while reusable libraries and publishable packages should live under `packages/`.

### REPO_03
The monorepo contains a Next.js web application in `apps/web`.

The frontend should live as its own app within the monorepo and own the user-facing product experience for project and scenario management.

### REPO_04
Convex lives inside the Next.js application.

Convex functions, schema definitions, and backend logic should be located within `apps/web` rather than extracted into a separate top-level package or app in v1.

### REPO_05
The monorepo contains the published `caracara` CLI package.

The npm package responsible for local execution should live in the same repository so API contracts and shared types can stay aligned with the hosted application.

### REPO_06
The monorepo includes a small shared package for contracts from the start.

A dedicated shared package should define core domain types, API payload shapes, and validation schemas so the web app and CLI can share a single source of truth for project, scenario, run, and result contracts.

### REPO_07
Frontend-specific UI code stays in the web app.

Reusable business logic may be shared across packages, but UI components and app-specific presentation code should remain within the frontend app unless there is a clear reason to extract them.

### REPO_08
Package responsibilities should remain explicit.

Even though everything lives in one monorepo, the web app, CLI, and shared contracts package should have clear build boundaries and should not depend on each other in ad hoc ways.

### REPO_09
The CLI package should be publishable to npm from the monorepo.

The repository structure and release process should support building and publishing the `caracara` package without manual copying or external packaging steps.

### REPO_10
The monorepo should optimize for straightforward local development and future growth.

A developer should be able to install dependencies once and work across the web app, Convex backend, shared contracts, and CLI with minimal friction, while the structure still leaves room for future packages if the product expands.
