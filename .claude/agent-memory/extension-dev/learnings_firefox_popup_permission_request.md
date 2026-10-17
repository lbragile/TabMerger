---
name: learnings-firefox-popup-permission-request
description: Firefox shows no permissions.request() doorhanger over an open browser-action popup, and tabs.create does not close the popup; open a Firefox-only extension tab, then window.close() the popup
metadata:
  type: reference
---

Firefox shows no `permissions.request()` doorhanger over an open browser-action popup. The prompt
only appears after the popup closes. By then the popup that asked is gone, so its promise never
settles in a live page and the UI never updates. In the popup the click seems to do nothing, and
the grant shown later never reaches the UI. Unit tests can't catch this because they mock
`chrome.permissions.request` as resolving at once. Only a real Firefox install shows it.

Fix pattern (the site-access banner, `components/WebAppConnectBanner.tsx`):
- The popup button calls `chrome.tabs.create({ url: chrome.runtime.getURL('/site-access.html'), active: true })`
  and then `closePopupView()` (`window.close()`, skipped when `extension.getViews({type:'popup'})`
  doesn't include this window, i.e. `popup.html` open as a plain tab). It never calls
  `permissions.request` itself. On a failed open the popup stays and the banner shows a
  `role="alert"` message (the `<p role="alert">` is always mounted so the text gets announced).
- **Opening a tab does NOT close a Firefox popup.** Measured in headless Firefox 158: `tabs.create`
  from the popup resolves with `active: true`, but `getViews({type:'popup'})` still lists the popup
  seconds later. With an explicit `window.close()` it is gone within ~200 ms. Measure that from a
  separate BiDi evaluate: while one long async evaluate keeps polling, the closing popup stays
  listed until that evaluate returns.
- A real BiDi `input.performActions` click on the tab's button opens the doorhanger
  (`PopupNotifications._currentNotifications` has `addon-webext-permissions`, read from the
  `{'moz:scope':'chrome'}` context). A `script.evaluate` with `userActivation: true` plus
  `el.click()` does NOT count as user input there: `permissions.request` rejects at once.
- Harness gotchas: install opens no extension tab, so navigate `about:home` to `popup.html`. Set
  `tm_tour` to `{status:'done'}` first, or the tour's inert root swallows `el.click()` in the popup.
  `ff.kill()` leaves headless children holding the profile, so kill with `taskkill /PID <pid> /T /F`
  and use a fresh profile dir and port per run.
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
