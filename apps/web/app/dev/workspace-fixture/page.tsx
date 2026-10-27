import { notFound } from "next/navigation"

import { WorkspaceFixture } from "./workspace-fixture"

// Development-only fixture for checking the shared resizable panels and
// sortable list in a browser without signing in or seeding Convex data.
// Production builds return 404 for this route.
export default function WorkspaceFixturePage() {
  if (process.env.NODE_ENV !== "development") {
    notFound()
  }

  return <WorkspaceFixture />
}
