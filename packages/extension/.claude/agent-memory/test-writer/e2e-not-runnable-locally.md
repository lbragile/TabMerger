---
name: e2e-not-runnable-locally
description: Extension Playwright E2E specs cannot be executed in this dev environment — expect to deliver E2E changes unverified locally
metadata:
  type: project
---

The extension E2E suite (`packages/extension/e2e`, `pnpm --filter @tabmerger/extension test:e2e`)
does not run to a meaningful result in this Windows dev environment.

**Why:**
- Playwright browsers are not installed by default (`pnpm exec playwright install chromium` fixes
  the "Executable doesn't exist" error).
- Even after installing, `e2e/fixtures.ts` launches `chromium.launchPersistentContext` with
  `headless: false` to load the MV3 extension. In this agent/session context the popup page
  renders blank (screenshots ~2.7 kB, React never paints), so EVERY spec fails on the first
  `getByRole(...)` assertion — including trivial "popup shows seeded groups". This is an
  environment limitation, not a regression.

**How to apply:**
- Write/update E2E specs to house style (data-testid / role / `[data-sidebar-group-index]` /
  `getByLabel('Drag to reorder …')`, IDB-read assertions via `page.evaluate` like the existing
  `groups.spec.ts` DnD tests) so they run in CI, but do NOT block a green-phase report on
  executing them locally. State clearly in the report that E2E was delivered unverified-locally
  and why.
- `pnpm --filter @tabmerger/extension lint` is also broken here (`minimatch` "expand is not a
  function"). tsc (`pnpm exec tsc --noEmit`) and the unit + integration vitest runs DO work and
  are the reliable local gates.

**Unit + integration both run fine:**
- unit: `pnpm test --run` (+ `pnpm exec vitest run --coverage` for the 80% gate — the `--`
  in `pnpm test -- --coverage` gets swallowed as a filter, call vitest directly).
- integration: `pnpm --filter @tabmerger/extension test:integration` (real fake-indexeddb;
  Supabase-dependent files self-skip → "2 skipped").
