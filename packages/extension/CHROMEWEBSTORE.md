# Chrome Web Store Listing — TabMerger

> Last Updated: 2026-10-26
>
> This file tracks everything filled into the Chrome Developer Dashboard for **both** TabMerger
> Chrome Web Store items — see [Two listings](#two-listings) below. Manifest facts here are
> pulled from `wxt.config.ts`; keep this file in sync with that file, not the other way around.
>
> **State of the stable item:** v3 has been live since `3.1.0` (2026-10-07); the live build is
> `3.7.0` and `3.9.0` is waiting for approval in the publish workflow. Each stable release from
> `main` goes to the store only when its `store-stable` jobs are approved, so not every tag is
> uploaded (see [Version History](#version-history)). The BETA item is still on `3.3.2-beta.1`.

## Owner to confirm in the dashboard

Everything else in this file was derived from the repository. These items cannot be:

- [ ] **Publisher / developer display name** and the **public contact email** shown on the listing
      (the email is verified in the dashboard; do not commit it here).
- [x] **Live version** on the stable item: `3.7.0` (confirmed 2026-10-21).
- [ ] **Regions** (stable and BETA) as currently set.
- [ ] **Screenshots and tiles:** upload the five screenshots and the two promo tiles listed under
      [Graphics & Assets](#graphics--assets) (regenerated 2026-10-06).
- [ ] **Privacy practices tab:** tick the data categories, the certifications and the
      permission justifications exactly as written in
      [Privacy & Data Use](#privacy--data-use) and
      [Permissions Justification](#permissions-justification).
- [ ] **Test instructions field:** paste the "Notes for the review team" paragraph from
      [Review Notes](#review-notes). No test account is needed.
- [ ] **BETA item:** confirm `3.3.2-beta.1` is the live BETA build.
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
- Search every tab and group, saved or open right now (Ctrl/Cmd+K), for the text as you type it
  (any case), best matches first. The text that matched is
  highlighted in titles, addresses, window, group and tab-group names, and tabs that do not match
  are hidden or faded, whichever you choose in Settings. The search stays until you clear it.
- Add notes to tabs, windows and groups, give tabs a custom title, and set reminders that show a
  notification at the time you choose.
- Set URL rules that send matching tabs to a group automatically, and clean up duplicate tabs.
- Take saved sessions (snapshots of your groups) and restore them later.
- Use TabMerger in 18 languages (English, German, Spanish, French, Italian, Russian, Korean,
  Turkish, Indonesian, Polish, Vietnamese, Hindi, Japanese, Brazilian Portuguese, Simplified
  Chinese, Arabic, Hebrew and Persian, with right-to-left layouts for the last three): it follows
  your browser's language, or search for one in the header or in Settings.
- Undo and redo changes, and switch between light and dark themes.
- When the browser has downloaded a new version, a small banner offers "Restart to update" (or
  dismiss it for that version). Settings also has a "Check for updates" button.
- Get a guided tour the first time you open TabMerger: seven short chapters in plain language,
  each with a header saying what it covers. Most steps let you try things yourself (make a
  group, color it, pin it, drag tabs and groups around, save a tab, reopen a window, remove a
  repeated tab, select items, search, undo and redo, switch the theme), with a ring on the
  exact control to use next. You practice on two sample groups and one spare tab that the
  tour adds and removes by itself, so your own tabs are never touched. Skip a step, a chapter
  or the whole tour, and replay it any time from the "?" button or from Settings.
- Import from a JSON file, a bookmarks HTML export or OneTab, and export your data as JSON.
  Imported files are checked entry by entry: links that run script instead of opening a page
  (bookmarklets, for example) are left out, and the import tells you how many were skipped.

FREE AND PRO
TabMerger works fully without an account. The free plan keeps everything in your browser and
allows up to 5 groups, 50 saved tabs, 3 URL rules and 3 saved sessions.

Pro is a paid subscription bought on the TabMerger website (not inside the extension). It removes
those limits and adds optional cloud sync of your groups and sessions between devices, automatic
backups (an encrypted snapshot of your saved groups, taken on a schedule you choose, that you can
restore from Settings, including on a new or reinstalled browser once you sign in and unlock
encryption; you can also have each backup saved as a file in your Downloads folder), a
"Continue on other device" view, and encrypted share links for groups.
Pro features need a
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

**Search highlighting (next release):** no current store screenshot shows a search, so none is
wrong because of it. A new screenshot of a search (matched text highlighted, the "N tabs hidden
by search" line, per-group counts in the sidebar) is optional and not made yet. The visual
regression baseline `search` (extension e2e) does change and needs regenerating.

**Needs refreshing (guided tour, next release):** the popup header gained a "?" (Take the tour)
button between the selection toggle and the account icon, so every store screenshot that shows
the popup header is one icon out of date: `open-popup-light/dark.jpg`,
`view-new-group-dark/light.jpg`, `cross-window-tab-drag-light/dark.jpg` and
`add-window-note-dark/light.jpg`. Regenerate them with the usual demo pipeline before the next
store upload. Demo builds never start the tour by themselves, so the captures stay clean. A
screenshot of the tour itself is optional and not made yet. If one is made, use a "try it" step
(for example "Make a group"): it shows the chapter header at the top of the card and the action
ring on the control to use next, which the welcome card does not.

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

Checked against the manifest `wxt.config.ts` produces on 2026-10-12. Seven API permissions, one
optional permission (`downloads`, see the row below), **no `host_permissions`** of any kind (required or optional) — deliberately,
to keep the extension out of the store's elevated review tier for reading page content. The
extension also declares `incognito: "spanning"`, four keyboard `commands`, and an
`externally_connectable` block (all explained below). No content script ships in the Chrome or
Edge build. Tab previews' page-image fetch is done server-side by the web app
(`packages/web/app/api/og-preview`), not by the extension, and is **off by default**.

| Permission | Justification (paste into the dashboard) |
|------------|------------------------------------------|
| `tabs` | Reads the title, address and icon of the browser's open tabs so the user can save them into named groups, and creates, moves and closes tabs to restore or save them. The "Now Open" view uses it to mirror the tabs currently open. Tab data is only read to show it to the user and to save what they choose. |
| `tabGroups` | Reads the browser's native tab groups (name and color) so a saved tab remembers its group, and recreates that group when the tab is restored. |
| `storage` | Stores settings, the chosen display language, the sync encryption key (on this device only), pending reminders and whether the guided tour was finished in `chrome.storage.local`, so they survive a browser restart. Saved groups are kept in the extension's own database. |
| `contextMenus` | Adds the right-click entry "Save to TabMerger" (save this tab, tabs to the left, tabs to the right, all other tabs) as a faster alternative to opening the popup. |
| `alarms` | Schedules the one-time reminders a user sets on a saved tab, so the reminder fires at the chosen time even when the popup is closed. Also runs the automatic backup of saved groups on the interval the user picked in Settings (paid accounts; can be turned off), and wakes the background worker once a day for the anonymous `extension_heartbeat` usage event. |
| `notifications` | Shows the reminder notification when a reminder the user set comes due; clicking it opens the saved tab. |
| `identity` | Runs the "Continue with Google" sign-in window (`chrome.identity.launchWebAuthFlow`, `src/lib/googleOAuthFlow.ts`). Used only if the user chooses to sign in; the extension works without it. |
| `downloads` (**optional**, `optional_permissions`) | Optional (not granted at install); requested only from the click that turns on "Also save a file to this computer" (automatic backups) in Settings. Used only for backup files: each backup is saved as a JSON file in a folder the user names inside Downloads (downloads.download, saveAs false, conflictAction "uniquify"). The extension keeps the id of the last backup file, on this device only. With Settings → Data open, it looks up that one id (downloads.search({ id })) to show the file's full path and whether it still exists. "Show in folder" opens that file (downloads.show), or the Downloads folder if it is gone (downloads.showDefaultFolder). The path is shown, never stored or sent. It never lists other downloads, opens file contents, deletes or cancels downloads, or touches entries it did not start. Without the permission, backups still work, minus the file. |

**`downloads` must stay optional.** As a required permission Chrome would disable the extension
for every existing user until they accepted the new warning. The CI baseline
(`packages/extension/manifest-permissions.json`) lists it under `optional_permissions`.

Not permissions, but reviewers ask:

- **Keyboard `commands`:** four save shortcuts (current tab, tabs to the left, tabs to the
  right, all other tabs) plus the standard "activate the extension" command. Not a permission.
- **`incognito: "spanning"`:** one shared extension instance. Private windows are only visible
  to the extension if the user turns on "Allow in Incognito" in Chrome; it is used to reopen
  saved private windows as private windows.
- **`externally_connectable`:** matches only the TabMerger website, which during the move to
  its own domain is two sites: `https://tabmerger.vercel.app/*` and `https://tabmerger.com/*`
  in the stable build, `https://tabmerger-preview.vercel.app/*` and
  `https://preview.tabmerger.com/*` in the BETA build (`VITE_WEB_APP_URL` plus
  `VITE_EXTRA_WEB_APP_URLS`). Plus one extra extension ID (`DEV_EXTENSION_ID`, the maintainer's
  unpacked development build). It lets the website detect that the extension is installed, pass
  a sign-in session to it, and request a sync. It grants nothing to other sites or extensions,
  and it is not a permission: Chrome shows no warning for it, at install or on update.
  Justification to paste: "Lets the TabMerger website (tabmerger.com, and tabmerger.vercel.app
  while the site moves there) detect the extension, hand over the user's sign-in and ask for a
  sync. No other site can message the extension."
- **Content scripts:** none on Chrome and Edge. Firefox only: one script on the TabMerger
  website, the same two sites as `externally_connectable` (see "Firefox permission note" below).
- **Remote code:** none. All code is bundled in the package; no script is loaded from a CDN.
- **Host permissions:** none, so there is no host justification to paste.

<!-- Removed 2026-10-06: the old `alarms` text (sync checks) and `notifications` text (finished
     sync) described features that do not exist; background.ts only uses both for reminders. -->

---

## Privacy & Data Use

The authoritative, user-facing version of this section lives at the web app's
[`/privacy`](https://tabmerger.com/privacy) page
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
remote code, no data sold.

**Which website the extension talks to.** The extension accepts messages (install check,
sign-in handoff, sync request) only from the TabMerger website: `tabmerger.vercel.app` and
`tabmerger.com` for the stable build, `tabmerger-preview.vercel.app` and
`preview.tabmerger.com` for the BETA build, while the site moves to its own domain. Everything
the extension itself sends (API calls, `/api/track`, links, the sign-in redirect) still goes to
the first of each pair, `VITE_WEB_APP_URL`; the second site only adds where those messages may
come from, so no data-use answer changes. AI features are off (neither `VITE_AI_ENABLED` nor
`VITE_AI_BYOK_ENABLED` is `"true"`), so no tab titles or URLs are sent to any AI provider; the
Pro AI row of the privacy policy only becomes true when AI ships, at which point re-check this
table (AI would send open-tab titles and URLs, which is Web history, and, for Pro AI "own key"
users, their own Anthropic, OpenAI or Gemini API key, which is Authentication information; see
the AI note under Technical privacy notes).

**Analytics and error reporting: which builds are active.** `.github/workflows/publish.yml`
sets only `VITE_WEB_APP_URL`, `VITE_EXTRA_WEB_APP_URLS` (a second trusted site, see "Which
website the extension talks to" above), `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the
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
[`/privacy`](https://tabmerger.com/privacy), "Data Retention").

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
- Automatic backups (Pro, on by default, Settings → Data): on a schedule (hourly to weekly,
  daily by default) the background worker saves a snapshot of the user's saved groups (the same
  content as a saved session: group and window names, notes, tab URLs and titles; never the
  "Now Open" tabs) as a session marked automatic. It is stored in the extension's own database
  and uploaded to the same place as synced sessions (`sessions`), encrypted on the device first
  like every other session; the "automatic" marker is inside the ciphertext, so the server
  cannot tell a backup from a session the user saved. By default nothing is written to disk as
  a file; no new data category, no new network destination and **no new required permission**
  (`alarms` and `storage` were already granted). The only addition is the optional `downloads`
  permission, asked for only if the user turns on the file copy described below. The newest 10 are kept; older automatic ones are deleted on
  the device and on the server. Restoring one adds its groups back into TabMerger; it does not
  open or close browser windows. The server rejects the upload for an account without an active
  paid plan (`has_cloud_sync()` on `sessions`). See `src/lib/autoBackup.ts`.
- Getting backups back onto a device (`src/lib/autoBackupDownload.ts`): when the user opens
  Settings → Data (and after "Back up now"), the extension reads the signed-in user's own
  `sessions` rows from Supabase, decrypts them on the device, keeps only the ones marked as
  automatic backups, validates them like an imported file and stores the missing ones locally.
  This is a download of the user's own encrypted data: no new kind of data is collected. It
  never overwrites or removes a backup on the device and does not run on a timer. The one thing
  it does besides adding: it first retries deletes the user (or the keep-newest-10 rule) already
  made on this device but that had not reached the server yet. **A backup that is missing from
  the account is never deleted from the device because of that.** Deleting a backup in the web
  dashboard removes the cloud copy only: a browser that already has that backup keeps its own
  copy, and does not upload it again. Deleting a backup in the extension removes it from that
  browser and from the account; another browser that already has it keeps its copy. An account
  that is no longer paid can still read its own backups. Backups are listed only in Settings →
  Data, not in the sidebar's Sessions list.
  Restoring offers two choices, both undoable: add the backup's groups next to the current
  ones, or replace the current groups with them (after a confirmation).
- "Also save a file to this computer" (off by default, optional `downloads` permission, see
  Permissions): when on, each backup is also written as a JSON file inside the browser's
  Downloads folder, in a subfolder (default `TabMerger`) and with a file name pattern (default
  `TabMerger backup {date} {time}`) the user can change; both are validated so the path can
  never leave Downloads (no absolute paths, no `..`, no names Windows reserves, no control,
  invisible or text-direction characters). The option is switched off again when a different
  account signs in on the same browser profile, so one account's choice never writes another
  account's groups to disk. **The file is not encrypted**: it is plaintext on the user's own
  disk, in the same format as Settings → Export, and holds saved groups only (tab addresses and
  titles, group and window names, notes), never the "Now Open" tabs, keys, tokens or the account
  id. It never leaves the device through TabMerger. TabMerger does not delete these files.
  The setting says so in plain words. See `src/lib/autoBackupFile.ts`.
  To help the user find the file, the setting says where the folder is, shows "Last file" with
  the full path the browser reports for the last file written (or that it was moved or
  deleted), and has a "Show in folder" button that opens the system file manager there. Only the
  download id and time of that last file are kept, on the device (never synced, removed with the
  account's local data); the path is read from the browser each time and shown as text.
- AI features (Pro AI tier) are currently **disabled/coming soon** in both the extension and the
  web app, behind two flags: `VITE_AI_ENABLED`/`NEXT_PUBLIC_AI_ENABLED` (Pro AI where TabMerger
  handles setup; also turns on the own-key option) and `VITE_AI_BYOK_ENABLED`/`NEXT_PUBLIC_AI_BYOK_ENABLED` (the
  own-key option only, which may launch first). No tab content is sent to any AI provider while
  both are off. Update this note when either ships. What they send once on (built, behind the
  flags): for an AI action the user starts (or the once-a-day session suggestion), the titles
  and URLs of the tabs involved (for Describe group, also the group's name; for Describe window,
  also the window's name; the reply becomes that group's or window's note, which syncs encrypted
  like any note; Name window sends that window's tabs) go to TabMerger's own server (`VITE_WEB_APP_URL/api/ai/*`),
  together with the AI model chosen in Settings → AI (a model name, stored in the extension's
  own settings). The server passes them to **one AI provider**: Anthropic when TabMerger
  handles setup (usage counted in monthly credits on the server), or, when the user adds their
  **own API key** ("Use your own AI provider"), the company that issued that key: Anthropic, OpenAI or Google (for
  Gemini), one key at a time. In Settings → AI the user picks the provider first, then types that provider's
  key; a key whose format belongs to another provider is refused in the popup before anything is
  sent. A provider picked before its key is saved is remembered on the device
  (`chrome.storage.local` `aiByokProvider`: the provider name and the account, no key). The key is
  checked with the server once (`/api/ai/byok/verify`), then stored **only on this device** in
  `chrome.storage.local` (`aiByokKey`, with the account that saved it and its provider, removed
  on sign-out), never in the extension's database, so exports, automatic backups and sync never
  contain it. It is sent in the `X-AI-Key` header of each AI request to TabMerger's server,
  which passes it straight to that provider and never stores or logs it; it is never sent to
  analytics or error reports, and only its first and last characters are ever shown
  (`sk-ant-…abcd`, `sk-…abcd`, `AIza…abcd`). Settings links to the picked provider's own pages
  (how to create a key, and its API keys page) so the user can create a key and set a spending
  limit there; the links are listed once in `AI_PROVIDER_KEY_LINKS` (`@tabmerger/shared`). No new permission and no new network
  destination: the extension still talks only to TabMerger's website, and the AI providers are
  called by the server. See `src/lib/byokKey.ts` and `src/hooks/useAI.ts`.
- Imported files (JSON, bookmarks HTML, OneTab) are read and validated on the device, in the
  popup: each group, window and tab is rebuilt from known fields only, and addresses using a
  script-running scheme (`javascript:`, `data:`, `vbscript:`, `blob:`) are not saved. The same
  check sits in front of every action that opens a saved address (`src/lib/safeOpen.ts`), so
  such an address is never opened; browser pages (`chrome://`, `file://` and the like) open as
  before. No permission, data collection or network destination changed with this.
- Uninstall survey (`src/lib/uninstallSurvey.ts`): on every start the background worker calls
  `chrome.runtime.setUninstallURL` (no permission needed), so after the extension is removed the
  browser opens `<web app>/uninstalled` (`https://tabmerger.com/uninstalled` for the stable
  item). The address carries only the extension version, the browser (`chrome`, `firefox`,
  `edge`), the channel (`stable`, `beta`) and an analytics flag (`a=1` when anonymous usage
  analytics are allowed: always on Chrome and Edge, on Firefox only with the
  `technicalAndInteraction` consent; otherwise `a=0`), e.g. `?v=3.1.2&b=chrome&c=stable&a=1`: no
  user id, email, install id, group or tab data, or settings. On Firefox the URL is registered
  again when that consent is granted or revoked. When the flag is `1`, the website's server
  records one anonymous `extension_uninstalled` count in Google Analytics (version, browser,
  channel; a random one-off client id), so the extension itself sends nothing. The survey on that
  page is optional; anything typed there is sent by the web page, not by the extension. Not set in
  the demo-video build.
- Direct network destinations from the extension: the TabMerger website (`/api/track`,
  `/api/og-preview` when enabled, `/api/portal` for the billing link), Supabase, Google's favicon
  service, and the Google sign-in window. PostHog's capture endpoint and Sentry are in the code
  but are not called by store builds (no key or DSN is set there). Anthropic is only ever called
  from the website's server routes, and not at all while AI is off.

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://tabmerger.com/privacy

The route exists (`packages/web/app/(marketing)/privacy/page.tsx`, last updated September 26,
2026). The listing URLs moved to `tabmerger.com` on 2026-10-16, on both the stable and BETA
listings; the old `tabmerger.vercel.app` host still serves the same pages (public pages redirect
there to `tabmerger.com`). Beta builds use `preview.tabmerger.com` for the app, but the listing
links the production domain. Terms of Service: https://tabmerger.com/terms
(`app/(marketing)/terms/page.tsx`).

---

## License

The Chrome Web Store has no license field. The code is licensed under `LICENSE.md`
(PolyForm Strict 1.0.0 plus an all-rights-reserved preface), and using the extension is governed by
the Terms of Service (<https://tabmerger.com/terms>), linked from the listing through the
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
on Firefox: a content script on the web app's origins (`VITE_WEB_APP_URL` plus
`VITE_EXTRA_WEB_APP_URLS`, per build mode) that relays `window.postMessage` to
`chrome.runtime.sendMessage` and back.

- **Permission it adds, Firefox only:** content-script matches on the TabMerger website only:
  `https://tabmerger.vercel.app/*` and `https://tabmerger.com/*` for production,
  `https://tabmerger-preview.vercel.app/*` and `https://preview.tabmerger.com/*` for the beta
  build. No `host_permissions` entry — Firefox MV3 content scripts don't need one alongside a
  `content_scripts` match. Chrome and Edge users see no change (`include: ['firefox']` in the
  entrypoint excludes this content script from their manifests entirely).
- **How Firefox grants it (MV3):** content-script sites count as host access, and in MV3 they
  are optional, not required. A new install grants every listed site and names them in the
  install prompt. An update never prompts for a site added in that update and does not grant
  it: the new site stays off until the user allows it (the extensions button on that site, or
  about:addons, TabMerger, Permissions). Sites granted before stay granted. So an installed
  Firefox build that gains a second site keeps working on the first one only, until the user
  allows the second. The Firefox popup offers that with an "Allow" banner
  (it opens a TabMerger tab that asks Firefox, then closes the popup; dismissible); see `FIREFOXADDONS.md`, "The in-popup
  prompt". Chrome and Edge never show it.
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
https://tabmerger.com/contact (route: `packages/web/app/(marketing)/contact/page.tsx`).
Alternative for bug reports: https://github.com/lbragile/TabMerger/issues

**Homepage URL** [RECOMMENDED]
https://tabmerger.com (production site, the same host builds use: `PROD_WEB_APP_URL` in
`publish.yml`). The verified domain is linked under Account → Publisher.
Also live as routes: `/features`, `/pricing`, `/faq`, `/changelog`.

---

## Version History

Manifest version mapping follows `packages/extension/scripts/manifestVersion.ts` — stable
`version` is plain semver; beta `version` is `(major + BETA_STORE_MAJOR_OFFSET).minor.patch.N`
with the real semver string carried in `version_name`.

| Listing | `version` (manifest) | `version_name` | Semver / tag | Date | Status |
|---|---|---|---|---|---|
| Stable | `2.0.0` | — | `v2.0.0` | 2021-03-06 (GitHub release) | Superseded by v3 (`3.1.0`) |
| Stable | `3.0.0` | — | `v3.0.0` | 2026-09-19 (tag) | Never published to the store; superseded by `3.1.0` |
| Stable | `3.1.0` | — | `v3.1.0` | 2026-10-07 | Superseded. **The first v3 stable release:** a rewrite with optional account and end-to-end encrypted sync |
| Stable | `3.1.1` | — | `v3.1.1` | 2026-10-09 | Superseded |
| Stable | `3.1.2` | — | `v3.1.2` | 2026-10-10 | Superseded |
| Stable | `3.1.3` | — | `v3.1.3` | 2026-10-15 | Not submitted (publish run cancelled) |
| Stable | — | — | unreleased | — | Draft, behind the AI flag (off, so nothing changes for users yet): Pro AI gets a choice of model in Settings → AI (Auto, Claude Haiku/Sonnet/Opus 5.5 when TabMerger handles setup, each with its approximate credits per action; with an own key, Auto plus that provider's three models, each with a relative cost level and no dollar figures), and a "Use your own AI provider" option where the user adds their own API key (Anthropic, OpenAI or Gemini, one at a time) whose key is kept on the device and sent only with AI requests to TabMerger's server, which forwards the request to that provider. The own-key option has its own flag (`VITE_AI_BYOK_ENABLED`) so it can launch before the option where TabMerger handles setup. In Settings → AI the own-key user picks the provider first (Anthropic, OpenAI or Gemini); only then do that provider's key field, setup links ("How to create a key" and its API keys page) and models show, and a key of another provider is refused before it is sent. Switching provider keeps the saved key in use until a key for the new one is saved. Credits now measure AI cost. The header's AI menu is grouped by what each action works on (open tabs: Auto-group; the selected group, named in its label: Name group and the new Describe group; all groups: Organize), with the credits left this month (or "Your own key") and an "AI settings" link at the bottom. New Describe group (header AI menu and the group's right-click menu, switchable in Settings → AI): sends the selected group's name and its tabs' titles and URLs to TabMerger's server, like Name group, and writes the 1-3 sentence reply as the group's note (an existing note is never overwritten without asking: Replace note, Add below or Cancel). The note syncs end-to-end encrypted like any note edit. Name group now offers up to three suggested names to pick from ("Name this group": the current name, the suggestions with the first preselected, or a name typed by the user; Rename applies it as one undo step), from both the header AI menu and the group's right-click menu; the same tab titles and URLs are sent as before. New window AI actions in a saved window's ⋯ menu (Pro AI only, like the group's right-click menu, and not on Now Open windows): "AI rename" sends that window's tabs' titles and URLs and opens the same picker, titled "Name this window" (Rename is one undo step), and "Describe with AI" sends the window's name and its tabs' titles and URLs and writes the reply as the window's note (an existing note gets the same Replace note / Add below / Cancel review). Both follow the existing Settings → AI switches, now labelled "Name groups and windows" and "Describe groups and windows". Free and Pro users see the AI button as a preview: the sparkle in full colour with a small "Pro AI" tag, opening the same menu with every action locked and an "Upgrade to Pro AI" button at the bottom (it opens the existing upgrade prompt; nothing is sent to an AI provider). A new local setting, "Show AI button" in Settings, General (on by default, every plan), hides the button. No manifest change, no new permission. When either flag is turned on: refresh any screenshot that shows the popup header (the AI button now shows for every plan, tagged "Pro AI" for free and Pro) and update the long description, the Privacy section above (Authentication information and Web history rows) and the privacy policy's Pro AI row, and refresh the Settings screenshot (the AI settings screen now opens on the provider picker; capture it with a provider picked so the key field, links and models show) |
| Stable | `3.2.0` | — | `v3.2.0` | 2026-10-15 | Superseded |
| Stable | `3.2.1` | — | `v3.2.1` | 2026-10-16 | Superseded |
| Stable | `3.3.0` | — | `v3.3.0` | 2026-10-16 | Superseded |
| Stable | `3.3.1` | — | `v3.3.1` | 2026-10-16 | Superseded |
| Stable | `3.3.2` | — | `v3.3.2` | 2026-10-16 | Superseded |
| Stable | `3.3.3` | — | `v3.3.3` | 2026-10-17 | Superseded |
| Stable | `3.4.0`–`3.6.0` | — | `v3.4.0`, `v3.5.0`, `v3.6.0` | 2026-10-18 | Not submitted (publish runs cancelled); their changes reached the store in `3.7.0` |
| Stable | `3.7.0` | — | `v3.7.0` | 2026-10-18 | **Published: the live stable build** (Chrome and Firefox; Edge still in review) |
| Stable | `3.7.1`, `3.8.0` | — | `v3.7.1`, `v3.8.0` | 2026-10-21 | Not submitted (no user-facing change; superseded by `3.9.0`) |
| Stable | `3.9.0` | — | `v3.9.0` | 2026-10-21 | Awaiting approval in the publish workflow (`store-stable`) |
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
| BETA | `4.1.0.11` | `3.1.0-beta.11` | `v3.1.0-beta.11` | 2026-10-07 | Superseded |
| BETA | `4.1.3.1` | `3.1.3-beta.1` | `v3.1.3-beta.1` | 2026-10-15 | Superseded |
| BETA | `4.3.2.1` | `3.3.2-beta.1` | `v3.3.2-beta.1` | 2026-10-16 | Latest BETA build. Changes from stable `3.4.0` on (rows below marked "Stable only so far") are not on the BETA item yet |
| Both | `3.2.0` | — | `v3.2.0` | 2026-10-15 | Published (stable `3.2.0`; BETA from `3.3.2-beta.1`): adds automatic backups (Pro) and the `alarms` wording above, plus the OPTIONAL `downloads` permission for "Also save a file to this computer". No required permission changes, so no re-approval prompt for existing users; `downloads` is asked for only when a user turns that option on. Update the dashboard's privacy tab: the permission justification above, and "Web history" stays ticked (the file holds saved tab addresses but stays on the user's disk). Screenshots: none of the current ones shows Settings, so none needs refreshing; a new Settings → Data screenshot showing the backups list would be worth adding. Same draft: the `downloads` justification now also covers showing where the last backup file is ("Last file" path and "Show in folder"), so paste the updated justification into the dashboard; and the browser's native confirm boxes (import, restore a backup by replacing, delete a backup, restore a session) became dialogs inside the popup, which no current screenshot shows |

| Both | `3.2.0` | — | `v3.2.0` | 2026-10-15 | Published (stable `3.2.0`; BETA from `3.3.2-beta.1`): adds the guided tour of the popup (starts once after a first install, never after an update; replay from the header "?" button or Settings, General). No manifest change and no new permission: the tour's progress is one record in `chrome.storage.local`, already covered by `storage`, so there is no re-approval prompt. The tour has seven chapters with a header each, fifteen "try it" steps and a thin pulsing orange ring on the control to use next. Eleven of them (four drag-and-drop steps, saving a tab, "Open in browser", "Deduplicate tabs", selecting items, two search steps, undo and redo) work on two sample groups ("Tour demo", "Tour demo 2") that the tour adds for those chapters and removes again by itself, and which never leave the device (not synced, backed up, exported, shared or counted toward a plan). The "save a tab" step opens one spare tab of the extension's own (`tour-practice.html`, a packaged page, opened in the background with `chrome.tabs.create`, which needs no extra permission) and closes it again; it is the only tab that step can move, and it is left out of the "continue on another device" snapshot. During those chapters "Open in browser" opens nothing, and "Undo" and "Redo" run on a history of the sample data alone, so the user's own tabs, groups and undo history are untouched. The group made while trying is offered for removal at the end. No new data leaves the device apart from six anonymous usage events (`tour_started`, `tour_completed`, `tour_skipped`, `tour_task_done`, `tour_step_skipped`, `tour_chapter_skipped`, carrying step or chapter ids only) through the existing analytics path. Screenshots: the ones showing the popup header need refreshing, see Screenshot Notes |
| Both | `3.2.0` | — | `v3.2.0` | 2026-10-15 | Published (stable `3.2.0`; BETA from `3.3.2-beta.1`): search shows what matched, and matches only the text as typed (in sequence, any case; letters out of order no longer match), best matches first in the search list. Matched text is highlighted (title, address, window, group and Chrome tab-group names, and the rows of the search list); tabs, windows and groups that do not match are hidden, or faded, by a new local setting "Tabs that do not match a search" (Hide by default, Dim) in Settings, General; the query stays until the user clears it (a clear button in the search field, next to the header box and on the "hidden by search" line); "Now Open" is searched like any group. No manifest change, no new permission, no new data: the query never leaves the popup's memory and the setting is one more field of the existing local preferences record. Dragging and keyboard moving are switched off while a search hides rows. Screenshots: see Screenshot Notes |

| Both | `3.3.0` | — | `v3.3.0` | 2026-10-16 | Published (stable `3.3.0`; BETA from `3.3.2-beta.1`): the extension also accepts its website messages (install check, sign-in handoff, sync request) from the site's new domain: `tabmerger.com` next to `tabmerger.vercel.app` (stable), `preview.tabmerger.com` next to `tabmerger-preview.vercel.app` (BETA). Only `externally_connectable.matches` changes in the Chrome and Edge manifest; it is not a permission, so no warning and no re-approval prompt. Paste the updated `externally_connectable` text above into the review notes if asked. The privacy tab needs no new tick: the extension sends nothing new and still sends everything to the current site. Screenshots: none affected |

| Both | `3.3.1` | — | `v3.3.1` | 2026-10-16 | Published (stable `3.3.1`; BETA from `3.3.2-beta.1`): the extension now talks to the website on its new domain: sign-in, sync, AI and checkout requests, links and the uninstall page go to `tabmerger.com` (stable) / `preview.tabmerger.com` (BETA). The old `vercel.app` hosts stay trusted. Manifest: the same two `externally_connectable.matches` per build as the previous release, so no permission change and no prompt. The privacy tab needs no new tick: the same data goes to the same operator's site under its own domain. Screenshots: none affected |

| Both | `3.2.0` | — | `v3.2.0` | 2026-10-15 | Published (stable `3.2.0`; BETA from `3.3.2-beta.1`): after the extension is removed, the browser opens the optional uninstall survey page (`/uninstalled` on the TabMerger website) via `runtime.setUninstallURL`. No manifest change and no new permission. The address carries only the extension version, browser and release channel; see Technical privacy notes. The dashboard's privacy tab needs no new tick (the extension sends nothing; the page itself is the website's) |
| Stable | `3.7.0` | — | `v3.5.0` | 2026-10-18 | Published in stable `3.7.0` (first in `3.5.0`, which wasn't submitted). Stable only so far: the uninstall survey address gains an analytics on/off flag (`a=1` / `a=0`; on Firefox it follows the `technicalAndInteraction` consent and is re-registered when that consent changes). When it is `1`, the website's server records one anonymous `extension_uninstalled` count in Google Analytics; the extension itself sends nothing new. No manifest change, no new permission. Privacy tab: already covered by "User activity" (anonymous usage events); no new tick. Screenshots: none affected |
| Stable | `3.7.0` | — | `v3.6.0` | 2026-10-18 | Published in stable `3.7.0` (first in `3.6.0`, which wasn't submitted). Stable only so far: "update available" prompt. When the browser has downloaded an update it cannot apply while TabMerger runs (`runtime.onUpdateAvailable`), the popup shows a dismissible banner, "Version X is ready", with "Restart to update" (`runtime.reload()`, which closes the popup). Settings → General gains "Check for updates" (`runtime.requestUpdateCheck()`). No manifest change, no new permission, no data sent anywhere: the pending version is kept in `chrome.storage.local`. Same draft: a daily anonymous `extension_heartbeat` event (on the existing `alarms` permission; justification above updated). Screenshots: none show the banner; optional new one |
| Stable | `3.7.0` | — | `v3.4.0` | 2026-10-18 | Published in stable `3.7.0` (first in `3.4.0`, which wasn't submitted). Stable only so far: the popup, the extension pages, the right-click menu and notifications are translated into German, Spanish, French, Japanese, Brazilian Portuguese and Simplified Chinese, following the browser's UI language (`chrome.i18n.getUILanguage()`, English otherwise) unless a language is picked in the header's language menu or Settings, General (stored on the device only, never synced). No manifest change and no new permission, so no re-approval prompt; the manifest name and description and this listing stay English. No new data leaves the device. Screenshots: the popup header gained a language button (globe icon and a two-letter code) next to the "?" button, so the ones showing the header need refreshing; localized store listings and screenshots are optional |
| Stable | `3.7.0` | — | `v3.7.0` | 2026-10-18 | Published in stable `3.7.0`. Stable only so far: the TabMerger logo in the popup header is now a link to the TabMerger website (`tabmerger.com` stable, `preview.tabmerger.com` BETA), opened in a new tab in the popup's language (`/en`, `/de`, `/fr`, …). No manifest change, no new permission, no data sent (a plain link with no tracking parameters). Privacy tab: no new tick. Screenshots: no visual change except a focus ring and tooltip on hover/focus; none need refreshing |
| Stable | `3.9.0` | — | `v3.9.0` | 2026-10-21 | Awaiting approval: eight more languages in the popup, the extension pages, the right-click menu and notifications (Italian, Russian, Korean, Turkish, Indonesian, Polish, Vietnamese, Hindi; fifteen in all), the same language rules as above. The package stays under its size budget because the background worker now bundles only the strings it uses. Same release: the anonymous install and update events also carry the extension version, the release channel and the browser name (already covered by "User activity"; no new tick), and test builds no longer send analytics or error reports. No manifest change, no new permission. The manifest name and description and this listing stay English. Screenshots: none affected |
| Stable | — | — | next release | — | Draft: three more languages, Arabic, Hebrew and Persian (eighteen in all), with right-to-left layouts: in those languages the popup and the extension pages mirror (sidebar on the right, menus, tour card, toasts, Left/Right arrow keys), while tab titles, group names and URLs keep their own direction. The language menu in the header and Settings, General → Language now have a search field (by name or code such as "de"), a scrolling list, each language's name in the current language, and a ¶← mark on right-to-left languages. The old Hebrew code `iw` stored by an earlier choice is read as `he`. No manifest change, no new permission, no new data leaves the device. The manifest name and description and this listing stay English; the long description's language bullet is updated. Screenshots: the English popup is pixel-identical, so none need refreshing; a right-to-left screenshot is optional |
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

> TabMerger 3 rewrites version 2: same item, same purpose (saving, organizing and restoring tabs
> in named groups). No account or test credentials needed: open the popup, save tabs with "Save
> to TabMerger" (popup or right-click menu), then restore them. Tabs are stored locally. New:
> optional paid sync, only via the popup's account icon. Sync is end-to-end encrypted on the
> device with the user's passphrase; the server holds only ciphertext. No host permissions; no
> content script on Chrome. The background script only runs user-set reminders, the right-click
> menu, the badge, shortcuts and the user's URL rules. AI is off. Version 2 data is not imported.
> Uninstalling opens an optional survey on the TabMerger website (runtime.setUninstallURL, no
> permission); its URL holds only version, browser, channel and an analytics on/off flag.

### Known Issues / Limitations

- Pro AI (AI grouping, smart naming, group descriptions written into the group's note, tab summaries, session suggestions, and Organize, which
  proposes merges, renames, archives and a new group order to review and apply) is marked "coming soon" and disabled behind
  feature flags as of this writing (one for Pro AI where TabMerger handles setup, one for the own-key option) —
  do not describe it as available in store copy while both are off. See `CLAUDE.md`'s AI feature flag notes.
- `externally_connectable` is scoped to the web app's sites (`VITE_WEB_APP_URL` plus
  `VITE_EXTRA_WEB_APP_URLS`, each checked to be a bare https origin when the extension builds)
  plus one extra ID,
  `DEV_EXTENSION_ID` (`@tabmerger/shared`): the maintainer's unpacked development build, so the
  local web app can reach it. It grants nothing to other extensions or sites.

### Rejection History

No rejection has been recorded in this repo's history as of 2026-10-06. Add a row here the
first time one occurs.

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| — | — | — | — |
