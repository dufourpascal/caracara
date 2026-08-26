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

API v3 run creation snapshots an evidence policy and returns the authenticated Convex HTTP-action URL for screenshot uploads. The CLI uploads each failed-check screenshot after scenario start and before result submission. The backend rejects a completed Codex result under the screenshot policy unless every failed check has exactly one attached image.

### API_08
Scenario results are submitted incrementally.

The CLI should report each scenario result back to the hosted service immediately after that scenario finishes or errors rather than waiting for the full run to complete.

### API_09
API contracts are versioned and require the most recent supported client version.

Older CLI versions should fail fast when they are no longer compatible so users can upgrade to the newest published version instead of continuing with undefined behavior.

The service supports only HTTP namespace v3, API version 3, and CLI version 0.3.0 or newer. Older namespaces and clients are rejected.

### API_10
The API distinguishes contract errors from execution outcomes.

Contract responses should clearly separate malformed requests, authentication failures, authorization failures, missing resources, and accepted result submissions that contain failed scenario executions as normal product data.

### API_11
API v3 exposes one narrow authoring operation endpoint.

`POST /api/v3/projects/:projectSlug/authoring` accepts a discriminated request for one of the eight supported CLI authoring operations. It uses the existing bearer token, CLI version header, project ownership checks, validation limits, and structured error format. A running-run authoring lock returns `conflict` rather than queuing the write.

### API_12
Run creation may include a target environment snapshot.

The environment name and target URL must be supplied together. The backend validates the name and safe HTTP or HTTPS URL, then stores both on the run. Older clients may omit both and create an untracked run.
