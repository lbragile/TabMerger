---
name: analytics-e2e-test-guard
description: How trackEvent/trackPostHogEvent and Sentry are kept from firing real network calls during automated test runs, locally and in CI
metadata:
  type: user
---

`src/lib/analytics.ts`'s `trackEvent`/`trackPostHogEvent` now early-return when `import.meta.env.VITE_E2E_TEST === 'true'`, checked via a module-level `IS_AUTOMATED_TEST_BUILD` constant — gated at the "about to fire a real network call" layer (same principle as the web app's `isAutomatedTestEnvironment()`), not inside `hasDataConsent`, so it never gets confused with a real consent decision.

The define lives in `wxt.config.ts`'s `vite().define`, built by `resolveE2eTestDefine(mode, process.env.VITE_E2E_TEST)` in `scripts/buildEnv.ts`: the source text `'"true"'` (a STRING) for any `development`-mode build or when `VITE_E2E_TEST=true` is exported for the build, otherwise `'undefined'`.

**Regression this replaced:** the define used to be `JSON.stringify(boolean)`, which pastes a boolean `true` into the bundle. `analytics.ts` compares `=== 'true'`, so the guard compiled to nothing in EVERY build and e2e runs posted to `${VITE_WEB_APP_URL}/api/track`. It went unnoticed while CI had no web app URL (trackEvent no-ops without one). Check a built bundle: an e2e build must contain no `/api/track` string at all (dead-code eliminated). Never define the string `"false"`: the Sentry checks read the variable for truthiness.

Key fact confirmed by reading `src/lib/i18n.ts`'s `VITE_PSEUDO_LOCALE` usage: Vite/WXT auto-exposes any `process.env.VITE_*` value into `import.meta.env.VITE_*` at build time with zero `wxt.config.ts` wiring required — `build:dev:pseudo`'s `node -e "process.env.VITE_PSEUDO_LOCALE='1';...wxt build..."` pattern is the existing precedent. No new wiring was needed for local e2e (`build:dev`, `seed:dev`, `seed:dev:wipe` all already use `--mode development`, so they're covered automatically).

The same flag gates both `Sentry.init` calls (`entrypoints/popup/main.tsx`, `entrypoints/background.ts`).

**CI builds in production mode**, not development: the `e2e-extension` and visual-regression jobs in `.github/workflows/ci.yml` run a plain `pnpm --filter @tabmerger/extension build`, which loads the real `.env.production` (real PostHog key, Sentry DSN, `tabmerger.com`). The dev-mode default doesn't cover them, so both build steps set `env: VITE_E2E_TEST: 'true'`. Any new CI job that builds the extension and drives it with Playwright needs the same env on its build step. (Workflow files are hook-protected: `.claude/hooks/protect-workflows.py`; an edit there needs explicit confirmation.)

Also: do NOT gate this on `import.meta.env.MODE === 'test'` or any Vitest-default signal — Vitest's own `import.meta.env.MODE` is `'test'` by default, and `__tests__/unit/lib/analytics.test.ts` mocks `fetch` and asserts real calls happen through `trackEvent`, so that guard would have silently broken those assertions.
