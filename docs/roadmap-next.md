# TabMerger — Next Features & Improvements

## How to use this doc

Each item is a self-contained spec that can be pasted directly into a domain agent as the task prompt. Items are grouped by domain, ordered roughly by user value. E2E test coverage is called out explicitly where it's critical.

---

## E2E Test Coverage (cross-cutting)

**Current gap:** all tests are unit/component (Vitest + jsdom). Zero E2E coverage of the actual Chrome extension or the Next.js web app.

### E2E-001 — Extension Playwright Suite
**Agent:** `test-writer` + `extension-dev`  
**Scope:** Use `@playwright/test` + the WXT-provided test helpers (or `chrome-extension-tools`) to drive the real popup against a seeded IndexedDB state.

Core flows to cover:
1. Open popup → groups list renders
2. Create group → appears in sidebar
3. Drag tab between windows → reorder persists
4. Selection mode → bulk delete → undo
5. Search filter → matches update live
6. Now Open sync → tab count badge matches

**Deliverable:** `packages/extension/e2e/` with a `vitest.e2e.config.ts` that runs against a Chromium binary.

### E2E-002 — Web App Playwright Suite
**Agent:** `test-writer` + `web-dev`  
**Scope:** Next.js app router flows.

Core flows to cover:
1. Landing page renders without auth errors
2. `/pricing` → Stripe checkout redirect (mock Stripe.js)
3. Auth callback → dashboard redirect
4. Dashboard loads groups list from Supabase
5. Billing portal link visible for pro users

**Deliverable:** `packages/web/e2e/` with Playwright config wired into CI.

---

## Stripe + Supabase Paid User Flow

### PAY-001 — End-to-end subscription lifecycle
**Agent:** `payments` + `database`  
**Spec:**

#### Sign-up → Free tier
- User installs extension, opens popup
- Prompted to create account (email/password via Supabase Auth)
- Free entitlements enforced: ≤5 groups, ≤50 tabs per group
- "Upgrade" CTA visible when approaching limit (4 groups / 45 tabs)

#### Upgrade → Pro
1. User clicks "Upgrade" in extension popup or on `/pricing`
2. `POST /api/checkout` creates a Stripe Checkout session with `client_reference_id = supabase_user_id`
3. Stripe redirects to `/checkout/success?session_id=...`
4. Webhook `checkout.session.completed` fires → upserts `subscriptions` row:
   - `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `tier = 'pro'`, `status = 'active'`
5. Extension re-fetches entitlements → limits lifted immediately (no reload needed)
6. Dashboard shows "Pro" badge + current billing period

#### Cancellation
1. User opens billing portal (`POST /api/billing-portal`)
2. Cancels in Stripe → `customer.subscription.updated` webhook fires with `cancel_at_period_end = true`
3. DB: `cancel_at_period_end = true` set on subscription row
4. Extension shows "Your Pro plan ends on {date}" banner
5. At period end: `customer.subscription.deleted` → `status = 'canceled'`, tier reverts to `free`
6. Tabs/groups above free limit become read-only (not deleted), shown with a "Pro required" lock icon

#### Payment failure
- `invoice.payment_failed` → set `status = 'past_due'` in DB
- Extension shows "Payment issue — update card" warning
- Grace period: 7 days before downgrade to free

#### Required DB schema additions:
```sql
alter table subscriptions add column cancel_at_period_end boolean default false;
alter table subscriptions add column current_period_end timestamptz;
alter table subscriptions add column stripe_price_id text;
```

#### Acceptance criteria:
- [ ] New user can complete checkout in < 3 clicks from pricing page
- [ ] Webhook idempotency: replaying the same event twice doesn't create duplicate rows
- [ ] Extension entitlements refresh within 30s of subscription change (no reload)
- [ ] Pro user downgrade: data preserved, UI locked not destroyed
- [ ] All flows covered by E2E-002 web suite

### PAY-002 — Pro AI tier
**Agent:** `payments` + `ai-features`  
**Scope:** Gate AI features (auto-group, tab summary) behind `pro_ai` tier.

- Add `pro_ai` Stripe product + price
- `useEntitlements` already reads `tier` — add `hasAI: tier === 'pro_ai'`  
- AI action buttons show upgrade prompt when `!hasAI`
- Usage cap: 100 AI requests/month per user, tracked in a `ai_usage` table with monthly reset

---

## Extension Features

### EXT-001 — Tab notes
**Agent:** `extension-dev`  
**Spec:** Each tab chip has an optional note field (plain text, ≤500 chars).

- Long-press or right-click → "Add note" → inline textarea below the chip
- Note icon (📝) appears on chips that have a note; hover shows preview tooltip
- Notes stored as `tab.note?: string` in `packages/shared/src/types/index.ts`
- Notes sync via Supabase (already in `updatedAt` sync model)

### EXT-002 — Session restore
**Agent:** `extension-dev` + `database`  
**Spec:** Snapshot the entire browser state (all windows + tabs) as a named session.

- "Save session" button in the top bar → prompt for session name
- Sessions listed in a new "Sessions" tab in the sidebar (below groups)
- One-click restore: closes current windows, opens session windows
- Sessions stored in IndexedDB, synced to Supabase for pro users
- Free tier: 3 sessions max

### EXT-003 — Keyboard-first navigation
**Agent:** `extension-dev` + `design-system`  
**Scope:** Full keyboard navigation without a mouse.

- `↑`/`↓` to move between groups in sidebar; `Enter` to expand
- `Tab` to move between tabs in the windows panel
- `Ctrl+G` to create new group
- `Ctrl+F` to focus search
- `Del` to remove focused tab/group (with confirm for groups)
- `Ctrl+Z` / `Ctrl+Y` for undo/redo (already in store)
- Visible focus rings (2px indigo, not browser default)

### EXT-004 — Tab deduplication
**Agent:** `extension-dev`  
**Spec:** Detect and highlight duplicate URLs within a group.

- "Deduplicate" button in group header (or via right-click on group)
- Shows a modal: "Found N duplicates" with a diff-style list (keep first, remove others)
- Auto-dedup option in settings
- Now Open: deduplicate live browser tabs (close duplicate chrome tabs, keep the oldest)

### EXT-005 — Import / Export
**Agent:** `extension-dev`  
**Spec:** JSON export/import of the full groups state.

- Settings → "Export data" → downloads `tabmerger-backup-{date}.json`
- Settings → "Import data" → file picker, validates schema, merges or replaces
- Chrome bookmarks import: parse Bookmarks HTML export, convert folders → groups
- OneTab import: parse the plain-text OneTab export format

### EXT-006 — Context menu "Open all in new window"
**Agent:** `extension-dev`  
**Spec:** Right-click a saved group → "Open all tabs in new window" — `chrome.windows.create({ urls })`.  
Already have the architecture; this is a small addendum to the existing context menu.

### EXT-007 — Tab aging / stale indicators
**Agent:** `extension-dev` + `design-system`  
**Spec:** Tabs saved > 30 days ago show a subtle "stale" indicator (amber dot on favicon).

- Configurable threshold in settings (7 / 14 / 30 / 60 days)  
- "Remove stale tabs" bulk action in group header

---

## Web App Features

### WEB-001 — Dashboard: group grid view
**Agent:** `web-dev` + `design-system`  
**Spec:** The dashboard currently shows a list; add a card grid view.

- Toggle between list and grid in the top-right
- Card shows: group name, color swatch, window count, tab count, last updated
- Click card → expand to tab list (inline accordion)
- Pro: sync indicator (cloud icon, last synced timestamp)

### WEB-002 — Landing page social proof
**Agent:** `web-dev` + `design-system`  
**Scope:** Add testimonials section and Chrome Web Store rating widget.

- 3-4 testimonial cards (user quotes, star ratings)
- Live Chrome Web Store rating via unofficial API or static + manual update
- "Trusted by X users" count (pulled from analytics or set manually)

### WEB-003 — Referral program
**Agent:** `web-dev` + `payments` + `database`  
**Spec:** Pro users get a shareable referral link. Successful referral = 1 month free for both.

- `referrals` table: `referrer_id`, `referee_id`, `created_at`, `rewarded_at`
- Referral link: `tabmerger.com/r/{code}` → sets a cookie, tracked at signup
- Stripe coupon applied on first invoice of referee; referrer gets credit on next invoice
- Dashboard shows referral link + count of successful referrals

### WEB-004 — Public group sharing
**Agent:** `web-dev` + `database`  
**Spec:** Pro users can publish a group as a shareable read-only URL.

- `groups.public_slug` column (nullable, unique)
- `GET /share/{slug}` → public page showing group tabs (no auth required)
- One-click "Copy link" from extension popup (pro only)
- View count tracked in DB

---

## AI Features

### AI-001 — Smart cleanup suggestions
**Agent:** `ai-features`  
**Spec:** Weekly digest email (or in-extension notification) with suggestions:

- "You have 12 tabs older than 30 days — remove or archive?"
- "These 5 tabs seem related — merge into a new group?"
- Powered by the existing `/api/ai/organize` route + a scheduled Supabase edge function

### AI-002 — Tab search with natural language
**Agent:** `ai-features` + `extension-dev`  
**Spec:** Cmd+K style search that understands queries like "recipes I saved last week" or "anything about TypeScript".

- Builds an embedding index of tab titles + URLs (OpenAI `text-embedding-3-small`)
- Stored in Supabase `pgvector` column
- Query → embed → cosine similarity search → ranked results

### AI-003 — Meeting prep mode
**Agent:** `ai-features` + `extension-dev`  
**Spec:** User pastes a meeting agenda → AI suggests relevant saved tabs to open.

- Small modal: "What's your meeting about?" text input
- Returns top 5 matching tabs across all groups
- One-click "Open all suggested tabs"

---

## DevOps / Quality

### DEV-001 — Bundle size budget
**Agent:** `devops`  
**Spec:** Add a CI step that fails if the extension bundle exceeds 2MB (current: ~800KB).

- `rollup-plugin-visualizer` in WXT config (dev only)
- CI: `wxt build --analyze`, check output size, fail with diff if over budget
- Report uploaded as CI artifact

### DEV-002 — Automated store screenshots
**Agent:** `demo` + `devops`  
**Spec:** The `packages/demo/` pipeline already records the extension. Wire it into CI to auto-generate store screenshots on every release.

- `pnpm demo:screenshots` → Playwright captures 5 canonical views at 1280×800
- CI `publish.yml` job: run screenshots, upload to Chrome Web Store draft via API
- Blocks manual screenshot updates

### DEV-003 — Error tracking (Sentry)
**Agent:** `devops` + `extension-dev` + `web-dev`  
**Spec:** Add Sentry for both the extension and web app.

- Extension: `@sentry/browser` init in popup entrypoint, DSN via `VITE_SENTRY_DSN`
- Web: `@sentry/nextjs` with `withSentryConfig` wrapper
- Source maps uploaded on build (not committed)
- Alert on new issues with > 5 occurrences/hour

---

## Priority Order (suggested)

| # | Item | Value | Effort |
|---|------|-------|--------|
| 1 | PAY-001 (subscription lifecycle) | Critical | L |
| 2 | E2E-001 (extension Playwright) | High | M |
| 3 | EXT-003 (keyboard nav) | High | M |
| 4 | EXT-004 (deduplication) | High | S |
| 5 | EXT-005 (import/export) | High | S |
| 6 | WEB-001 (dashboard grid) | Medium | S |
| 7 | PAY-002 (AI tier) | Medium | S |
| 8 | AI-002 (semantic search) | Medium | L |
| 9 | DEV-003 (Sentry) | Medium | S |
| 10 | EXT-001 (tab notes) | Medium | S |
| 11 | EXT-002 (session restore) | Medium | M |
| 12 | DEV-001 (bundle budget) | Low | S |
| 13 | WEB-002 (social proof) | Low | S |
| 14 | AI-001 (smart cleanup) | Low | M |
| 15 | WEB-003 (referral) | Low | L |

S = small (1-2 days), M = medium (3-5 days), L = large (1-2 weeks)
