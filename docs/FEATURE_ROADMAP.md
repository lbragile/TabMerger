# Feature Roadmap

## Current State — v2.0 (Scaffold Complete)

The full monorepo scaffold is in place. Core work remaining before v2.0 ships:

- [ ] `pnpm install` + verify all packages resolve
- [ ] Configure Supabase project (URL + keys in `.env.local`)
- [ ] Configure Stripe products/prices and populate price IDs
- [ ] Load Chrome/Firefox/Edge store credentials into GitHub Secrets
- [ ] Connect Vercel project for web deployment
- [ ] End-to-end test: install extension → sign up → upgrade → sync → AI group tabs

---

## v2.1 — Polish & Conversion (Next milestone)

**Goal:** Drive free → paid conversion.

### Extension
- [ ] Onboarding tooltip flow for new installs (highlight key features)
- [ ] "You've reached the free limit" upgrade prompt (non-blocking, shows value prop)
- [ ] Keyboard shortcuts (Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo, Cmd/Ctrl+F search)
- [ ] Group collapse/expand in sidebar (persist to IndexedDB)
- [ ] Tab favicon fallback (letter avatar when favicon missing)

### Web
- [ ] Email capture on landing page (Resend waitlist/newsletter)
- [ ] Chrome Web Store featured screenshot optimization
- [ ] `/changelog` page (auto-generated from git tags)
- [ ] Testimonials from real users (replace placeholders)
- [ ] SEO: meta descriptions, OpenGraph images, sitemap.xml

**Agents:** extension-dev, web-dev, design-system

---

## v2.2 — AI Quality (Pro AI value prop)

**Goal:** Make AI features good enough that Pro AI tier sells itself.

- [ ] Improve auto-grouping prompt with few-shot examples
- [ ] Cache tab summaries in IndexedDB by URL (24h TTL) — reduces API calls 80%+
- [ ] Streaming AI responses for session suggestions (show text as it generates)
- [ ] "AI grouped X tabs into Y groups" success feedback with undo option
- [ ] Deduplicate tab detection (cluster near-identical URLs + titles)
- [ ] Smart close suggestion: "8 tabs haven't been active in 3 days — archive?"
- [ ] Quality evaluation harness: log AI outputs for manual review

**Agents:** ai-features, extension-dev

---

## v2.3 — Power User Features (Pro retention)

**Goal:** Give Pro users features they can't get anywhere else.

- [ ] Session scheduler: "Restore this session every Monday at 9am"
- [ ] Tab notes: per-tab text notes stored with the group snapshot
- [ ] Group templates: save a group structure (without URLs) as a reusable template
- [ ] Bulk tab actions: select multiple tabs → move to group / close / open
- [ ] Quick-open: `Cmd+Shift+Space` fuzzy search across all saved groups (Raycast-style)
- [ ] Export to Notion / Obsidian (markdown links)
- [ ] Browser history integration: show recently closed tabs in a recoverable list

**Agents:** extension-dev, design-system

---

## v2.4 — Growth

**Goal:** Expand reach beyond organic store installs.

- [ ] Referral program: "Give 1 month Pro, get 1 month Pro free"
- [ ] Team plan ($14.99/mo): shared group collections across a team via Supabase
- [ ] Public group sharing: shareable link to a group snapshot (no auth required to view)
- [ ] Embed widget: `<tabmerger-badge>` web component showing your saved session count
- [ ] ProductHunt launch assets (GIF demo, tagline variants)
- [ ] Affiliate program for productivity bloggers/YouTubers

**Agents:** web-dev, payments, extension-dev

---

## v3.0 — Platform (Long-term)

- [ ] Mobile app (React Native) — view and restore saved sessions on phone
- [ ] Safari extension (requires macOS + Xcode build pipeline)
- [ ] API access tier (Enterprise): programmatic tab group management
- [ ] Browser history analytics dashboard
- [ ] Zapier/Make integration: trigger tab group creation from external events

