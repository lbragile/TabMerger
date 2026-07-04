# Architecture

## Overview

TabMerger 2.0 is a **pnpm monorepo** with three packages:

```
tabmerger/
  packages/
    extension/   # WXT browser extension (Chrome MV3, Firefox, Edge)
    web/         # Next.js 15 marketing site + API backend
    shared/      # Shared TypeScript types and constants
  supabase/      # Postgres schema, migrations, RLS
  .github/       # CI + store publish + Vercel deploy workflows
  .claude/agents/ # Specialized Claude Code agents per domain
  docs/          # This directory
```

---

## Extension (packages/extension)

**Framework:** WXT — handles MV3/MV2 differences, HMR, TypeScript, cross-browser zip packaging.

**Entry points** (`src/entrypoints/`):
- `popup/` — the main 780×600px UI (React 18)
- `background.ts` — service worker: alarm-based sync, context menus, tab count badge
- `content.ts` — injected into pages for tab metadata (tab preview feature)

**State architecture — two layers:**

| Layer | Tool | What it stores |
|---|---|---|
| Server/async state | TanStack Query v5 | Groups, sessions, subscription tier (all backed by IndexedDB) |
| Ephemeral UI state | Zustand | Modal visibility, activeGroupIndex, searchFilter, renameTarget, undo stack |

**Data flow:**
```
Browser tabs (chrome.tabs.* events)
    ↓  useCurrentTabs
IndexedDB (idb) ← primary store, all reads/writes go here first
    ↓  TanStack Query (staleTime: Infinity)
React UI
    ↓  syncEngine (when online + authenticated)
Supabase Postgres ← cloud backup + cross-device sync
    ↓  Realtime subscription
Other devices
```

**Offline-first guarantee:** All features work without internet. Supabase sync is additive.

**Undo/redo:** Manual 10-snapshot stack in Zustand. Excluded: Now Open sync, timestamp updates, info field edits.

---

## Web App (packages/web)

**Framework:** Next.js 15 App Router — Server Components by default.

**Route groups:**
- `(marketing)/` — public pages, no auth required
- `(app)/` — protected by middleware, requires Supabase session
- `api/` — API routes (Stripe webhooks, Supabase auth callback, AI endpoints)

**Data flow (web):**
```
User action on pricing page
    → POST /api/checkout (server action)
    → Stripe Checkout (hosted)
    → Stripe webhook → POST /api/webhooks/stripe
    → Supabase subscriptions table updated
    → Extension reads subscriptions via useEntitlements
    → Features unlocked
```

**AI request flow:**
```
Extension (user hovers tab)
    → useTabPreview (400ms debounce)
    → POST {WEB_APP_URL}/api/ai/tab-summary
        (with Supabase JWT in Authorization header)
    → JWT validated (service role)
    → Subscription tier checked (must be pro_ai + active)
    → Claude API (claude-haiku-4-5-20251001)
    → Response back to extension popup
    → Tooltip displays summary
```

---

## Shared Package (packages/shared)

Single source of truth for:
- TypeScript interfaces (`Tab`, `ExtWindow`, `Group`, `Session`, `Subscription`, `PricingTier`, AI request/response types)
- Constants (`DEFAULT_GROUP_COLOR`, `FIRST_GROUP_TITLE`, `PRESET_COLORS`, `FREE_TIER_LIMITS`, `PRICING_TIERS`)

Both `packages/extension` and `packages/web` import from `@tabmerger/shared`.

---

## Database (Supabase)

**Tables:** `profiles`, `subscriptions`, `groups`, `sessions`

**Key invariants:**
- `handle_new_user` trigger auto-creates `profiles` + free `subscriptions` row on auth signup
- All tables have RLS; every policy uses `auth.uid() = user_id`
- Service role key (server-only) bypasses RLS — used only in webhook handler and AI route auth checks
- Sync conflict resolution: last-write-wins by `updated_at` timestamp

---

## Publishing Pipeline

On `git tag v*.*.*`:
1. Build Chrome/Firefox/Edge zips via WXT
2. Publish to Chrome Web Store → Firefox AMO → Edge Add-ons
3. Create GitHub Release with auto-generated notes
4. Vercel deploys `packages/web` on every master merge

See `docs/PUBLISHING.md` for credentials setup.

---

## Entitlement System

Tiers are checked in two places:
1. **Extension** (`useEntitlements.ts`): reads `subscriptions` table, falls back to `free` if offline/unauthenticated
2. **Web API routes** (`/api/ai/*`): validates JWT + tier before every Claude API call

Free tier limits are enforced in `useGroups.ts` (group count) and `useCurrentTabs.ts` (tab count).
