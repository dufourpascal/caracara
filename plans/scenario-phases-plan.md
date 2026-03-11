# Scenario Phase Management Plan

This document is the implementation plan for introducing phase-based scenario management across the Convex backend, Next.js frontend, and `caracara` CLI.

It reflects the current codebase as it exists today. It does not assume older aspirational plan items that are not yet implemented.

## Product Decisions Locked In

- Phases are first-class project-owned records.
- A phase has an internal numeric order and a user-visible name.
- Users do not edit phase numbers directly.
- Users reorder phases through drag and drop in the web UI.
- Phases have implicit linear dependencies through their order only.
- There is no explicit phase-to-phase dependency model.
- Scenario dependencies are only allowed within the same phase.
- A scenario may have no phase assigned.
- Unassigned scenarios remain editable and may still be run directly through the CLI with single-scenario mode.
- Unassigned scenarios do not participate in normal phase-based execution.
- Existing scenarios will not be migrated into a default phase.
- Removing a phase unassigns its scenarios.
- Since phase order is linear and implicit, removing a phase does not require explicit phase dependency cleanup.

## Current Baseline

The current implementation is phase-unaware:

- Scenarios are flat records in [apps/web/convex/schema.ts](/home/pascal/src/caracarascore/apps/web/convex/schema.ts).
- Scenario dependencies are project-wide edges in [apps/web/convex/schema.ts](/home/pascal/src/caracarascore/apps/web/convex/schema.ts).
- Execution order is a single topological sort in [apps/web/convex/domain.ts](/home/pascal/src/caracarascore/apps/web/convex/domain.ts).
- Ordered scenario delivery is flat in [apps/web/convex/lib.ts](/home/pascal/src/caracarascore/apps/web/convex/lib.ts) and [apps/web/convex/scenarios.ts](/home/pascal/src/caracarascore/apps/web/convex/scenarios.ts).
- CLI run targeting only supports `all` and `single` in [packages/contracts/src/domain.ts](/home/pascal/src/caracarascore/packages/contracts/src/domain.ts), [packages/caracara/src/bin/caracara.ts](/home/pascal/src/caracarascore/packages/caracara/src/bin/caracara.ts), and [packages/caracara/src/commands.ts](/home/pascal/src/caracarascore/packages/caracara/src/commands.ts).
- The web workspace only has `Scenarios`, `Runs`, and `Project` in [apps/web/components/project-workspace.tsx](/home/pascal/src/caracarascore/apps/web/components/project-workspace.tsx).
- The graph view is scenario-only in [apps/web/components/scenario-graph.tsx](/home/pascal/src/caracarascore/apps/web/components/scenario-graph.tsx) and [apps/web/lib/scenario-graph-layout.ts](/home/pascal/src/caracarascore/apps/web/lib/scenario-graph-layout.ts).

## Implementation Goals

1. Introduce ordered phases as a first-class authored object.
2. Make normal execution phase-aware and sequential from top to bottom.
3. Support CLI execution of:
   - a single scenario
   - a single phase
   - all phases through a selected phase
   - all runnable phases
4. Restrict scenario dependencies to scenarios within the same phase.
5. Add a dedicated phases management workspace in the web app.
6. Show phases as grouped sections in the scenario graph.
7. Preserve historical run clarity by storing phase information on run records and scenario results.

## Data Model Changes

### Convex schema

Add a new `phases` table in [apps/web/convex/schema.ts](/home/pascal/src/caracarascore/apps/web/convex/schema.ts):

- `projectId: v.id("projects")`
- `name: v.string()`
- `order: v.number()`
- `createdAt: v.number()`
- `updatedAt: v.number()`

Indexes:

- `by_project`
- `by_project_order`

Update `scenarios`:

- Add `phaseId` as optional during rollout.
- Final intended semantics: `phaseId` may be `null` or missing for unassigned scenarios.

Update `runs`:

- Replace the current coarse targeting shape with phase-aware run metadata.
- Recommended fields:
  - `mode: "all" | "single" | "phase" | "through_phase"`
  - `requestedScenarioSlug: string | null`
  - `requestedPhaseOrder: number | null`

Update `scenarioResults`:

- Add phase snapshot fields:
  - `phaseId: string | null`
  - `phaseName: string | null`
  - `phaseOrder: number | null`
- Keep `sequenceIndex` as the flat run-local execution order.

### Why `order` instead of user-edited number

The product requirement still needs an internal numeric phase sequence for execution and display. That sequence should be stored as an implementation field such as `order`, while the UI exposes drag-and-drop reordering instead of freeform numeric editing.

## Domain Logic Changes

### Phase-aware scenario validation

Extend the domain helper layer in [apps/web/convex/domain.ts](/home/pascal/src/caracarascore/apps/web/convex/domain.ts) and [apps/web/convex/lib.ts](/home/pascal/src/caracarascore/apps/web/convex/lib.ts) with:

- phase-aware scenario nodes
- phase lookup by scenario
- validation that both ends of a dependency belong to the same phase
- validation that unassigned scenarios cannot have dependencies
- per-phase topological ordering
- grouped execution plan generation

### Execution plan shape

Replace the current flat ordered list with a grouped execution plan:

- `project`
- `phases: Array<{ id, name, order, scenarios: OrderedScenario[] }>`
- `unassignedScenarioCount`

The helper should:

1. Load phases ordered by `order`.
2. Partition scenarios by assigned phase.
3. Exclude unassigned scenarios from normal runnable execution.
4. Validate dependencies within each phase only.
5. Topologically sort scenarios within each phase.
6. Return phases in ascending order.

### Phase deletion behavior

Removing a phase should:

1. Patch scenarios in that phase to `phaseId: null`.
2. Remove any dependency edges where either endpoint is now unassigned, because those edges are no longer valid under the same-phase rule.

This is scenario dependency cleanup, not phase dependency cleanup.

## Convex API Surface Changes

### New phase functions

Add `apps/web/convex/phases.ts` with:

- `listForProject`
- `create`
- `update`
- `reorder`
- `remove`

### Phase mutation rules

- `create` appends to the end by assigning the next highest `order`.
- `update` changes only the phase name.
- `reorder` accepts an ordered array of phase ids and rewrites `order` values densely.
- `remove` unassigns scenarios in that phase, deletes invalid dependency edges, then deletes the phase.

### Scenario function changes

Update [apps/web/convex/scenarios.ts](/home/pascal/src/caracarascore/apps/web/convex/scenarios.ts):

- `create` accepts optional `phaseId`.
- Default `phaseId` to the highest ordered phase in the project.
- `update` accepts `phaseId`.
- `getBySlug` returns:
  - phase metadata
  - same-phase dependency ids
  - warning state for unassigned scenarios
- `listForProject` returns:
  - phase metadata
  - warning state for unassigned scenarios
  - enough data for grouped graph rendering
- Replace `orderedActiveForProject` with a phase-aware runnable execution-plan query for the CLI.

### Run function changes

Update [apps/web/convex/runs.ts](/home/pascal/src/caracarascore/apps/web/convex/runs.ts):

- `create` accepts the new run target fields.
- `submitScenarioResult` and `startScenarioExecution` store the phase snapshot fields with each result.
- Run detail responses continue sorting by `sequenceIndex`, but include phase snapshot metadata so the UI can group results by phase later if desired.

## Shared Contracts Changes

Update [packages/contracts/src/domain.ts](/home/pascal/src/caracarascore/packages/contracts/src/domain.ts) and [packages/contracts/src/api.ts](/home/pascal/src/caracarascore/packages/contracts/src/api.ts):

- Add `phaseSchema`.
- Extend `scenarioSchema` with optional nullable phase metadata in API-facing shapes.
- Extend `orderedScenarioSchema` with:
  - `phaseId`
  - `phaseName`
  - `phaseOrder`
- Replace `runModeSchema = ["all", "single"]` with:
  - `["all", "single", "phase", "through_phase"]`
- Extend `runSchema` with `requestedPhaseOrder`.
- Extend `scenarioResultSchema` with phase snapshot fields.
- Add a grouped execution-plan response schema for normal CLI runs.
- Add a phase-list response schema for the web workspace if needed.

## CLI Changes

### Command surface

Update [packages/caracara/src/bin/caracara.ts](/home/pascal/src/caracarascore/packages/caracara/src/bin/caracara.ts) and [packages/caracara/src/types.ts](/home/pascal/src/caracarascore/packages/caracara/src/types.ts):

- keep `--scenario <slug>`
- add `--phase <number>`
- add `--through-phase <number>`
- reject invalid combinations:
  - `--scenario` with either phase flag
  - `--phase` with `--through-phase`

### API client changes

Update [packages/caracara/src/api.ts](/home/pascal/src/caracarascore/packages/caracara/src/api.ts):

- normal execution fetches grouped phase plans
- single-scenario execution still uses the single-scenario endpoint
- create-run payload includes the new mode and target metadata

### Run orchestration changes

Update [packages/caracara/src/commands.ts](/home/pascal/src/caracarascore/packages/caracara/src/commands.ts):

- `--scenario`:
  - fetch one scenario
  - allow execution even if `phaseId` is null
  - create run with `mode = "single"`
- `--phase N`:
  - fetch grouped execution plan
  - execute only phase `N`
  - create run with `mode = "phase"` and `requestedPhaseOrder = N`
- `--through-phase N`:
  - fetch grouped execution plan
  - execute phases `1..N`
  - create run with `mode = "through_phase"` and `requestedPhaseOrder = N`
- default:
  - execute all runnable phases in order
  - create run with `mode = "all"`

### Terminal output

Before the first scenario of each phase, print a clear separator such as:

```text
Phase 2: Metadata Management
```

Then continue with the existing per-scenario output.

### Failure handling

- In grouped execution modes, once a scenario fails:
  - remaining scenarios in the same phase become `dependency_failed`
  - all later phases in that run also become `dependency_failed`
- In `single` mode, only the selected scenario is affected.

This preserves the current “stop after first failure” semantics while making the phase boundary explicit.

## Next.js CLI API Route Changes

Update:

- [apps/web/app/api/v1/projects/[projectSlug]/scenarios/route.ts](/home/pascal/src/caracarascore/apps/web/app/api/v1/projects/[projectSlug]/scenarios/route.ts)
- [apps/web/app/api/v1/projects/[projectSlug]/scenarios/[scenarioSlug]/route.ts](/home/pascal/src/caracarascore/apps/web/app/api/v1/projects/[projectSlug]/scenarios/[scenarioSlug]/route.ts)
- [apps/web/lib/api-route.ts](/home/pascal/src/caracarascore/apps/web/lib/api-route.ts)

Changes:

- normal scenario retrieval route returns grouped phase execution plans for runnable scenarios
- single-scenario route still returns one scenario
- run creation route accepts the expanded mode and target fields

## Frontend Changes

### Workspace navigation

Update [apps/web/components/project-workspace.tsx](/home/pascal/src/caracarascore/apps/web/components/project-workspace.tsx):

- add `"phases"` to `WorkspaceKind`
- add a `/projects/[projectSlug]/phases` page
- include `Phases` in the workspace dropdown alongside `Scenarios`, `Runs`, and `Project`

This is intentionally a workspace at the same level as existing authored surfaces, matching your requirement.

### Phases workspace

Create a new dedicated panel inside `ProjectWorkspace`:

- left panel:
  - ordered phase list
  - create button
  - drag-and-drop reorder
- right panel:
  - phase editor for name
  - delete action
  - compact list of scenarios assigned to that phase

### Drag and drop

Use the shadcn-compatible drag-and-drop pattern rather than a bespoke interaction.

Implementation constraint:

- there is no drag-and-drop primitive currently in `packages/ui`
- the work should add the minimal shared component wrapper needed in `packages/ui` and use it from the web app
- do not build an isolated app-only drag system if a shared wrapper is practical

The drag action should reorder phases and persist through a dedicated `reorder` mutation.

### Scenario editor

Update the scenario editor in [apps/web/components/project-workspace.tsx](/home/pascal/src/caracarascore/apps/web/components/project-workspace.tsx):

- add a phase selector
- default to the latest phase on creation
- show an inline warning when no phase is assigned
- filter dependency candidates to the currently selected phase only
- disable dependency editing when the scenario has no phase selected

### Scenario list

Update the scenario list rows:

- show phase name or phase order badge when assigned
- show a warning icon when unassigned
- keep execution-order-based ordering for assigned scenarios
- place unassigned scenarios after grouped runnable scenarios, still searchable and editable

### Graph view

Rework [apps/web/lib/scenario-graph-layout.ts](/home/pascal/src/caracarascore/apps/web/lib/scenario-graph-layout.ts) and [apps/web/components/scenario-graph.tsx](/home/pascal/src/caracarascore/apps/web/components/scenario-graph.tsx):

- introduce phase groups as top-level vertical bands
- render phases from top to bottom
- render scenarios inside each phase group
- draw synthetic arrows between phase groups to communicate linear execution order
- draw scenario dependency edges only within a phase
- exclude unassigned scenarios from the grouped graph and show a warning summary outside the graph

### Run detail UI

The existing runs UI can remain mostly intact in the first pass. Small additions:

- show run target metadata for phase and through-phase runs
- optionally show phase labels on scenario results

## Routing Changes

Add:

- `/projects/[projectSlug]/phases`

No extra query-state is required for v1 phase management beyond the existing workspace routing approach.

## Migration and Rollout

Because the project has no meaningful production data yet, keep rollout simple:

1. Add `phases` table.
2. Add `phaseId` to scenarios as optional.
3. Do not create default phases for existing projects.
4. Existing scenarios remain unassigned.
5. Unassigned scenarios are editable and single-runnable, but excluded from normal phase execution.

This is intentionally not a data-preserving migration strategy for legacy runnable behavior.

## Testing Plan

### Convex unit tests

Update or add tests for:

- same-phase dependency validation
- rejection of cross-phase dependencies
- rejection of dependencies on unassigned scenarios
- grouped execution-plan ordering
- phase reorder logic
- phase removal behavior that unassigns scenarios and removes invalid edges

Targets:

- [apps/web/convex/domain.test.ts](/home/pascal/src/caracarascore/apps/web/convex/domain.test.ts)
- new tests for `phases.ts`
- focused helper tests in `lib.test.ts` if extraction is useful

### Graph layout tests

Update [apps/web/lib/scenario-graph-layout.test.ts](/home/pascal/src/caracarascore/apps/web/lib/scenario-graph-layout.test.ts):

- phases render top to bottom
- scenarios stay inside their phase group
- cross-phase scenario edges are impossible
- unassigned scenarios are excluded from grouped graph output

### Contract tests

Update [packages/contracts/src/index.test.ts](/home/pascal/src/caracarascore/packages/contracts/src/index.test.ts):

- new run modes
- phase-aware scenario payloads
- grouped execution-plan response parsing

### CLI tests

Add or update tests for:

- flag validation for `--scenario`, `--phase`, `--through-phase`
- create-run payloads for each mode
- grouped execution loops
- phase start terminal output
- direct run of unassigned scenarios

Targets:

- `packages/caracara/src/api.test.ts`
- `packages/caracara/src/execution.test.ts`
- new command-level tests if needed

## Implementation Sequence

1. Shared contracts:
   - add phase schemas
   - extend run and result contracts
   - add grouped execution-plan contracts
2. Convex schema and helpers:
   - add phases table
   - add scenario phase field
   - add grouped ordering and validation logic
3. Convex functions:
   - phases CRUD and reorder
   - scenario create/update/list/get updates
   - run create/result updates
4. Next.js API routes:
   - grouped plan delivery
   - expanded run creation payloads
5. CLI:
   - new flags
   - grouped execution
   - phase start output
6. Frontend:
   - phases workspace
   - scenario phase assignment and warnings
   - graph grouping
   - run metadata polish
7. Verification:
   - lint
   - typecheck
   - targeted tests

## Remaining Open Design Questions

There are no hard product blockers after your decisions. The remaining implementation choices are technical, not product-level:

- whether phase order is stored as dense integers `1..n` after every reorder or with sparse gaps and periodically normalized
- which shadcn-compatible drag-and-drop package is the cleanest fit for the current monorepo
- whether the runs detail screen should immediately group historical results by phase or defer that to a later polish pass

Recommended defaults:

- dense integer `order`
- minimal shared drag-and-drop wrapper in `packages/ui`
- phase labels in run details now, full grouped run-detail UI later
