# Feature Roadmap

This is the forward-looking list. Known bugs and engineering tasks are tracked separately, not here. [roadmap-next.md](roadmap-next.md) has more detail on upcoming items; link to it rather than copying it here.

## Current state

_Last updated 2026-10-06. Keep this current in the same change as the work (a CLAUDE.md rule)._

- **Releases:** the latest stable tag is `v3.0.0`, but it hasn't been published to the stores: v3
  goes to stable after the 3.1 beta. The beta channel is at `v3.1.0-beta.11`
  (Chrome BETA listing, and the self-hosted Firefox beta). Releases come from semantic-release:
  prereleases on the `beta` branch, stable versions on `main` ([PUBLISHING.md](PUBLISHING.md)).
- **Stores:** the Chrome Web Store stable listing and the Firefox AMO listing are both still on v2
  (`2.0.0`); v3 is only on the beta channels. The
  Edge Add-ons listing isn't published from CI yet (its secrets aren't set).
- **Shipped and in the code:** local-first groups, windows and tabs in IndexedDB. Supabase sync (Pro) with mandatory E2E encryption, enforced server-side (RLS requires an active paid plan). Saved sessions. "Continue on other device" (`device_sessions`). Encrypted multi-group share links (`shared_bundles`, `/share/[slug]`). URL auto-assignment rules. Tab notes, reminders and custom titles. Bulk selection actions. Duplicate-tab cleanup. Stale-tab cleanup suggestions. Import from JSON, bookmarks HTML and OneTab. Right-click menu and keyboard commands. Stripe subscriptions and AI credit packs. Monthly ↔ yearly plan switching. Local-currency checkout (Stripe Adaptive Pricing). Web dashboard and account pages, usable on phones. Public `/changelog`. Beta tester guide at `/beta` with a known-issues list (`packages/web/lib/knownIssues.ts`).
- **Built but off:** AI features (auto-group, name group, tab summary, session suggestions, organize) are behind the "coming soon" flag (`NEXT_PUBLIC_AI_ENABLED` / `VITE_AI_ENABLED`, off unless `"true"`).

---

## Polish and conversion

### Extension

- [x] Non-blocking upgrade prompt at the free limit (`UpgradePrompt`, `UpgradeCTA`, locked items past `FREE_TIER_LIMITS`)
- [x] Search shortcuts: Ctrl/Cmd+F focuses search, Ctrl/Cmd+K opens the search overlay. Ctrl/Cmd+G adds a group.
- [ ] Undo/redo keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z). Undo and redo exist only as header buttons today.
- [ ] Onboarding tooltip flow for new installs. The web dashboard has an onboarding checklist; the extension has nothing.
- [ ] Group collapse/expand in the sidebar, persisted to IndexedDB
- [ ] Letter-avatar favicon fallback. Today a generic fallback icon is shown.

### Web

- [x] `/changelog` page (reads the semantic-release `CHANGELOG.md`; prereleases filtered out)
- [x] Invented testimonials replaced by live store ratings and reviews (Chrome Web Store, with Firefox AMO as fallback)
- [x] SEO basics: metadata, `sitemap.ts`, `robots.ts`
- [ ] OpenGraph/Twitter share image. `metadata.openGraph` has no image today.
- [ ] Email capture on the landing page (newsletter/waitlist). Resend is used only for the contact form so far.
- [ ] Chrome Web Store screenshot refresh. The pipeline exists in `packages/demo` (`screenshots`, `store-assets`).
- [x] Toasts with a countdown bar, readable contrast, and a proper dismiss button
- [x] Signed-in pages (dashboard, account) fit phone screens

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
- [ ] Streaming responses for session suggestions. Only `organize` streams, via Vercel Workflow.
- [ ] "AI grouped X tabs into Y groups" confirmation with undo
- [ ] Quality evaluation harness (log outputs for review)

## Power-user features (Pro retention)

- [x] Tab notes, and reminders with notifications
- [x] Bulk tab actions (selection mode → move, star, share, delete)
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
