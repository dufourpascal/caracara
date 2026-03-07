# Caracara Score Full Implementation Plan

This document is the execution plan for implementing Caracara Score end to end across the hosted web app, Convex backend, and published `caracara` CLI package.

The plan is intentionally non-interactive. Execution should proceed phase by phase without waiting for user feedback. If a phase exposes gaps, bugs, or missing details, resolve them inside the phase or the next strictly dependent phase and continue. Do not stop once implementation begins until the full application is implemented, verified, and brought into alignment with the specs in [`specs/`](/home/pascal/src/caracarascore/specs).

## Operating Rules

1. Treat this document as the working baseline for implementation sequencing.
2. Treat the spec files as the source of truth when this plan and a spec differ.
3. Do not ask for design or product clarification unless a hard blocker cannot be resolved from the repo, the specs, or reasonable v1 assumptions.
4. Keep the architecture inside the declared monorepo shape:
   - `apps/web`: Next.js app, Convex schema/functions, Next API routes.
   - `packages/ui`: shared shadcn-based UI primitives.
   - `packages/contracts`: shared domain and API contracts.
   - `packages/caracara`: published CLI package.
5. Prefer thin adapters at boundaries and pure, unit-testable modules for domain logic.
6. Use the same verification loop after every phase.

## Standard Phase Completion Loop

Every phase must end with this exact loop before moving on:

1. Implement the scoped code changes for the phase.
2. Add or update unit tests for the logic introduced in the phase.
3. Run the relevant automated verification:
   - `pnpm lint`
   - `pnpm typecheck`
   - targeted package tests
   - targeted builds when the phase changes packaging or runtime wiring
4. Compare the implemented work against this plan and record any deviation that was necessary.
5. Compare the implemented work against the relevant spec sections and correct any deviation from the specs.
6. For frontend or user-visible web behavior, verify with Chrome DevTools MCP using:
   - username: `pascal@renaissanceai.ch`
   - password: `Aksojxh3283729st!`
7. If defects or deviations are found, fix them immediately and rerun the same verification loop.
8. Only mark the phase complete when the scoped goal, tests, spec checks, and browser checks all pass.

## Global Technical Decisions To Follow

- Testing stack:
  - `vitest` for shared packages, CLI logic, and pure backend helpers.
  - `@testing-library/react` for component and interaction tests in `apps/web`.
  - `msw` or equivalent request mocking for API/CLI integration tests.
- Shared contracts:
  - `packages/contracts` is the single source of truth for zod schemas, shared types, enums, API payloads, API error shapes, version constants, and runner/result status values.
- Backend split:
  - Convex is the system of record for persistent data and authenticated browser-side mutations/queries.
  - Next.js route handlers provide CLI-facing HTTP APIs and OAuth callback handling where browser-style request handling is simpler than Convex HTTP actions.
- CLI auth:
  - Use OAuth 2.0 Authorization Code with PKCE through Clerk, opening the user browser and receiving the callback on a loopback local server.
- Scenario ordering:
  - Dependency resolution and ordering are backend responsibilities.
  - The CLI only consumes either an already ordered active scenario list or a single scenario by slug.
- Historical integrity:
  - Preserve both authored scenario revisions and the exact scenario snapshot submitted with each result record.
- Score representation:
  - Standardize on a numeric score contract in shared types and use one documented scale consistently across backend, frontend, and CLI.

## Phase Overview

1. Phase 1: Monorepo foundation, contracts, and test harness
2. Phase 2: Convex domain model and authenticated backend for projects and scenarios
3. Phase 3: CLI-facing API surface, OAuth, and contract versioning
4. Phase 4: `caracara` CLI foundation, auth, config, and project selection
5. Phase 5: CLI execution engine, runner adapters, scoring, and incremental submission
6. Phase 6: Authenticated web shell, routes, navigation, and project management
7. Phase 7: Scenario authoring workspace, dependency management, and graph view
8. Phase 8: Runs workspace, run details, and execution-result inspection
9. Phase 9: Hardening, release readiness, and full-system compliance sweep

## Phase 1: Monorepo Foundation, Contracts, and Test Harness

**Goal**

Establish the package structure, shared contract layer, and testing foundation required for the rest of the implementation.

**Implementation**

- Add `packages/contracts` with:
  - domain enums for scenario status, run status, scenario-result status, runner type
  - zod schemas for project, scenario, scenario dependency, scenario revision, run, scenario result, API errors, auth payloads, and CLI config
  - API payload/response schemas for:
    - project listing and retrieval
    - ordered active scenario retrieval
    - single-scenario retrieval by slug
    - run creation
    - incremental scenario-result submission
    - version mismatch errors
  - shared constants for API version and minimum supported CLI version
  - shared helpers for slug normalization and run-name formatting
- Add `packages/caracara` as a publishable package stub with `package.json`, build config, TypeScript config, and placeholder command entrypoint.
- Update workspace scripts so `lint`, `typecheck`, `build`, and `test` can run coherently across root, web, contracts, UI, and CLI packages.
- Introduce test tooling and baseline config:
  - `vitest`
  - React Testing Library for `apps/web`
  - a request-mocking strategy for API/CLI tests
- Add environment and package boundary docs for new packages and required env vars.

**Unit Testing**

- Validate every shared zod contract with happy-path and rejection tests.
- Test slug normalization and collision-handling helpers.
- Test run-name generation helper formatting and timestamp suffix behavior.
- Test API version compatibility helper logic.

**Verification Against This Plan**

- Confirm the repo shape now matches the target package layout in this document.
- Confirm test tooling exists before any deeper implementation phase depends on it.
- If a tooling choice must change, update this plan file immediately and continue.

**Frontend Verification**

- Not a primary frontend phase.
- Smoke-check that the current auth scaffold still renders after dependency and script changes.

**Specification Verification**

- `specs/monorepo-and-packages.md`: `REPO_01` to `REPO_10`
- `specs/api-contracts.md`: `API_09`
- `specs/core-domain-model.md`: `DOMAIN_09`

**Iterative Bug-Fix Loop**

- Fix package resolution, script wiring, or TypeScript boundary issues before moving on.
- Keep rerunning lint, typecheck, and package tests until the foundation is stable.

**Exit Criteria**

- `packages/contracts` exists and is consumed by both `apps/web` and `packages/caracara`.
- `packages/caracara` exists as a real publishable package skeleton.
- Root test tooling is operational.

## Phase 2: Convex Domain Model and Authenticated Backend for Projects and Scenarios

**Goal**

Implement the persistent domain model and authenticated Convex backend required for projects, scenarios, dependencies, authored revisions, and project ownership.

**Implementation**

- Add Convex schema for:
  - `projects`
  - `scenarios`
  - `scenarioDependencies`
  - `scenarioRevisions`
  - `runs`
  - `scenarioResults`
- Persist project fields:
  - owner identity
  - name
  - slug
  - description
  - project-level prompt
  - timestamps
- Persist scenario fields:
  - project id
  - stable scenario id
  - name
  - slug
  - status (`draft` or `active`)
  - instructions
  - scoring prompt
  - current revision number
  - timestamps
- Persist dependency edges as first-class records with project-local validation.
- Create revision snapshots on scenario save so authored history is durable.
- Build pure domain helpers for:
  - slug uniqueness
  - dependency validation
  - cycle detection
  - topological ordering
  - filtering to active scenarios for runnable flows
- Add authenticated Convex queries/mutations for:
  - current user bootstrapping
  - project create/list/get/update
  - scenario create/list/get/update
  - dependency assignment and replacement
  - execution-order retrieval for the web app
- Centralize ownership checks so all project and scenario access is scoped to the Clerk user.

**Unit Testing**

- Test cycle detection, self-dependency rejection, and cross-project dependency rejection.
- Test deterministic execution ordering.
- Test project ownership guards.
- Test scenario revision creation and revision increment behavior.
- Test draft versus active filtering logic.

**Verification Against This Plan**

- Confirm the data model includes both authored scenario revisions and per-run execution snapshots.
- Confirm backend logic, not the CLI, owns dependency validation and ordered scenario delivery.

**Frontend Verification**

- If any early project or scenario screens are wired during this phase, log in with Chrome DevTools MCP and verify authenticated reads and writes only occur for the signed-in user.
- If the UI is not yet present, browser verification is limited to confirming the app still boots after schema and auth changes.

**Specification Verification**

- `specs/core-domain-model.md`: `DOMAIN_01` to `DOMAIN_10`
- `specs/scenario-authoring.md`: `AUTHORING_01` to `AUTHORING_10`
- `specs/data-and-storage.md`: `DATA_01` to `DATA_10`
- `specs/authentication-and-access.md`: `AUTH_01`, `AUTH_02`, `AUTH_03`, `AUTH_04`, `AUTH_08`, `AUTH_09`, `AUTH_10`

**Iterative Bug-Fix Loop**

- Fix schema/index issues, auth gaps, ordering bugs, and revision bugs immediately.
- Re-run backend-targeted tests until all project/scenario invariants hold.

**Exit Criteria**

- Projects and scenarios are fully persisted in Convex with owner scoping and dependency validation.
- Scenario authored history is durable.
- The web app can retrieve authenticated project and scenario data through Convex.

## Phase 3: CLI-Facing API Surface, OAuth, and Contract Versioning

**Goal**

Expose a stable, authenticated HTTP API for the CLI and implement versioned contract enforcement and Clerk OAuth integration.

**Implementation**

- Add Next.js route handlers under a versioned namespace such as `/api/v1/...`.
- Implement Clerk OAuth configuration for the CLI with PKCE and loopback redirect support.
- Build authenticated route middleware for bearer-token validation and project ownership enforcement.
- Implement CLI-oriented endpoints for:
  - listing accessible projects
  - retrieving project metadata for one project
  - retrieving ordered active scenarios for normal execution
  - retrieving a single scenario by slug for direct execution
  - creating a run and returning both durable id and generated run name
  - incrementally submitting scenario results
  - optionally finalizing a run if a separate completion step is needed
- Ensure ordered-scenario responses include:
  - project-level prompt context
  - scenario instructions
  - scoring prompt
  - runner-relevant metadata
- Enforce API version compatibility:
  - CLI sends its version
  - backend compares against minimum supported version
  - incompatible clients receive explicit upgrade errors
- Define uniform error contracts for:
  - unauthenticated
  - unauthorized
  - not found
  - validation error
  - version mismatch

**Unit Testing**

- Test route auth for valid, expired, invalid, and unauthorized tokens.
- Test project scoping across all endpoints.
- Test ordered scenario responses and single-scenario responses.
- Test run creation responses for required id and run name fields.
- Test version mismatch responses and error payload structure.

**Verification Against This Plan**

- Confirm the CLI API is the minimum required surface and does not leak web-only concerns.
- Confirm the backend, not the CLI, resolves dependency order.

**Frontend Verification**

- Not a main web-UI phase.
- Use Chrome DevTools MCP only if browser-based OAuth pages or error screens need a real interaction check.

**Specification Verification**

- `specs/api-contracts.md`: `API_01` to `API_10`
- `specs/authentication-and-access.md`: `AUTH_01`, `AUTH_05`, `AUTH_06`, `AUTH_07`, `AUTH_09`
- `specs/execution-and-scoring.md`: `EXEC_02`, `EXEC_03`, `EXEC_04`, `EXEC_08`, `EXEC_10`

**Iterative Bug-Fix Loop**

- Fix auth edge cases, project leakage, and contract mismatches before starting serious CLI work.
- Re-run API tests until all HTTP responses match the shared contracts.

**Exit Criteria**

- A real, versioned, authenticated CLI API exists.
- OAuth and bearer-token validation are implemented end to end.
- The API returns ordered scenarios, run metadata, and accepts incremental results.

## Phase 4: `caracara` CLI Foundation, Auth, Config, and Project Selection

**Goal**

Turn the CLI package into a usable authenticated client that can log in, persist configuration, and target a project without executing scenarios yet.

**Implementation**

- Build CLI command surface in `packages/caracara`, for example:
  - `caracara login`
  - `caracara logout`
  - `caracara whoami`
  - `caracara projects list`
  - `caracara run ...` as a stubbed command wired to config loading
- Implement PKCE login flow:
  - generate verifier and challenge
  - start loopback callback server
  - open browser
  - receive auth code
  - exchange for tokens
  - persist tokens securely
- Add config resolution order:
  - CLI flags
  - environment variables
  - persisted user config
- Persist auth and CLI state under an OS-appropriate config directory with restricted file permissions.
- Add user-friendly terminal output for auth success, project targeting, and version mismatch guidance.
- Implement project selection helpers so later run commands can resolve the current project by slug or explicit flag.

**Unit Testing**

- Test command parsing and option precedence.
- Test config read/write and file-permission handling.
- Test PKCE helper functions and callback parsing with mocked network responses.
- Test token validation and expired-token handling behavior.

**Verification Against This Plan**

- Confirm the CLI can authenticate and identify a project before execution logic is introduced.
- Confirm the package remains publishable and bounded from app-only dependencies.

**Frontend Verification**

- Use Chrome DevTools MCP to verify the browser portion of the Clerk OAuth login flow opens, signs in successfully with the provided credentials, and returns control to the CLI callback flow without manual intervention.

**Specification Verification**

- `specs/product-and-scope.md`: `SCOPE_03`, `SCOPE_06`, `SCOPE_07`
- `specs/authentication-and-access.md`: `AUTH_01`, `AUTH_05`, `AUTH_06`, `AUTH_07`, `AUTH_09`
- `specs/monorepo-and-packages.md`: `REPO_05`, `REPO_08`, `REPO_09`, `REPO_10`

**Iterative Bug-Fix Loop**

- Fix auth UX, callback timing, token persistence, and project-resolution bugs before implementing execution.
- Re-run CLI unit tests and interactive login smoke tests until authentication is reliable.

**Exit Criteria**

- `caracara login`, `logout`, `whoami`, and project targeting work against the live backend.
- The CLI package can authenticate via Clerk without manual token copying.

## Phase 5: CLI Execution Engine, Runner Adapters, Scoring, and Incremental Submission

**Goal**

Implement local scenario execution through supported runners, separate scoring, and durable incremental submission of results back to the hosted service.

**Implementation**

- Add runner adapters for:
  - Codex CLI
  - Claude Code CLI
- Standardize an internal execution interface so the rest of the CLI is runner-agnostic.
- Implement normal execution mode:
  - fetch ordered active scenarios from the API
  - create a run
  - execute scenarios in delivered order
  - include project-level prompt context in every execution
  - run scoring as a separate step from task execution
  - submit each scenario result immediately after completion or failure
- Implement direct single-scenario mode:
  - fetch one scenario by slug
  - do not expand dependencies
  - create a run scoped to the single requested scenario
- Capture structured execution data:
  - run id
  - run name
  - scenario id and slug
  - runner used
  - start and end timestamps
  - raw output
  - score
  - rationale
  - failure detail
  - submitted scenario snapshot
- Distinguish failure classes:
  - success
  - scoring failure
  - runner invocation failure
  - dependency failure
  - interrupted
- Handle interrupts and partial completion safely:
  - trap termination signals
  - submit interrupted status when possible
  - avoid losing already computed scenario results
- Make CLI output readable for long runs, including current scenario, runner, score, and final summary.

**Unit Testing**

- Test execution-plan orchestration for normal mode and direct mode.
- Test dependency-failure propagation.
- Test runner adapter selection and argument mapping.
- Test prompt composition to ensure project prompt and scenario instructions remain separate from scoring prompt.
- Test incremental result submission ordering and retry/error handling.
- Test interrupt handling and partial-run persistence behavior.

**Verification Against This Plan**

- Confirm the CLI never resolves dependency graphs locally for normal execution.
- Confirm each scenario result submission includes the scenario content that was actually executed.
- Confirm the run name returned by the backend is surfaced in CLI output.

**Frontend Verification**

- After a real local run is possible, use Chrome DevTools MCP to inspect the web app afterward and confirm the new run and incremental results are visible and correctly ordered.

**Specification Verification**

- `specs/execution-and-scoring.md`: `EXEC_01` to `EXEC_10`
- `specs/api-contracts.md`: `API_01`, `API_04`, `API_05`, `API_06`, `API_07`, `API_08`, `API_10`
- `specs/product-and-scope.md`: `SCOPE_01`, `SCOPE_02`, `SCOPE_04`, `SCOPE_05`, `SCOPE_06`, `SCOPE_07`, `SCOPE_08`, `SCOPE_10`, `SCOPE_14`, `SCOPE_15`

**Iterative Bug-Fix Loop**

- Fix runner integration mismatches, result-shape bugs, and failure-state ambiguity before moving into final web inspection UI work.
- Repeat CLI smoke runs until both supported runners and both run modes behave consistently.

**Exit Criteria**

- The CLI can authenticate, fetch scenarios, execute through supported runners, and report durable results incrementally.
- The backend stores those results in a form the web app can inspect.

## Phase 6: Authenticated Web Shell, Routes, Navigation, and Project Management

**Goal**

Implement the authenticated desktop-first application shell, routing model, breadcrumb-driven navigation, project switcher, and project-management screens.

**Implementation**

- Build the route structure described in the layout spec:
  - `/projects`
  - `/projects/new`
  - `/projects/[projectSlug]/scenarios`
  - `/projects/[projectSlug]/scenarios/[scenarioSlug]`
  - `/projects/[projectSlug]/runs`
  - `/projects/[projectSlug]/runs/[runId]`
- Add an authenticated app shell with:
  - top navbar
  - logo on the left
  - user avatar on the right
  - breadcrumb path in the middle
- Implement breadcrumb logic so it reflects project, workspace, and selected record.
- Implement project breadcrumb click behavior as a shadcn dropdown project switcher with `+ Create New Project` as the final option.
- Build `/projects` as the post-login landing page with project list and create entry point.
- Build project creation and project settings forms using shared shadcn primitives from `packages/ui`.
- Add the top-level segmented switch between `Scenarios` and `Runs`.
- Introduce resizable panel primitives using the shared shadcn-compatible resizable pattern.
- Preserve desktop-first layout behavior and do not invent a mobile layout for v1.

**Unit Testing**

- Test route-to-breadcrumb mapping.
- Test project switcher behavior and selected-project navigation.
- Test project form validation and slug uniqueness handling.
- Test route-state preservation on refresh and deep-link entry.

**Verification Against This Plan**

- Confirm authenticated users land on the project list after login.
- Confirm the route shape matches the plan before deeper scenario/run UI is layered on top.

**Frontend Verification**

- Use Chrome DevTools MCP to:
  - sign in with the provided Clerk credentials
  - verify unauthenticated access is blocked
  - verify `/projects` is the primary post-login landing page
  - create a project
  - edit project metadata and project-level prompt
  - switch projects from the breadcrumb dropdown
  - verify breadcrumb text and URL stay aligned
  - verify resizable left panel behavior on desktop widths

**Specification Verification**

- `specs/frontend-application.md`: `FRONTEND_01` to `FRONTEND_05`, `FRONTEND_10`
- `specs/layout-and-navigation.md`: `LAYOUT_01` to `LAYOUT_05`, `LAYOUT_11`, `LAYOUT_13`, `LAYOUT_14`, `LAYOUT_15`, `LAYOUT_16`
- `specs/authentication-and-access.md`: `AUTH_04`, `AUTH_08`, `AUTH_09`

**Iterative Bug-Fix Loop**

- Fix routing, breadcrumb, auth redirect, and panel-layout issues before scenario authoring work begins.
- Re-run browser verification until project management is stable and visually aligned with the style guide.

**Exit Criteria**

- The authenticated shell, route structure, project list, project creation, and project editing flows are complete.
- The app matches the desktop-first navigation model required by the specs.

## Phase 7: Scenario Authoring Workspace, Dependency Management, and Graph View

**Goal**

Implement the full scenario-management experience: list ordering, editing, status management, dependency selection, save/revert behavior, and read-only graph visualization.

**Implementation**

- Build the `Scenarios` workspace with:
  - left navigation panel
  - search input
  - sort-direction toggle
  - mode toggle between `Edit` and `Graph`
- Render scenario list rows ordered by execution order by default.
- Build scenario selection routing and blank-state behavior for no selected scenario.
- Implement the scenario editor with:
  - name
  - slug
  - draft/active status
  - execution instructions
  - scoring prompt
  - dependency selector
  - save button with dirty-state awareness
  - revert button restoring the last persisted state
- Make the dependency selector searchable using shared shadcn-style `Popover` plus `Command` or an equivalent combobox pattern.
- Enforce dependency validation from backend responses and surface useful inline errors.
- Add read-only React Flow graph mode that shows scenario nodes and dependency edges without direct graph editing.
- Ensure mode and selection state are URL-backed, including `?mode=edit` and `?mode=graph`.

**Unit Testing**

- Test editor dirty-state detection, save enablement, and revert behavior.
- Test dependency selector filtering and selected-value rendering.
- Test URL-mode synchronization.
- Test graph data transformation from ordered scenarios/dependencies into React Flow nodes and edges.
- Test handling of backend validation errors for cycles and invalid dependency selections.

**Verification Against This Plan**

- Confirm execution instructions and scoring prompts remain visibly distinct throughout the UI.
- Confirm graph mode is read-only and the list remains visible on the left.
- Confirm scenario list ordering still reflects execution order from the backend.

**Frontend Verification**

- Use Chrome DevTools MCP to:
  - create draft and active scenarios
  - edit names, slugs, instructions, and scoring prompts separately
  - assign valid dependencies
  - attempt invalid dependency setups and verify they are blocked
  - confirm save/revert behavior
  - confirm list sorting direction toggle
  - switch between edit and graph modes
  - refresh deep links and verify workspace state is preserved

**Specification Verification**

- `specs/frontend-application.md`: `FRONTEND_04`, `FRONTEND_06`, `FRONTEND_07`, `FRONTEND_08`, `FRONTEND_10`
- `specs/layout-and-navigation.md`: `LAYOUT_04`, `LAYOUT_05`, `LAYOUT_06`, `LAYOUT_08`, `LAYOUT_09`, `LAYOUT_11`, `LAYOUT_12`, `LAYOUT_13`, `LAYOUT_14`, `LAYOUT_15`
- `specs/scenario-authoring.md`: `AUTHORING_01` to `AUTHORING_10`

**Iterative Bug-Fix Loop**

- Fix ordering, validation, dirty-state, and URL-state bugs before starting run inspection work.
- Repeat frontend verification until the authoring flow is reliable without manual workaround steps.

**Exit Criteria**

- Scenario authoring is complete for v1, including dependency management and read-only graph viewing.
- The workspace can support real CLI execution without additional authoring capabilities.

## Phase 8: Runs Workspace, Run Details, and Execution-Result Inspection

**Goal**

Implement the run-history workspace and run-detail inspection UI so users can review past evaluations and drill into per-scenario outcomes.

**Implementation**

- Build the `Runs` workspace with:
  - left run list ordered by execution date
  - sort-direction toggle
  - selection routing by run id
  - blank state when no run is selected
- Use generated run name as the primary human-readable label everywhere in the UI.
- Build the run details workspace with:
  - second-tier left navigation panel
  - compact run summary
  - execution date
  - aggregated score when available
  - list of executed scenarios in execution order
- Display per-scenario result rows with:
  - scenario name or slug
  - score
  - failure indicator
  - indicator that the runner returned output where applicable
- Build the detailed scenario-result panel showing:
  - status
  - score
  - rationale
  - runner used
  - timestamps
  - failure detail
  - raw output
  - scenario snapshot used during execution
- Support URL query state for selected executed scenario within a run.
- Preserve blank-state behavior when a run is selected but no executed scenario is selected.

**Unit Testing**

- Test run sorting and selection behavior.
- Test aggregated score calculation and display rules.
- Test status-to-badge/icon mapping.
- Test executed-scenario selection through URL query state.
- Test rendering of missing-score, failed-run, and interrupted-run cases.

**Verification Against This Plan**

- Confirm run name, not raw id, is used as the primary human-readable label.
- Confirm the UI exposes the scenario snapshot that was executed, not only the current authored scenario.
- Confirm run and scenario-result lists are independently navigable and resizable as specified.

**Frontend Verification**

- Use Chrome DevTools MCP to:
  - inspect the runs list after creating multiple CLI runs
  - verify sort direction changes
  - open a run and inspect the run summary
  - select executed scenarios within the run
  - verify failure cases and interrupted runs render clearly
  - confirm the URL preserves run and executed-scenario selection state

**Specification Verification**

- `specs/frontend-application.md`: `FRONTEND_09`, `FRONTEND_10`
- `specs/layout-and-navigation.md`: `LAYOUT_02`, `LAYOUT_07`, `LAYOUT_10`, `LAYOUT_11`, `LAYOUT_12`, `LAYOUT_13`, `LAYOUT_14`, `LAYOUT_15`
- `specs/core-domain-model.md`: `DOMAIN_09`, `DOMAIN_10`
- `specs/data-and-storage.md`: `DATA_05`, `DATA_06`, `DATA_07`, `DATA_09`

**Iterative Bug-Fix Loop**

- Fix result-display ambiguities, URL-sync bugs, and summary-calculation issues before entering final hardening.
- Re-run CLI-to-web inspection flows until the run-history experience is stable.

**Exit Criteria**

- Users can inspect complete run history and drill into each scenario execution result from the web app.
- The web app accurately reflects results produced by the CLI.

## Phase 9: Hardening, Release Readiness, and Full-System Compliance Sweep

**Goal**

Close remaining quality gaps, prepare the CLI for publication, and perform a full end-to-end compliance pass against the entire specification set and this plan.

**Implementation**

- Review and tighten all error handling, empty states, loading states, and failure messaging across web, backend, and CLI.
- Add final package metadata for `packages/caracara`:
  - executable bin entry
  - files/export map
  - README usage
  - publish configuration
- Add release and local-development docs covering:
  - environment variables
  - Clerk setup
  - Convex setup
  - CLI login and run commands
  - npm publish flow for `caracara`
- Add or refine seed/demo data helpers if they materially reduce verification effort.
- Remove dead scaffolding and keep boundaries explicit.
- Ensure all new frontend work adheres to `STYLE_GUIDE.md` and uses shared shadcn primitives rather than a parallel design system.

**Unit Testing**

- Fill remaining test gaps discovered in earlier phases.
- Add regression tests for defects fixed during integration.
- Add package-level smoke tests for CLI build/install/command startup.

**Verification Against This Plan**

- Perform a line-by-line audit of every phase in this plan and confirm each exit criterion is met.
- Document any intentional deviation and verify it does not violate the specs.

**Frontend Verification**

- Run a full browser verification with Chrome DevTools MCP using the provided credentials:
  - sign in
  - create or open a project
  - create and edit scenarios
  - verify dependency graph mode
  - execute runs locally through the CLI
  - inspect runs and per-scenario results in the UI
  - verify breadcrumb and project switching behavior throughout

**Specification Verification**

- `specs/product-and-scope.md`: full-file audit
- `specs/core-domain-model.md`: full-file audit
- `specs/scenario-authoring.md`: full-file audit
- `specs/execution-and-scoring.md`: full-file audit
- `specs/api-contracts.md`: full-file audit
- `specs/authentication-and-access.md`: full-file audit
- `specs/data-and-storage.md`: full-file audit
- `specs/frontend-application.md`: full-file audit
- `specs/layout-and-navigation.md`: full-file audit
- `specs/monorepo-and-packages.md`: full-file audit

**Iterative Bug-Fix Loop**

- Treat this as the final convergence phase.
- If any spec deviation, browser bug, CLI bug, or contract mismatch remains, fix it immediately and rerun the relevant verification subset plus the affected regression tests.
- Do not stop on partial success.

**Exit Criteria**

- The hosted app, backend, and CLI work together end to end.
- The application satisfies the specs and this plan without requiring further user decisions.
- The CLI package is ready to publish to npm as `caracara`.

## Final Definition of Done

The work is complete only when all of the following are true:

1. The monorepo contains a functioning `apps/web`, `packages/ui`, `packages/contracts`, and `packages/caracara` implementation.
2. Clerk authentication works for both the web app and CLI OAuth flow.
3. Convex is the durable system of record for projects, scenarios, dependencies, runs, and scenario results.
4. The CLI can log in, fetch scenarios, run them through supported local runners, score them, and submit results incrementally.
5. The web app can create projects, author scenarios, inspect dependency graphs, and review runs and per-scenario results.
6. All relevant unit tests pass.
7. Lint, typecheck, and build pass across the workspace.
8. Browser verification through Chrome DevTools MCP passes for the full primary flow.
9. A final spec audit shows no unresolved deviations.
