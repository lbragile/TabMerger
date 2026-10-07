# Chrome Web Store Listing — TabMerger

> Last Updated: 2026-10-06
>
> This file tracks everything filled into the Chrome Developer Dashboard for **both** TabMerger
> Chrome Web Store items — see [Two listings](#two-listings) below. Manifest facts here are
> pulled from `wxt.config.ts`; keep this file in sync with that file, not the other way around.
>
> **State of the stable item:** the public listing is still the v2 build (`2.0.0`). Everything
> under "Store Listing — Stable" below is written for the first v3 stable release (planned as
> `v3.1.0`, not yet released); paste it into the dashboard when that version is uploaded.

## Owner to confirm in the dashboard

Everything else in this file was derived from the repository. These items cannot be:

- [ ] **Publisher / developer display name** and the **public contact email** shown on the listing
      (the email is verified in the dashboard; do not commit it here).
- [ ] **Live version** currently shown on the stable item (the repo believes `2.0.0`).
- [ ] **Regions** (stable and BETA) as currently set.
- [ ] **Screenshots and tiles:** upload the five screenshots and the two promo tiles listed under
      [Graphics & Assets](#graphics--assets) (regenerated 2026-10-06).
- [ ] **Privacy practices tab:** tick the data categories, the certifications and the
      permission justifications exactly as written in
      [Privacy & Data Use](#privacy--data-use) and
      [Permissions Justification](#permissions-justification).
- [ ] **Test instructions field:** paste the "Notes for the review team" paragraph from
      [Review Notes](#review-notes). No test account is needed.
- [ ] **BETA item:** update the `3.1.0-beta.11` status below once its review completes.
- [ ] **Existing-user note:** the description tells v2 users that v3 does not import their v2
      data. Delete that paragraph if you would rather not say so.

## Two listings

| | Stable (public) | BETA (private) |
|---|---|---|
| Manifest `name` | `TabMerger` | `TabMerger BETA` |
| Extension ID | `inmiajapbpafmhjleiebcamfhkfnlgoc` | `nboljhidpjakiohfdkdjkcljdehcapcd` (also `CHROME_BETA_EXTENSION_ID` in `publish.yml`'s `env:`; an item ID is public, it's in the listing URL, so it isn't a secret) |
| Listing URL | <https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc> | <https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd> |
| Visibility | Public | Private / trusted testers: members of the Google Group `tabmerger-beta-testers@googlegroups.com` (<https://groups.google.com/g/tabmerger-beta-testers>) |
| Built from | `wxt zip` (default mode) on a non-prerelease `release` event | `wxt zip -b chrome --mode beta` on any prerelease `release` event, or manual `workflow_dispatch` |
| Published by CI | Uploaded only (`chrome-webstore-upload-cli@4 upload`) — a human presses Publish | Auto-published (`chrome-webstore-upload-cli@4`, no subcommand) |
| `manifest.version` | Real semver, e.g. `3.1.0` | Offset mapping — see `scripts/manifestVersion.ts` (major +1, prerelease `N` becomes a 4th integer) |
| `version_name` | Not set (version is already valid semver) | The real semver string, e.g. `3.1.0-beta.4` |

Both listings ship the identical codebase; only the manifest `name`/description/version differ
per `wxt.config.ts`'s `getExtensionName()` and the beta/stable branches of the `manifest()` fn.
See `docs/PUBLISHING.md` for how builds and publishing are wired.

---

## Store Listing — Stable

**Extension Name** [REQUIRED]
TabMerger

<!-- Must match manifest.json "name" exactly — getExtensionName() returns "TabMerger" for any
     mode other than "beta"/"development". -->

**Short Description** [REQUIRED] (max 132 characters)

122 characters, the stable manifest `description` in `wxt.config.ts`:

> Save open tabs into named, color-coded groups and restore them anytime. Works offline, with optional encrypted sync (Pro).

<!-- The dashboard summary is read from the manifest `description`, so change it there, not only
     here. BETA builds use their own description string and are unaffected. -->

**Detailed Description** [REQUIRED] (about 3,100 characters, limit 16,000)

TabMerger saves the tabs you have open into named, color-coded groups, so you can close them,
clear your browser, and bring them back later: a single tab, one window, or a whole group.

WHAT YOU CAN DO
- Save the current tab, all tabs, the tabs to the left or right of it, or all other tabs. Use the
  popup, the right-click menu ("Save to TabMerger"), or keyboard shortcuts (Ctrl+Shift+S, K, U
  and P; Command instead of Ctrl on Mac). You can rebind them at chrome://extensions/shortcuts.
- Organize tabs into windows inside groups. Name each group, give it a color (12 presets or any
  custom color), star it to keep it at the top, or archive it.
- Restore one tab, one window or a whole group. Saved browser tab groups are recreated, and
  private windows reopen as private windows when you have allowed TabMerger in Incognito.
- Reorder by drag and drop, or with a keyboard-only move mode, across tabs, windows and groups.
- See a "Now Open" view that always mirrors the tabs open in your browser right now.
- Search every saved tab and group (Ctrl/Cmd+K).
- Add notes to tabs, windows and groups, give tabs a custom title, and set reminders that show a
  notification at the time you choose.
- Set URL rules that send matching tabs to a group automatically, and clean up duplicate tabs.
- Take saved sessions (snapshots of your groups) and restore them later.
- Undo and redo changes, and switch between light and dark themes.
- Import from a JSON file, a bookmarks HTML export or OneTab, and export your data as JSON.

FREE AND PRO
TabMerger works fully without an account. The free plan keeps everything in your browser and
allows up to 5 groups, 50 saved tabs, 3 URL rules and 3 saved sessions.

Pro is a paid subscription bought on the TabMerger website (not inside the extension). It removes
those limits and adds optional cloud sync of your groups and sessions between devices, a
"Continue on other device" view, and encrypted share links for groups. Pro features need a
signed-in account; prices and plans are on the website.

PRIVACY
- Your saved tabs stay in your browser's local storage unless you sign in to a Pro account and
  turn on sync.
- Synced content (tab URLs and titles, group and window names, notes, sessions) is encrypted on
  your device with a passphrase only you know before it is uploaded. We store ciphertext and
  cannot read it. If you lose the passphrase, we cannot recover that data.
- TabMerger does not read or change the pages you visit and does not ask for access to any
  website.
- Page images in tab previews are off by default. When you turn them on, hovering a tab sends
  that tab's address to TabMerger's preview service to fetch an image.
- The extension sends a small number of anonymous usage events (for example "group created",
  without any URLs or titles) to help us understand which features are used. See the privacy
  policy for the full list of what is collected and why.

NOTE FOR USERS OF VERSION 2
Version 3 is a complete rewrite. It does not import the tabs and groups saved by version 2.

Questions or feedback? Use the support links on this listing.

<!-- Verified against the code on 2026-10-06: shortcuts and context menu in background.ts and
     wxt.config.ts `commands`; limits from FREE_TIER_LIMITS; sync/sessions/share gating from
     useEntitlements + migration 019; AI is not mentioned because VITE_AI_ENABLED is off. -->

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

Assets live under `packages/demo/` (paths below are relative to it; the images themselves are
not committed). The store images are composited from raw captures by `pnpm demo:screenshots`
(raw PNGs, 1600×1200) followed by `pnpm demo:store-assets` (headline overlay, 1280×800 JPEGs in
`screenshots/store/`, plus the promo tiles in `promo/`). They were regenerated from a current
demo build on 2026-10-06, and every file was opened and measured that day.

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store icon [REQUIRED] | 128×128 PNG | Ready | `../extension/src/public/icon/128.png` |
| Screenshot [REQUIRED] | 1280×800 | Ready | `screenshots/store/open-popup-light.jpg` (also `open-popup-dark.jpg`) |
| Screenshot | 1280×800 | Ready | `screenshots/store/view-new-group-dark.jpg` (also `-light.jpg`) |
| Screenshot | 1280×800 | Ready | `screenshots/store/cross-window-tab-drag-light.jpg` (also `-dark.jpg`) |
| Screenshot | 1280×800 | Ready | `screenshots/store/add-window-note-dark.jpg` (also `-light.jpg`) |
| Screenshot | 1280×800 | Do not upload: shows the current colour picker, but the popover hides the group list, the group is empty and a stray square shows at the left edge | `screenshots/store/color-new-group-dark.jpg`, `color-new-group-light.jpg` |
| Screenshot | 1280×800 | Do not upload: windows are named "temp window" and the footer counts 11 windows (demo artefacts) | `screenshots/store/multi-window.jpg` |
| Screenshot | 1280×800 | Sharp now (the browser strip is drawn at its natural size under a caption), but mostly empty canvas: not recommended | `screenshots/store/cluttered-chrome.jpg` |
| Small promo tile [RECOMMENDED] | 440×280 | Ready | `promo/small-tile.jpg` |
| Marquee promo tile | 1400×560 | Ready (the browser strip on its left half is now shown at native resolution) | `promo/marquee-tile.jpg` |
| Not for the store | 1280×640 | Social preview image, not a store asset | `promo/social-preview.png` |
| Raw captures | 1600×1200 (cluttered-chrome 1400×155) | Wrong size for upload; inputs to the composer only | `screenshots/raw/*.png` |

**Verdict.** The store requires 1280×800 or 640×400 screenshots, a 440×280 small tile and a
1400×560 marquee: every store JPEG, both tiles and the icon have the right pixel size, and the
five screenshots below show the current UI. No store asset shows the encryption unlock dialog or
the incognito strip (the demo data has neither), so recent changes to those do not date them.

**Upload order (max 5):**

1. `open-popup-light.jpg`: the "Now Open" view with four windows and 18 tabs.
2. `view-new-group-dark.jpg`: a saved group with its window.
3. `cross-window-tab-drag-light.jpg`: a tab mid-drag, with the drop zones for a new window and a
   new group.
4. `add-window-note-dark.jpg`: a renamed window with the note editor open.
5. `open-popup-dark.jpg`: the main view in the dark theme.

**To regenerate** (from the repo root): `pnpm --filter @tabmerger/extension build:extension:demo`,
then `pnpm demo:screenshots`, then `pnpm demo:store-assets`. Do not upload the raw PNGs.
Screenshots are not required to contain a headline; the current ones carry one.

### Edge Add-ons images

Partner Center (Store listings → Details) takes the same pixel sizes as Chrome, with three
differences worth knowing before uploading:

| Field | Requirement | Use |
|-------|-------------|-----|
| Extension logo [REQUIRED] | Square, 300×300 recommended (128×128 minimum) | A 300×300 PNG scaled from `packages/web/public/logo.png` (662×662); the 128×128 extension icon is only the minimum |
| Small promotional tile | 440×280 | `promo/small-tile.jpg` content |
| Large promotional tile | 1400×560, **PNG** | `promo/marquee-tile.jpg` content, converted to PNG (the JPEG is not accepted as-is) |
| Screenshots | Up to **6**, 1280×800 or 640×400 | The five listed above plus `add-window-note-light.jpg` |

The listing text and images cannot be changed through the publish API; they are entered by hand.
The description must be between 250 and 10,000 characters (the stable description above fits).

### Screenshot Notes

What each existing store screenshot shows (all use demo data; none shows personal data, AI
features or paid-only screens):

- `open-popup-light/dark.jpg` — headline "Switch to TabMerger. Every tab, already here." The popup
  open on the "Now Open" view: four live windows with 18 tabs, five groups (Work, Research,
  Shopping, Reading List) in the sidebar with their colours and counts, the search box, undo
  and redo, and the Archived and Sessions sections.
- `cross-window-tab-drag-light/dark.jpg` — headline "Drag a tab between windows. It just
  works." A tab being dragged from one window to another inside a group, with drop targets for a
  new window and a new group.
- `view-new-group-light/dark.jpg` — headline "Every project, its own space." A newly created
  group ("Q4 Launch") with one window of three tabs and the "Add Window" button.
- `add-window-note-light/dark.jpg` — headline "Leave yourself a note on any window." The note
  editor open on a named window, with a 500-character counter.
- `multi-window.jpg` — headline "One group, split across windows. Still one click away." The
  Research group split into four windows of one tab each (not for upload, see the table).
- `color-new-group-light/dark.jpg` — headline "Color it to spot it at a glance." The current group
  colour picker open over an empty group (not for upload, see the table).
- `cluttered-chrome.jpg` — headline "Too many tabs. Too many windows." A crowded browser tab strip
  at its natural size (not recommended, see the table).
- `promo/small-tile.jpg` — the popup split diagonally between light and dark themes, "Light or
  dark. Always organized."
- `promo/marquee-tile.jpg` — a crowded tab strip on the left, an arrow, and the TabMerger popup on
  the right, "Tab chaos in. Order out."

---

## Permissions Justification

Checked against the manifest `wxt.config.ts` produces on 2026-10-06. Seven API permissions, no
optional permissions, **no `host_permissions`** of any kind (required or optional) — deliberately,
to keep the extension out of the store's elevated review tier for reading page content. The
extension also declares `incognito: "spanning"`, four keyboard `commands`, and an
`externally_connectable` block (all explained below). No content script ships in the Chrome or
Edge build. Tab previews' page-image fetch is done server-side by the web app
(`packages/web/app/api/og-preview`), not by the extension, and is **off by default**.

| Permission | Justification (paste into the dashboard) |
|------------|------------------------------------------|
| `tabs` | Reads the title, address and icon of the browser's open tabs so the user can save them into named groups, and creates, moves and closes tabs to restore or save them. The "Now Open" view uses it to mirror the tabs currently open. Tab data is only read to show it to the user and to save what they choose. |
| `tabGroups` | Reads the browser's native tab groups (name and color) so a saved tab remembers its group, and recreates that group when the tab is restored. |
| `storage` | Stores settings, the sync encryption key (on this device only) and pending reminders in `chrome.storage.local`, so they survive a browser restart. Saved groups are kept in the extension's own database. |
| `contextMenus` | Adds the right-click entry "Save to TabMerger" (save this tab, tabs to the left, tabs to the right, all other tabs) as a faster alternative to opening the popup. |
| `alarms` | Schedules the one-time reminders a user sets on a saved tab, so the reminder fires at the chosen time even when the popup is closed. |
| `notifications` | Shows the reminder notification when a reminder the user set comes due; clicking it opens the saved tab. |
| `identity` | Runs the "Continue with Google" sign-in window (`chrome.identity.launchWebAuthFlow`, `src/lib/googleOAuthFlow.ts`). Used only if the user chooses to sign in; the extension works without it. |

Not permissions, but reviewers ask:

- **Keyboard `commands`:** four save shortcuts (current tab, tabs to the left, tabs to the
  right, all other tabs) plus the standard "activate the extension" command. Not a permission.
- **`incognito: "spanning"`:** one shared extension instance. Private windows are only visible
  to the extension if the user turns on "Allow in Incognito" in Chrome; it is used to reopen
  saved private windows as private windows.
- **`externally_connectable`:** matches only the TabMerger website origin (the production site
  in the stable build) and one extra extension ID (`DEV_EXTENSION_ID`, the maintainer's unpacked
  development build). It lets the website detect that the extension is installed, pass a
  sign-in session to it, and request a sync. It grants nothing to other sites or extensions.
- **Content scripts:** none on Chrome and Edge. Firefox only: one script on the TabMerger
  website origin (see "Firefox permission note" below).
- **Remote code:** none. All code is bundled in the package; no script is loaded from a CDN.
- **Host permissions:** none, so there is no host justification to paste.

<!-- Removed 2026-10-06: the old `alarms` text (sync checks) and `notifications` text (finished
     sync) described features that do not exist; background.ts only uses both for reminders. -->

---

## Privacy & Data Use

The authoritative, user-facing version of this section lives at the web app's
[`/privacy`](https://tabmerger.vercel.app/privacy) page
(`packages/web/app/(marketing)/privacy/page.tsx`) — this table is the CWS data-use-disclosure-form
mapping of the same facts, verified against that page and the extension's own code
(`src/lib/analytics.ts`, `src/lib/syncEngine.ts`, `src/lib/encryptionKey.ts`).

### Data Collection

**Does the extension collect user data?** Yes

Derived from the code on 2026-10-06. This is exactly what to tick on the dashboard's
**Privacy practices** tab. Fresh install with no account sends nothing except the anonymous
usage events and the favicon lookups listed below.

| CWS data category | Tick? | What and why | Code evidence |
|---|---|---|---|
| Personally identifiable information | **Yes** | Email address, only when the user signs in (account, linking a subscription). Sent to Supabase Auth. | `src/hooks/useAuth.ts`, `src/components/Modal/Auth.tsx`, `src/lib/supabase.ts` |
| Health information | No | Never read or sent. | — |
| Financial and payment information | No | Payment happens on the website through Stripe; the extension never sees card or billing details. It only reads the user's own plan and status (`tier`, `status`) from Supabase to unlock Pro. | `src/hooks/useEntitlements.ts` |
| Authentication information | **Yes** | Supabase session tokens (sign-in with email and password, magic link or Google). Also an encryption-key record: the data key wrapped (encrypted) by the user's passphrase, plus a salt. The passphrase itself is never sent. | `src/hooks/useAuth.ts`, `src/lib/googleOAuthFlow.ts`, `src/lib/encryptionKey.ts` |
| Personal communications | No | Never read or sent. | — |
| Location | No | Never read or sent. | — |
| Web history | **Yes** | Not browsing history: only tabs the user saves, plus the open-tab list that stays on the device. What leaves the device: (a) Pro users who turn on sync upload saved tab URLs and titles, end-to-end encrypted before upload; (b) the site's origin (for example `https://example.com`, no path) goes to Google's favicon service to fetch an icon when the browser did not supply one; (c) only if the user turns on "Show page images in previews" (off by default), the hovered tab's address goes to TabMerger's preview service, not linked to an account, not logged, not stored. | `src/lib/syncEngine.ts`, `src/lib/utils.ts` (`getFaviconUrl`), `src/hooks/useCurrentTabs.ts`, `src/lib/tabAccess.ts`, `src/components/Windows/TabPreview.tsx` |
| User activity | **Yes** | Anonymous product-usage events (names such as `group_created`, `tab_saved`, `search_used`, `upgrade_clicked`, with counts and labels like `source` or `limit`; never URLs, titles or names) tagged with a random install ID kept in `chrome.storage.local`, not the account. Sent to TabMerger's own server (`/api/track`), which forwards to Google Analytics 4 when the production server has its analytics keys set (server-side setting, not visible in this repo). | `src/lib/analytics.ts` (`trackEvent`), `packages/web/app/api/track/route.ts` |
| Website content | No | The extension never reads page text, images, media or links from any page. (The opt-in preview image is fetched by TabMerger's server and returned; its input is the address, covered under Web history.) | `src/lib/tabAccess.ts` |

**Not applicable on purpose:** no host permissions, no content script on Chrome or Edge, no
remote code, no data sold. AI features are off (`VITE_AI_ENABLED` is not `"true"`), so no tab
titles or URLs are sent to Anthropic; the Pro AI row of the privacy policy only becomes true
when AI ships, at which point re-check this table (AI would send open-tab titles and URLs, which
is Web history).

**Analytics and error reporting: which builds are active.** `.github/workflows/publish.yml`
sets only `VITE_WEB_APP_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the
store builds (stable and beta, Chrome, Firefox and Edge). It does **not** set
`VITE_POSTHOG_API_KEY` or `VITE_SENTRY_DSN`, and `.env*` files are not in the repository, so in
every store build:

- **PostHog is inactive.** `trackPostHogEvent` returns immediately without a key.
- **Sentry is inactive.** `Sentry.init` runs only when a DSN is present (`src/entrypoints/popup/main.tsx`,
  `src/entrypoints/background.ts`). If a DSN is ever added, the popup would send error reports
  (URLs redacted by a `beforeSend` filter; session replay masks all text), and this table and the
  privacy policy must be re-checked first.
- **GA4 via `/api/track` is active** in every store build, because `VITE_WEB_APP_URL` is set. On
  Chrome and Edge it runs with no prompt; on Firefox it waits for the user's consent. The
  extension never contacts Google Analytics directly and holds no measurement ID or secret.

### Data Use Certification

All three certifications can be ticked, because they are true as built:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
      (Supabase, Stripe's website checkout and the analytics provider act as processors for
      TabMerger; nothing is sold.)
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single
      purpose. (Data is used only to save, sync and restore tabs, to run accounts and
      subscriptions, and for anonymous usage statistics.)
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Other dashboard questions:** "Remote code": No. "Data encrypted in transit": yes (HTTPS only).
"Users can request deletion": yes, by deleting the account on the website (see
[`/privacy`](https://tabmerger.vercel.app/privacy), "Data Retention").

### Technical privacy notes

- Free-tier users: all tab/group data stays in local IndexedDB and never leaves the device
  (except the favicon and analytics requests in the table above, and the opt-in preview).
- What the server can see when a Pro user syncs: row ids, timestamps, group colour, starred and
  archived flags, sidebar order, a coarse device label such as "Chrome on Windows", and the
  wrapped (passphrase-encrypted) data key with its salt. Everything that describes content is
  ciphertext, as listed next.
- Pro users who enable sync: `groups.windows/name/note/info`, `sessions.groups/name/description`,
  and `device_sessions.now_open_snapshot` are stored in Supabase as `{v:1,iv,ct}` ciphertext —
  the unwrapped data key lives only in `chrome.storage.local` on the user's device and is never
  transmitted. See `src/lib/encryptionKey.ts`.
- AI features (Pro AI tier) are currently **disabled/coming soon** in both the extension and the
  web app (`VITE_AI_ENABLED`/`NEXT_PUBLIC_AI_ENABLED` feature flags) — no tab content is sent to
  Anthropic's Claude API while this flag is off. Update this note when AI ships.
- Direct network destinations from the extension: the TabMerger website (`/api/track`,
  `/api/og-preview` when enabled, `/api/portal` for the billing link), Supabase, Google's favicon
  service, and the Google sign-in window. PostHog's capture endpoint and Sentry are in the code
  but are not called by store builds (no key or DSN is set there). Anthropic is only ever called
  from the website's server routes, and not at all while AI is off.

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://tabmerger.vercel.app/privacy

The route exists (`packages/web/app/(marketing)/privacy/page.tsx`, last updated September 26,
2026) and the production domain matches `PROD_WEB_APP_URL` in `publish.yml`. Beta builds use
the preview alias (`tabmerger-preview.vercel.app`) for the app, but the listing links the
production domain. Terms of Service: https://tabmerger.vercel.app/terms
(`app/(marketing)/terms/page.tsx`).

---

## License

The Chrome Web Store has no license field. The code is licensed under `LICENSE.md`
(PolyForm Strict 1.0.0 plus an all-rights-reserved preface), and using the extension is governed by
the Terms of Service (<https://tabmerger.vercel.app/terms>), linked from the listing through the
website. Code must stay readable:
minifying is allowed, but the store's code-readability policy forbids obfuscation, so a license
(not obfuscation) is the protection.

## Distribution

**Stable listing**
**Visibility**: Public
**Regions**: see "Owner to confirm" at the top (dashboard setting, not in the repo).

**BETA listing**
**Visibility**: Private / restricted to invited testers
**Regions**: see "Owner to confirm" at the top.

**Firefox is unaffected by the two Chrome Web Store listings above** — it's a separate item on
a separate store (see `FIREFOXADDONS.md`). Chrome and Edge builds carry
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
Set in the developer account, not in the repo (see "Owner to confirm" at the top).

**Contact Email** [REQUIRED]
Set and verified in the developer account (see "Owner to confirm" at the top). Security reports
go through GitHub's private vulnerability reporting (see `.github/SECURITY.md`) rather than a
published email. Do not commit the address into this file.

**Support URL** [RECOMMENDED]
https://tabmerger.vercel.app/contact (route: `packages/web/app/(marketing)/contact/page.tsx`).
Alternative for bug reports: https://github.com/lbragile/TabMerger/issues

**Homepage URL** [RECOMMENDED]
https://tabmerger.vercel.app (production site, same as `PROD_WEB_APP_URL` in `publish.yml`).
Also live as routes: `/features`, `/pricing`, `/faq`, `/changelog`.

---

## Version History

Manifest version mapping follows `packages/extension/scripts/manifestVersion.ts` — stable
`version` is plain semver; beta `version` is `(major + BETA_STORE_MAJOR_OFFSET).minor.patch.N`
with the real semver string carried in `version_name`.

| Listing | `version` (manifest) | `version_name` | Semver / tag | Date | Status |
|---|---|---|---|---|---|
| Stable | `2.0.0` | — | `v2.0.0` | 2021-03-06 (GitHub release) | **Live: v2 `2.0.0` is the public build today** (owner to confirm the live version in the dashboard) |
| Stable | `3.0.0` | — | `v3.0.0` | 2026-09-19 (tag) | Never published to the store; superseded by the planned `3.1.0` |
| Stable | `3.1.0` | — | `v3.1.0` (planned) | not yet released | **Planned: the first v3 stable release.** A rewrite with optional account and end-to-end encrypted sync. Not uploaded, not released. Cut from `main` once the 3.1 beta finishes |
| BETA | `3.1.0.1` | `3.1.0-beta.1` | `v3.1.0-beta.1` | 2026-09-20 | Superseded |
| BETA | `3.1.0.2` | `3.1.0-beta.2` | `v3.1.0-beta.2` | 2026-09-21 | Superseded |
| BETA | `3.1.0.3` | `3.1.0-beta.3` | `v3.1.0-beta.3` | 2026-09-23 | Superseded |
| BETA | `4.0.0.1` | `4.0.0-beta.1` | none (tag deleted) | 2026-09-26 | Published by mistake — live until beta.5 is approved; see note |
| BETA | `4.1.0.4` | `3.1.0-beta.4` | `v3.1.0-beta.4` | 2026-09-26 | Superseded by beta.5 (withdrawn from review if still pending) |
| BETA | `4.1.0.5` | `3.1.0-beta.5` | `v3.1.0-beta.5` | 2026-09-26 | Superseded |
| BETA | `4.1.0.6` | `3.1.0-beta.6` | `v3.1.0-beta.6` | 2026-09-27 | Superseded |
| BETA | `4.1.0.7` | `3.1.0-beta.7` | `v3.1.0-beta.7` | 2026-09-29 | Superseded |
| BETA | `4.1.0.8` | `3.1.0-beta.8` | `v3.1.0-beta.8` | 2026-09-30 | Superseded |
| BETA | `4.1.0.9` | `3.1.0-beta.9` | `v3.1.0-beta.9` | 2026-10-01 | Superseded |
| BETA | `4.1.0.10` | `3.1.0-beta.10` | `v3.1.0-beta.10` | 2026-10-02 | Superseded by beta.11 (withdrawn from review if still pending) |
| BETA | `4.1.0.11` | `3.1.0-beta.11` | `v3.1.0-beta.11` | 2026-10-07 | Submitted by the publish workflow; owner to update when the review completes |

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

### Notes for the review team

Paste into the dashboard's test-instructions field for the v2 to v3 update:

> TabMerger 3 is a rewrite of the version 2 extension (same item, same single purpose: saving,
> organizing and restoring browser tabs in named groups). New in this version is an optional
> account with paid end-to-end encrypted sync. No account, login or test credentials are needed
> to review the core features: install, open the popup, and use "Save to TabMerger" from the
> right-click menu or the popup to save tabs into a group, then restore them. Sign-in and sync
> are only reachable from the account icon in the popup header and are not required for anything
> else. The extension requests no host permissions and has no content script on Chrome. Saved
> tabs are stored locally; if a user signs in and subscribes, group content is encrypted on the
> device with the user's passphrase before upload, so the server holds only ciphertext. The
> background script only handles reminder alarms the user set, the right-click menu, the toolbar
> badge, keyboard shortcuts and the URL rules the user created. AI features
> are not enabled in this release. Data saved by version 2 is not imported.

### Known Issues / Limitations

- Pro AI (AI grouping, smart naming, tab previews) is marked "coming soon" and disabled behind
  a feature flag as of this writing — do not describe it as available in store copy while that
  flag is off. See `CLAUDE.md`'s AI feature flag notes.
- `externally_connectable` is scoped to the web app origin plus one extra ID,
  `DEV_EXTENSION_ID` (`@tabmerger/shared`): the maintainer's unpacked development build, so the
  local web app can reach it. It grants nothing to other extensions or sites.

### Rejection History

No rejection has been recorded in this repo's history as of 2026-10-06. Add a row here the
first time one occurs.

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| — | — | — | — |
