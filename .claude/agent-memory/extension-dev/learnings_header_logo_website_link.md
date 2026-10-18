---
name: learnings-header-logo-website-link
description: Header logo links to the build's website in the popup language; content-sized link keeps the visual spec's neutral pointer spot; e2e oracle for "does this build have a web app URL"
metadata:
  type: reference
---

The header logo is an `<a>` to `websiteHomeUrl(import.meta.env.VITE_WEB_APP_URL, activeLocale())`
(`src/lib/websiteLink.ts`): origin plus `/<locale>` for EVERY shipped locale, English included;
an unknown tag and the pseudo-locale give `/en`. Why `/en` and not `/`: the web app routes
`as-needed` with locale detection, so `/` follows the visitor's `NEXT_LOCALE` cookie (an old
`de` cookie sends an English popup's link to `/de`), while `/en` redirects to `/` AND sets the
cookie to `en`. Any link meant to open the site in a given language must carry the prefix. An invalid or missing
env value renders the old plain logo. Clicks go through `openInNewTab` (`chrome.tabs.create`,
`window.open` if that rejects, plain `target="_blank"` if the API is missing).

- **Keep the link sized to its content.** `e2e/tests/visual.spec.ts` parks the pointer at
  `NEUTRAL_POINT = { x: 120, y: 20 }`, inside the 240px logo cell but right of the logo text
  (the link ends near x=107 at 800x600). Stretching the link across the cell would put a hover
  style and a tooltip under the parked pointer and break every visual shot.
- **The 240px cell stays the header's first child** (`sidePanelAndHeader.test.tsx` reads
  `header.firstElementChild.style.width`); the link goes inside it, never replaces it.
- **Focus ring**: `outline-2 outline-offset-2` fits inside the cell's `px-3` and the 12px above
  and below, so no inset ring is needed.
- **E2E oracle for the web app URL.** CI builds have no `.env.production`, so `VITE_WEB_APP_URL`
  is unset there while local builds have one. A spec can ask the build itself:
  `chrome.runtime.getManifest().externally_connectable?.matches?.[0]` is `<primary origin>/*`
  exactly when the bundle got a URL (wxt.config.ts derives it from the same env), so assert the
  link's href in one case and its absence in the other (`language.spec.ts`).
- Unit tests change the URL per case with `vi.stubEnv('VITE_WEB_APP_URL', …)` +
  `vi.unstubAllEnvs()`; the value is read at render time, so no module reset is needed.
