# TabMerger — Next Features & Improvements

## How to use this doc

Each item is a self-contained spec that can be pasted directly into a domain agent as the task prompt. Items are grouped by domain, ordered roughly by user value. E2E test coverage is called out explicitly where it's critical.

---

## Session 4 Batch — In Progress / Completed (2026-07-18)

### GOLD-001 — TypeScript strict mode + ESLint across all packages
**Status:** Done  
- Extension: `@tabmerger/shared` path alias added to tsconfig so `tsc` resolves workspace types; `strict: true` was already set.  
- Web: Fixed `localStorage` reads inside `useEffect` in `GroupGrid.tsx` and `OnboardingChecklist.tsx` → lazy `useState` initializer instead.  
- CI: `dep-audit` job added (`pnpm audit --audit-level=high`, non-blocking). Branch-protection required jobs documented in `ci.yml` header comment.

### GOLD-002 — WCAG 2.1 AA accessibility audit
**Status:** Done  
Full audit: contrast, keyboard nav, focus rings, ARIA labels, semantic HTML fixed across 10 files. Key: `GroupContextMenu` wrapper div needed `role="button"` + `onKeyDown`; Navbar text was 4.4:1 (below AA).

### FEAT-001 — Session restore in web dashboard
**Status:** Done  
Session cards gain: Restore button, stats (groups / windows / tabs count, pluralized), full datetime display (`Intl.DateTimeFormat` long date + short time).

### FEAT-002 — Multi-group sharing
**Status:** Done  
- DB: `shared_bundles` table with `slug`, `groups_snapshot` jsonb, `expires_at`. Public SELECT RLS, authenticated INSERT only. (migration `009_create_shared_bundles.sql`)
- Extension: "Share" button in SelectionActionBar when groups are selected. Pro-tier gate. Generates slug, inserts bundle, copies URL to clipboard.
- Web: `/share/[slug]` public page showing groups → windows → tabs. Click tab to open. Expired / not-found states handled server-side.

### FEAT-003 — URL auto-assignment background listeners
**Status:** Done  
`chrome.tabs.onCreated` + `chrome.tabs.onUpdated` listeners in `background.ts`. Reads rules from localDb, calls `matchUrlToRule()`, saves matching tab to the target group silently. Tab stays open in browser.

### FEAT-004 — Tab title editing
**Status:** Done  
Double-click to rename tab title inline (same UX as group rename). Saves `customTitle` to localDb. Best-effort content script message (`SET_TAB_TITLE`) renames live browser tab title via `document.title`.

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

### ~~E2E-002 — Web App Playwright Suite~~ ✅ DONE
`packages/web/e2e/` — landing, pricing, AI auth guards, dashboard auth redirect, public share 404. Playwright config wired to `pnpm dev` webServer.

### E2E-002 — Web App Playwright Suite (archived spec)
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

### ~~EXT-001 — Tab notes~~ ✅ DONE
Right-click → "Add note" / "Edit note", inline textarea (Escape cancels, Ctrl+Enter commits, 500 char cap), `StickyNote` icon with tooltip on chips that have a note. Stored as `tab.note?: string`, syncs via Supabase automatically.

~~**Agent:** `extension-dev`  
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

### ~~EXT-004 — Tab deduplication~~ ✅ DONE
`DeduplicateConfirmModal` + `useDeduplicateGroup` hook implemented. Deduplicate button in group context menu.

### ~~EXT-005 — Import / Export~~ ✅ DONE
`ImportExportModal` implemented — JSON export (downloads file) and import (file picker, validates schema). Accessible from Settings.

### EXT-005b — Import formats (remaining scope)
**Agent:** `extension-dev`  
Still pending from original EXT-005 spec:
- Chrome bookmarks import: parse Bookmarks HTML export, convert folders → groups
- OneTab import: parse plain-text OneTab export format
- Chrome bookmarks import: parse Bookmarks HTML export, convert folders → groups
- OneTab import: parse the plain-text OneTab export format

### ~~EXT-006 — Context menu "Open all in new window"~~ ✅ DONE
Added to `GroupContextMenu.tsx` — disabled for Now Open group and when no valid HTTP URLs exist.

### EXT-007 — Tab aging / stale indicators
**Agent:** `extension-dev` + `design-system`  
**Spec:** Tabs saved > 30 days ago show a subtle "stale" indicator (amber dot on favicon).

- Configurable threshold in settings (7 / 14 / 30 / 60 days)  
- "Remove stale tabs" bulk action in group header

### EXT-009 — Auto-assign URL rules
**Agent:** `extension-dev`  
**Spec:** Users define domain/path patterns that automatically place matching tabs into a target group when a tab is saved to TabMerger.

#### Data model
Add `rules: UrlRule[]` to `GroupsState` in `packages/shared/src/types/index.ts`:
```ts
interface UrlRule {
  id: string;          // nanoid
  pattern: string;     // glob-style, e.g. "github.com/*"
  groupId: string;     // target group id
  createdAt: string;   // ISO
}
```
Rules are stored in IndexedDB alongside groups (same `localDb.ts` store) and synced to Supabase for pro users via the existing `updatedAt` sync model.

#### Rule matching
- Patterns are glob-style (`*` matches any segment, no regex). Use a simple `minimatch`-style check — if `minimatch` is not already installed, implement a one-liner: strip protocol, match hostname + path with `*` as a wildcard.
- Matching runs in `useGroups` at the point a tab is saved (the `addTab` / `saveCurrentTab` mutation), before the tab is inserted.
- If the caller already specifies a target `groupId` explicitly, rules are skipped — explicit always wins.
- **Conflict resolution:** when multiple rules match, use the first rule in insertion order (deterministic, user-controlled). Show a tooltip in the UI listing all matching rules.

#### UI — Rules manager
- Accessible from the group context menu: "Manage URL rules" → opens a small modal (`UrlRulesModal`).
- Modal lists all rules (pattern → group name), with delete and reorder (drag handle).
- "Add rule" row: text input for pattern + group picker dropdown (all non-Now-Open groups). Validate pattern is non-empty before saving.
- Free tier: max 3 rules. Pro: unlimited. Show upgrade CTA at limit.

#### Acceptance criteria
- [ ] Saving a tab whose URL matches a rule places it in the rule's group, not the selected group
- [ ] Explicit group selection always overrides rules
- [ ] First matching rule wins when multiple rules match
- [ ] Rules persist across extension restarts (IndexedDB) and sync to Supabase for pro users
- [ ] Free-tier cap of 3 rules enforced in UI
- [ ] Rules manager modal opens from group context menu

### EXT-010 — Archive groups
**Agent:** `extension-dev`  
**Spec:** Groups can be archived — hidden from the main sidebar but preserved in storage with all their tabs intact.

#### Data model
Add `archived: boolean` (default `false`) to the `Group` type in `packages/shared/src/types/index.ts`. No new store needed; existing IndexedDB + Supabase sync handles it automatically via `updatedAt`.

#### Archive action
- Available in `GroupContextMenu` as "Archive group" (below "Rename", above "Delete").
- Disabled for the "Now Open" group (`permanent: true`).
- Archives the group immediately (no confirm dialog — it's reversible).
- Triggers an undo-stack snapshot so `Ctrl+Z` restores it to the sidebar.

#### Archived groups view
- A collapsible "Archived" section at the bottom of the sidebar, below all active groups.
- Collapsed by default; expand to see archived groups (same `GroupItem` rendering, muted opacity).
- Archived group items show a "Restore" button in place of the drag handle, and retain the context menu (minus "Archive", plus "Restore" and "Delete permanently").

#### Free-tier counting
- Archived groups **do** count toward the free-tier 5-group limit. Archiving hides groups from the active workspace but does not free up slots — otherwise users could bypass the limit by archiving and creating new groups indefinitely.
- The value proposition of archiving vs. deleting is **data preservation**, not limit evasion. Pro users get unlimited groups and can archive freely.

#### Sync behavior
- `archived: true` syncs to Supabase as a normal field update. Pro users see archived groups on all devices.

#### Acceptance criteria
- [ ] Archiving a group removes it from the main sidebar immediately
- [ ] Archived section is visible and expandable at the bottom of the sidebar
- [ ] Restoring a group moves it back to the active sidebar (appended at the end, before archived section)
- [ ] Archived groups are excluded from the free-tier group count
- [ ] "Now Open" group cannot be archived
- [ ] Archive/restore is undoable via `Ctrl+Z`
- [ ] Archived state syncs to Supabase for pro users

### EXT-011 — Tab reminders
**Agent:** `extension-dev`  
**Spec:** Users can set a one-time reminder on any saved tab. At the scheduled time the background script fires a Chrome notification; clicking it opens the tab's URL.

#### Setting a reminder
- Accessible via the tab chip right-click context menu: "Remind me…" → opens a small inline picker (no modal needed).
- Picker offers preset offsets: "In 1 hour", "In 2 hours", "Tomorrow morning (9 AM)", "Custom…".
- "Custom" shows a `<input type="datetime-local">` — native, no date-picker library.
- Confirmation stores the reminder and dismisses the picker.

#### Storage
Add `reminder?: { fireAt: string; tabId: string; groupId: string }` to the `Tab` type. Stored in IndexedDB on the tab object. Also write to `chrome.storage.local` under key `reminders` (array) so the background script can read it without going through the popup's IndexedDB connection.

```ts
interface TabReminder {
  tabId: string;       // Tab.id (our internal id)
  groupId: string;
  fireAt: string;      // ISO timestamp
  url: string;
  title: string;
}
```

#### Background script (chrome.alarms)
- When a reminder is saved, `background.ts` calls `chrome.alarms.create(tabId, { when: Date.parse(fireAt) })`.
- `chrome.alarms.onAlarm` listener: look up the reminder from `chrome.storage.local`, create a `chrome.notifications.create` notification:
  - Title: "TabMerger Reminder"
  - Message: tab title (truncated to 80 chars)
  - Icon: extension icon
  - `requireInteraction: true` so it stays until dismissed
- `chrome.notifications.onClicked`: open the tab URL in a new tab, then clear the notification and remove the reminder from `chrome.storage.local` and IndexedDB.
- Clear the alarm on popup-side dismiss (user deletes the reminder manually).

#### UI affordance
- Tabs with a pending reminder show a small clock icon (Lucide `Clock`) on the chip, with a tooltip showing the scheduled time.
- Clicking the clock icon opens the same picker pre-populated, allowing reschedule or cancel.

#### Acceptance criteria
- [ ] Right-click a tab chip → "Remind me…" → picker appears
- [ ] Preset and custom times both work; reminder is stored in IndexedDB + `chrome.storage.local`
- [ ] Chrome notification fires at the scheduled time (within alarm granularity — Chrome enforces 1-minute minimum)
- [ ] Clicking the notification opens the tab URL and clears the reminder
- [ ] Dismissing the notification without clicking leaves the reminder cleared (no repeat)
- [ ] Clock icon appears on chips with a pending reminder; tooltip shows scheduled time
- [ ] Reminder survives extension reload (alarm re-registered from `chrome.storage.local` on background startup)

---

## Web App Features

### ~~WEB-001 — Dashboard: group grid view~~ ✅ DONE
`GroupGrid` component implemented with list/grid toggle, color swatches, tab counts, last-updated timestamps. Inline accordion for tab list.

### ~~WEB-005b — Privacy Policy & Terms of Service pages~~ ✅ DONE
**Agent:** `web-dev`  
**Spec:** Static legal pages required by Chrome Web Store submission and Stripe live-mode activation.

- `app/(marketing)/privacy/page.tsx` — Privacy Policy
- `app/(marketing)/terms/page.tsx` — Terms of Service
- Content covers: data collected (tab URLs/titles, email), Supabase storage, Stripe billing, no sale of data, user deletion rights (GDPR/CCPA)
- Linked in site footer, extension popup settings, and Stripe checkout
- Chrome Web Store requires a publicly accessible Privacy Policy URL before the extension can be published
- Stripe requires ToS and Privacy Policy linked in the checkout flow before going live

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

### ~~WEB-005a — Landing page interactive demo sync~~ ✅ DONE
Badge format, color accent bar, circular favicons, grip handle, destructive delete styling, window border all updated to match real extension UI.

~~**Agent:** `web-dev`  
**Spec:** `DemoSection.tsx` is a hand-coded mockup that has drifted from the real extension UI.

- Audit against current extension: group color dots, window starred border (should match group color), tab truncation with ellipsis, "Now Open" group, tab preview placeholder
- Update the static mockup to match current styling and component structure
- Long-term: DEV-002 (automated screenshots) will replace it with real recorded frames

---

## AI Features

### AI-001 — Smart cleanup suggestions
**Agent:** `ai-features`  
**Spec:** Weekly digest email (or in-extension notification) with suggestions:

- "You have 12 tabs older than 30 days — remove or archive?"
- "These 5 tabs seem related — merge into a new group?"
- Powered by the existing `/api/ai/organize` route + a scheduled Supabase edge function

**Shipped (pragmatic v1):** In-extension `CleanupSuggestionBanner` (below UpgradeCTA in popup) driven by
client-side heuristic `useCleanupSuggestions` — shows when ≥ 5 saved tabs are older than the configured
stale threshold (default 30 days). Review jumps to the first stale group; "Remove stale" reuses
`useRemoveStaleTabs` per group; Dismiss hides it for 7 days via localStorage. No AI call, no digest email —
the "merge related tabs" suggestion is deferred (needs AI).

### AI-002 — Tab search with natural language
**Agent:** `ai-features` + `extension-dev`  
**Spec:** Cmd+K style search that understands queries like "recipes I saved last week" or "anything about TypeScript".

- Builds an embedding index of tab titles + URLs (OpenAI `text-embedding-3-small`)
- Stored in Supabase `pgvector` column
- Query → embed → cosine similarity search → ranked results

### AI-004 — E2E encryption for synced data
**Agent:** `extension-dev` + `database`  
**Spec:** Client-side AES-256-GCM encryption of group data before it reaches Supabase.

- Key derived from user passphrase via PBKDF2 (salt stored in `chrome.storage.local`)
- Encrypt in `pushPendingChanges`, decrypt in `pullRemoteChanges` — ~200 lines wrapping the existing sync engine
- Opt-in toggle in extension Settings; disabling encryption decrypts and re-uploads in plaintext
- **Constraint:** mutually exclusive with AI features (`pro_ai` tier) — AI routes read from Supabase server-side and cannot process ciphertext. UI must warn clearly when enabling encryption that AI organize/group features will be disabled.
- Decision log: `chrome.storage.sync` was considered as a no-server alternative but ruled out — 100KB hard limit breaks silently for heavy users, and it's Chrome-only (no Firefox/Edge sync).

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

### DEV-005 — GA4 Analytics via Measurement Protocol
**Agent:** `extension-dev` + `web-dev`
**Spec:** Track key user actions in both the extension popup and the web app using Google Analytics 4 via the Measurement Protocol (server-side / background-script side — no gtag.js in the extension popup, which lacks a document).

#### Extension (Measurement Protocol)
- Fire events from `background.ts` using `fetch` to `https://www.google-analytics.com/mp/collect?measurement_id=...&api_secret=...`
- Events to track:
  - `group_created` — when user creates a new group
  - `tab_saved` — when user saves tabs to a group
  - `session_restored` — when user restores a session
  - `ai_feature_used` — when any AI action is triggered (property: `feature_name`)
  - `extension_opened` — on popup open (once per session, use `chrome.storage.session`)
- User ID: use the Supabase `user.id` (hashed with SHA-256 before sending — never send raw PII)
- Env vars: `VITE_GA4_MEASUREMENT_ID`, `VITE_GA4_API_SECRET` (both public, safe in extension)
- Edge cases: no-op silently if env vars missing; never block the main action on analytics failure; catch all fetch errors

#### Web app (gtag.js)
- Add GA4 via `@next/third-parties/google` (`GoogleAnalytics` component) in `app/layout.tsx`
- Track page views automatically (Next.js router integration)
- Track: checkout initiated, subscription upgraded, billing portal opened
- Env var: `NEXT_PUBLIC_GA4_MEASUREMENT_ID`

#### Privacy
- Respect `Do Not Track` header in the web app
- Document in Privacy Policy that GA4 is used (already has a placeholder)
- No cross-device tracking without auth; anonymous `client_id` via `crypto.randomUUID()` stored in `chrome.storage.local`

#### Acceptance criteria
- [ ] Extension fires `extension_opened` on popup open (deduplicated per session)
- [ ] `group_created` and `tab_saved` events appear in GA4 DebugView
- [ ] No raw user email or PII in any event parameters
- [ ] Web app page views tracked automatically
- [ ] All analytics calls are fire-and-forget — no `await`, no error propagation

### DEV-004 — Automated release notes
**Agent:** `devops`  
**Spec:** Generate a structured changelog from conventional commits on each release tag.

- `semantic-release` in CI — reads `feat:`/`fix:` commits since last tag
- Outputs `CHANGELOG.md` + creates GitHub Release with the same content
- Feeds into WEB-006 — MDX changelog file auto-generated and committed by CI
- Enforces conventional commit format via `commitlint` in the pre-commit hook

### ~~EXT-012 — Fix saved sessions end-to-end~~ ✅ DONE
Web dashboard `SessionList` was gating all sessions behind Pro — removed gate; free users now see their sessions (up to 3). Extension already synced correctly via Supabase upsert.

### EXT-012 — Fix saved sessions end-to-end (archived spec)
**Agent:** `extension-dev` + `database`  
**Status:** Bug — sessions saved in extension do not appear in the web dashboard.

- Sessions are written to IndexedDB but the Supabase upsert in `useSaveSession` may be failing silently or the web dashboard query is wrong
- Check: `useSessions.ts` Supabase upsert column names match the `sessions` table schema
- Check: web dashboard sessions query uses correct `user_id` filter
- Check: RLS policy on `sessions` table allows the authenticated user to read/write their own rows
- Acceptance: saving a session in the extension shows it in the web dashboard within 5s (no reload required)

### ~~EXT-013 — Fix chrome.alarms (missing manifest permission)~~ ✅ DONE
Added `"alarms"` and `"notifications"` to `wxt.config.ts` manifest permissions. Background script already used both correctly.

### EXT-013 — Fix chrome.alarms (archived spec)
**Agent:** `extension-dev`  
**Status:** Bug — tab reminders (EXT-011) use `chrome.alarms` but the permission may be missing from `wxt.config.ts`, causing alarms to silently fail.

- Check `wxt.config.ts` `manifest.permissions` array for `"alarms"` and `"notifications"`
- Both are required: `alarms` for scheduling, `notifications` for the Chrome notification on fire
- Also verify `background.ts` registers `chrome.alarms.onAlarm` listener correctly on startup
- Acceptance: setting a 1-minute reminder fires a Chrome notification at the scheduled time

### DEV-007 — Inline code comments audit (extension + web)
**Agent:** `extension-dev`, `web-dev`  
**Status:** Pending  
**Spec:** Add meaningful inline comments wherever logic is non-obvious — regex invariants, algorithmic decisions, framework gotchas, workarounds. Do not comment obvious code or repeat what the function name already says. Target: a new contributor can understand *why* without needing to ask.

- Extension: focus on `SearchOverlay.tsx` picker context regex, `useGroups` mutation ordering, `syncEngine` conflict resolution, `urlRuleEngine` match priority
- Web: focus on Stripe webhook raw-body requirement, Supabase RLS client selection, Next.js 15 async `cookies()` pattern, session restore flow
- Rule: if a comment would still be useful after renaming the variable/function to something more descriptive, keep it; otherwise delete it

---

### DEV-006 — Upgrade all dependencies to latest major versions
**Agent:** `devops`  
**Status:** ✅ Done  
**Spec:** Keep all packages at the latest stable major version. Run `pnpm outdated -r` to identify what's behind, then upgrade one package at a time verifying builds pass.

- Priority upgrades: Next.js (15.x → latest), React (18 → 19 if stable), WXT, Tailwind, TypeScript
- After each major upgrade: run `pnpm type-check && pnpm lint && pnpm build:extension && pnpm build:web`
- Document any breaking changes and migration steps taken
- Do not upgrade to RC/alpha/beta versions — latest stable only

**Tailwind CSS 3 → 4 migration (completed):**
- Extension: replaced PostCSS setup with `@tailwindcss/vite` plugin in `wxt.config.ts`; deleted `postcss.config.js` and `tailwind.config.ts`
- Web: replaced PostCSS `tailwindcss` plugin with `@tailwindcss/postcss`; deleted `tailwind.config.ts`
- Both: replaced `@tailwind base/components/utilities` directives with `@import "tailwindcss"` + `@theme inline` block for custom shadcn colors + `@custom-variant dark` for class-based dark mode
- Web: moved `tailwindcss-animate` plugin to CSS via `@plugin "tailwindcss-animate"` directive; keyframes moved into CSS
- Breaking class renames applied: `shadow-sm` → `shadow-xs`, bare `shadow` → `shadow-sm` across all components in both packages

---

## Priority Order (suggested)

| # | Item | Value | Effort | Status |
|---|------|-------|--------|--------|
| 1 | PAY-001 (subscription lifecycle) | Critical | L | ✅ done |
| 2 | WEB-005b (privacy policy + ToS) | Critical | S | ✅ done |
| 3 | WEB-005a (demo sync with real UI) | High | S | ✅ done |
| 4 | EXT-008 (context menu save) | High | S | ✅ done |
| 5 | DEV-003 (Sentry) | Medium | S | ✅ done |
| 6 | EXT-001 (tab notes) | Medium | S | ✅ done |
| 7 | WEB-005 (onboarding checklist) | Medium | S | ✅ done |
| 8 | WEB-006 (changelog page) | Low | S | ✅ done |
| 9 | PAY-002 (AI tier) | Medium | S | ✅ done |
| 10 | E2E-001 (extension Playwright) | High | M | ✅ done |
| 11 | EXT-003 (keyboard nav) | High | M | ✅ done |
| 12 | EXT-009 (auto-assign URL rules) | Medium | M | ✅ done |
| 13 | EXT-010 (archive groups) | Medium | S | ✅ done |
| 14 | AI-002 (semantic search) | Medium | L | — |
| 15 | EXT-002 (session restore) | Medium | M | ✅ done |
| 16 | EXT-007 (tab aging) | Medium | S | ✅ done |
| 17 | EXT-011 (tab reminders) | Medium | S | ✅ done |
| 18 | DEV-004 (release notes automation) | Low | S | ✅ done |
| 19 | DEV-001 (bundle budget) | Low | S | ✅ done |
| 20 | WEB-002 (social proof) | Low | S | ✅ done |
| 21 | AI-001 (smart cleanup) | Low | M | ✅ done |
| 22 | WEB-003 (referral) | Low | L | — |
| 23 | EXT-005b (bookmark/OneTab import) | Low | S | ✅ done |
| 24 | AI-004 (E2E encryption) | Low | S | — |
| 25 | DEV-005 (GA4 analytics via Measurement Protocol) | Medium | S | ✅ done |
| 26 | WEB-004 (public group sharing) | Medium | S | ✅ done |

**✅ Done:** PAY-001, PAY-002, WEB-005b, WEB-005a, WEB-005, WEB-006, EXT-001, EXT-004, EXT-005 (JSON), EXT-006, EXT-008, WEB-001, DEV-003

S = small (1-2 days), M = medium (3-5 days), L = large (1-2 weeks)
