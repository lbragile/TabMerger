---
name: analytics-e2e-test-guard
description: How trackEvent/trackPostHogEvent and Sentry are kept from firing real network calls during automated test runs, locally and in CI
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

The same flag gates both `Sentry.init` calls (`entrypoints/popup/main.tsx`, `entrypoints/background.ts`).

**CI builds in production mode**, not development: the `e2e-extension` and visual-regression jobs in `.github/workflows/ci.yml` run a plain `pnpm --filter @tabmerger/extension build`, which loads the real `.env.production` (real PostHog key, Sentry DSN, `tabmerger.com`). The dev-mode default doesn't cover them, so both build steps set `env: VITE_E2E_TEST: 'true'`. Any new CI job that builds the extension and drives it with Playwright needs the same env on its build step. (Workflow files are hook-protected: `.claude/hooks/protect-workflows.py`; an edit there needs explicit confirmation.)

Also: do NOT gate this on `import.meta.env.MODE === 'test'` or any Vitest-default signal — Vitest's own `import.meta.env.MODE` is `'test'` by default, and `__tests__/unit/lib/analytics.test.ts` mocks `fetch` and asserts real calls happen through `trackEvent`, so that guard would have silently broken those assertions.
