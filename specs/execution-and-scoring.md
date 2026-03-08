# Execution and Scoring

### EXEC_01
Scenario execution is initiated locally through the `caracara` CLI.

The hosted platform stores definitions and receives results, but the actual execution process begins on the user's machine through the published npm package.

### EXEC_02
The CLI fetches scenario definitions from the hosted service before execution.

The local runner should retrieve the current project and scenario data needed for execution rather than relying on locally copied scenario files.

### EXEC_03
Normal execution resolves and runs scenario dependencies first.

When a user runs a scenario in normal mode, all declared dependencies must be resolved and executed in valid order before the requested scenario is executed.

### EXEC_04
The CLI also supports direct single-scenario execution.

A user may execute a specific scenario by slug through the CLI, and this mode runs only the specified scenario without expanding or executing its dependencies.

### EXEC_05
Execution is performed through supported local agent runners.

In v1, the system supports Codex CLI and Claude Code CLI as local execution backends, while keeping the scenario model independent from any one runner.

### EXEC_06
Project-level prompt context is included in each scenario execution.

Each scenario run should include both project-level shared context and scenario-level instructions so execution remains consistent across scenarios within the same project.

### EXEC_07
Scoring prompt context is executed in the same runner invocation as task instructions.

The scoring prompt is still authored and stored separately from scenario instructions, but the local runner receives both in a single invocation so it can gather the evidence needed for evaluation while executing the scenario.

### EXEC_08
Each executed scenario produces a structured result.

A scenario execution result should capture status, timestamps, runner used, an execution summary, score, and any available scoring rationale or evaluation details. The enclosing run record should also include a generated human-readable run name built with `unique-names-generator` using one adjective and one animal, plus a timestamp suffix at the end.

### EXEC_09
Execution failures must be represented explicitly.

The system should distinguish successful runs, scoring failures, runner invocation failures, dependency failures, and interrupted executions so users can understand what went wrong.

### EXEC_10
Runs are reported back to the hosted service as durable records.

After local execution, the CLI submits the resulting run and per-scenario outputs back to the backend so users can inspect and compare results in the web app.
