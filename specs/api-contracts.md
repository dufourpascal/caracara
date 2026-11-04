# API Contracts

### API_01

The hosted service exposes APIs for project retrieval, scenario retrieval, run creation, and incremental result submission.

The API surface in v1 should cover the minimum integration path needed by the web app and CLI: reading project and scenario definitions, starting runs, and reporting scenario outcomes back as execution progresses. Run creation responses should include the generated human-readable run name so clients can display it immediately.

### API_02

The `caracara` CLI authenticates through an OAuth 2.0 authorization flow.

The CLI should initiate login, send the user through browser-based authentication with Clerk, receive an OAuth access token, and then call the API using `Authorization: Bearer <token>`.

### API_03

All CLI API access is project-scoped.

The CLI must fetch and submit data within the context of a specific project, and APIs must not allow scenario access or run submission outside that project boundary.

### API_04

The API supports fetching either the ordered active scenario list or a single scenario by slug.

The CLI should be able to retrieve the full ordered set of runnable scenarios for normal execution, or directly fetch one specific scenario when the user invokes single-scenario mode.

### API_05

The backend is responsible for dependency resolution and ordered scenario delivery.

The CLI should not need to understand or resolve the dependency graph itself. For normal execution, the API should return scenarios in the exact order they must be executed.

### API_06

Scenario responses include project-level execution context.

When the CLI retrieves scenarios, the response includes project context, instructions, and ordered evaluation checks.

### API_07

Scenario start snapshots the data that will be executed.

The start request includes scenario identity, instructions, phase metadata, and checks. Result submission sends scenario ID, status, check results, summary or failure detail, and finish time. The backend validates result IDs against the stored snapshot.

API v3 run creation snapshots an evidence policy and returns the authenticated Convex HTTP-action URL for screenshot uploads. The CLI uploads each failed-check screenshot after scenario start and before result submission. The backend rejects a completed Codex result under the screenshot policy unless every failed check has exactly one attached image, or none plus an `evidenceUnavailableReason` (1 to 500 characters). A stored screenshot for a check that carries a reason is removed, and only failed checks may carry a reason. Results outside the screenshot policy cannot carry a reason.

### API_08

Scenario results are submitted incrementally.

The CLI should report each scenario result back to the hosted service immediately after that scenario finishes or errors rather than waiting for the full run to complete.

Run finalization includes a per-execution attempt ID. The backend may correct a completed or failed run to interrupted only when the correction carries the same attempt ID as the request that finalized it, covering a signal race without allowing unrelated stale clients to rewrite terminal runs. Scenario start similarly includes a per-execution attempt ID. An interrupted finalization may identify the active scenario-result record and matching attempt ID so the same transaction can correct a terminal result whose response was lost during cancellation without trusting a result ID alone.

Run creation accepts a client-generated attempt ID and is idempotent for that project and attempt. A bounded recovery request may also carry an interruption timestamp; the creation mutation then atomically creates the run as interrupted or interrupts the matching running run. A lost recovery response therefore cannot leave a duplicate or stuck running run behind.

### API_09

API contracts are versioned and require the most recent supported client version.

Older CLI versions should fail fast when they are no longer compatible so users can upgrade to the newest published version instead of continuing with undefined behavior.

The service supports only HTTP namespace v3, API version 3, and CLI version 0.3.0 or newer. Older namespaces and clients are rejected.

### API_10

The API distinguishes contract errors from execution outcomes.

Contract responses should clearly separate malformed requests, authentication failures, authorization failures, missing resources, and accepted result submissions that contain failed scenario executions as normal product data.

### API_11

API v3 exposes one narrow authoring operation endpoint.

`POST /api/v3/projects/:projectSlug/authoring` accepts a discriminated request for one of the twelve supported CLI authoring operations. It uses the existing bearer token, CLI version header, project ownership checks, validation limits, and structured error format. Writes apply immediately, including while a project run is running; that run keeps executing the definitions it fetched when it started.

### API_12

Run creation may include a target environment snapshot.

The environment name and target URL must be supplied together. The backend validates the name and safe HTTP or HTTPS URL, then stores both on the run. Older clients may omit both and create an untracked run.

Run creation may also include the Codex `model` and `reasoningEffort` the run uses. Both are optional and only accepted for Codex runs. The backend stores them as given (model: printable ASCII without spaces, up to 100 characters; reasoning effort: a short lowercase token, so newer CLI effort levels don't fail run creation). A run-creation retry with the same creation attempt ID must send the same model settings as the stored run, unless the stored run has none. Run responses return both fields, `null` when not recorded.

### API_13

The execution API supports suite filtering without suite authoring operations.

`GET /api/v3/projects/:projectSlug/scenarios?suite=:suiteSlug` returns the normal execution-plan shape filtered to the suite's phases and includes the resolved suite name and slug. Run creation accepts suite mode with a mutually exclusive requested suite slug. In one Convex mutation, the server resolves the suite, rejects a non-runnable suite, stores its name, slug, and selected phase snapshots, and creates the running run. The CLI fetches the suite's execution plan before creating the run, for the fixture preflight, and fetches it again after creation. It refuses to execute (finalizing the run as interrupted) when that plan's suite phases differ from the run's phase snapshot, because authoring stays open in between. There are no suite authoring REST operations.

### API_14

The CLI can read a run's results back.

`GET /api/v3/projects/:projectSlug/runs/:runRef` returns the run and its ordered scenario results, including check snapshots, verdicts, timing, and token usage, but not the owner ID or execution instructions. `runRef` is a run ID, an exact run name, or `latest`, the most recently started run of the project. With `latest`, an optional `?environment=` filter selects the latest run in that environment. A run outside the owned project, or no match, returns `not_found`. A name shared by several runs returns `conflict`. Result submission accepts an optional `tokenUsage` object, which older CLIs omit.

### API_15

The API exposes fixtures for execution and authoring.

`GET /api/v3/projects/:projectSlug/fixtures` returns the project's fixture definitions. The execution plan and single-scenario responses add `fixtureRequirements` (merged per DOMAIN_14) to each scenario and a top-level `fixtures` list with the definitions those scenarios require; both default to empty for older servers. The authoring endpoint accepts `createFixture`, `updateFixture` (partial; given step and check arrays replace the stored ones and may omit IDs), `requireFixture` (exactly one `phaseId` or `scenarioId`, access, and a scope only for `mutates`; it replaces an existing requirement for that target), and `unrequireFixture`. Run creation accepts an optional `fixturePreflight` array (up to 100 entries), which run responses return. Older CLIs ignore all fixture fields.
