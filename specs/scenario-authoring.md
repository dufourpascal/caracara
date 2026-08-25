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
