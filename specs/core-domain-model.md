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

A scenario contains execution instructions and evaluation checks.

Each check has a stable ID, name, and observable expectation. Array order is execution and display order.

### DOMAIN_06

A scenario may depend on other scenarios in the same project.

Dependencies define prerequisite execution order between scenarios and allow users to model setup steps, staged flows, and compound evaluations.

### DOMAIN_07

Scenario dependencies are explicit graph relationships.

Dependencies should be modeled as first-class relations between scenarios so the system can validate them, prevent cycles, and execute scenarios in a deterministic order.

### DOMAIN_08

A scenario has a stable identity and mutable content.

A scenario keeps its durable identifier and is updated in place. Caracara does not store authored scenario versions. Scenario results retain the instructions and checks used for that execution so past runs remain intelligible after later edits.

### DOMAIN_09

A run is a single execution event within a project.

A run captures the execution of one scenario or a group of scenarios against the project's application under test at a specific time and in a specific target environment. New runs snapshot the CLI-selected environment name and target URL so history remains accurate after local configuration changes. Runs created before environment tracking remain valid without that snapshot. Each run stores both a durable identifier and a human-readable run name. In v1, the run name is generated with `unique-names-generator` using a single adjective plus a single bird in kebab-case, followed by a timestamp suffix, for example `pleasant-warbler-20260307-142530`.

### DOMAIN_10

Execution results are separate from scenario definitions.

Scenario definitions describe what should happen. Results store the exact check snapshot, runner, timestamps, execution summary, and an evidenced verdict for each check. Caracara derives the run pass rate from those verdicts.

### DOMAIN_11

A suite is a project-owned phase collection.

A suite has a name, slug, and unordered set of phase IDs. A phase may belong to multiple suites. Suite execution follows the project's current phase order. Suites do not own phases or scenarios and may be empty.

### DOMAIN_12

Suite-targeted runs preserve their target identity.

When a run targets a suite, the run snapshots the suite name, slug, and each selected phase's ID, name, and order so history remains intelligible after the suite or its phases change or are deleted.
