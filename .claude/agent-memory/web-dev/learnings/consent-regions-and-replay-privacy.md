---
name: consent-regions-and-replay-privacy
description: Region-based consent via a proxy-set cookie on static pages, GPC client-side, testing proxy cookies, and keeping decrypted data / #key out of PostHog (ph-no-capture vs portals, disable_capture_url_hashes, before_send)
metadata:
  type: reference
---

**Region cookie, static pages.** `proxy.ts` sets `tm_consent_region` from `x-vercel-ip-country`
on every page response via `withConsentRegion`. Any new page response in `proxy()` (redirects
included) must be wrapped, or that visitor defaults to opt-in. Test with `res.headers.getSetCookie()`.
`CONSENT_REGION_OVERRIDE` is read per request, so `vi.stubEnv` works without reloading the module;
verified on `next start` too. The Playwright e2e drives regions by adding the header only for
same-origin requests via `page.route` (`extraHTTPHeaders` would also hit third-party requests).

**GPC** is read client-side only (`navigator.globalPrivacyControl`). Browsers that send `Sec-GPC`
expose it too, and reading the header server-side would make the pages dynamic.

**Analytics load deferred.** `DeferredOnLoad` waits up to 6 s plus idle time, so a network check
needs a wait of 10 s or more; 2.5 s showed "nothing loaded" even in opt-out.

**PostHog privacy (posthog-js 1.409):** `disable_capture_url_hashes: true` strips fragments from
$current_url, $initial_current_url, $session_entry_url, autocapture hrefs and the replay meta
href. `ph-no-capture` blocks replay (rrweb blockClass) and autocapture, checking ancestors up to
(not including) `<body>`. Radix portals render outside any container, so use
`session_recording.blockSelector` for `[data-radix-popper-content-wrapper]`/dialogs. Drop
interaction events on private paths in `before_send`. The replay URL blocklist is remote-config
only. gtag.js already drops the fragment from `dl`/page_location (checked with the real script).
Vercel Web Analytics logs the full URL including `#key` in dev debug mode.
Related: [[cookie-consent-analytics]], [[i18n-next-intl]].
