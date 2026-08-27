# Data and Storage

### DATA_01

All persistent product data is stored in Convex.

Convex is the system of record for projects, scenarios, dependencies, runs, and submitted scenario results in v1.

### DATA_02

A project stores its core configuration as durable data.

Each project persists its name, slug, description, project-level prompt, ownership information, and any other configuration required to execute scenarios consistently.

### DATA_03

Scenarios are stored as first-class records under a project.

Each scenario persists its name, slug, status, instructions, ordered embedded evaluation checks, and project association.

### DATA_04

Scenario dependencies are stored as explicit relationship records.

Dependencies should be represented structurally in storage so the backend can validate them, order scenarios correctly, and prevent invalid graphs.

### DATA_05

Scenario content used during execution is preserved with run results.

When the CLI submits a scenario result, the backend stores the scenario data that was actually executed alongside that result so historical records remain accurate after later edits.

### DATA_06

Runs and per-scenario results are stored separately.

A run stores overall execution state, passed and total check counts, and the selected environment name plus target URL when supplied by the CLI. The project keeps the distinct run environment names as a compact summary for history filters. Each scenario result stores its status, check snapshot, evidenced verdicts, optional failure detail, and timing. The run also persists its generated human-readable name.

### DATA_07

Scenario result records are written incrementally.

The storage model must support creating a run and then attaching scenario results one by one as they are submitted by the CLI during execution.

### DATA_08

Project ownership is stored directly in the data model.

Because v1 projects are single-user only, each project should persist a single owner identity rather than a membership table or role matrix.

### DATA_09

Stored execution data is intentionally compact.

The primary durable execution output is the ordered check snapshot and one verdict plus evidence for every check. The run-level percentage is derived from persisted passed and total counts.

Failed-check screenshots live in Convex File Storage. A separate run-evidence record attaches each storage object to one owned project, run, scenario result, and check. It stores the content type, byte size, SHA-256 digest, and creation time, but never a reusable storage URL.

### DATA_11

Screenshot evidence follows the run lifecycle.

Run and project deletion remove screenshot objects before their attachment and result records. Restarted, interrupted, and failed scenario executions remove unused attachments. A daily paginated cleanup removes storage objects older than 24 hours that have no run-evidence record. Future file-storage features must register their storage IDs before sharing this cleanup job.

### DATA_10

Checks remain embedded in their parent documents.

Authored checks have no independent lifecycle, so scenarios store them as an array. Scenario results store an immutable copy and a result array keyed by check ID.

### DATA_12

Authored scenarios have one live copy.

CLI and web authoring overwrite the current scenario or phase record. The data model has no scenario-version, proposal, activation, audit, or undo tables. Existing scenario-result snapshots remain execution records and are not an authoring history.

### DATA_13

Suites store phase references and follow project lifecycle rules.

The `suites` table stores project ID, unique project-scoped slug, name, and phase IDs. Deleting a phase removes it from every suite membership; deleting a project deletes its suites. Deleting a suite does not affect phases or scenarios. Suite-targeted runs store the requested suite slug, resolved suite name, and selected phase IDs, names, and orders as immutable metadata. These run fields remain optional for runs created before suite support.
