# Resizable panels and sortable phases: manual acceptance

`packages/ui` ships in-house `resizable` and `sortable-list` components in place of `react-resizable-panels` and `@dnd-kit/*`. Run this checklist after changing either component.

## Setup

- Dev fixture, no sign-in or Convex data: `pnpm dev`, then open `http://localhost:3055/dev/workspace-fixture`. Production builds return 404 for this route. It uses the real shared components, a primary and a nested resizable group, four phases, persisted widths and order, a theme toggle, an event log of commits, and a "Fail next reorder" switch.
- Real app: sign in, open a project with at least four phases and a finished run.

## Resizable panels

Check scenarios, suites, phases, runs, and a selected run (nested run-detail panel).

- [ ] Defaults are 320px for primary navigation and 280px for run-detail navigation.
- [ ] Dragging clamps to 260–420px (primary) and 220–360px (run detail). The detail panel takes the rest.
- [ ] The handle keeps its look: 1px border line, grip box, about 8px grab area, column-resize cursor.
- [ ] No text gets selected while dragging, including when the pointer leaves the handle.
- [ ] Releasing commits once (fixture event log shows one entry). Escape mid-drag, or a cancelled pointer such as an alt-tab, puts the width back and commits nothing.
- [ ] Keyboard: Tab to the handle shows a focus ring. Arrow keys move 16px, Shift+Arrow 64px, Home goes to the minimum, End to the maximum. Screen readers announce a separator with its current, minimum and maximum values.
- [ ] Reload keeps each width. Widths are stored per project and per workspace: changing project A leaves project B alone. Scenarios and phases share one width.
- [ ] Shrinking the browser window keeps the navigation width within limits and the detail panel usable. Desktop only; no mobile layout is specified.
- [ ] Vertical scrolling inside each panel still works.
- [ ] Light and dark themes both look right.
- [ ] Known reset: widths saved by the old library were percentages under the unversioned key. They are ignored and deleted once, so each workspace starts at its default width one time after upgrading.

## Sortable phases

- [ ] Pointer: the drag starts from the grip only, after about 4px of movement. A plain click on the grip or row still selects the phase.
- [ ] Rows shift smoothly (about 150ms). The target follows the pointer crossing a row's midpoint. The dropped row settles into its slot with no flicker and no extra shadow.
- [ ] Dropping outside the list, pressing Escape, or a cancelled pointer returns the row to its slot without saving.
- [ ] Releasing a drag does not also select the row underneath.
- [ ] Keyboard: focus the grip, Space or Enter picks the row up, the arrow keys move it, Space or Enter drops, Escape cancels. Focus stays on the moved row's grip. These keys do not select the row.
- [ ] A screen reader politely announces pickup, each move, the drop and a cancel.
- [ ] Touch: dragging the grip on a touch screen or in device emulation reorders without scrolling the page. Scrolling on the rest of the row still works.
- [ ] Reload keeps the new order (real app: the server order; fixture: localStorage).
- [ ] Async failure: in the fixture, turn on "Fail next reorder" and drag. The row shows the new order until the simulated mutation fails, then goes back and an error appears. The event log shows exactly one `onReorder` call per drop.
- [ ] Known gap: dragging near the edge of a long list does not auto-scroll. The phases list is short, so this is out of scope.
