---
name: e2e-runnable-locally-since-2026-09-17
description: CORRECTION — the extension Playwright E2E suite DOES run in this Windows dev environment; the old "blank popup" blocker was a production-build artefact
metadata:
  type: project
---

**Superseded 2026-09-17.** The extension E2E suite (`packages/extension/e2e`,
`pnpm --filter @tabmerger/extension test:e2e`) runs to a meaningful result here. A full
pass (every spec except `@visual`) was green.

**What the old note got wrong:** the "popup renders blank, every spec fails on the first
`getByRole`" symptom was the PRODUCTION build (`.output/chrome-mv3`) being loaded — with a
placeholder `.env.production`, `new URL()` inside supabase-js throws and the popup never
mounts. `e2e/fixtures.ts` now prefers `.output/chrome-mv3-dev` when it exists, so the fix is
simply to build first.

**How to apply:**
- `pnpm --filter @tabmerger/extension build:dev` BEFORE running E2E. The specs load the
  BUILT extension, so an un-rebuilt `.output` silently tests the previous commit's code —
  this masked a real regression for a whole run.
- Playwright browsers must be installed once (`pnpm exec playwright install chromium`).
- Budget ~5s per test, single worker; chunk spec files to stay inside a 10-minute cap.
- `--retries=0` while iterating; the config defaults to 1 retry.
- Still broken here: `pnpm --filter @tabmerger/extension lint` (`minimatch` "expand is not a
  function"), pre-existing and unrelated.

**Selector traps this suite exposed (all real product changes, not test rot):**
- Group rows and their drag grips are both `role="button"`, and the grip's label now embeds
  the group name (`Drag to reorder group: Work`). `getByRole('button', { name })` is a
  SUBSTRING match, so every group-row query needs `exact: true`.
- Selection mode puts a `role="checkbox"` on sidebar group rows and window headers too, so
  `getByRole('checkbox', { name: /^select /i })` no longer means "a tab". Scope it:
  `page.getByRole('listitem').getByRole('checkbox', …)`.
