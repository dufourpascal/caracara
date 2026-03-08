# Core Domain Model

### DOMAIN_01
A project is the top-level domain container and maps to a real code project.

In v1, a project represents a single real application or codebase under test. Scenarios, runs, results, and members all belong to that project, and the project is the main unit users create and operate in.

### DOMAIN_02
A user may belong to one or more projects.

Users authenticate through Clerk, but inside Caracara Score they participate as project members. In v1, membership is sufficient and no role system is required yet.

### DOMAIN_03
Projects have project-level configuration.

Each project stores shared configuration such as a name, slug, description, and a project-level prompt that acts as common context for scenario execution by being prepended or otherwise applied to each scenario run.

### DOMAIN_04
A scenario is the primary authored object.

A scenario represents one reusable evaluation task definition inside a project. It is the main object users create, edit, and execute.

### DOMAIN_05
A scenario contains separate execution and scoring content.

Each scenario includes instructions that tell the agent runner what to do and a scoring prompt that defines how the outcome should be evaluated.

### DOMAIN_06
A scenario may depend on other scenarios in the same project.

Dependencies define prerequisite execution order between scenarios and allow users to model setup steps, staged flows, and compound evaluations.

### DOMAIN_07
Scenario dependencies are explicit graph relationships.

Dependencies should be modeled as first-class relations between scenarios so the system can validate them, prevent cycles, and execute scenarios in a deterministic order.

### DOMAIN_08
A scenario has a stable identity and versioned content.

A scenario should keep a durable identifier across edits, while the actual authored content used for execution should be snapshotted or versioned so past runs remain trustworthy.

### DOMAIN_09
A run is a single execution event within a project.

A run captures the execution of one scenario or a group of scenarios against the project's application under test at a specific time and in a specific local environment. Each run stores both a durable identifier and a human-readable run name. In v1, the run name is generated with `unique-names-generator` using a single adjective plus a single bird in kebab-case, followed by a timestamp suffix, for example `pleasant-warbler-20260307-142530`.

### DOMAIN_10
Execution results are separate from scenario definitions.

Scenario definitions describe what should happen, while run results describe what did happen, including per-scenario outcomes, runner used, timestamps, execution summaries, scores, and any scoring rationale.
