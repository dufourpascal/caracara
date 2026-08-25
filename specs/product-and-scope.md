# Product and Scope

### SCOPE_01
The product is a scenario-based evaluation system for locally deployed applications.

Caracara Score lets users define structured scenarios and checks, execute them through a local CLI, and inspect evidenced verdicts plus a derived pass rate in the web app.

### SCOPE_02
The primary value of the product is repeatable evaluation of real application behavior.

Caracara Score repeatedly evaluates whether an application behaves correctly under concrete, stable checks.

### SCOPE_03
The product consists of two primary surfaces: a web app and a local CLI.

The web app is used to author, organize, version, and inspect scenarios and results, while the local `caracara` npm package is used to fetch scenarios, execute them against a locally running application, and return results.

### SCOPE_04
Scenarios are the core unit of evaluation.

Each scenario represents one testable behavior with execution instructions, ordered evaluation checks, and dependency information.

### SCOPE_05
A scenario may depend on other scenarios.

Caracara Score supports ordered execution by allowing scenarios to declare dependencies on prerequisite scenarios that must run first, making it possible to model setup flows, staged workflows, and compound evaluations.

### SCOPE_06
Scenario execution is performed locally, not in the hosted platform.

The hosted system stores and serves scenario definitions, but the actual execution of scenarios occurs on the user's machine or in the user's own environment through the `caracara` CLI so it can interact directly with locally deployed applications.

### SCOPE_07
The product supports multiple local agent runners.

Caracara Score executes scenarios through supported local coding-agent backends, initially including the Codex SDK and Claude Code CLI, while keeping one consistent scenario model above both runners.

### SCOPE_08
Evaluation checks are defined separately from execution instructions.

Each scenario contains instructions that tell the runner what to do and concrete checks that define observable pass conditions. The runner returns evidence and verdicts, while Caracara calculates the pass rate.

### SCOPE_09
The initial product is intended for technical users.

The first version is aimed at developers, AI engineers, QA engineers, and teams building local or self-hosted applications who are comfortable running local CLIs, managing environment setup, and interpreting structured evaluation results.

### SCOPE_10
The product is optimized for scenario management, not full test-environment orchestration.

Caracara Score is responsible for defining, sequencing, and evaluating scenarios, but not for provisioning infrastructure, deploying applications, or fully managing the target runtime environment in v1.

### SCOPE_11
The product stores scenario definitions and evaluation records as durable assets.

Users can treat scenarios, checks, dependencies, and run outcomes as persistent project artifacts.

### SCOPE_12
The initial version focuses on human-authored scenarios.

In v1, scenarios are explicitly created and edited by users in the web app rather than automatically generated from codebases, logs, or documentation, though future versions may add assisted generation.

### SCOPE_13
The initial version focuses on single-tenant execution ownership per user or workspace.

A user or workspace defines the scenarios and initiates local runs using its own credentials and environment; cross-org execution sharing, public marketplaces, and third-party hosted runners are out of scope for the first release.

### SCOPE_14
The product is not a generic CI system in v1.

Although scenario runs may later integrate with automation pipelines, the first version is centered on user-triggered local execution and result reporting rather than broad CI/CD orchestration.

### SCOPE_15
The initial goal is trustworthy evaluation workflows, not model-generated scoring.

The agent still judges each check from browser evidence, but it cannot choose the numeric result. The same stored verdicts always produce the same pass rate.
