/**
 * Whether this page load is an automated test run rather than a real visitor, so analytics
 * providers can skip loading real scripts (gtag.js, posthog-js) even when consent is granted.
 *
 * Why this exists: e2e's authenticated storage state now records a stored "granted" consent
 * choice (so other e2e specs don't have to click through the banner), which means Playwright
 * runs against a real dev/preview server would otherwise make genuine network calls to Google
 * Analytics and PostHog with test traffic — inflating event counts and session/replay data with
 * noise that isn't a real visitor.
 *
 * Vitest unit tests need no signal here: they mock `posthog-js` and never execute the inserted
 * gtag.js `<script>` tag (jsdom doesn't run scripts it didn't parse from real page content), so
 * no real network call happens whether or not this guard fires. Only e2e and visual regression
 * drive a real browser against a real (or real-ish) server with the real libraries, so two
 * browser-side signals:
 * - `NEXT_PUBLIC_E2E_TEST` — set by `playwright.config.ts`'s `webServer.env` for both e2e and
 *   visual regression runs (same config, same `pnpm dev` server). Inlined into the client bundle
 *   by Next.js like any `NEXT_PUBLIC_*` var, so it's readable here even though this check runs
 *   in the browser.
 * - `navigator.webdriver === true` — Playwright (and most automated browsers) set this on every
 *   page it drives, so it also catches a run where the env var wasn't wired through for some
 *   reason (belt and suspenders, not the primary signal — some real visitors use automation
 *   tools too, but none of them should be driving our own e2e server).
 */
export function isAutomatedTestEnvironment(): boolean {
  if (process.env.NEXT_PUBLIC_E2E_TEST === 'true') return true
  if (typeof navigator !== 'undefined' && navigator.webdriver === true) return true
  return false
}
