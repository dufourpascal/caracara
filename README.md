# Caracara Score

Initial setup for the web app now includes Clerk authentication, Convex wiring, Clerk-to-Convex auth bridging, and the first protected frontend route.

## What is implemented

- Clerk provider wired into [apps/web/app/layout.tsx](/home/pascal/src/caracarascore/apps/web/app/layout.tsx)
- Convex client provider wired through [apps/web/components/convex-client-provider.tsx](/home/pascal/src/caracarascore/apps/web/components/convex-client-provider.tsx)
- Clerk route protection in [apps/web/proxy.ts](/home/pascal/src/caracarascore/apps/web/proxy.ts)
- Clerk prebuilt auth screens in [apps/web/app/sign-in/[[...sign-in]]/page.tsx](/home/pascal/src/caracarascore/apps/web/app/sign-in/[[...sign-in]]/page.tsx) and [apps/web/app/sign-up/[[...sign-up]]/page.tsx](/home/pascal/src/caracarascore/apps/web/app/sign-up/[[...sign-up]]/page.tsx)
- Convex auth configuration in [apps/web/convex/auth.config.ts](/home/pascal/src/caracarascore/apps/web/convex/auth.config.ts)
- A first authenticated Convex query in [apps/web/convex/users.ts](/home/pascal/src/caracarascore/apps/web/convex/users.ts)
- A protected placeholder projects page in [apps/web/app/projects/page.tsx](/home/pascal/src/caracarascore/apps/web/app/projects/page.tsx)

## Manual Clerk flow

1. Create a Clerk application for the web app.
2. Enable the sign-in methods you want for v1.
3. Put the Clerk publishable key and secret key into [apps/web/.env.local](/home/pascal/src/caracarascore/apps/web/.env.local).
4. In Clerk, open `JWT Templates` and create a new template from the `Convex` preset, or use Clerk's Convex integration flow if you already enabled it there.
5. Keep the template name as `convex`. The frontend bridge uses that template name when requesting a token for Convex.
6. Copy the Clerk Frontend API URL and store it as `CLERK_FRONTEND_API_URL` in [apps/web/.env.local](/home/pascal/src/caracarascore/apps/web/.env.local).

For local development the Frontend API URL is typically a `https://...clerk.accounts.dev` URL. Convex uses that URL as the auth provider domain.

## Manual Convex flow

1. From the repo root, start the Convex setup flow:

```bash
pnpm --filter web convex:dev
```

2. Log in to Convex in the browser if prompted.
3. Create or select the development deployment for `apps/web`.
4. Let Convex write `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into [apps/web/.env.local](/home/pascal/src/caracarascore/apps/web/.env.local).
5. Set the Clerk Frontend API URL on the Convex development deployment:

```bash
pnpm --filter web exec convex env set CLERK_FRONTEND_API_URL "$CLERK_FRONTEND_API_URL"
```

6. Keep `pnpm --filter web convex:dev` running in one terminal so Convex continues to push function changes and regenerate types once the deployment is connected.

## Run locally

After the manual setup above is complete, you can run everything from the repo root:

```bash
pnpm dev
```

That starts both:

- `web#dev` for Next.js
- `web#convex:dev` for Convex

## Verify the flow

1. Visit `/` and confirm the signed-out shell renders.
2. Open `/sign-in` or `/sign-up` and complete authentication with Clerk's prebuilt UI.
3. Confirm the post-login redirect lands on `/projects`.
4. Confirm `/projects` shows identity data returned by the Convex query.
5. Sign out from the `UserButton` and confirm `/projects` is protected again.

## Notes

- `pnpm --filter web lint` passes.
- `pnpm --filter web typecheck` passes.
- Convex code generation is not fully active yet because it needs a real deployment connection first. The frontend currently uses `makeFunctionReference("users:viewer")` so the auth flow can be completed before `convex dev` has generated `convex/_generated/api`.
- For production, repeat the same `CLERK_FRONTEND_API_URL` setup on the Convex production deployment and set the corresponding Clerk env vars in Vercel.
