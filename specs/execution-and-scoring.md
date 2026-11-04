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

In v1, the system supports the Codex CLI and Claude Code CLI as local execution backends, while keeping the scenario model independent from any one runner.

The local `.caracara/config.json` may pin the Codex model and reasoning effort for reproducible project runs. If either setting is absent, the Codex CLI resolves its own default.

### EXEC_06

Project-level prompt context is included in each scenario execution.

Each scenario run should include both project-level shared context and scenario-level instructions so execution remains consistent across scenarios within the same project.

### EXEC_07

Evaluation checks are executed in the same runner invocation as task instructions.

The runner receives the ordered authored checks and must return exactly one passed, failed, or blocked verdict with concrete browser evidence for every check. A blocked verdict includes one structured reason: `blocked_by_check`, `setup_incomplete`, `environment_failure`, or `tool_limit`. The runner retries only blocked checks once, using the current browser state, before returning their final verdicts. Historical `not_observed` verdicts remain readable for compatibility but are not emitted by current runners. It never returns a numeric score.

For API v3 Codex runs, every failed verdict also requires one visible-viewport WebP screenshot. Codex saves it to the check-specific path supplied by the CLI. The CLI validates the file and asks once more on the same Codex thread if the screenshot is missing. In that turn Codex either saves the screenshot or, as a last resort, returns a short reason no screenshot can show the failure, such as a screenshot tool that keeps failing. A check that still has no screenshot is recorded as evidence unavailable with that reason, or with a CLI-written reason when Codex gave none or the follow-up turn failed. The scenario still completes with its verdicts; a missing screenshot is never a runner failure.

### EXEC_08

Each executed scenario produces a structured result.

A scenario execution result captures status, timestamps, runner, an execution summary, the snapshotted checks, and one evidenced verdict per check. The enclosing run stores passed and total check counts plus its generated human-readable name.

Failed-check screenshots are stored as private attachments to the run, scenario result, and check. Local screenshot files are removed after the CLI reads them or the runner closes.

### EXEC_09

Execution failures must be represented explicitly.

The system distinguishes completed scenarios, runner failures, dependency failures, and interrupted executions. Failed checks are product findings and do not turn a completed scenario into an infrastructure failure.

The CLI handles `SIGINT` and `SIGTERM` as interrupted executions. It cancels the active local runner, reports any active scenario and enclosing run as interrupted, and only then exits with the conventional signal exit code.

By default the CLI keeps going after a runner failure: it skips only the scenarios that declare a dependency on the failed one, directly or through another skipped scenario, and records them as dependency failures. Dependencies never cross phases, so other scenarios in the phase and later phases still run in the same shared browser, starting from whatever state the failed scenario left. The CLI stops the whole run when the runner session is unusable (the runner could not start or its browser exited) when two phases in a row fail on their first scenario, or after three runner failures in a row, in each case with no scenario completing in between. `--no-keep-going` restores stopping after the first runner failure. Any runner failure still finalizes the run as failed.

### EXEC_10

Runs are reported back to the hosted service as durable records.

After local execution, the CLI submits the resulting run and per-scenario outputs back to the backend so users can inspect and compare results in the web app.

### EXEC_11

Caracara calculates the final pass rate.

For a completed run, the pass rate is `round(100 * passedCheckCount / totalCheckCount)`. Failed, blocked, and historical not-observed checks stay in the denominator. Failed or interrupted runs have no final pass rate.

### EXEC_12

The CLI reports local runner usage after each run.

The end-of-run summary includes aggregate and per-phase token usage and an estimated API-equivalent cost when the runner exposes enough information.

The CLI also submits each scenario's token usage with its result: input (including cached and cache-write input), cached input, cache-write input, output, and reasoning output tokens, plus a `complete` flag that is false when a runner turn did not report usage. A scenario that failed before the runner started reports zero usage. Dependency-failed scenarios report none. The cost estimate is not submitted. Run totals are the sum of the scenario usage and are computed when the run is read, so runs from older CLIs show no token usage.

`caracara results [run] [--json]` reads a finished or running run back from the hosted service. `run` is a run ID, the run name printed by `caracara run`, or `latest` (the default; with `--environment`, the latest run in that environment). The table output lists each scenario's phase, status, checks, duration, and tokens, followed by the checks that did not pass. `--json` prints a versioned report with run identity, status, environment, start and end, duration, model and reasoning effort when the run records them (otherwise `null`), token totals, and for each scenario its phase, status, timing, tokens, and every authored check with its verdict and reason (`null` when the scenario ended before evaluating it). The command exits 0 regardless of the run's outcome.

### EXEC_13

Each CLI run selects one named target environment.

The nearest `.caracara/config.json` maps arbitrary lowercase environment names to HTTP or HTTPS application URLs and may set a default. `--environment` overrides `CARACARA_ENVIRONMENT`, which overrides the saved default. The CLI opens its shared browser at the selected URL and treats that origin as authoritative for every scenario in the run.

The same config may set the default Codex `model` and `model_reasoning_effort`. `caracara run --model` and `--model-reasoning-effort` override them for one run and are rejected for the `claude-code` runner. The CLI validates the resolved values once, passes them to Codex and stores the same values on the run as `model` and `reasoningEffort`. These record the requested settings. When no model is configured, Codex uses its own default and the run records no model.

### EXEC_14

The CLI can execute one named suite.

`caracara run --suite <slug>` executes only active scenarios in the suite's phases. The backend validates and snapshots the suite while creating the run, before the CLI fetches the execution plan. If the suite's phases change in between, the CLI finalizes the run as interrupted and asks the user to run it again. The backend filters the existing ordered phase plan, so selected phases retain project order. `--suite` is mutually exclusive with `--scenario`, `--phase`, `--phases`, and `--through-phase`; an empty or otherwise non-runnable suite returns a specific error before a run is inserted.

### EXEC_15

The CLI can execute several phases as one run.

`caracara run --phases <list>` accepts phase numbers and ascending ranges such as `1-7,9,10`. A list with one phase uses the `phase` run mode; otherwise the run uses the `phases` mode and stores the sorted, unique `requestedPhaseOrders` (2 to 100 entries), which the backend validates. Every requested phase must exist. `--phases` is mutually exclusive with `--scenario`, `--suite`, `--phase`, and `--through-phase`.

### EXEC_16

The CLI reports progress while a run executes and summarizes it at the end.

When stdout and stderr are both interactive terminals outside CI, the CLI keeps a status panel at the bottom of stderr with the current phase and scenario, elapsed time and ETA, cumulative check verdicts, tokens and the agent's current step; other output scrolls above it on stdout. Otherwise (CI, redirected or piped output), or with `--plain`, it prints timestamped lines and a periodic heartbeat for a running scenario. `--quiet` prints only a compact summary and `--json` prints versioned JSON lines events, ending with `run.finished`. Agent steps are reduced to tool names or redacted, single-line command labels; arguments, outputs and reasoning text are never shown.

The end-of-run summary lists totals, per-phase rows, only the scenarios with failed or blocked checks, each failed or blocked check with its evidence and blocked reason, execution errors with the scenarios they skipped and a rerun command, duration, runner, model, tokens and the run's web app URL.

The CLI exits with 0 when every scenario ran, 1 when a CLI, configuration or API error stops the run, 2 when a scenario was recorded as a runner failure (including a completed result the API rejected, as before) or was skipped, 3 when `--fail-on` matches a failed or blocked check, and the conventional signal codes (130, 143) when interrupted. Failed checks alone never change the exit code. Earlier CLIs exited 0 after runner failures.
