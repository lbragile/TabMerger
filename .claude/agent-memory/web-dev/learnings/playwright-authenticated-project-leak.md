---
name: playwright-authenticated-project-leak
description: Playwright multi-project e2e configs silently run every unrestricted spec under every project — unauthenticated-behavior tests need an explicit storageState override or they flip meaning under the authenticated project.
metadata:
  type: project
---

`packages/web/playwright.config.ts` defines four projects: `setup` / `teardown` (matched only via
`testMatch: /auth\.setup\.ts/` etc.) and `chromium` / `authenticated` (no `testMatch`, so they pick
up **every** `*.spec.ts` file in `e2e/` by default). A spec file with no explicit project targeting
therefore runs twice — once with a clean context (`chromium`) and once with a real signed-in
session restored from `storageState: 'e2e/.auth/user.json'` (`authenticated`).

This bit `e2e/dashboard.spec.ts` ("Dashboard auth guard" describe) and
`e2e/pricing.spec.ts` ("Auth redirect" describe): both assert "unauthenticated X redirects to
sign-in," which is true under `chromium` but false under `authenticated` (a signed-in user visiting
`/dashboard` correctly stays there). These tests were green in CI only because `auth.setup.ts` was
separately broken (bad `SUPABASE_SERVICE_ROLE_KEY`), so the `authenticated` project never actually
had a session to leak. Fixing the service-role key exposed the latent misassignment as 3 failures.

**Fix pattern**: add `test.use({ storageState: { cookies: [], origins: [] } })` at the top of the
specific `describe` block whose tests assert logged-out behavior — not the whole file, and not by
moving the file to a different project. This makes the test genuinely project-agnostic: it forces a
clean context whether it happens to run under `chromium` (already clean, override is a no-op) or
`authenticated` (override wins over the project default). Chosen over restricting via
`test.skip(testInfo.project.name !== 'chromium')` because it keeps the assertion running (and
proven) under both projects instead of silently skipping half the matrix — and because
`organize-api.spec.ts`'s 401-guard tests already rely on running under both projects harmlessly
(header-based auth check, orthogonal to cookies), so skipping would be the inconsistent choice here,
not the established one.

**Inverse case to always check too**: a test that actually needs a session but sits in `chromium`
(or any unrestricted project) will silently pass/fail for the wrong reason instead of exercising real
auth. `e2e/visual.spec.ts`'s "dashboard (authenticated)" describe already guards against this
correctly with `test.skip(testInfo.project.name !== 'authenticated', ...)` in a `beforeEach` — that's
the right pattern when a test is inherently *project-specific* rather than *project-agnostic*.

**Local repro note**: `auth.setup.ts` needs `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in the shell's actual
`process.env` — nothing in this repo (`playwright.config.ts`, the spec files, `package.json`'s
`test:e2e` script) loads `.env.local` for the Playwright test-runner process itself (Next.js's dev
server loads it for itself, but that's a separate process). Locally you must
`set -a && source .env.local && set +a` (bash) before `npx playwright test`, and the local Supabase
stack must be up (`npx supabase status` / Docker Desktop running) or `auth.setup.ts` fails with
`ECONNREFUSED 127.0.0.1:54321` instead of the env-var-missing error.
