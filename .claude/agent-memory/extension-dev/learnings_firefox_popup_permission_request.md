---
name: learnings-firefox-popup-permission-request
description: Firefox shows no permissions.request() doorhanger over an open browser-action popup; request from a Firefox-only extension tab (WXT manifest.include meta) instead
metadata:
  type: reference
---

Firefox shows no `permissions.request()` doorhanger over an open browser-action popup. The prompt
only appears after the popup closes. By then the popup that asked is gone, so its promise never
settles in a live page and the UI never updates. In the popup the click seems to do nothing, and
the grant shown later never reaches the UI. Unit tests can't catch this because they mock
`chrome.permissions.request` as resolving at once. Only a real Firefox install shows it.

Fix pattern (the site-access banner, `components/WebAppConnectBanner.tsx`):
- The popup button calls `chrome.tabs.create({ url: chrome.runtime.getURL('/site-access.html') })`,
  which closes the popup. It never calls `permissions.request` itself.
- The tab (`entrypoints/site-access/`, component `components/SiteAccess/SiteAccessPage.tsx`) works
  out what is missing itself (`getMissingWebAppHostPatterns()`), with nothing taken from the URL.
  Its button calls `requestWebAppHostAccess(missing)` before any await. It listens to
  `permissions.onAdded`/`onRemoved` so a grant from about:addons also shows up. On a grant it
  tries `window.close()`, which works for extension-opened tabs, and keeps the message if that fails.
- The popup banner already rechecks on open and on `permissions.onAdded`, so it hides by itself.

WXT 0.20 per-browser HTML entrypoint: `<meta name="manifest.include" content="['firefox']" />` in
the page's `index.html`. WXT parses every `manifest.*`/`wxt.*` meta with JSON5
(`find-entrypoints.mjs` `importHtmlEntrypoint`) and `isEntrypointSkipped` drops it for browsers
not listed. Verified: `build:firefox` emits `site-access.html`, and the Chrome build has no file
or chunk for it. An unlisted page needs no manifest entry, and `tabs.create` on its own
extension URL needs no permission.

Reusing the popup's CSS on a full tab: `globals.css` fixes `body` at 800×600 with
`overflow: hidden`. The page's `<head>` overrides that with `html body { width:auto; height:auto;
min-height:100vh; overflow:auto }`. The higher specificity matters because Vite puts the CSS
`<link>` after the inline `<style>`. Theme comes from the same `<script src="/theme-init.js">`,
because extension pages share one origin and so one `localStorage`. Tailwind v4 picks up the new
component's classes automatically, with no config change.

Test-env note: the `web-bridge.content` "matches only the configured web app origin" unit test
reads `VITE_EXTRA_WEB_APP_URLS` from the local env files. If a local env file sets that variable,
run the suite with `VITE_EXTRA_WEB_APP_URLS=` (empty) to match CI. Related:
[[learnings-firefox-data-consent]], [[learnings-extra-trusted-web-origins]].
