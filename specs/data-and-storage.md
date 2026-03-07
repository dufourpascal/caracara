# Data and Storage

### DATA_01
All persistent product data is stored in Convex.

Convex is the system of record for projects, scenarios, dependencies, runs, and submitted scenario results in v1.

### DATA_02
A project stores its core configuration as durable data.

Each project persists its name, slug, description, project-level prompt, ownership information, and any other configuration required to execute scenarios consistently.

### DATA_03
Scenarios are stored as first-class records under a project.

Each scenario persists its name, slug, status, instructions, scoring prompt, and project association as durable authored data.

### DATA_04
Scenario dependencies are stored as explicit relationship records.

Dependencies should be represented structurally in storage so the backend can validate them, order scenarios correctly, and prevent invalid graphs.

### DATA_05
Scenario content used during execution is preserved with run results.

When the CLI submits a scenario result, the backend stores the scenario data that was actually executed alongside that result so historical records remain accurate after later edits.

### DATA_06
Runs and per-scenario results are stored separately.

A run record represents the overall execution event, while individual scenario result records capture each scenario's status, score, optional failure detail, and timing within that run. The run record must persist the generated human-readable run name alongside its durable identifier so the UI and CLI can refer to the same execution consistently.

### DATA_07
Scenario result records are written incrementally.

The storage model must support creating a run and then attaching scenario results one by one as they are submitted by the CLI during execution.

### DATA_08
Project ownership is stored directly in the data model.

Because v1 projects are single-user only, each project should persist a single owner identity rather than a membership table or role matrix.

### DATA_09
Stored execution data is intentionally compact.

The primary durable execution output is the scenario score, plus optional explanatory detail when the score is not perfect and the system needs to record what failed or did not meet quality expectations.

### DATA_10
The storage model should stay compatible with future expansion.

Even though v1 is single-user and relatively simple, the schema should avoid painting the product into a corner if later versions add collaboration, richer versioning, or more detailed evaluation artifacts.
