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

When the CLI retrieves scenarios, the response must include enough information to compose execution inputs correctly, including project-level prompt data and the scenario fields needed for execution and scoring.

### API_07
Run result submission includes the scenario data that was actually executed.

Instead of relying on backend version lookups, each submitted scenario result should attach the scenario content used during execution so historical run records remain accurate even if the scenario is edited later.

### API_08
Scenario results are submitted incrementally.

The CLI should report each scenario result back to the hosted service immediately after that scenario finishes or errors rather than waiting for the full run to complete.

### API_09
API contracts are versioned and require the most recent supported client version.

Older CLI versions should fail fast when they are no longer compatible so users can upgrade to the newest published version instead of continuing with undefined behavior.

### API_10
The API distinguishes contract errors from execution outcomes.

Contract responses should clearly separate malformed requests, authentication failures, authorization failures, missing resources, and accepted result submissions that contain failed scenario executions as normal product data.
