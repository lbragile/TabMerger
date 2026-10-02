---
name: seed-dev-manual-tool
description: pnpm seed:dev manual DnD click-around tool — how it's built and the Playwright/tsconfig/seed.ts gotchas hit building it
metadata:
  type: project
---

`pnpm --filter @tabmerger/extension seed:dev` (+ `:wipe` / `:reset`) launches headed
persistent Chrome with the dev build, seeds IndexedDB with realistic groups, opens the
real toolbar popup, and stays open until closed. Files under `e2e/repro/`:
`seedData.ts` (pure builder), `seedDev.ts` (Playwright runner), `playwright.seed.config.ts`
+ `playwright.seed.wipe.config.ts`. Unit test: `src/__tests__/unit/repro/seedData.test.ts`.

**Why:** dev/manual verification tool for the unified-DnD rewrite; CDP-synthesised events
in the existing `*.repro.ts` scripts can't reproduce real-popup drag bugs, so a human
needs a fast way to get a seeded popup.

**How to apply / gotchas for future seed/repro work:**

- **THREE different "dev" builds, only one is standalone-loadable:**
  1. `pnpm dev:extension` / `wxt` (serve mode) → writes `.output/chrome-mv3-dev` whose
     `popup.html` references `http://localhost:3001/@vite/client` + `.../main.tsx` —
     **blank popup unless the HMR server is running**. This is what's usually sitting
     in `.output/chrome-mv3-dev`.
  2. `wxt build --mode development` → **self-contained** `.output/chrome-mv3-dev`
     (references `/chunks/popup-*.js`, loads `.env.local` real keys, name "TabMerger DEV").
     This is the one to load for headless/standalone Chrome. Added as `build:dev` script.
  3. `wxt build` (prod) → `.output/chrome-mv3`, popup **blank** — `.env.production` has a
     placeholder `VITE_SUPABASE_URL` that throws in `@supabase/supabase-js` at import.
  WXT's `-dev` output-dir suffix is driven by **mode**, not command (`resolve-config.mjs`:
  `modeSuffix = {production:'', development:'-dev'}[mode]`), so `wxt build --mode development`
  lands in `chrome-mv3-dev` and does NOT clobber the prod dir.
- `seed:dev` now runs `wxt build --mode development &&` before the Playwright config, and
  `seedDev.ts` `resolveExtensionPath()` hard-rejects (with the exact fix) a missing /
  dev-server (`/@vite\/client|localhost:3001/` in popup.html) / stale (`src/` newer than
  `manifest.json` mtime + 2s slop) dev build. Never falls back to the prod dir.
- **Verify the popup actually RENDERED**, not just that a `/popup.html` target appeared:
  `page.evaluate(() => document.getElementById('root')?.childElementCount > 0)`. A CDP
  page whose URL ends `/popup.html` can still be a blank shell. If blank, the runner
  opens `chrome-extension://<id>/popup.html` as a normal tab (listeners attached first)
  and dumps captured `console.error` + `pageerror` for diagnosis.

- `e2e/seed.ts`'s `tab(id,title,url)` helper uses a **module-level mutable `picsumSeed`
  counter** for its random `favIconUrl`/`ogImage`. Anything that reuses `tab()` is NOT
  deterministic across calls unless you override BOTH `favIconUrl` and `ogImage` after
  the spread. Bit the builder's determinism test.
- **Playwright's `test` CLI rejects unknown `--flags`** (`error: unknown option '--wipe'`).
  You cannot pass a custom flag through `pnpm run <script> --wipe` to a `playwright test`
  command. Workaround used: a wrapper config file (`playwright.seed.wipe.config.ts`) that
  does `process.env.SEED_WIPE = '1'` at module top then `export { default } from './playwright.seed.config'`
  — the config module loads before workers spawn, and workers inherit `process.env`.
- The extension's root `tsconfig.json` (`include: ["src"]`, `types: ["chrome"]`, DOM lib)
  **will type-check `e2e/` files pulled in via a `src/__tests__` import graph**. `e2e/tsconfig.json`
  uses `types: ["node"]` + no DOM lib, so `e2e/*` files are already full of
  `Cannot find name 'indexedDB'/'chrome'/'IDBRequest'` errors under their own config
  (pre-existing, whole suite) — harness.ts included. To keep a shared module clean under
  BOTH configs, avoid Node globals: `resolveSeedConfig(env)` takes `env` as an explicit
  param instead of reading `process.env`. The runner passes `process.env`.
- Isolation: `playwright.seed.config.ts` `testMatch: '**/seedDev.ts'`; the DnD repro
  config matches `'**/*.repro.ts'`; main e2e `testDir: './tests'`. Naming the runner
  `seedDev.ts` (not `*.repro.ts`) keeps it out of `pnpm repro:dnd`. Verified with
  `playwright test --config … --list`.
- Persistent user-data-dir at `e2e/test-results/seed-profile/` (gitignored via the global
  `test-results/` rule — the root `.gitignore` is a protected chunk, don't touch it).
  A stable dir keeps the unpacked extension ID stable across runs and makes wipe/append
  meaningful.
- On a fresh profile the popup boot creates the real "Now Open" group before the seed
  write runs; `writeSeed` finds it via `existing.find(g => g.permanent)` and preserves it.
  If none exists yet it synthesises one (`id: 'nowopen0001'`). `useCurrentTabs` re-syncs
  it on mount regardless.
- `SEED_OPEN_MS=<ms>` env makes the runner auto-close instead of waiting forever — use it
  for your own end-to-end verification so the script doesn't hang.
- Saved-tab shape: `id: 0` sentinel + `savedAt` epoch ms (matches `useGroups.ts` /
  `dndMove.ts` `detachTab`). Window/tab React keys are positional
  (`${groupId}::w${i}` / `${groupId}::w${wi}::t${ti}`), so tab `id` value is irrelevant to
  rendering — but give windows unique numeric ids anyway.
