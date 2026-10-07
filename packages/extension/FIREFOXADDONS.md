# Firefox Add-ons Listings — TabMerger

> Last Updated: 2026-10-06
>
> **State of the stable add-on:** the public AMO listing is still the v2 build (`2.0.0`). The
> first v3 stable release is planned as `v3.1.0` and is not yet released. The listing copy,
> permission justifications and data-use answers for it are in `CHROMEWEBSTORE.md` (same
> extension, same facts); Firefox-specific differences are below.
>
> The Firefox counterpart of `CHROMEWEBSTORE.md` — everything filled into Mozilla's Add-on
> Developer Hub (addons.mozilla.org, "AMO") and the unlisted self-distribution pipeline. Manifest
> facts here are pulled from `wxt.config.ts`; keep this file in sync with that file, not the
> other way around.

## Two add-ons, two very different distribution models

Unlike Chrome (one store, two listings), Firefox has **two separate add-ons on two separate
distribution paths** — AMO dropped beta versions for *listed* add-ons in 2019, so there's no
Firefox equivalent of the Chrome BETA item's private-listing tester gating.

| | Stable (listed) | BETA (unlisted, self-distributed) |
|---|---|---|
| Gecko ID (`browser_specific_settings.gecko.id`) | `{19feb84f-3a0b-4ca3-bbae-211b52eb158b}` | `tabmerger-beta@lbragile.com` |
| Listing | [addons.mozilla.org/firefox/addon/tabmerger](https://addons.mozilla.org/firefox/addon/tabmerger/) | None — no AMO listing page. Installed directly from a hosted `.xpi` link |
| Current version live | `2.0.0` (**outdated** — the AMO listing has not been updated since the 2.0 rewrite; see Version History below) | Tracks the same `3.1.0-beta.N` line Chrome BETA testers get |
| Who can install | Anyone, via the AMO listing page | Anyone with the link (unlisted add-ons cannot be gated — see Access control below) |
| Review | Full AMO review per release | Automated signing for unlisted submissions (`web-ext sign --channel unlisted`), typically minutes; may be flagged for manual review |
| Updates | From AMO itself — **no `gecko.update_url`** (setting one would make AMO's validator treat it as self-distributed) | `gecko.update_url` → a hosted `updates.json`, checked by Firefox roughly every 24h |
| Minimum Firefox (`strict_min_version`) | 140 desktop, 142 Android (`gecko_android`) | Same |
| Where it's built | `wxt build -b firefox` / `wxt zip -b firefox` (default mode) | `wxt zip -b firefox --mode beta` |
| Hosting for CI-published files | AMO itself | Vercel Blob, fronted by the web app at `<beta web app>/firefox-beta/` (see Distribution below) |

**The stable Gecko ID must never change.** AMO identifies an add-on only by this GUID; the 2.0
rewrite briefly used a different ID (`tabmerger@lbragile.com`), which would have orphaned every
existing Firefox user (~142 daily users per the spec) since AMO would treat it as a new,
unrelated add-on. This was restored to the live listing's real GUID in `wxt.config.ts`.

## Listing copy (stable)

- **Name:** TabMerger. **Summary** (AMO limit 250 characters): reuse the Chrome short description
  from `CHROMEWEBSTORE.md` (122 characters): "Save open tabs into named, color-coded groups and
  restore them anytime. Works offline, with optional encrypted sync (Pro)."
- **Description:** reuse the Chrome "Detailed Description" from `CHROMEWEBSTORE.md` with these
  Firefox adjustments: keyboard shortcuts are rebound at `about:addons` (gear menu, "Manage
  Extension Shortcuts"); restoring saved browser tab groups depends on the browser exposing the
  tab-groups API, so drop that bullet if reviewers on Firefox see no effect; private windows
  reopen as private only when "Run in Private Windows" is allowed for the add-on. AI features
  stay out of the copy (off in every build).
- **Privacy policy URL:** https://tabmerger.vercel.app/privacy. **Support site:**
  https://tabmerger.vercel.app/contact. **Homepage:** https://tabmerger.vercel.app.
- **Screenshots:** the same store images as Chrome (`packages/demo/screenshots/store/`); see the
  asset table and the outdated-screenshot warning in `CHROMEWEBSTORE.md`.
- **Notes to reviewer:** reuse "Notes for the review team" from `CHROMEWEBSTORE.md`, and add that
  the Firefox build includes one content script on the TabMerger website origin (below). No test
  account is needed for core features.

## Permissions

Firefox ships the exact same `manifest.permissions` array as Chrome/Edge — see
`CHROMEWEBSTORE.md`'s [Permissions Justification](CHROMEWEBSTORE.md#permissions-justification)
table for the per-permission rationale (`tabs`, `tabGroups`, `storage`, `contextMenus`, `alarms`,
`notifications`, `identity`; re-verified 2026-10-06: `alarms` and `notifications` are used only
for user-set reminders). No `host_permissions` on Firefox either, with one addition:

### The Firefox-only web-bridge content script

Firefox doesn't support `externally_connectable` for web pages
([bug 1319168](https://bugzil.la/1319168)), so `chrome.runtime.sendMessage(extensionId, ...)`
calls from the TabMerger website (install detection `PING`, sign-in handoff `SYNC_AUTH`, and the
dashboard's `SYNC_NOW` button) silently fail there. `src/entrypoints/web-bridge.content.ts` relays
the same three message types between `window.postMessage` (page side) and
`chrome.runtime.sendMessage` (background script side), and is scoped to Firefox only
(`include: ['firefox']` — never reaches the Chrome/Edge manifest, no permission change for those
users). Full permission-request wording and scope: see
`CHROMEWEBSTORE.md`'s ["Firefox permission note"](CHROMEWEBSTORE.md#firefox-permission-note-web-bridgecontentts)
section (the fact pattern is identical for both the stable and beta Firefox add-ons — only the
content script's `matches` origin differs, since it reads `VITE_WEB_APP_URL` per build mode).

## Data collection declaration (`data_collection_permissions`)

AMO requires new submissions to declare `browser_specific_settings.gecko.data_collection_permissions`
("Firefox Built-in Data Collection Consent" — **mandatory for new add-ons from
2025-11-03**, so the beta add-on's new Gecko ID must comply from its first submission; the
already-live stable listing can adopt on its own extended timeline, but this repo declares the
same block for both so the two builds never drift). Both Firefox add-ons declare the identical
block, set in `wxt.config.ts`'s `manifest()` for any `browser === "firefox"` build, from one
shared typed constant (`packages/shared/src/constants/firefoxDataConsent.ts`'s
`FIREFOX_DATA_CONSENT_CATEGORIES`) — the same list feeds `src/lib/dataConsent.ts`'s runtime
`permissions.request()` calls, so the manifest declaration and what the extension actually
requests at runtime can never drift apart:

```json
"data_collection_permissions": {
  "required": ["none"],
  "optional": [
    "technicalAndInteraction",
    "browsingActivity",
    "authenticationInfo",
    "personallyIdentifyingInfo"
  ]
}
```

**Critical rule this declaration must respect (extensionworkshop.com, "Firefox Built-in Data
Collection Consent"):** optional categories are **not granted by default**. Declaring a category
here only makes it *available* to request — the add-on must call
`browser.permissions.request({ data_collection: [...] })` from a user-activated handler (a click,
synchronously, before any `await`) and must not collect/transmit that category until the promise
resolves `true`. `technicalAndInteraction` is the one exception Firefox handles differently: it
shows as an install-time opt-in checkbox rather than a runtime prompt, but analytics code must
still check it reads back as granted before sending anything — it is not granted by default either.

Why this shape, mirroring `CHROMEWEBSTORE.md`'s
["Privacy & Data Use"](CHROMEWEBSTORE.md#privacy--data-use) table — what TabMerger actually
transmits and where consent is requested:

- `required: ["none"]` — none of TabMerger's data collection is required for the extension's core,
  offline, free-tier functionality. AMO's schema requires `required` to be present; `"none"` is
  only valid there, and only alone.
- `optional`:
  - `technicalAndInteraction` — anonymous GA4/PostHog usage events (`src/lib/analytics.ts`).
    Gated in `trackEvent`/`trackPostHogEvent`: on Firefox, no event is sent unless this reads
    back as granted. AMO's schema only permits this category under `optional`, never `required`.
  - `browsingActivity` (URLs/domains visited) — tab URLs sent to the opt-in page-image preview
    (`src/lib/tabAccess.ts`'s `/api/og-preview` call, gated in
    `src/components/Windows/TabPreview.tsx` — requested when Settings → "Show page images in
    previews" is turned on, and re-checked on every hover so a mid-session revocation in
    about:addons is respected) and tab URLs/titles included in cloud sync uploads
    (`src/lib/syncEngine.ts`'s `pushPendingChanges`, `src/hooks/useSessions.ts`'s
    `pushSessionToSupabase`, `src/lib/deviceSessions.ts`'s device-session push — all gated on
    `canUploadOnFirefox()`; a denied/revoked permission pauses uploads, surfaced in Settings'
    Cloud sync row as "Sync paused: allow in Firefox", not a silent failure). End-to-end encrypted
    client-side before upload, but the ciphertext still leaves the browser, and Firefox's consent
    model is about what leaves the device, not whether the destination can read it.
  - `authenticationInfo` / `personallyIdentifyingInfo` — email + Supabase session on sign-in.
    Requested in `src/components/Modal/Auth.tsx`, synchronously in the click/submit handler,
    before every sign-in entry point proceeds (email/password sign-in, sign-up, magic link,
    Google OAuth) — since signing in also enables sync. A denial blocks the sign-in attempt and
    shows an inline message plus a toast. The website-driven `SYNC_AUTH` bridge message
    (`src/entrypoints/background.ts`, Firefox-only relay path) has no user gesture to hang a
    prompt off of, so it's accepted only if these categories were already granted on this device;
    otherwise it replies `{ ok: false, reason: 'consent_required' }`
    (`SYNC_AUTH_CONSENT_REQUIRED_REASON` in `packages/shared/src/constants/extensionMessages.ts`,
    for the web side to consume in a future change) rather than silently handing over a session
    with no permission to use it. `PING` is never gated.

No `websiteContent` (page text/images) or `financialAndPaymentInfo`/health/location/communications
categories — nothing here transmits page content off-device, Stripe/billing is handled entirely by
the web app, and TabMerger never collects health/location/communications data.

**Which builds actually send analytics (checked 2026-10-06).** `publish.yml` sets no
`VITE_POSTHOG_API_KEY` and no `VITE_SENTRY_DSN`, so PostHog and Sentry are inactive in every
published build (stable and beta). The anonymous GA4 events go through the website's `/api/track`
proxy and, on Firefox, only after `technicalAndInteraction` is granted. The extension also asks
Google's favicon service for a site's icon by origin when the browser supplies none; see
`CHROMEWEBSTORE.md`'s Data Collection table for the full category mapping and code evidence.

Build-output tests assert this exact shape and that Chrome/Edge manifests never carry the key
(it's Firefox-specific): `src/__tests__/manifest/manifest.build.test.ts` (`pnpm test:manifest`).
Runtime consent gating has unit coverage in `src/__tests__/unit/lib/dataConsent.test.ts` plus
per-surface tests (analytics, Auth modal, Settings' preview-images toggle, TabPreview,
syncEngine/useSessions/deviceSessions, background.ts's SYNC_AUTH handler).

## Distribution and update mechanism

### Stable

Installed from the AMO listing; updates come from AMO's own infrastructure (no `update_url` in
the manifest — see the build test above).

### BETA (unlisted, self-distributed)

1. CI (`devops`-owned, `.github/workflows/publish.yml`) builds `wxt zip -b firefox --mode beta`,
   then signs the result with `web-ext sign --channel unlisted` using the `FIREFOX_API_KEY` /
   `FIREFOX_API_SECRET` secrets.
2. The signed `.xpi` and a regenerated `updates.json` are uploaded to Vercel Blob under the shared
   `FIREFOX_BETA.PATH` (`/firefox-beta`, `packages/shared/src/constants/firefoxBeta.ts` —
   the single source of truth for these path/file-name strings across the extension, web app, and
   CI). The web app forwards that path on its own domain, giving the beta a stable URL:
   `<beta web app>/firefox-beta/updates.json` (e.g.
   `https://tabmerger-preview.vercel.app/firefox-beta/updates.json`).
3. The beta build's `gecko.update_url` (set in `wxt.config.ts`, only for `browser === "firefox"`
   and `mode === "beta"`) points at that exact URL. **If the beta build has no `VITE_WEB_APP_URL`
   set, the build fails loudly** (`scripts/firefoxBetaUpdateUrl.ts`) rather than shipping a beta
   that can never receive another update.
4. Firefox checks `update_url` roughly every 24h and installs the newest signed `.xpi` it finds
   there automatically — testers never need to manually reinstall.
5. Testers install for the first time via the `LATEST_XPI_FILE` link
   (`<beta web app>/firefox-beta/tabmerger-beta.xpi`, always the newest build) surfaced on the
   `/beta` marketing page (web-dev owned).

### Version badge (Settings modal)

Firefox drops Chrome's `version_name` manifest field entirely (it's Chrome-specific, not part of
the WebExtensions spec), so `chrome.runtime.getManifest().version_name` always reads `undefined`
on Firefox — even though `wxt.config.ts` sets it for every browser via
`scripts/manifestVersion.ts`'s beta offset mapping. Without a fix, the Settings badge would show
Firefox testers the offset store version (e.g. `4.1.0.6`) instead of the real semver
(`3.1.0-beta.6`) they're asked to report in bug reports.

Fix: `wxt.config.ts`'s `vite().define` injects `__TABMERGER_VERSION__` — the same raw semver
string fed into `resolveManifestVersion` — as a build-time constant (declared in `src/env.d.ts`).
`src/components/Modal/Settings.tsx`'s version badge falls back to it specifically when running on
Firefox (detected via `navigator.userAgent`), after `version_name` and before `manifest.version`.
Chrome and Edge are unaffected — `version_name` is present there and still wins.

## Access control

Unlisted Firefox add-ons **cannot be gated** — anyone with the `.xpi` or `updates.json` link can
install. There is no Firefox equivalent of the Chrome BETA listing's Google Group tester
allowlist. The Google Group (`tabmerger-beta-testers@googlegroups.com`) is still where the link is
*shared*, but it is not enforcement. Acceptable for a beta channel; documented here so it isn't
mistaken for real access control later.

## License

The code is licensed under `LICENSE.md` (PolyForm Strict 1.0.0 plus an all-rights-reserved
preface); using the add-on is governed by the Terms of Service
(<https://tabmerger.vercel.app/terms>).

- **Stable (listed) — AMO asks for a license.** Choose **"All Rights Reserved"**; the old GPL-3.0
  choice no longer applies to TabMerger 3.x.
- **Beta (unlisted)** — no license field; the same terms apply.
- **Source code submission** — AMO reviewers may need the unminified source for a listed version.
  Handing it to Mozilla for review is the copyright holder's own disclosure, not a distribution
  under the license, so it's fine under these terms.

## Minimum Firefox version and AMO validator warnings

`strict_min_version` is the oldest Firefox that has every API and manifest key the extension uses:
`data_collection_permissions` (desktop 140, Android 142), the `tabGroups` permission with
`tabs.group`/`tabGroups.*` (139), `storage.session` (115). It was `109.0` until 2026-09-29, and
signing `4.1.0.7` produced a validator warning for each of those APIs; raising it to 140/142
clears them. Raise it again whenever a newer API is adopted.

Two warnings remain and are expected; mention them if a reviewer asks:

- **"Unsafe assignment to innerHTML"** in the popup chunk: React DOM's own markup handling. No
  TabMerger code sets `innerHTML` or uses `dangerouslySetInnerHTML`.
- **"Unsafe call to import for argument 0"** in the background and popup: Vite's generated
  loader for code-split chunks, which only ever imports the extension's own bundled files. No
  TabMerger code calls `import()` with a computed path.

## Version History

Firefox shows only `version`: it drops `version_name`, so testers should quote the version in
TabMerger's Settings (the true semver).

| Listing | `version` (manifest) | `version_name` | Semver / tag | Date | Status |
|---|---|---|---|---|---|
| Stable (listed) | `2.0.0` | (ignored by Firefox) | `v2.0.0` | 2021-03-06 (GitHub release) | **Live: v2 `2.0.0` is the public AMO build today** |
| Stable (listed) | `3.1.0` | (ignored by Firefox) | `v3.1.0` (planned) | not yet released | **Planned: first v3 stable release.** Not yet submitted. Stable keeps the same plain semver as Chrome (no beta offset) |
| BETA (unlisted) | `4.1.0.7` | (ignored by Firefox) | `v3.1.0-beta.7` | 2026-09-29 | Signed; published to `/firefox-beta/`. Validator warnings above (min version 109 at the time) |
| BETA (unlisted) | `4.1.0.11` | (ignored by Firefox) | `v3.1.0-beta.11` | 2026-10-07 | Signed and published to the self-hosted beta channel by the publish workflow |

## Notes for a future review / support request

- Free-tier users: all tab/group data stays in local IndexedDB and never leaves the device — same
  as every other build.
- Pro users who enable sync: data is end-to-end encrypted client-side before it reaches Supabase;
  see `CHROMEWEBSTORE.md`'s "Notes for the review team" and `src/lib/encryptionKey.ts`.
- AI features are currently disabled/"coming soon" behind `VITE_AI_ENABLED` in every build,
  Firefox included.
- If AMO support asks about the web-bridge content script's site-access permission, point them at
  the "Firefox-only web-bridge content script" section above and the exact three message types it
  relays.
