# Layout and Navigation

### LAYOUT_01
The login screen uses Clerk's prebuilt authentication components.

Unauthenticated users are shown a dedicated login page built with Clerk components rather than a custom login form. The page should focus only on authentication and should not include product management UI such as project navigation, scenario lists, or run views.

### LAYOUT_02
The authenticated application uses a single top navbar with fixed left and right anchors.

The logo is placed on the far left of the navbar. The user avatar is placed on the far right. Between them, the navbar contains breadcrumb navigation in this exact structure when applicable: `logo / [project-slug] / [scenario | run] / [scenario-id | run-name]`. The breadcrumb length is dynamic and reflects the current route. When no scenario or run is selected, the breadcrumb stops at `... / scenarios` or `... / runs`. When the breadcrumb refers to a run, the human-readable run name should be the generated `unique-names-generator` adjective-animal label with the timestamp suffix rather than the raw run identifier.

### LAYOUT_03
Clicking the project breadcrumb opens the project switcher.

When the user clicks the `[project-slug]` breadcrumb item in the navbar, the UI opens a shadcn dropdown menu containing the list of projects. The last option in that list is always `+ Create New Project`, and selecting it navigates to project creation.

### LAYOUT_04
Inside a project, the main content area begins with a segmented switch between scenarios and runs.

Below the top navbar, the page shows a segmented switch with exactly two options: `Scenarios` and `Runs`. This switch controls the primary project workspace and replaces the need for a separate sidebar or tab bar for those two sections.

### LAYOUT_05
The scenarios workspace uses a left-side selection container with mode controls.

When the `Scenarios` segment is active, the page layout is split into a left-side navigation container and a main content panel on the right. The left-side container includes a toggle between `Edit` and `Graph` modes and a search bar for scenarios.

### LAYOUT_06
Scenario list mode uses a left-side navigation list ordered by execution order.

In scenario list mode, the left-side panel shows only scenario titles. The default ordering is the execution order derived from the dependency graph. The panel header includes a simple sort toggle button that changes the sort direction. The selected scenario row should use the default selected styling from the shared shadcn-based list implementation.

### LAYOUT_07
Runs mode uses a left-side navigation list ordered by execution date.

When the `Runs` segment is active, the left-side panel shows the list of runs. The default ordering is by execution date. The panel header includes a simple sort toggle button that changes the sort direction. Each list item shows the run name, such as `placating-platypus`, and the run date. The selected run row should use the default selected styling from the shared shadcn-based list implementation.

### LAYOUT_08
Scenario graph mode keeps the scenario list on the left and shows the dependency graph on the right.

When the scenario workspace is switched to `Graph` mode, the left-side scenario list remains visible, and the right-side main panel shows the scenario dependency graph. The graph is rendered with React Flow. Each node displays the scenario name, and directed edges represent scenario dependencies. In v1, the graph is read-only and does not support node selection or direct graph interaction beyond viewing.

### LAYOUT_09
Selecting a scenario opens the scenario editor in the main content panel.

When the user clicks a scenario in the left-side scenario list, the right-side panel shows the scenario editor for that scenario. The editor must expose all editable scenario data and include a stateful `Save` button that reflects whether there are unsaved changes, along with a `Revert` button that restores the last saved state.

### LAYOUT_10
Selecting a run opens a run details workspace with a second-tier left-side navigation and summary metadata.

When the user clicks a run in the runs list, the right-side area becomes a run details workspace. That workspace includes a second-tier left-side navigation panel whose top area shows a compact run summary with execution date and aggregated score when available. Below that summary, the panel lists the scenarios executed in that run in execution order, showing each scenario's score, a failure icon if it failed to run, and an icon indicating that the agent runner returned a response when applicable. Clicking one of those executed scenarios opens a detailed panel with all execution information for that scenario within the selected run.

### LAYOUT_11
Primary workspace state is reflected in the URL.

The current project, the selected primary workspace section (`scenarios` or `runs`), the selected scenario or run, and the selected scenario submode (`edit` or `graph`) must all be represented in the application route so that refresh, navigation, and deep linking preserve the current layout state.

### LAYOUT_12
Unselected detail areas show blank panels rather than placeholder dashboards.

When the user is in the scenarios workspace without a selected scenario, the right-side main panel is blank. When the user is in the runs workspace without a selected run, the right-side main panel is blank. When a run is selected but no executed scenario within that run is selected yet, the run detail panel remains blank. The layout should preserve the surrounding navigation structure in all of these cases.

### LAYOUT_13
Left-side navigation panels are resizable and use the shared shadcn resizable pattern.

The main left-side navigation panel for scenarios and runs should be horizontally resizable. The run-details second-tier left-side navigation should also use the same resizable layout pattern when present. Resizable behavior should be implemented with the shared shadcn-compatible resizable component rather than a custom panel-resize solution.

### LAYOUT_14
Primary layout state uses a route shape that maps cleanly to the breadcrumb structure.

The v1 route shape should use path segments for project, primary workspace, and primary selected record, with query parameters for secondary state. The recommended route pattern is:

- `/projects`
- `/projects/new`
- `/projects/[projectSlug]/scenarios?mode=edit`
- `/projects/[projectSlug]/scenarios/[scenarioSlug]?mode=edit`
- `/projects/[projectSlug]/scenarios?mode=graph`
- `/projects/[projectSlug]/runs`
- `/projects/[projectSlug]/runs/[runId]`
- `/projects/[projectSlug]/runs/[runId]?scenario=[scenarioSlug]`

This keeps the breadcrumb aligned to project and primary selection while still reflecting edit mode, graph mode, and run-scenario selection in the URL.

### LAYOUT_15
Resizable panel defaults are fixed for v1 desktop layouts.

The primary left-side navigation panel for scenarios and runs should default to `320px`, with a minimum width of `260px` and a maximum width of `420px`. The second-tier run-details navigation panel should default to `280px`, with a minimum width of `220px` and a maximum width of `360px`.

### LAYOUT_16
The v1 layout is desktop-first and does not define a mobile experience.

The application layout in v1 is specified only for desktop and laptop viewports. Narrow-screen and mobile-specific layout behavior is explicitly out of scope for this version of the layout spec.
