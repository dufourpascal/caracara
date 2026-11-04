# Scenario Authoring

### AUTHORING_01

Scenarios are created and edited inside a project.

Users author scenarios within the context of a single project, and every scenario belongs to exactly one project.

### AUTHORING_02

A scenario requires both a name and a slug.

The name is the primary human-readable label used in the web app, while the slug is a CLI-friendly identifier that can be used when a user wants to run a single scenario through the `caracara` CLI. In v1, the slug does not need to be permanently stable across edits.

### AUTHORING_03

A scenario requires execution instructions and evaluation checks.

Draft scenarios may have no checks. An active scenario requires 1 to 20 ordered checks. Each check has a stable ID, short name, and observable expectation.

### AUTHORING_04

A scenario may include dependencies on other scenarios in the same project.

Authors can attach prerequisite scenarios so execution order is explicit and more complex evaluation flows can be built from smaller scenario units.

### AUTHORING_05

Scenario authoring must validate dependency correctness.

The system should prevent invalid self-dependencies, cycles, and references to scenarios outside the current project.

### AUTHORING_06

Scenario instructions and evaluation checks are edited separately.

The authoring interface separates the user flow from the observable conditions the frontend must satisfy. Users can add, edit, delete, and reorder checks without changing their stable IDs.

### AUTHORING_07

Scenario authoring uses project-level prompt context automatically.

Authors define scenario instructions and checks, while shared project context comes from project configuration.

### AUTHORING_08

A scenario has an explicit draft or active status.

Draft scenarios may be incomplete or still under construction, while active scenarios are intended to be runnable and available for normal execution flows.

### AUTHORING_09

Normal execution must respect dependencies, but single-scenario execution is also supported.

In normal mode, a scenario's dependencies must run fully before the scenario itself can run. In addition, the `caracara` CLI should support executing only one selected scenario directly, even when invoked outside a full dependency-driven run flow.

### AUTHORING_10

Scenario edits should preserve historical execution integrity.

When a scenario is changed, the system must ensure past runs still reference the exact scenario content that was executed at that time so scenario definitions remain maintainable durable assets.

### AUTHORING_11

The CLI exposes twelve narrow authoring commands.

The supported mutations are `addPhase`, `editPhase`, `removePhase`, `createScenario`, `updateScenario`, `addCheck`, `removeCheck`, `updateCheck`, `createFixture`, `updateFixture`, `requireFixture`, and `unrequireFixture`. They update live records directly and return structured results. The CLI does not expose a generic patch or scenario deletion command.

### AUTHORING_12

CLI authoring does not add a version or review workflow.

Commands do not create proposals, authored versions, delayed activations, or undo records. The existing scenario `draft` status still describes whether a live scenario is runnable; it is not an authoring proposal.

### AUTHORING_13

Authoring stays open while a project run is running, and edits never change a running run.

Phase, scenario, check, suite, and project prompt writes apply immediately, also while the project has a running run. The CLI fetches the execution plan, including the project prompt, once when the run starts and executes only that copy. Each scenario result stores the scenario name, slug, phase, instructions, and checks it was executed and scored against, so verdict validation and run results never read the live definitions. Edits made during a run therefore apply to later runs only, which also means an evaluation agent cannot change the requirements of the run it is part of.

Writes that would cut a running run off from its project stay blocked while it runs, on both web and CLI callers: deleting a scenario, changing the project slug, and deleting the project.

### AUTHORING_14

Suite authoring is frontend-only and direct.

The frontend supports direct suite create, update, and delete operations using a name, slug, and phase membership checkboxes. Suite writes stay open during runs like other authoring writes. These operations are intentionally absent from the CLI authoring API.

### AUTHORING_15

Fixtures are authored on the web and through the CLI.

The web Fixtures workspace edits every fixture field and its requirements and deletes fixtures. The CLI creates and updates fixtures (steps and checks as whole JSON arrays) and adds or removes requirements; it does not delete fixtures. Fixture writes stay open during runs: a run uses the definitions it fetched with its plan.
