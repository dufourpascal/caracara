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
4. Let Convex write `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and `NEXT_PUBLIC_CONVEX_SITE_URL` into [apps/web/.env.local](/home/pascal/src/caracarascore/apps/web/.env.local).
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

## Local CLI secrets

`caracara init` creates `.caracara/secrets.env` with owner-only permissions and adds it to `.caracara/.gitignore`. Put project-specific credentials there using names that start with `CARACARA_SECRET_`:

```dotenv
CARACARA_SECRET_USERNAME=test@example.com
CARACARA_SECRET_PASSWORD=replace-me
```

`caracara run` loads the nearest project secrets automatically and makes them available only to the selected local runner. Project and scenario prompts may refer to the variable names, but must never contain their values. The CLI redacts exact secret values from runner errors and submitted result text. The local agent may still receive a secret in model context when it reads the value to enter it into the application under test.

## Target environments

Define any number of named application targets in `.caracara/config.json`:

```json
{
  "environments": {
    "development": "http://localhost:3000",
    "preview": "https://preview.example.com",
    "production": "https://app.example.com"
  },
  "defaultEnvironment": "development"
}
```

A plain `caracara run` uses `defaultEnvironment`. Override it for one run with `caracara run --environment preview` or `CARACARA_ENVIRONMENT=preview caracara run`. Environment names are lowercase slugs. Target URLs must use HTTP or HTTPS and must not contain credentials; keep credentials in `.caracara/secrets.env`.

Each run stores the selected environment and normalized target URL so the web app can label and filter run history without changing older results when the local config changes. Runs created by older CLIs appear as `untracked`.

## Codex model configuration

Set the Codex model and reasoning effort in `.caracara/config.json`:

```json
{
  "runner": "codex",
  "model": "gpt-5.6-luna",
  "model_reasoning_effort": "low"
}
```

Both settings are optional. Without them, Codex uses its own configuration. You can also set them with `caracara init --model <model> --model-reasoning-effort <effort>`.

Caracara runs Codex through `@openai/codex-sdk`. The SDK uses the existing local Codex authentication and starts a fresh Codex thread for each scenario while sharing one run-scoped browser session.

When Codex marks a check as failed, it captures a WebP screenshot through Chrome DevTools. The CLI validates and uploads the screenshot before submitting the completed result. Run deletion also removes the stored screenshots.

## CLI scenario authoring

The logged-in CLI can update the selected project directly:

```bash
caracara addPhase --name "Checkout"
caracara createScenario --name "Complete checkout" --instructions "Buy one item."
caracara addCheck --scenario complete-checkout --name "Receipt" --expectation "The receipt is visible."
caracara updateCheck --scenario complete-checkout --check "Receipt" --expectation "The receipt shows VAT."
```

The complete mutation set is `addPhase`, `editPhase`, `removePhase`, `createScenario`, `updateScenario`, `addCheck`, `removeCheck`, and `updateCheck`. Phase references accept an ID, order, or exact name. Check references accept an ID or exact name. Commands print one JSON result and fail if a name is ambiguous.

Authoring commands update live records immediately and have no version, proposal, activation-delay, or undo workflow. The server rejects phase and scenario writes while the project has a running run.

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
- For production, repeat the same `CLERK_FRONTEND_API_URL` setup on the Convex production deployment and set the corresponding Clerk and `NEXT_PUBLIC_CONVEX_SITE_URL` env vars in Vercel.
