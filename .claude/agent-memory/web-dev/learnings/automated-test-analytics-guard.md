---
name: automated-test-analytics-guard
description: How GA4 (gtag.js) and posthog-js are kept from loading real scripts during e2e/visual Playwright runs even once consent is granted, and why Vitest needed no separate signal
metadata:
  type: reference
---

`lib/isAutomatedTestEnvironment.ts` is the single guard checked at the top of
`ConsentedGoogleAnalytics`'s effect and `PostHogProvider`'s effect, before either reads
`getEffectiveConsent()`. It returns true for `NEXT_PUBLIC_E2E_TEST === 'true'` (set via
`playwright.config.ts`'s `webServer.env`, shared by e2e and visual regression since both use one
config) or `navigator.webdriver === true` (Playwright's own browser flag, belt-and-suspenders).

**Why Vitest needed no third signal, even though it also runs in `NODE_ENV=test`.** Unit tests
never execute the real libraries: `posthog-provider.test.tsx` mocks `posthog-js` entirely via
`vi.mock`, and `loadGoogleAnalytics` only inserts a `<script>` element — jsdom doesn't fetch or
execute script `src` attributes it didn't parse from real page markup, so no real request leaves
the process either way. Adding `process.env.VITEST`/`NODE_ENV === 'test'` to the guard was tried
first and reverted: it made `isAutomatedTestEnvironment()` always true under Vitest, which broke
`posthog-provider.test.tsx`'s assertions that `fake.init` gets called on consent-granted (the test
renders the real component and checks the mocked library was invoked — a guard that no-ops the
effect entirely skips that call). Keep the guard browser-signal-only; if a future test needs to
simulate "blocked", mock `@/lib/isAutomatedTestEnvironment` directly rather than relying on the
ambient env.

**`reuseExistingServer` locally.** `playwright.config.ts`'s `webServer.env` only takes effect on a
fresh `pnpm dev` start; a dev server already running from before this change (common locally,
since `reuseExistingServer: !CI` reuses it) won't have `NEXT_PUBLIC_E2E_TEST` set until restarted.

Related: [[cookie-consent-analytics]], [[consent-regions-and-replay-privacy]].
