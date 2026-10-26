# Feature Roadmap

This is the forward-looking list. Known bugs and engineering tasks are tracked separately, not here. [roadmap-next.md](roadmap-next.md) has more detail on upcoming items; link to it rather than copying it here.

## Current state

_Last updated 2026-10-25. Keep this current in the same change as the work (a CLAUDE.md rule)._

- **Releases:** the latest stable tag is `v3.9.0` and the beta channel is at `v3.3.2-beta.1`
  (Chrome BETA listing, and the self-hosted Firefox beta), so beta testers have none of 3.4–3.9.
  Releases come from semantic-release: prereleases on the `beta` branch, stable versions on
  `main` ([PUBLISHING.md](PUBLISHING.md)). A stable release reaches the stores only when its
  `store-stable` publish jobs are approved, so not every tag is uploaded.
- **Website address:** the site lives at `tabmerger.com` (beta: `preview.tabmerger.com`) since
  v3.3.1. The old `*.vercel.app` hosts stay up and trusted, so installed builds keep working.
- **Stores:** v3 is live on the stable listings since `3.1.0` (2026-10-07). The live build is
  `3.7.0` on the Chrome Web Store and Firefox AMO; Edge Add-ons is still reviewing it. `3.9.0`
  (eight more languages) is waiting for approval in the publish workflow.
- **Shipped and in the code:** local-first groups, windows and tabs in IndexedDB. Supabase sync (Pro) with mandatory E2E encryption, enforced server-side (RLS requires an active paid plan). Saved sessions. "Continue on other device" (`device_sessions`). Encrypted multi-group share links (`shared_bundles`, `/share/[slug]`). URL auto-assignment rules. Tab notes, reminders and custom titles. Bulk selection actions. Duplicate-tab cleanup. Stale-tab cleanup suggestions. Import from JSON, bookmarks HTML and OneTab. Right-click menu and keyboard commands. Guided tour of the popup for new installs, replayable from the header and Settings (since 3.2.0). Stripe subscriptions and AI credit packs. Monthly ↔ yearly plan switching. Local-currency checkout (Stripe Adaptive Pricing). Web dashboard and account pages, usable on phones. Public `/changelog`. Beta tester guide at `/beta` with a known-issues list (`packages/web/lib/knownIssues.ts`). The website and the extension in fifteen languages (English, German, Spanish, French, Italian, Russian, Korean, Turkish, Indonesian, Polish, Vietnamese, Hindi, Japanese, Brazilian Portuguese, Simplified Chinese). The first seven are live (stable extension 3.7.0); the eight added in 3.9.0 are released but not yet in the stores. Arabic, Hebrew and Persian, with right-to-left layouts, are in the code but not yet released.
- **Built but off:** AI features (auto-group, name group, describe group, which writes the group's note, tab summary, session suggestions, organize, which is reviewed and applied in the popup; the header's AI menu groups them by what they act on) are behind the "coming soon" flag (`NEXT_PUBLIC_AI_ENABLED` / `VITE_AI_ENABLED`, off unless `"true"`).

---

## Polish and conversion

### Extension

- [x] Non-blocking upgrade prompt at the free limit (`UpgradePrompt`, `UpgradeCTA`, locked items past `FREE_TIER_LIMITS`)
- [x] Search shortcuts: Ctrl/Cmd+F focuses search, Ctrl/Cmd+K opens the search overlay. Ctrl/Cmd+G adds a group.
- [x] Search shows what matched: the matched text is highlighted in tab titles and addresses, window names (`window:`), group names (`group:`), Chrome tab-group names (`tag:`) and the rows of the search list; a tab found only by its address shows that part of the address. Tabs, windows and groups that do not match are hidden or faded (Settings, General: "Tabs that do not match a search", Hide by default; a local, per-device preference). While searching, the sidebar shows a per-group match count and the panel a "N tabs hidden by search" line with "Clear search". The query stays until the user clears it (also after picking a result, which goes to the tab and scrolls it into view), "Now Open" is searched like any group, and a screen reader hears the result count. Drag and drop and keyboard move are off while rows are hidden.
- [ ] Undo/redo keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z). Undo and redo exist only as header buttons today.
- [x] Guided tour of the popup for new installs: 26 steps in seven chapters, in plain language. Every chapter has a header on the card (title plus one sentence on what it covers and what the user will try). Fifteen steps are "try it" steps (make and name a group, change its color, pin it, four drag-and-drop steps, save a tab from Now Open, "Open in browser", "Deduplicate tabs", select items, search, a `group:` search filter, undo and redo, change the theme): completion is read from real state, only the controls the step needs are unlocked, and a thin pulsing ring in the secondary color marks the exact control to use next, with a "2 of 3" marker on the card. Three chapters (dragging, saving and reopening tabs, finding and undoing) run on two sample groups ("Tour demo") that the tour adds on entering them and removes on leaving; they are local-only and excluded from sync, backups, sessions, export, sharing, plan limits, the right-click menu, URL rules, the user's undo history and search (search shows them only during the tour's two search steps), and drag and drop treats them as a sealed sandbox. Each drag step has three sub-steps (pick up, move to the marker, drop) and works with the mouse and with the keyboard move mode; the marker stays up from the first sub-step to the drop and says what is literally true ("Drop below this tab", "Drop in this window", "Drop on this group", "Drop below this group"). Saving a tab is tried on a spare tab the tour opens and closes itself. During those chapters "Open in browser" opens nothing and "Undo" / "Redo" run on a history of the sample data alone; the user's own history is put back untouched.
  - [ ] Tour follow-ups: the tab right-click menu (notes, reminders, rename) is still explained only, because it has no control a keyboard user can be pointed at. Read-only steps spotlight the area they describe. At the Free group limit the group steps are shown read-only. Starts once after a first install (never after an update), resumes if the popup closes, and can be replayed from the header "?" button or Settings. Unreleased: ships with the next release.
- [x] Uninstall survey: after the extension is removed, the browser opens an optional "Why did you remove TabMerger?" page on the website (`/uninstalled`). The address carries only the extension version, browser and release channel; not set in the demo-video build (development builds set it, pointing at the local web app). Extension side since 3.2.0; the page and its form ship with the web app.
- [ ] Group collapse/expand in the sidebar, persisted to IndexedDB
- [ ] Letter-avatar favicon fallback. Today a generic fallback icon is shown.

### Web

- [x] `/changelog` page (reads the semantic-release `CHANGELOG.md`; prereleases filtered out)
- [x] Invented testimonials replaced by live store ratings and reviews from all three listings (Chrome Web Store, Firefox Add-ons, Edge Add-ons): one combined rating, each store's own figures, and a carousel mixing their reviews
- [x] SEO basics: metadata, `sitemap.ts`, `robots.ts`
- [ ] OpenGraph/Twitter share image. `metadata.openGraph` has no image today.
- [ ] Email capture on the landing page (newsletter/waitlist). Resend is used only for the contact form so far.
- [ ] Chrome Web Store screenshot refresh. The pipeline exists in `packages/demo` (`screenshots`, `store-assets`).
- [x] Toasts with a countdown bar, readable contrast, and a proper dismiss button
- [x] Signed-in pages (dashboard, account) fit phone screens
- [x] Translation-ready web app (next-intl): every public and signed-in page reads its words from `packages/web/messages/<locale>/`, English URLs unchanged, other languages under `/<locale>/…`, hreflang in metadata and the sitemap, a dev-only pseudo-locale (`/en-XA`) for layout testing, and a language switcher in the footer and on the account page. Privacy and Terms stay English. See [I18N.md](I18N.md). Since 3.4.0.
- [x] The website and the extension in German, Spanish, French, Japanese, Brazilian Portuguese and Simplified Chinese. The site picks the visitor's language from the browser and the switcher; the extension follows the browser's language. Since 3.4.0 (stable extension 3.7.0).
- [x] Eight more languages on the website and in the extension: Italian, Russian, Korean, Turkish, Indonesian, Polish, Vietnamese and Hindi (fifteen in all). The plan names "Pro" and "Pro AI" stay as brand names in every language. Released in 3.9.0 (stable extension awaiting approval).
- [x] Arabic, Hebrew and Persian on the website and in the extension (eighteen languages in all), with right-to-left layouts: the page and the popup mirror (sidebar, menus, tour card, drag ghost, toasts, left/right arrow keys), user content such as tab titles and group names keeps its own direction, and URLs stay left-to-right. Text that names a side ("the list on the left") names the mirrored side in these languages. The old Hebrew code `iw` is read as `he`. Not yet released.
- [x] A language picker in the extension: Settings → General → Language (applied with "Save changes") and a language menu in the popup header (applied at once). "Browser default" follows the browser's language; the choice is per device and never synced. Since 3.4.0 (stable extension 3.7.0).
- [x] Searchable language pickers on the website and in the extension: a search field that matches a language's own name, its name in the current language, or its code ("de", "he"); a scrolling list that opens at the current language; each language's own name with its name in the current language beside it; and a ¶← mark on right-to-left languages. On the website the picker sits in the top bar at every width, phones included. Not yet released.

### Billing

- [x] Switch a paid plan between monthly and yearly (pricing page button + Billing Portal). Monthly → yearly applies now with proration; yearly → monthly waits for the end of the term.
- [x] Local-currency checkout via Stripe Adaptive Pricing: customers pay in their currency (2–4% conversion fee on them), we're credited USD. Needs USD as a settlement currency in **live** mode before it applies there.
- [ ] Stripe Tax (EU/UK VAT, Canadian GST/HST, AU GST) before selling to those regions at volume. Decide registration with an accountant.
- [ ] Optional fixed CAD prices (`currency_options`) so Canadians pay a round price with no conversion fee.

## AI quality (Pro AI), gated on the AI launch

- [x] Stale-tab / cleanup suggestions (`useCleanupSuggestions`, a client-side heuristic)
- [x] Exact duplicate-URL detection (`lib/deduplication.ts`)
- [ ] Near-duplicate clustering (similar URLs and titles)
- [ ] Few-shot examples in the auto-grouping prompt
- [ ] Persist tab summaries in IndexedDB with a TTL. Today the cache is in memory and lasts only until the popup closes.
- [ ] Streaming responses for session suggestions.
- [ ] "AI grouped X tabs into Y groups" confirmation with undo
- [ ] Quality evaluation harness (log outputs for review)

## Power-user features (Pro retention)

- [x] Tab notes, and reminders with notifications
- [x] Bulk tab actions (selection mode → move, star, share, delete)
- [x] Automatic backups (Pro): an encrypted snapshot of the saved groups on a schedule (hourly to weekly, daily by default), newest 10 kept, restored from Settings → Data (add to the current groups, or replace them; both undoable). Backups stored in the account are brought back onto a device that lost its local data (reinstall, new browser profile) when that screen is opened. They also appear in a Backups section on the web dashboard, where they can be viewed, downloaded and deleted (restoring is done in the extension). Deleting one there removes the cloud copy only: a browser that already has that backup keeps its own copy, and a backup missing from the account is never deleted from a browser because of that. Optionally each backup is also saved as a JSON file inside the browser's Downloads folder (optional `downloads` permission, folder and file name chosen by the user); Settings shows the full path of the last file and a "Show in folder" button. In the code, not released yet.
- [ ] Session scheduler ("restore this session every Monday at 9am")
- [ ] Group templates (group structure without URLs)
- [ ] Global quick-open hotkey outside the popup. Search inside the popup exists (Ctrl/Cmd+K).
- [ ] Export to Notion or Obsidian (markdown links). Export is JSON only today.
- [ ] Recently closed tabs list

## Growth

- [x] Public sharing: encrypted multi-group bundles. Single-group publish via `public_slug` is currently broken.
- [ ] Referral program
- [ ] Team plan with shared group collections. Only `free`, `pro` and `pro_ai` exist.
- [ ] Embeddable badge widget
- [ ] Product Hunt launch assets. The promo cuts exist in `packages/demo` (see `PROMO_VIDEO_SPEC.md`).
- [ ] Affiliate program

## Distribution

- [x] Firefox beta channel: unlisted, signed by AMO, self-hosted with auto-updates
- [ ] Chrome Web Store stable 3.x (replaces 2.0.0), after the 3.1 beta
- [ ] Firefox stable 3.x on the AMO listing (replaces 2.0.0)
- [ ] Edge Add-ons publishing from CI (the job is ready; needs the `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID` and `EDGE_API_KEY` secrets in the `store-stable` environment)
- [x] Development is public at `lbragile/TabMerger` (moved 2026-10-02): one repo for code, CI, releases and store publishing, with secrets in GitHub environments

## Platform (long-term)

- [ ] Mobile companion app (view and restore saved sessions)
- [ ] Safari extension
- [ ] API access tier
- [ ] Browsing-history analytics dashboard
- [ ] Zapier/Make integration
