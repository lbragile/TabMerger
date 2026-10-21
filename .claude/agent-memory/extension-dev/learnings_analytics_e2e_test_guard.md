---
name: analytics-e2e-test-guard
description: How trackEvent/trackPostHogEvent are kept from firing real network calls during automated test runs, and the one CI gap that remains
metadata:
  type: user
---

`src/lib/analytics.ts`'s `trackEvent`/`trackPostHogEvent` now early-return when `import.meta.env.VITE_E2E_TEST === 'true'`, checked via a module-level `IS_AUTOMATED_TEST_BUILD` constant — gated at the "about to fire a real network call" layer (same principle as the web app's `isAutomatedTestEnvironment()`), not inside `hasDataConsent`, so it never gets confused with a real consent decision.

The define lives in `wxt.config.ts`'s `vite().define`:
```
"import.meta.env.VITE_E2E_TEST": JSON.stringify(cliWxtMode === "development" || process.env.VITE_E2E_TEST === "true")
```
This is `true` for ANY `development`-mode build (`wxt build/dev --mode development`) — the same precedent as `e2eGrantDownloads` in the manifest fn (a development-mode build is never a real user's install) — and can additionally be forced on for any other mode by exporting `VITE_E2E_TEST=true` before the build.

Key fact confirmed by reading `src/lib/i18n.ts`'s `VITE_PSEUDO_LOCALE` usage: Vite/WXT auto-exposes any `process.env.VITE_*` value into `import.meta.env.VITE_*` at build time with zero `wxt.config.ts` wiring required — `build:dev:pseudo`'s `node -e "process.env.VITE_PSEUDO_LOCALE='1';...wxt build..."` pattern is the existing precedent. No new wiring was needed for local e2e (`build:dev`, `seed:dev`, `seed:dev:wipe` all already use `--mode development`, so they're covered automatically).

**Known remaining gap:** CI's `e2e-extension` job (`.github/workflows/ci.yml`) builds the extension with a plain `pnpm --filter @tabmerger/extension build` (production mode, loads real `.env.production` — real PostHog key, real `tabmerger.com` URL) before running `test:e2e`. That build is never flagged `VITE_E2E_TEST`, so if that job's e2e specs ever call analytics-firing code paths, they'd hit the real GA4 proxy / PostHog project. Closing it needs a `ci.yml` edit (e.g. `env: { VITE_E2E_TEST: 'true' }` on that one build step) — left undone because `.claude/hooks/protect-workflows.py` blocks automated edits to workflow files; a maintainer should add it by hand.

Also: do NOT gate this on `import.meta.env.MODE === 'test'` or any Vitest-default signal — Vitest's own `import.meta.env.MODE` is `'test'` by default, and `__tests__/unit/lib/analytics.test.ts` mocks `fetch` and asserts real calls happen through `trackEvent`, so that guard would have silently broken those assertions.
