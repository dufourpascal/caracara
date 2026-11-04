# CLI live status, run summary and multi-phase runs

Agreed design (discussion of 2026-11-04): live status panel in a TTY, timestamped lines elsewhere, `--plain`, `--quiet`, `--json`, a full end-of-run summary that lists only scenarios with failed or blocked checks, exit codes, and `--phases <list>` as one run. Mixing phases and single scenarios is out of scope.

## Scope

### 1. Multi-phase runs (contracts, Convex, API route, CLI)

- New run mode `phases` with `requestedPhaseOrders: number[]` (sorted, unique, positive, 2 to 100 entries). `requestedPhaseOrders` is `.nullable().optional()` in every schema, so stored runs without it still parse. `runs.create` validates it server-side too. Like the existing `phase` mode, only orders are stored.
- `--phases` parsing rejects `0`, empty tokens, descending ranges and lists over 100 phases before expanding.
  - `packages/contracts`: add `"phases"` to `runModeSchema`; add `requestedPhaseOrders` to `createRunRequestSchema` (nullable optional), `runSchema` (optional), `createRunResponseSchema.run` pick. Mode/target validation: `phases` requires `requestedPhaseOrders` and nothing else; every other mode rejects it.
  - `apps/web/convex/schema.ts` and `runs.create`: new literal and optional `requestedPhaseOrders` field; `lib.toRun` returns it (`null` when absent).
  - `apps/web/lib/api-route.ts`: pass it through.
- CLI `--phases <list>` accepts `1-7,9,10`: comma-separated integers and ascending ranges. Parsed to a sorted unique list. A list with one phase uses the existing `phase` mode. Mutually exclusive with `--scenario`, `--suite`, `--phase`, `--through-phase`. Every requested phase must exist; the error names the missing ones. Phases with no active scenarios are allowed as long as the whole queue is non-empty.
- `specs/execution-and-scoring.md`: new EXEC entry for `--phases`, keep-going, output modes and exit codes; EXEC_12 now says usage is part of the run summary.

### 2. Error handling across phases (`--keep-going`)

- Today a runner failure marks every later scenario `dependency_failed`.
- New: `--keep-going` / `--no-keep-going`. Default on when the queue covers more than one phase, off otherwise.
- With keep-going, after a runner failure in phase P the rest of phase P is skipped (`dependency_failed`, detail "Skipped after an execution error earlier in this phase."). Later phases run. (Dependencies across phases are already rejected by the backend, so no dependency-graph logic is needed.)
- Keep-going stops anyway (rest of the run skipped, as today) on session failures: `runner.startRun` throws, or the runner session reports itself unhealthy (`RunnerSession.isHealthy?()`, false once the shared Chromium has exited), or two phases in a row fail on their first scenario.
- Applies to every mode whose queue spans more than one phase (`all`, `through_phase`, `suite`, `phases`); EXEC_09 is updated.
- Without keep-going: unchanged behavior.
- The run is still finalized as `failed` when any scenario had a runner failure.
- Skipped scenarios now print a line (today nothing is printed).

### 3. Runner activity (current agent action)

- `CodexTurnOptions.onEvent?(event)`: `CodexThread.runProcess` forwards every `item.started`, `item.updated` and `item.completed` event. Existing handling is unchanged. Wired through the initial, blocked-retry and screenshot-correction turns.
- Tool calls are counted once per item ID. `command_execution`, `mcp_tool_call` and `web_search` set the current action when they start (or on completion if no start was seen); `reasoning` and `agent_message` only arrive completed and set "thinking"/"writing result". Every event refreshes "last event". Test fixtures follow the Codex 0.166 `exec --json` shapes.
- `RunnerScenarioInput.onActivity?(activity: { label: string })`: the Codex runner maps items to labels:
  - `mcp_tool_call` → `<server>.<tool>`
  - `command_execution` → `$ <command>`: the whole command is redacted with `redactSecretValues` first, then the `bash -lc '…'` wrapper is stripped, then the first line is taken and truncated to 80 chars. Control characters are removed.
  - Only the label leaves the runner: no raw Codex items, MCP arguments, reasoning text or outputs in panel, heartbeat or JSON.
  - `web_search` → `web search`, `file_change` → `editing files`, `reasoning` → `thinking`, `agent_message` → `writing result`
  - other item types are ignored.
- Claude Code runner uses `--output-format json` and reports no activity; the panel shows elapsed time and "no live activity for this runner".

### 4. Reporter (new `packages/caracara/src/run-reporter.ts`, `run-summary.ts`)

Every other stderr writer during a run (`cdp-proxy.ts`, Chromium output in `execution.ts`, interrupted-finalization errors) goes through a shared `writeDiagnostic()` that the live reporter hooks to clear and redraw the panel. The reporter is disposed (timer, listeners, panel cleared) in an outer `finally` before anything is rethrown. Output mode, streams and clock are injectable for tests; tests never get the live mode by accident.

The run loop in `commands.ts` stops writing directly; it calls a reporter with events:
`runStarted`, `phaseStarted`, `scenarioStarted`, `activity`, `scenarioFinished` (completed / runner_failed / skipped / interrupted, with check results, check names, duration, usage), `runFinished` (status, stats, exit code).

A pure `RunStats` builder (`run-summary.ts`) aggregates scenario outcomes into totals, per-phase rows and per-scenario rows, with failed and blocked check details (check name from the scenario snapshot, verdict, blockedReason, evidence). This shape is exported so `caracara results <run> --json` (parallel branch) can reuse it.

Output modes, chosen in `bin/caracara.ts` options:

| Mode | When | stdout | stderr |
|---|---|---|---|
| live | stderr is a TTY, `CI` unset, `TERM` != `dumb`, no `--plain/--quiet/--json` | scenario lines + summary | 3-line panel redrawn every second and on events |
| plain | not live, or `--plain` | timestamped lines + heartbeat + summary | — |
| quiet | `--quiet` / `-q` | compact summary (S2) only | errors |
| json | `--json` | JSON lines only | errors |

`--json` cannot be combined with `--quiet` or `--plain`.

- **Live panel** (stderr): line 1 phase name (k of K), scenario index/total and slug, progress bar and percent; line 2 elapsed, ETA, cumulative ✓/✗/⊘ checks, total tokens with cached share, error count; line 3 spinner, scenario elapsed, current action, tool call count, "last event Ns ago". Lines are truncated to the terminal width. Before any stdout write the panel is cleared and redrawn after. Cleared on finish and on interrupt. Colors only in live mode and only when `NO_COLOR` is unset; glyphs stay Unicode.
- **ETA**: mean duration of completed (not skipped) scenarios in this run × remaining scenarios; shown as `—` before the first completes. History-based ETA can follow once run stats exist server-side.
- **Plain**: `HH:MM:SS` prefix. Lines: run started (name, environment, runner/model, scenario count, web URL), phase started, scenario finished (`[i/N] slug 5/8 (2 failed, 1 blocked) 6m12s 1.9M tok`), errors, skips. Heartbeat while a scenario runs: every `--heartbeat <duration>` (default `5m`, `0` disables; accepts `30s`, `5m`, `1h`, or bare seconds), with elapsed, tool calls and the last action with its age.
- **JSON lines** (`"v":1`): `run.started`, `phase.started`, `scenario.started`, `agent.action`, `scenario.finished`, `run.finished` (status, exitCode, runUrl, stats). Timestamps as ISO strings.
- **Summary S1** (live and plain): header (run name and status, web URL, environment and target URL, runner/model/effort, selection, start → end and duration); totals (checks passed/failed/blocked of total with pass %, scenarios completed/errors/skipped/interrupted); tokens line (total, cached share, output, cost or `n/a`); per-phase table when the run has phases; scenario table only for scenarios with failed or blocked checks; failed checks (one line each: `scenario › check name  evidence`, evidence truncated to terminal width or 160 chars); blocked checks with a count per reason and `[reason]` per line; execution errors with the scenarios skipped because of them; a rerun hint for each errored scenario.
- **Summary S2** (`--quiet` only): status line with run name, duration, model and tokens; checks and scenario counts; one line per execution error; web URL.
- Web URL: `<apiBaseUrl>/projects/<projectSlug>/runs/<runId>` (the API is served by the web app).
- The existing `formatRunnerUsage` "Tokens: …" lines are replaced by the summary's tokens line.

### 5. Exit codes

- `0`: every scenario ran (failed checks don't change it)
- `1`: CLI, configuration or API error (unchanged)
- `2`: at least one runner failure or skipped scenario
- `3`: `--fail-on <verdicts>` (`failed`, `blocked`, or `failed,blocked`) matched at least one check and no exit 2 condition
- `130`/`143`: interrupts (unchanged)
- Precedence: signal > 1 (thrown error, including API and finalization errors) > 2 > 3 > 0. `process.exitCode` only, never `process.exit()`. The summary (and JSON `run.finished` with `exitCode`) is written after finalization and before any rethrow, whenever a run was created.
- Exit 2 on runner failures is a behaviour change (today it exits 0); recorded in the spec and PR.

## Out of scope

Mixing phases and scenarios in one run, a phase snapshot on the run record, narrowing the runner catch around evidence upload (upload failures stay scenario failures, as today), waiting on other runs, pausing between phases, history-based ETA, web UI changes for the new mode (the run list shows no phase badge for `phase`/`through_phase` today either), Claude stream-json activity.

## Tests

- contracts: `phases` mode validation.
- CLI: `--phases` parsing and selector conflicts; keep-going skip logic (unit-tested via an exported pure function deciding skip per scenario); stats builder; S1/S2 rendering; plain lines and heartbeat formatting; JSON event shapes; exit code resolution; Codex activity label mapping; `runCommand` integration with mocked API/runner (existing `run-interruption.test.ts` pattern) for exit code 2, keep-going default and summary output.
- Validation: `pnpm lint`, `pnpm typecheck`, `pnpm test` (sequential, not alongside `pnpm build`), `pnpm build`. DEV check (no live runs): a scripted render of live/plain/json output from a recorded event sequence, plus `caracara run --help`.
