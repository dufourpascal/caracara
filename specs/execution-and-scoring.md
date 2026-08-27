# Execution and evaluation checks

### EXEC_01

Scenario execution is initiated locally through the `caracara` CLI.

The hosted platform stores definitions and receives results, but the actual execution process begins on the user's machine through the published npm package.

### EXEC_02

The CLI fetches scenario definitions from the hosted service before execution.

The local runner should retrieve the current project and scenario data needed for execution rather than relying on locally copied scenario files.

### EXEC_03

Normal execution resolves and runs scenario dependencies first.

When a user runs a scenario in normal mode, all declared dependencies must be resolved and executed in valid order before the requested scenario is executed.

### EXEC_03A

Scenarios in the same local run share browser session state when the runner supports browser automation.

The CLI starts one run-scoped Chromium process and exposes it to the agent through Chrome DevTools MCP. Later scenarios reuse its authenticated state. Caracara does not use Playwright.

### EXEC_04

The CLI also supports direct single-scenario execution.

A user may execute a specific scenario by slug through the CLI, and this mode runs only the specified scenario without expanding or executing its dependencies.

### EXEC_05

Execution is performed through supported local agent runners.

In v1, the system supports the Codex SDK and Claude Code CLI as local execution backends, while keeping the scenario model independent from any one runner.

The local `.caracara/config.json` may pin the Codex model and reasoning effort for reproducible project runs. If either setting is absent, the Codex SDK resolves its own default.

### EXEC_06

Project-level prompt context is included in each scenario execution.

Each scenario run should include both project-level shared context and scenario-level instructions so execution remains consistent across scenarios within the same project.

### EXEC_07

Evaluation checks are executed in the same runner invocation as task instructions.

The runner receives the ordered authored checks and must return exactly one passed, failed, or not-observed verdict with concrete browser evidence for every check. It never returns a numeric score.

For API v3 Codex runs, every failed verdict also requires one visible-viewport WebP screenshot. Codex saves it to the check-specific path supplied by the CLI. The CLI validates the file and asks once more on the same SDK thread if the screenshot is missing. A second miss is a runner failure.

### EXEC_08

Each executed scenario produces a structured result.

A scenario execution result captures status, timestamps, runner, an execution summary, the snapshotted checks, and one evidenced verdict per check. The enclosing run stores passed and total check counts plus its generated human-readable name.

Failed-check screenshots are stored as private attachments to the run, scenario result, and check. Local screenshot files are removed after the CLI reads them or the runner closes.

### EXEC_09

Execution failures must be represented explicitly.

The system distinguishes completed scenarios, runner failures, dependency failures, and interrupted executions. Failed checks are product findings and do not turn a completed scenario into an infrastructure failure.

The CLI handles `SIGINT` and `SIGTERM` as interrupted executions. It cancels the active local runner, reports any active scenario and enclosing run as interrupted, and only then exits with the conventional signal exit code.

### EXEC_10

Runs are reported back to the hosted service as durable records.

After local execution, the CLI submits the resulting run and per-scenario outputs back to the backend so users can inspect and compare results in the web app.

### EXEC_11

Caracara calculates the final pass rate.

For a completed run, the pass rate is `round(100 * passedCheckCount / totalCheckCount)`. Failed and not-observed checks stay in the denominator. Failed or interrupted runs have no final pass rate.

### EXEC_12

The CLI reports local runner usage after each run.

The report includes aggregate token usage and an estimated API-equivalent cost when the runner exposes enough information. Caracara does not submit or persist this usage report.

### EXEC_13

Each CLI run selects one named target environment.

The nearest `.caracara/config.json` maps arbitrary lowercase environment names to HTTP or HTTPS application URLs and may set a default. `--environment` overrides `CARACARA_ENVIRONMENT`, which overrides the saved default. The CLI opens its shared browser at the selected URL and treats that origin as authoritative for every scenario in the run.

### EXEC_14

The CLI can execute one named suite.

`caracara run --suite <slug>` executes only active scenarios in the suite's phases. The backend validates and snapshots the suite while creating the run, which locks authoring before the CLI fetches the execution plan. The backend filters the existing ordered phase plan, so selected phases retain project order. `--suite` is mutually exclusive with `--scenario`, `--phase`, and `--through-phase`; an empty or otherwise non-runnable suite returns a specific error before a run is inserted.
