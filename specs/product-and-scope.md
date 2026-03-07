# Product and Scope

### SCOPE_01
The product is a scenario-based evaluation system for locally deployed applications.

Caracara Score allows users to define structured scenarios that test an application running in a local environment, execute those scenarios through a local CLI, and capture the resulting scores and outputs in a central web application.

### SCOPE_02
The primary value of the product is repeatable evaluation of real application behavior.

Caracara Score is not just a prompt runner or chatbot wrapper; it is intended to help users repeatedly evaluate whether an application behaves correctly under defined conditions using consistent scenario definitions and scoring instructions.

### SCOPE_03
The product consists of two primary surfaces: a web app and a local CLI.

The web app is used to author, organize, version, and inspect scenarios and results, while the local `caracara` npm package is used to fetch scenarios, execute them against a locally running application, and return results.

### SCOPE_04
Scenarios are the core unit of evaluation.

Each scenario represents one testable behavior or task to be executed against a target application, including execution instructions, scoring guidance, and dependency information that determines how it fits into a broader evaluation flow.

### SCOPE_05
A scenario may depend on other scenarios.

Caracara Score supports ordered execution by allowing scenarios to declare dependencies on prerequisite scenarios that must run first, making it possible to model setup flows, staged workflows, and compound evaluations.

### SCOPE_06
Scenario execution is performed locally, not in the hosted platform.

The hosted system stores and serves scenario definitions, but the actual execution of scenarios occurs on the user's machine or in the user's own environment through the `caracara` CLI so it can interact directly with locally deployed applications.

### SCOPE_07
The product supports multiple local agent runners.

Caracara Score is designed to execute scenarios through supported local coding-agent CLIs, initially including Codex CLI and Claude Code CLI, with the product responsible for providing a consistent scenario model above those runners.

### SCOPE_08
Scoring is defined separately from execution instructions.

Each scenario contains instructions that tell the runner what to do, and a separate prompt that tells the runner or scoring layer how to evaluate the outcome, so task execution and judgment remain distinct concerns.

### SCOPE_09
The initial product is intended for technical users.

The first version is aimed at developers, AI engineers, QA engineers, and teams building local or self-hosted applications who are comfortable running local CLIs, managing environment setup, and interpreting structured evaluation results.

### SCOPE_10
The product is optimized for scenario management, not full test-environment orchestration.

Caracara Score is responsible for defining, sequencing, and evaluating scenarios, but not for provisioning infrastructure, deploying applications, or fully managing the target runtime environment in v1.

### SCOPE_11
The product stores scenario definitions and evaluation records as durable assets.

Users should be able to treat scenarios, prompts, dependencies, and run outcomes as persistent project artifacts that can be reviewed, updated, and reused over time rather than ephemeral one-off prompts.

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
The initial goal is trustworthy evaluation workflows, not perfect universal scoring.

Caracara Score aims to make AI-assisted application evaluation more structured and inspectable, but it does not guarantee objective truth for every scenario; instead, it provides a repeatable framework for defining how evaluation should happen.
