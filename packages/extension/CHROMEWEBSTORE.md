# Chrome Web Store Listing — TabMerger

> Last Updated: 2026-09-26
>
> This file tracks everything filled into the Chrome Developer Dashboard for **both** TabMerger
> Chrome Web Store items — see [Two listings](#two-listings) below. Manifest facts here are
> pulled from `wxt.config.ts`; keep this file in sync with that file, not the other way around.

## Two listings

| | Stable (public) | BETA (private) |
|---|---|---|
| Manifest `name` | `TabMerger` | `TabMerger BETA` |
| Extension ID | `inmiajapbpafmhjleiebcamfhkfnlgoc` | `nboljhidpjakiohfdkdjkcljdehcapcd` (also the `CHROME_BETA_EXTENSION_ID` repo secret; an item ID is public, it's in the listing URL) |
| Listing URL | <https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc> | <https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd> |
| Visibility | Public | Private / trusted testers: members of the Google Group `tabmerger-beta-testers@googlegroups.com` (<https://groups.google.com/g/tabmerger-beta-testers>) |
| Built from | `wxt zip` (default mode) on a non-prerelease `release` event | `wxt zip -b chrome --mode beta` on any prerelease `release` event, or manual `workflow_dispatch` |
| Published by CI | Uploaded only (`chrome-webstore-upload-cli@4 upload`) — a human presses Publish | Auto-published (`chrome-webstore-upload-cli@4`, no subcommand) |
| `manifest.version` | Real semver, e.g. `3.1.0` | Offset mapping — see `scripts/manifestVersion.ts` (major +1, prerelease `N` becomes a 4th integer) |
| `version_name` | Not set (version is already valid semver) | The real semver string, e.g. `3.1.0-beta.4` |

Both listings ship the identical codebase; only the manifest `name`/description/version differ
per `wxt.config.ts`'s `getExtensionName()` and the beta/stable branches of the `manifest()` fn.
See `docs/PUBLISHING.md` and `.claude/plans/release-and-beta-channel-spec.md` for how builds and
publishing are wired.

---

## Store Listing — Stable

**Extension Name** [REQUIRED]
TabMerger

<!-- Must match manifest.json "name" exactly — getExtensionName() returns "TabMerger" for any
     mode other than "beta"/"development". -->

**Short Description** [REQUIRED]
Save, organize, and restore your browser tabs — with optional encrypted cloud sync.

<!-- TODO (owner): tighten to ≤132 characters if the dashboard rejects this; verify count at
     submission time. -->

**Detailed Description** [REQUIRED]

Stop drowning in tabs. TabMerger lets you save open tabs into named, color-coded groups, then
restore any group — or just the window you need — later.

Key features: save the current tab, all tabs, or tabs to the left/right/other with one click or
a keyboard shortcut; drag and drop to reorganize tabs, windows, and groups; a "Now Open" view
that always reflects your live browser tabs; light and dark themes; right-click context menu
actions. Pro subscribers get end-to-end encrypted cloud sync across devices and saved sessions,
so your groups are backed up and available everywhere you sign in.

To get started, click the TabMerger icon to open the popup, then use the toolbar buttons or
keyboard shortcuts to save tabs into a group. Drag tabs between groups and windows to
reorganize, and use the sidebar to switch between groups.

TabMerger requests no permission to read or modify the content of the pages you visit. Tab data
(URLs, titles) stays in your browser's local storage unless you sign in and enable cloud sync,
at which point it is encrypted on your device before it ever reaches our servers — we cannot
read it. See the full privacy policy linked below.

Questions or feedback? Reach out through the support links on this listing.

<!-- TODO (owner): re-verify this against the current in-app feature set and word-count limit
     (16,000 chars) before submitting — description above is comprehensive but not exhaustive. -->

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Saves, organizes, and restores browser tabs into named groups.

**Primary Language** [REQUIRED]
English

---

## Store Listing — BETA

**Extension Name** [REQUIRED]
TabMerger BETA

**Short Description** [REQUIRED]
Private beta channel for TabMerger — for invited testers only.

**Detailed Description** [REQUIRED]
This is the private beta testing channel for TabMerger, distributed to a closed group of
trusted testers ahead of stable release. Functionality is identical to the stable listing
(see above) but may include in-progress features and is more likely to contain bugs. Do not
install unless you were invited to this testing program.

**Category**: Productivity
**Single Purpose**: Same as stable — pre-release testing channel for the TabMerger tab manager.
**Primary Language**: English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/public/icon/128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | TODO (owner) |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | TODO (owner) |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | TODO (owner) |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | TODO (owner) |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | TODO (owner) |

`packages/demo/` (Remotion + Playwright) is the intended source of store screenshots/promo
assets (`pnpm demo:screenshots`, `pnpm demo:store-assets`) — TODO (owner): confirm whether
those commands have been run and where their output lands, then update this table with real
filenames and check them into whatever path the store upload expects.

### Screenshot Notes

TODO (owner): describe what each screenshot should show once captured. Suggested shots based
on the current UI: (1) popup with several groups in the sidebar and the active group's windows
open, (2) drag-and-drop reordering a tab between windows, (3) the "Now Open" view next to a
saved group, (4) Settings → General showing dark mode, (5) the sync/entitlements upgrade prompt.

---

## Permissions Justification

All permissions below come directly from `wxt.config.ts`'s `manifest.permissions` array. There
are **no `host_permissions`** of any kind (required or optional) — deliberately, per that
file's own comment, to keep the extension out of the store's elevated review tier for reading
page content. Tab preview's OG-image fetch is done server-side by the web app
(`packages/web/app/api/og-preview`), not by the extension, and is **off by default** — see
"Show page images in previews" under Data Collection below.

| Permission | Type | Justification |
|------------|------|----------------|
| `tabs` | permissions | Read tab URLs/titles and move/create/close tabs so the extension can save your open tabs into groups and restore them later, and so the popup's "Now Open" view can stay in sync with what's actually open. |
| `tabGroups` | permissions | Read and set native browser tab groups so TabMerger's saved groups can be reflected as real Chrome tab groups when restored, and vice versa. |
| `storage` | permissions | Persist saved groups, tabs, and settings locally (IndexedDB/`chrome.storage`) so your data survives a browser restart, entirely on-device unless you opt into cloud sync. |
| `contextMenus` | permissions | Adds right-click menu entries (e.g. "Save tab to TabMerger") as a faster alternative to opening the popup. |
| `alarms` | permissions | Schedules periodic background sync checks for signed-in Pro users, and any other timed maintenance task, without keeping the service worker alive continuously. |
| `notifications` | permissions | Shows a system notification for actions that complete in the background (e.g. a finished sync), so you don't have to keep the popup open to know it happened. |
| `identity` | permissions | Used for `chrome.identity.launchWebAuthFlow` to run the Google OAuth sign-in flow (`src/lib/googleOAuthFlow.ts`) for account sign-in — needed only if you choose to sign in for cloud sync. |

<!-- No host_permissions entries — see note above. -->

---

## Privacy & Data Use

The authoritative, user-facing version of this section lives at the web app's
[`/privacy`](https://tabmerger.vercel.app/privacy) page
(`packages/web/app/(marketing)/privacy/page.tsx`) — this table is the CWS data-use-disclosure-form
mapping of the same facts, verified against that page and the extension's own code
(`src/lib/analytics.ts`, `src/lib/syncEngine.ts`, `src/lib/encryptionKey.ts`).

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | Email (if you sign in) | Yes, to Supabase Auth | Account identification, linking your subscription to your data | Supabase (processor only) |
| Health info | No | — | — | — |
| Financial info | No (Stripe handles payment directly; extension/web app only store a Stripe customer ID + subscription status) | Yes, customer ID/status only | Entitlements (free/Pro/Pro AI feature gating) | Stripe (processor only) |
| Authentication info | Supabase session/JWT | Yes, to Supabase and the web app's API routes | Sign-in, authorizing sync and AI requests | Supabase (processor only) |
| Personal communications | No | — | — | — |
| Location | No | — | — | — |
| Web history | No — TabMerger only stores tabs you explicitly save, not general browsing history | — | — | — |
| User activity | Anonymous usage events (feature usage, page views) via GA4 and PostHog, proxied server-side | Yes, via `${VITE_WEB_APP_URL}/api/track` and PostHog's Capture API | Product analytics | Google Analytics, PostHog (processors only) |
| Website content | Saved tab URLs, titles | (a) Only if you sign in and enable cloud sync — then end-to-end encrypted client-side before upload; (b) only if you turn on the opt-in "Show page images in previews" setting (Settings → General, **off by default**) — while on, hovering a tab sends that tab's URL to TabMerger's preview service (`/api/og-preview`) to fetch an image, not linked to your account, not logged, not stored | (a) Restoring your saved tabs/groups across devices; (b) showing a page-image thumbnail in the hover preview tooltip | None — (a) is encrypted client-side, TabMerger cannot read it; (b) is a stateless fetch-and-return, not persisted or associated with any account |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

### Notes for the review team

- Free-tier users: all tab/group data stays in local IndexedDB and never leaves the device.
- Pro users who enable sync: `groups.windows/name/note/info`, `sessions.groups/name/description`,
  and `device_sessions.now_open_snapshot` are stored in Supabase as `{v:1,iv,ct}` ciphertext —
  the unwrapped data key lives only in `chrome.storage.local` on the user's device and is never
  transmitted. See `src/lib/encryptionKey.ts`.
- AI features (Pro AI tier) are currently **disabled/coming soon** in both the extension and the
  web app (`VITE_AI_ENABLED`/`NEXT_PUBLIC_AI_ENABLED` feature flags) — no tab content is sent to
  Anthropic's Claude API while this flag is off. Update this note when AI ships.
- The extension itself never talks to Google Analytics, PostHog, Sentry, or Anthropic directly —
  all of those go through the web app's server-side routes/proxies (`/api/track`, PostHog's
  Capture API called from the extension with a public API key, and Anthropic only from the web
  app's AI routes), consistent with "AI calls are server-side only" in `CLAUDE.md`.

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://tabmerger.vercel.app/privacy

<!-- TODO (owner): confirm this is the production domain, not the preview alias
     (tabmerger-preview.vercel.app), before submitting. -->

---

## Distribution

**Stable listing**
**Visibility**: Public
**Regions**: TODO (owner) — confirm current region settings in the dashboard; not derivable from the repo.

**BETA listing**
**Visibility**: Private / restricted to invited testers
**Regions**: TODO (owner)

**Firefox is unaffected by the two Chrome Web Store listings above** — it's a separate item on
a separate store (see `.claude/plans/firefox-edge-beta-spec.md` §5). Chrome and Edge builds carry
no content script, no host permission, and no site-access prompt from the change below. Firefox's
own two add-ons (stable AMO listing + the unlisted self-distributed BETA), their data-collection
declaration, and their update mechanism are tracked separately in
[`FIREFOXADDONS.md`](FIREFOXADDONS.md), not here.

### Firefox permission note (`web-bridge.content.ts`)

Firefox doesn't support `externally_connectable` for web pages (MDN;
[bug 1319168](https://bugzil.la/1319168)), so the website→extension messages that Chrome/Edge
get for free via `externally_connectable` (`PING`, `SYNC_AUTH`, `SYNC_NOW` — install detection,
auth handoff after web sign-in, and the dashboard's "sync now" button) need a different transport
on Firefox: a content script on the web app's origin (`VITE_WEB_APP_URL`, per build mode) that
relays `window.postMessage` to `chrome.runtime.sendMessage` and back.

- **Permission it adds, Firefox only:** a single content-script match on the web app's own
  origin (e.g. `https://tabmerger.vercel.app/*` for production, the beta preview URL for the
  beta build). No `host_permissions` entry — Firefox MV3 content scripts don't need one alongside
  a `content_scripts` match. This is new site access Firefox users will be asked to approve on
  install/update; Chrome and Edge users see no change (`include: ['firefox']` in
  `wxt.config.ts`/the entrypoint excludes this content script from their manifests entirely).
- **What it can read/do:** relays exactly three message types between the page and the
  background script; reads nothing else from the page's DOM, network requests, or storage.
  `SYNC_AUTH`'s token payload is forwarded to the background script but never logged, echoed
  back to the page, or read for any purpose beyond that one relay.
- **Justification for the Firefox listing form's permission field:** "Relays three specific
  messages (install check, sign-in handoff, manual sync trigger) between the TabMerger website
  and the extension; reads nothing else on the page."

## Developer Info

**Publisher Name** [REQUIRED]
TODO (owner) — the Chrome Web Store publisher/developer account display name (not the same as
`CHROME_PUBLISHER_ID`, which is a secret ID, not a display name).

**Contact Email** [REQUIRED]
TODO (owner) — confirm which address is public-facing on the listing. Security reports go
through GitHub's private vulnerability reporting (see `.github/SECURITY.md`) rather than a
published email; the web app's `/contact` page may use a separate address for general
support — verify before submitting. Do not commit the actual address into this file.

**Support URL / Email** [RECOMMENDED]
https://tabmerger.vercel.app/contact (web app contact page) — or the GitHub Issues page:
https://github.com/lbragile/TabMerger/issues

**Homepage URL** [RECOMMENDED]
https://tabmerger.vercel.app

<!-- TODO (owner): confirm this is the correct production marketing URL. -->

---

## Version History

Manifest version mapping follows `packages/extension/scripts/manifestVersion.ts` — stable
`version` is plain semver; beta `version` is `(major + BETA_STORE_MAJOR_OFFSET).minor.patch.N`
with the real semver string carried in `version_name`.

| Listing | `version` (manifest) | `version_name` | Semver / tag | Date | Status |
|---|---|---|---|---|---|
| Stable | `3.0.0` | — | `v3.0.0` | TODO (owner) — confirm actual publish date from the dashboard | Published (assumed — verify in dashboard) |
| BETA | `3.1.0.1` | `3.1.0-beta.1` | `v3.1.0-beta.1` | 2026-09-20 | Superseded |
| BETA | `3.1.0.2` | `3.1.0-beta.2` | `v3.1.0-beta.2` | 2026-09-21 | Superseded |
| BETA | `3.1.0.3` | `3.1.0-beta.3` | `v3.1.0-beta.3` | 2026-09-23 | Superseded |
| BETA | `4.0.0.1` | `4.0.0-beta.1` | none (tag deleted) | 2026-09-26 | Published by mistake — live until beta.5 is approved; see note |
| BETA | `4.1.0.4` | `3.1.0-beta.4` | `v3.1.0-beta.4` | 2026-09-26 | Superseded by beta.5 (withdrawn from review if still pending) |
| BETA | `4.1.0.5` | `3.1.0-beta.5` | `v3.1.0-beta.5` | 2026-09-26 | Submitted — TODO (owner): update when the review completes |

<!-- Status options: Draft | Submitted | In Review | Published | Rejected | Superseded -->

Betas 1–3 predate the store-version offset, so their manifest version is the plain
`major.minor.patch.N`. From beta.4 on, the major is offset by `BETA_STORE_MAJOR_OFFSET`.

**Note on the accidental `4.0.0-beta.1` release (2026-09-26):** a commit-body line was misread
as a major-release note, so semantic-release cut `4.0.0-beta.1` (commit `6e97bf8`). Its build,
manifest version **4.0.0.1**, was reviewed and published on the BETA item. The git release was
undone — the GitHub release and `v4.0.0-beta.1` tag deleted, the release commit reverted in
`617da09`, and `.releaserc.json` changed so only the keyword *with its colon* counts. Because
the store only accepts higher versions, every later beta adds 1 to the major of its manifest
version (`3.1.0-beta.4` → `4.1.0.4`) while `version_name` keeps the real semver testers see.
Never remove that offset.

---

## Review Notes

### Known Issues / Limitations

- Pro AI (AI grouping, smart naming, tab previews) is marked "coming soon" and disabled behind
  a feature flag as of this writing — do not describe it as available in store copy while that
  flag is off. See `CLAUDE.md`'s AI feature flag notes and the recent commits enabling it
  (`945e4f1`, `63cbf63`, `7dff2d3`, `6d8fe0d`).
- `externally_connectable` is scoped to the web app origin plus one extra ID,
  `DEV_EXTENSION_ID` (`@tabmerger/shared`): the maintainer's unpacked development build, so the
  local web app can reach it. It grants nothing to other extensions or sites.

### Rejection History

TODO (owner): no rejection has been recorded in this repo's history as of this writing. Add a
row here the first time one occurs.

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| — | — | — | — |
