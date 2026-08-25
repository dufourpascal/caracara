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
The scenario editor must separate execution instructions from evaluation checks.

The editor provides an ordered check list with add, edit, delete, and move controls. Each check has a name and observable expectation.

### FRONTEND_07
Dependencies are managed through a searchable dropdown-style control built from shadcn primitives.

In v1, users should assign scenario dependencies through a simple searchable selection UI, likely based on shadcn `Popover` plus `Command` or an equivalent shared combobox pattern, rather than through a full graph editor or visualization workflow.

### FRONTEND_08
The UI must expose draft versus active scenario state.

Users need a clear way to see whether a scenario is still being authored or intended to be runnable, preferably through consistent shared badge, toggle, select, or status-chip patterns.

### FRONTEND_09
The frontend should present run history and per-scenario results using reusable data-display patterns.

Users can inspect pass rates and every scenario's ordered check verdicts and browser evidence. Execution failures remain visually separate from failed product checks. Run history uses the generated run name as its primary label.

When a failed check has screenshot evidence, the result view shows a small uncropped thumbnail below its text evidence. The thumbnail opens the authenticated full-size image in an accessible shared dialog. Historical text-only results do not show an empty screenshot frame.

### FRONTEND_10
The frontend is a management interface built on shared design-system conventions, not the execution environment.

Scenario execution itself happens through the local CLI, so the web app's responsibility is to configure, inspect, and explain runs rather than directly run the target application, and new frontend work should prefer extending the shared shadcn system instead of introducing one-off visual patterns.
