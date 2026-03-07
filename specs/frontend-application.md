# Frontend Application

### FRONTEND_01
The frontend is a Next.js application built on the generated shadcn monorepo scaffold.

The web app in `apps/web` is the main interface for creating projects, authoring scenarios, and reviewing execution history for the user's own apps under test, while shared UI primitives should come from the shadcn-based `packages/ui` package.

### FRONTEND_02
The application requires authentication before any project data is accessible.

Users must sign in through Clerk before they can view projects, edit scenarios, or inspect run results.

### FRONTEND_03
The primary post-login entry point is a project list.

After signing in, users should land on a projects list view where they can create a new project or open an existing one.

### FRONTEND_04
The primary project view centers on scenario management using shared shadcn primitives.

Each project should provide a clear interface for listing scenarios, creating new ones, editing existing ones, and understanding their current status, with tables, buttons, dialogs, forms, and layout primitives composed from the shared shadcn component layer wherever practical.

### FRONTEND_05
The UI must support editing project-level configuration with standard shared form components.

Users need a dedicated way to edit project metadata such as name, slug, description, and the shared project-level prompt used during scenario execution, and these forms should use shadcn input, textarea, label, button, and validation patterns rather than bespoke controls.

### FRONTEND_06
The scenario editor must separate execution instructions from scoring prompts.

The UI should make it obvious that scenario task instructions and scoring logic are different fields with different purposes, and the editor should be composed from standard shadcn form and layout primitives wherever possible.

### FRONTEND_07
Dependencies are managed through a searchable dropdown-style control built from shadcn primitives.

In v1, users should assign scenario dependencies through a simple searchable selection UI, likely based on shadcn `Popover` plus `Command` or an equivalent shared combobox pattern, rather than through a full graph editor or visualization workflow.

### FRONTEND_08
The UI must expose draft versus active scenario state.

Users need a clear way to see whether a scenario is still being authored or intended to be runnable, preferably through consistent shared badge, toggle, select, or status-chip patterns.

### FRONTEND_09
The frontend should present run history and per-scenario results using reusable data-display patterns.

Users should be able to inspect past runs, see scenario-by-scenario outcomes, and understand which scenarios passed, failed, or produced non-perfect scores, with data tables, badges, panels, and disclosure patterns built from shared shadcn-based components wherever practical. Run history and run detail views should use the generated run name as the primary human-readable label.

### FRONTEND_10
The frontend is a management interface built on shared design-system conventions, not the execution environment.

Scenario execution itself happens through the local CLI, so the web app's responsibility is to configure, inspect, and explain runs rather than directly run the target application, and new frontend work should prefer extending the shared shadcn system instead of introducing one-off visual patterns.
