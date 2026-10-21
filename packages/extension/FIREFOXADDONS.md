# Firefox Add-ons Listings — TabMerger

> Last Updated: 2026-10-20
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
- **Privacy policy URL:** https://tabmerger.com/privacy. **Support site:**
  https://tabmerger.com/contact. **Homepage:** https://tabmerger.com (moved from the
  `tabmerger.vercel.app` addresses on 2026-10-16).
- **Screenshots:** the same store images as Chrome (`packages/demo/screenshots/store/`); see the
  asset table and the outdated-screenshot warning in `CHROMEWEBSTORE.md`.
- **Notes to reviewer:** reuse "Notes for the review team" from `CHROMEWEBSTORE.md`, and add that
  the Firefox build includes one content script on the TabMerger website origin (below). No test
  account is needed for core features. Sentence to append: "Firefox only: a content script on the
  TabMerger site relays three messages (install check, sign-in handoff, sync) and reads nothing
  else."

## Permissions

Firefox ships the exact same `manifest.permissions` array as Chrome/Edge — see
`CHROMEWEBSTORE.md`'s [Permissions Justification](CHROMEWEBSTORE.md#permissions-justification)
table for the per-permission rationale (`tabs`, `tabGroups`, `storage`, `contextMenus`, `alarms`,
`notifications`, `identity`; re-verified 2026-10-11: `notifications` is used only for user-set
reminders, `alarms` for those reminders and for the automatic-backup schedule), plus the same
single OPTIONAL permission, `downloads` (re-verified 2026-10-12: asked for only when the user
turns on "Also save a file to this computer", used only to write backup files into the
Downloads folder and to show the user where the last one is: `downloads.search({ id })` for the
one file the extension wrote, `downloads.show(id)` and `downloads.showDefaultFolder()` behind a
"Show in folder" button. Desktop Firefox has all three (`search` since 47, the other two since
48); Firefox for Android removed the whole downloads API in 79, so there the button is disabled
with an explanation. Firefox's `show` answers `false` when it cannot show the file, and the
Downloads folder is opened instead. On Firefox the file is handed over as a blob URL because
Firefox does not accept `data:` URLs for downloads). No `host_permissions` on Firefox either, with one addition:

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
content script's `matches` origins differ, since they come from `VITE_WEB_APP_URL` plus
`VITE_EXTRA_WEB_APP_URLS` per build mode).

**Sites it runs on:** the TabMerger website only, two sites each while it moves to its own
domain. Stable: `https://tabmerger.vercel.app/*` and `https://tabmerger.com/*`. BETA:
`https://tabmerger-preview.vercel.app/*` and `https://preview.tabmerger.com/*`. Justification
to paste where AMO asks about site access: "Runs only on the TabMerger website (tabmerger.com,
and tabmerger.vercel.app while the site moves there) to relay three messages: install check,
sign-in handoff and sync request. Reads nothing else on the page."

**Granting (checked against Firefox 158's own add-on code):** in MV3 these sites are optional
host access, not required permissions. A new install grants all of them and lists them in the
install prompt (`extensions.originControls.grantByDefault`, on by default). An update shows no
prompt for a newly added site and does not grant it, so an existing install keeps working on the
sites it already had and the new site stays off until the user allows it: the extensions button
on that site, or about:addons, TabMerger, Permissions.

**The in-popup prompt (Firefox only):** so users don't have to find that setting, the popup shows
a one-line banner under the header, "Allow TabMerger on <site> so the website can find it and pass
your sign-in.", whenever one of the build's trusted sites is not granted
(`permissions.contains`, re-checked on every popup open and on `permissions.onAdded`/`onRemoved`).
Its **Allow** button opens a TabMerger tab (`site-access.html`, a Firefox-only extension page,
opened active) and then closes the popup itself (`window.close()`): opening a tab does not close
a Firefox popup, so without that the click looked like it did nothing. If the tab can't be opened
the popup stays open and the banner says so ("Couldn't open the site access tab. Try again, or
allow it in about:addons."). Firefox shows no permission prompt over an open browser-action popup:
it appears only after the popup closes, by which time the popup that asked is gone, so the grant
never reached the UI. The tab works out the missing sites itself (only the build's own trusted
sites, never anything from the URL) and shows one button, "Allow TabMerger on <site>" (the page tells the user to click it and confirm
in Firefox's prompt), which
calls `permissions.request({ origins })` from the click (Firefox needs the user action). Firefox
shows its permission prompt over the tab. On a grant the tab says so and tries to close itself;
a refusal says so and keeps the button. A grant from about:addons also updates it
(`permissions.onAdded`), and the popup banner disappears on the next open or permission change. The **dismiss** button hides it and remembers that in
`storage.local` (`webAppAccessDismissed`, the list of dismissed site patterns, on this device
only); it comes back only if a site that wasn't dismissed goes missing. No manifest change: in MV3
the content-script sites are requestable optional origins as they are. Chrome and Edge never show
it (`externally_connectable` needs no grant). Code: `src/components/WebAppConnectBanner.tsx`,
`src/components/SiteAccess/SiteAccessPage.tsx`, `src/entrypoints/site-access/`,
`src/lib/webAppHostAccess.ts`. For reviewers: "Firefox only: if an update added a TabMerger website
address that Firefox did not grant, the popup offers a button that opens a TabMerger page asking Firefox for access to
that one TabMerger site. Nothing is requested without the user's click on that page."

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
    (`src/lib/syncEngine.ts`'s `pushPendingChanges`, `src/lib/sessionUpload.ts`'s
    `pushSessionToSupabase` (saved sessions and automatic backups, which are sessions the
    background script saves on a schedule), `src/lib/deviceSessions.ts`'s device-session push — all gated on
    `canUploadOnFirefox()`; a denied/revoked permission pauses uploads, surfaced in Settings'
    Cloud sync row as "Sync paused: allow in Firefox", not a silent failure). End-to-end encrypted
    client-side before upload, but the ciphertext still leaves the browser, and Firefox's consent
    model is about what leaves the device, not whether the destination can read it. Reading the
    user's own automatic backups back from the account (`src/lib/autoBackupDownload.ts`, when
    Settings → Data is opened) is a download, not collection, so like every other pull it is
    not gated on this permission. That step also retries deletes of backups the user already
    made on this device. It never removes a local backup: one that is missing from the account
    (deleting in the web dashboard removes the cloud copy only) stays in the browser that has
    it and is not uploaded again. The optional
    backup FILE ("Also save a file to this computer") is written to the user's own Downloads
    folder and sent nowhere, so it is not a data-collection category; it is plaintext, and the
    setting says so.
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
   `https://preview.tabmerger.com/firefox-beta/updates.json`). Older betas carry the
   `tabmerger-preview.vercel.app` address, which serves the same file, so it must stay up.
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
(<https://tabmerger.com/terms>).

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
| Stable and BETA | set at release | (ignored by Firefox) | next release (unreleased) | — | Draft: adds the guided tour of the popup (starts once after a first install, never after an update; replay from the header "?" button or Settings, General). No manifest, permission or `data_collection_permissions` change: progress is one `storage.local` record, and the six tour usage events (started, completed, skipped, task done, step skipped, chapter skipped; step or chapter ids only) go through the existing `technicalAndInteraction`-gated analytics. The "try it" steps run on two sample groups the tour adds and removes itself, and on one spare tab of the extension's own (the packaged page `tour-practice.html`) that the "save a tab" step opens in the background and closes again; all of it is local-only (never synced, backed up, exported or shared, and the spare tab is left out of the other-devices snapshot), so no data-collection answer changes. The tour has seven chapters with a header each and fifteen "try it" steps (drag and drop, saving a tab, "Open in browser", "Deduplicate tabs", selecting items, search, undo and redo among them); during them nothing of the user's is opened, closed or changed. A thin pulsing ring marks the control to use next. Listing copy: the new Chrome description bullet applies unchanged |
| Stable and BETA | set at release | (ignored by Firefox) | next release (unreleased) | — | Draft: search matches only the text as typed (in sequence, any case; letters out of order no longer match, best matches first in the search list), highlights the matched text, hides or fades what does not match (new local setting, Hide by default), keeps the query until the user clears it, and covers "Now Open". No manifest, permission or `data_collection_permissions` change: the query stays in the popup's memory and the setting is local. Listing copy: the reworded Chrome search bullet applies unchanged. Screenshots: see the Chrome file's Screenshot Notes |
| Stable and BETA | set at release | (ignored by Firefox) | next release (unreleased) | — | Draft: the web-bridge content script also runs on the website's new domain (`tabmerger.com` next to `tabmerger.vercel.app`, `preview.tabmerger.com` next to `tabmerger-preview.vercel.app` for BETA). Manifest change: one more `content_scripts` match, no `host_permissions`, no `data_collection_permissions` change. Updating installs get no Firefox prompt and the new site is not granted, so the popup shows a banner with an "Allow" button that opens a TabMerger tab asking Firefox for that site (dismissible, remembered on the device; see "The in-popup prompt" above); new installs get both sites and never see it. Screenshots: the banner is Firefox-only and shows only on updated installs, so no store screenshot changes |
| Stable and BETA | set at release | (ignored by Firefox) | next release (unreleased) | — | Draft: fix: the "Allow TabMerger on <site>" banner's Allow button now opens a TabMerger tab that asks Firefox for the site, because Firefox shows no permission prompt over the popup (in 3.3.0 the click seemed to do nothing and the banner stayed). After opening the tab the popup now closes itself, since opening a tab leaves a Firefox popup open; if the tab can't be opened the banner shows a short error instead. The tab is a Firefox-only extension page (`site-access.html`). No manifest permission change. Screenshots: none |
| Stable and BETA | set at release | (ignored by Firefox) | next release (unreleased) | — | Draft: the add-on now talks to the website on its new domain: sign-in, sync, AI and checkout requests, links and the uninstall page go to `tabmerger.com` (stable) / `preview.tabmerger.com` (BETA), and the BETA `update_url` moves to `preview.tabmerger.com/firefox-beta/updates.json`. The old `vercel.app` hosts stay trusted. Manifest: the same two web-bridge `content_scripts` matches as the previous release, so no new site access and no prompt; installs that never clicked "Allow" for the new site still see the banner. No `data_collection_permissions` change |
| Stable and BETA | set at release | (ignored by Firefox) | next release (unreleased) | — | Draft: after the add-on is removed, Firefox opens the optional uninstall survey page (`/uninstalled` on the TabMerger website) via `runtime.setUninstallURL` (no permission). No manifest, permission or `data_collection_permissions` change: the address holds only the build's own version, browser and channel (constants of the build, nothing read from the user or device), and anything typed in the survey is sent by the web page, not the add-on |
| Stable and BETA | set at release | (ignored by Firefox) | next release (unreleased) | — | Draft: fix: Settings, General no longer shows a "Check for updates" button on Firefox, which has no `runtime.requestUpdateCheck`; on a normal AMO install the button always answered "This is a development build". It now says Firefox updates add-ons automatically and how to check by hand (about:addons, gear icon, Check for Updates). The "Version X is ready / Restart to update" banner is unchanged (`runtime.onUpdateAvailable` and `runtime.reload` exist on Firefox). No manifest, permission or `data_collection_permissions` change. Screenshots: none show Settings, General's update row |

## Notes for a future review / support request

- Free-tier users: all tab/group data stays in local IndexedDB and never leaves the device — same
  as every other build.
- Pro users who enable sync: data is end-to-end encrypted client-side before it reaches Supabase;
  see `CHROMEWEBSTORE.md`'s "Notes for the review team" and `src/lib/encryptionKey.ts`.
- AI features are currently disabled/"coming soon" behind `VITE_AI_ENABLED` in every build,
  Firefox included.
- Uninstall survey: on removal Firefox opens `<web app>/uninstalled?v=<version>&b=firefox&c=<stable|beta>`
  (`src/lib/uninstallSurvey.ts`). No identifier of any kind is in that address and the add-on sends
  nothing itself, so no data-collection category is declared for it.
- If AMO support asks about the web-bridge content script's site-access permission, point them at
  the "Firefox-only web-bridge content script" section above and the exact three message types it
  relays.
