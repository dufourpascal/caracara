# Convex Security

- All public queries and mutations must enforce Clerk auth.
- For project-scoped access by slug, use `requireProjectOwnerBySlug(ctx, slug)`.
- For project-scoped access by id, use `requireProjectOwnerById(ctx, projectId)`.
- Do not query Convex tables directly in handlers before ownership is checked.
- Any `scenarioId`, `runId`, or dependency id passed in must be verified to belong to the same owned project before read or write.

# Convex Schema Changes

- When dropping a field, do not remove it from the schema first.
- Use the Convex sequence: make the field `v.optional(...)`, backfill old documents with `db.patch(id, { field: undefined })`, verify no documents still have it, then remove it from the schema.
- If deployed data may still contain the old field, add a one-off internal migration and run it with `convex run` before the final schema cleanup.
