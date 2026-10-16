---
name: learnings-extra-trusted-web-origins
description: VITE_EXTRA_WEB_APP_URLS (second trusted site during a host move) - one parser for wxt.config, web-bridge matches and the background sender check; Firefox MV3 never grants a site added in an update
metadata:
  type: reference
---

**What exists.** `src/lib/webAppOrigins.ts` resolves the list of web origins a build TRUSTS:
`VITE_WEB_APP_URL` (primary, first) plus comma-separated `VITE_EXTRA_WEB_APP_URLS`. Three
consumers use the same function so they can't drift: `externally_connectable.matches`
(wxt.config.ts, via `loadEnv`), the Firefox web bridge's content-script `matches`
(`import.meta.env`), and the background's relayed-message sender check (`WEB_APP_ORIGINS`).
Anything that BUILDS a URL (API calls, links, auth redirect, gecko `update_url`) stays on the
primary. The list is generic "extra", not "legacy": the primary can flip to the new host and the
old one becomes the extra.

**Gotchas.**
- The helper must stay dependency-free (no `@/`, no `@tabmerger/shared`): wxt.config.ts imports
  it by relative path at config load.
- Extras are parsed strictly and THROW (the build fails) rather than drop: a dropped entry ships a
  build the site can't reach. `new URL()` happily parses `*` in a host and ignores a trailing bare
  `?`/`#`, so wildcard/query/hash are checked on the raw string too. Ports are rejected except on
  localhost; http only for localhost in development mode.
- The primary keeps its old lenient rules (any http(s) URL, reduced to origin) so dev/e2e builds on
  `http://localhost:3000` are unaffected.
- Real env vars outrank `.env.<mode>`/`.env.local` in Vite's `loadEnv` and `import.meta.env`, so
  `VITE_EXTRA_WEB_APP_URLS=` (empty) in the build env pins "no extras". The manifest build test's
  `build(args, outDir, env)` uses this; any build test asserting an exact match count must pin it,
  or a local `.env.production` with extras breaks it.
- WXT sorts content-script `matches` alphabetically; `externally_connectable` keeps insertion
  order. Compare the content-script list as a set.
- In the background, the origin list is computed inside `main()`, so a unit test can
  `vi.stubEnv` and re-run `capturedMain()` on a fresh chrome stub without re-importing.
- `scripts/ci/check-manifest-permissions.mjs` does not compare `externally_connectable` and only
  reads the Chrome manifest (no content scripts), so extra origins never trip it.

**Firefox MV3 granting (read from Firefox 158's omni.ja: Extension.sys.mjs, AddonManager.sys.mjs).**
Content-script matches count as host origins (`getManifestOrigins`). With `originControls` (MV3)
they are optional, not required (`getRequiredPermissions` returns `origins: []`). They're granted
only on `ADDON_INSTALL` (`extensions.originControls.grantByDefault`, true in greprefs.js), never on
`ADDON_UPGRADE` (except enterprise policy). The update prompt compares only required permissions,
so a site added in an update causes NO prompt and is NOT granted: existing installs keep the old
site, and the new one stays off until the user allows it (extensions button on the site, or
about:addons > Permissions). Chrome: `externally_connectable` is not a permission, so no warning.
To read Firefox source locally: `unzip` (not Python's zipfile, which rejects omni.ja's layout)
the needed `modules/*.sys.mjs` from `Program Files/Mozilla Firefox/omni.ja` into the scratchpad.

**Firefox popup prompt (`WebAppConnectBanner`, `lib/webAppHostAccess.ts`).** Built on the same
`resolveTrustedWebAppOrigins` list (no second list). `permissions.request({ origins })` works for
content-script sites with no manifest change, because MV3 Firefox lists them as optional origins
(`manifestOptionalPermissions`). It must run synchronously in the click: `connect()` calls the
request first and awaits only after. Dismissal is stored as the list of dismissed patterns, so a
later build adding a different site brings the banner back. When the banner unmounts under a
focused button, focus goes to the next focusable element in document order, set from a
`useEffect` on `missing.length` (after commit) and only if focus fell to `body`. Playwright can't
load Firefox extensions, so e2e only guards that Chromium never shows it.
