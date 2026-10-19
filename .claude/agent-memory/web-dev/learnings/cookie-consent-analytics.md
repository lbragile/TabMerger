---
name: cookie-consent-analytics
description: Cookie consent gating for GA4 (Consent Mode v2) and posthog-js; why @next/third-parties GoogleAnalytics was dropped, gtag `arguments` trap, posthog memory persistence vs cookieless_mode, leftover session-storage keys and the opt-out flag that must stay
metadata:
  type: reference
---

Consent lives in `lib/consent.ts` (`tm_consent` cookie + a tiny subscribe store). GA loads through
`components/consent/ConsentedGoogleAnalytics.tsx` -> `loadGoogleAnalytics()` in `lib/analytics.ts`;
PostHog through `applyPostHogConsent()` in `components/posthog-provider.tsx`.

**@next/third-parties `<GoogleAnalytics>` can't do Consent Mode.** Its inline `next/script` runs
`gtag('js')` + `gtag('config')` with no hook for a `consent default` first, and next/script injects
from an effect, so "push the default from a parent effect" races (child effects run first). Load
gtag yourself: dataLayer, `consent default` (all denied), optional `consent update` granted, `js`,
`config`, then append the script.

**gtag must push `arguments`, not an array.** `function gtag(){ dataLayer.push(arguments) }`.
A rest-args version (`(...a) => dataLayer.push(a)`) silently breaks consent/config commands. The
repo's ESLint does not flag `arguments` here, so no disable comment is needed (an unused one fails
`--max-warnings 0`). Tests: `Array.from(entry)` to compare queued commands.

**posthog-js `cookieless_mode` needs a PostHog project setting** (its own JSDoc: events are dropped
otherwise). `persistence: 'memory'` + `disable_session_recording: true` needs nothing server-side;
verified with the real library in jsdom that it writes no cookie, localStorage or sessionStorage.
Switching at runtime: `set_config({ persistence: 'localStorage+cookie', disable_persistence: false })`
+ `startSessionRecording()`; back: `stopSessionRecording()`, `opt_out_capturing()`,
`set_config({ persistence: 'memory', disable_persistence: true })`.

**What Reject leaves behind.** `disable_persistence` removes the `ph_<key>_posthog` cookie and
localStorage entry, but sessionStorage keeps `ph_<key>_posthog`, `ph_<key>_window_id` and
`ph_<key>_primary_window_exists`, so sweep them yourself. `opt_out_capturing()` writes
`__ph_opt_in_out_<key>` to localStorage. Leave that one: `ConsentManager` re-reads it on every
`isOptedOut()`, so deleting it turns a running instance back on. On a later Accept (even on a new
page load), `has_opted_out_capturing()` is still true, so call `opt_in_capturing()` or nothing
gets captured.

**Debugging real posthog-js in vitest:** `console.log` from a test did not show in the run output
here. Append to a file in the scratchpad instead. Point `api_host` at `http://127.0.0.1:9` so
nothing leaves the machine.

**Banner test patterns:** `useSyncExternalStore` with a server snapshot of "has a choice" keeps the
banner out of SSR, so there's no hydration mismatch. Give Accept and Reject the same width with
`grid grid-cols-2` (with `flex` they differed by label length, e.g. "Akzeptieren" vs "Ablehnen").
Related: [[i18n-next-intl]], [[server-side-ga4-events]].
