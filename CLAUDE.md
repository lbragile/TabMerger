# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Commands

```bash
# Development (with hot reload)
pnpm dev                    # Extension + web in parallel
pnpm dev:extension          # Chrome extension only (WXT HMR)
pnpm dev:extension:firefox  # Firefox extension
pnpm dev:web                # Next.js web app at localhost:3000

# Production builds
pnpm build:extension        # Chrome/Firefox/Edge zips → packages/extension/.output/
pnpm build:web              # Next.js build → packages/web/.next/
pnpm zip                    # Build all browser store zips

# Quality checks
pnpm lint                   # ESLint across extension + web
pnpm type-check             # TypeScript check across all packages
pnpm scan-secrets           # Check staged files for API keys / PII
```

## Architecture

TabMerger 2.0 is a **pnpm monorepo** with three packages:

```
packages/
  extension/   WXT browser extension — Chrome (MV3), Firefox, Edge
  web/         Next.js 15 marketing site + user dashboard + AI API routes
  shared/      TypeScript types and constants shared between both packages
supabase/      Postgres migrations, RLS policies, seed data
docs/          Architecture, feature roadmap, integration guides
scripts/       Dev tooling (scan-secrets.sh, setup.sh)
.github/       CI/CD workflows (ci.yml, publish.yml, deploy-web.yml)
.claude/       Agent definitions for domain-specific development tasks
```

## Extension (`packages/extension/`)

**Framework:** [WXT](https://wxt.dev) — Vite-based, MV3/MV2 cross-browser, built-in HMR.

**Entry points:**
- `src/entrypoints/popup/` — 780×600px popup UI (fixed size, no outer scrollbars)
- `src/entrypoints/background.ts` — alarms, context menus, tab badge, periodic sync
- `src/entrypoints/content.ts` — tab metadata collection for preview feature

**State layers:**
- **IndexedDB** (`src/lib/localDb.ts` via `idb`) — primary data store, offline-first
- **TanStack Query v5** — wraps all IndexedDB reads; `staleTime: Infinity` (data is local)
- **Zustand** (`src/stores/uiStore.ts`) — ephemeral UI: modal state, activeGroupIndex, searchFilter, renameTarget, undo/redo stack (10 snapshots)
- **Supabase** (`src/lib/syncEngine.ts`) — cloud sync layer; last-write-wins on `updatedAt`

**Key hooks:**
- `useGroups` — all group/tab CRUD mutations
- `useCurrentTabs` — syncs "Now Open" group (index 0, permanent) with live browser tabs
- `useDnd` — @dnd-kit handlers for sidebar + windows panel
- `useAI` — TanStack mutations posting to `VITE_WEB_APP_URL/api/ai/*` with Supabase JWT
- `useEntitlements` — reads `subscriptions` table; free: ≤5 groups, ≤50 tabs; pro: unlimited + sync; pro_ai: + AI

**Invariants:**
- "Now Open" group is always index 0, `permanent: true`, never deleted, never pushed to undo stack
- AI calls are server-side only — extension POSTs to Next.js API routes with Bearer token
- Env vars use WXT Vite convention: `import.meta.env.VITE_*`

## Web app (`packages/web/`)

**Framework:** Next.js 15 App Router + TypeScript.

**Route groups:**
- `app/(marketing)/` — landing, features, pricing (public)
- `app/(app)/` — dashboard, account (auth-required; protected by middleware)
- `app/api/` — webhooks/stripe, auth/callback, checkout, ai/* routes

**Critical patterns:**
- `cookies()` and `headers()` are async in Next.js 15 — always `await` them
- Supabase server client (`lib/supabase/server.ts`) must be async for the same reason
- Stripe webhook handler **must** use `req.text()` — `req.json()` destroys the raw body needed for signature verification
- Service role client bypasses RLS — only use in webhook handlers and AI routes, never client-side

## Shared package (`packages/shared/`)

- `src/types/index.ts` — `Tab`, `ExtWindow`, `Group`, `GroupsState`, `Session`, `Subscription`, AI request/response types, `PricingTier`
- `src/constants/index.ts` — `DEFAULT_GROUP_COLOR`, free tier limits, `PRESET_COLORS` (12 `rgba(...)` strings), `PRICING_TIERS`

## Path aliases

- Extension: `@/` → `packages/extension/src/`
- Web: `@/` → `packages/web/`
- Shared: imported as `@tabmerger/shared`

## Agents

Domain-specific agents are in `.claude/agents/`. Each agent has `memory: true` so it can read and write to the Claude project memory system. Invoke them for focused tasks:

| Agent | Domain | Learnings file |
|---|---|---|
| `extension-dev` | WXT popup, hooks, DnD, IndexedDB, Supabase sync | `agents/extension-dev-learnings.md` |
| `web-dev` | Next.js pages, API routes, auth, dashboard | `agents/web-dev-learnings.md` |
| `ai-features` | Claude API routes, prompt engineering, AI hooks | `agents/ai-features-learnings.md` |
| `database` | Supabase schema, migrations, RLS | `agents/database-learnings.md` |
| `payments` | Stripe billing, webhooks, entitlements | `agents/payments-learnings.md` |
| `devops` | CI/CD, store publishing, release pipeline | `agents/devops-learnings.md` |
| `design-system` | shadcn/ui, Tailwind, component patterns | `agents/design-system-learnings.md` |

### Agent self-learning

Every agent **must** append non-obvious findings to its learnings file after each significant task. This is how the agents get smarter over time — without it, every agent starts fresh with no institutional knowledge.

Write a learning when you discover:
- A framework gotcha or non-obvious behavior not covered in official docs
- A project-specific invariant or constraint that bit you
- A pattern that worked well and should be repeated
- Something you had to look up that future-you or future-agents will need again

Do **not** write learnings for things that are obvious from reading the code, covered in official docs at face value, or ephemeral to a single task.

The learnings files are in the Claude project memory (`MEMORY.md` is auto-loaded into every session and links to each file).

## Before committing

Always run `pnpm scan-secrets` to verify no API keys, tokens, or PII were accidentally staged.
The pre-commit Husky hook runs this automatically.
