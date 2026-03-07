# App Style Guide

This repo is scaffolded from:

```bash
pnpm dlx shadcn@latest init --preset auvQQ0O --template next --monorepo
```

The UI must follow the generated shadcn setup instead of introducing a separate custom design system.

## 1. Source of Truth

- App preset: `radix-lyra`
- Base color: `neutral`
- CSS variables: enabled
- Icons: `lucide`
- Theme support: enabled through `ThemeProvider`

These defaults are defined in:

- [`apps/web/components.json`](/home/pascal/src/caracarascore/apps/web/components.json)
- [`packages/ui/components.json`](/home/pascal/src/caracarascore/packages/ui/components.json)
- [`packages/ui/src/styles/globals.css`](/home/pascal/src/caracarascore/packages/ui/src/styles/globals.css)
- [`apps/web/app/layout.tsx`](/home/pascal/src/caracarascore/apps/web/app/layout.tsx)

## 2. Tokens and Theme

- Use the generated OKLCH CSS variables from [`packages/ui/src/styles/globals.css`](/home/pascal/src/caracarascore/packages/ui/src/styles/globals.css).
- Do not create a parallel token system for colors, radius, spacing, or component states.
- Keep the neutral shadcn palette unless there is an explicit global re-theme.
- Build against both light and dark themes. The scaffold supports both and the UI should not assume dark-only behavior.

## 3. Typography

- Use `Geist` as the default UI font.
- Use `Geist Mono` only for technical content such as slugs, prompts, scores, CLI text, and run metadata.
- Font setup comes from [`apps/web/app/layout.tsx`](/home/pascal/src/caracarascore/apps/web/app/layout.tsx).
- Do not switch the whole application to monospace.

## 4. Shape and Components

- Respect the scaffold's square-edged language. The generated theme sets `--radius: 0`.
- Prefer existing shadcn primitives from `packages/ui` before creating new custom components.
- Keep component variants aligned with the generated `cva` patterns, such as the button implementation in [`packages/ui/src/components/button.tsx`](/home/pascal/src/caracarascore/packages/ui/src/components/button.tsx).
- Favor border-first, crisp surfaces over soft cards, decorative shadows, or glossy effects.

## 5. Project-Specific Direction

Within the shadcn baseline, the app should lean slightly hacker and tool-like:

- Prefer dense, operational layouts over marketing-style composition.
- Use mono accents for technical identifiers and execution data, not for all UI copy.
- Favor explicit labels, separators, status chips, tables, lists, and command-surface patterns.
- Keep interactions restrained and fast.

## 6. Do Not

- Do not replace shadcn primitives with a bespoke parallel component library.
- Do not add custom gradient-heavy branding or neon/cyberpunk styling on top of the neutral preset.
- Do not over-round controls or reintroduce soft SaaS-style cards.
- Do not use monospace everywhere as a shortcut for “developer aesthetic”.
