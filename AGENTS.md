# AGENTS.md

## Project Stack

Use this stack unless a spec explicitly changes it:

- Next.js
- Tailwind CSS
- shadcn/ui
- Convex
- Clerk
- pnpm
- Turborepo
- Vercel
- npm for publishing the `caracara` CLI package

## Monorepo Shape

- `apps/web`: Next.js app and Convex backend
- `packages/ui`: shared shadcn-based UI primitives
- additional shared packages should be added only when justified by the specs

## Product References

Treat the files in [`specs/`](/home/pascal/src/caracarascore/specs) as the source of truth for product and architecture decisions, especially:

- [`specs/product-and-scope.md`](/home/pascal/src/caracarascore/specs/product-and-scope.md)
- [`specs/core-domain-model.md`](/home/pascal/src/caracarascore/specs/core-domain-model.md)
- [`specs/scenario-authoring.md`](/home/pascal/src/caracarascore/specs/scenario-authoring.md)
- [`specs/execution-and-scoring.md`](/home/pascal/src/caracarascore/specs/execution-and-scoring.md)
- [`specs/api-contracts.md`](/home/pascal/src/caracarascore/specs/api-contracts.md)
- [`specs/authentication-and-access.md`](/home/pascal/src/caracarascore/specs/authentication-and-access.md)
- [`specs/data-and-storage.md`](/home/pascal/src/caracarascore/specs/data-and-storage.md)
- [`specs/frontend-application.md`](/home/pascal/src/caracarascore/specs/frontend-application.md)
- [`specs/monorepo-and-packages.md`](/home/pascal/src/caracarascore/specs/monorepo-and-packages.md)

## Frontend Guidance

IMPORTANT: Whenever you make frontend changes, you must read and adhere to the STYLE_GUIDE.md
- Prefer shadcn primitives and shared components from `packages/ui`
- Do not introduce a parallel custom design system
