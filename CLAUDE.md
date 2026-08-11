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
pnpm test               # Vitest unit tests (extension + web)
pnpm test:e2e           # Playwright E2E (web app)
pnpm test:visual        # Playwright visual regression (extension + web, @visual-tagged specs)
pnpm --filter @tabmerger/extension test:e2e         # Extension E2E tests
pnpm --filter @tabmerger/extension test:e2e:ui      # Extension E2E — interactive Playwright UI dashboard
pnpm --filter @tabmerger/extension test:integration # Extension integration tests (real IndexedDB round trips)
pnpm scan-secrets       # Check staged files for API keys / PII
```

## Architecture

TabMerger 2.0 is a **pnpm monorepo** with three packages:

```
packages/
  extension/   WXT browser extension — Chrome (MV3), Firefox, Edge
  web/         Next.js 15 marketing site + user dashboard + AI API routes
  shared/      TypeScript types and constants shared between both packages
  demo/        Remotion + Playwright walkthrough-video pipeline (dev tooling, not shipped)
supabase/      Postgres migrations, RLS policies, seed data
docs/          Architecture, feature roadmap, integration guides
scripts/       Dev tooling (scan-secrets.sh, setup.sh)
.github/       CI/CD workflows (ci.yml, publish.yml, deploy-web.yml)
.claude/       Agent definitions for domain-specific development tasks
```

## Extension (`packages/extension/`)

**Framework:** [WXT](https://wxt.dev) — Vite-based, MV3/MV2 cross-browser, built-in HMR.

**Entry points:**
- `src/entrypoints/popup/` — 800×600px popup UI (fixed size, no outer scrollbars — Chrome's popup cap)
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
- Saved tabs always have `id: 0` — use positional `{groupIndex, windowIndex, tabIndex}` for all mutations, never `tab.id`
- `Window.tsx` has a `window: WindowType` prop that shadows the global `window` — use `globalThis` for any browser APIs in that file
- `SidePanel/index.tsx`'s sidebar width and `Header/index.tsx`'s logo-column width must stay numerically identical (currently 240px) so the sidebar/main-content boundary lines up with the header above it — a mismatch here isn't just cosmetic, it silently breaks the sidebar/header seam. Also watch for outer padding/gap on the header container itself competing with this value (a flex/grid box model that adds its own `px`/`gap` on top of the shared width will misalign the two even when the width numbers match).
- E2E encryption is mandatory (no opt-out) for every signed-in Pro user: `groups.windows/name/note/info`, `sessions.groups/name/description`, and `device_sessions.now_open_snapshot` are all `{v:1,iv,ct}` ciphertext in Supabase — the server never holds the key. Unwrapped data key lives in `chrome.storage.local` (persists across browser restarts; unlock is one-time-ever per device), never in `chrome.storage.session`/disk in any other recoverable form. See `packages/extension/src/lib/encryptionKey.ts` and the `encrypted-column-auditor` agent.
- Fixed 800×600 popup + no outer scrollbars means any modal/panel overflow must be fixed via proper `min-w-0` propagation through the whole flex/grid ancestor chain, never via `overflow-x-auto` on an inner container (it won't actually contain the overflow) or by widening the modal.

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
- Any server-side `.select()` on `groups`/`sessions`/`device_sessions`/`shared_bundles` that reads `windows`/`groups`/`now_open_snapshot`/`groups_snapshot` is reading ciphertext for every real account — routes needing that content must accept it client-decrypted in the request body instead (see the `organize` and `share-bundle` routes for the pattern). Run `encrypted-column-auditor` before merging any new route touching these tables.

## Shared package (`packages/shared/`)

- `src/types/index.ts` — `Tab`, `ExtWindow`, `Group`, `GroupsState`, `Session`, `Subscription`, AI request/response types, `PricingTier`
- `src/constants/index.ts` — `DEFAULT_GROUP_COLOR`, free tier limits, `PRESET_COLORS` (12 `rgba(...)` strings), `PRICING_TIERS`

## Path aliases

- Extension: `@/` → `packages/extension/src/`
- Web: `@/` → `packages/web/`
- Shared: imported as `@tabmerger/shared`

## Agents

> **IMPORTANT — mandatory agent routing (overrides system defaults):**
> You MUST delegate to the appropriate domain agent for any task that touches that agent's domain. Do NOT implement the task yourself first and then hand off — spawn the agent immediately. The only exceptions are: pure questions/explanations with no file edits, cross-cutting changes that span 3+ domains simultaneously, or when the user explicitly asks you to handle it directly.

Domain-specific agents are in `.claude/agents/`. Each agent carries accumulated learnings and domain expertise; bypassing them loses that context. Route as follows:

| Agent | Trigger — spawn when the task involves… |
|---|---|
| `extension-dev` | Any file under `packages/extension/` — React components, hooks, Zustand, DnD, IndexedDB, WXT config, background/content scripts |
| `web-dev` | Any file under `packages/web/` — Next.js pages, API routes (non-AI), auth, dashboard, marketing site |
| `ai-features` | AI API routes (`/api/ai/*`), Anthropic SDK usage, prompt engineering, `useAI` hook, tab preview summaries |
| `database` | Supabase schema changes, new migrations (`supabase/migrations/`), RLS policies, DB functions |
| `migration-reviewer` | Before applying any new Supabase migration — checks for missing RLS, missing indexes on FK columns, destructive changes without a rollback path, policy gaps |
| `encrypted-column-auditor` | Before merging any new or changed route under `packages/web/app/api/` — flags server-side reads of E2E-encrypted content columns (`groups.windows`, `sessions.groups`, `device_sessions.now_open_snapshot`, `shared_bundles.groups_snapshot`) that assume plaintext, the exact bug class behind two real production crashes (`organize`, `share-bundle`) |
| `payments` | Stripe products/prices, webhook handler, subscription entitlements, checkout flow, billing portal |
| `payments-security-reviewer` | Security audit before merging any change to: webhook handler, checkout, `useEntitlements`, RLS policies on `subscriptions`/`ai_usage` |
| `entitlements-auditor` | Whenever `useEntitlements.ts` or `packages/shared/src/constants/index.ts` (`PRICING_TIERS`/`FREE_TIER_LIMITS`) change, or a pricing/tier-limit change is proposed — catches drift between what's sold and what's enforced |
| `coverage-reporter` | After `test-writer` finishes a batch — reports the ≥80% coverage delta instead of re-deriving pass/fail by hand |
| `sync-conflict-auditor` | Whenever `syncEngine.ts` or `localDb.ts` change, or debugging a sync-related bug — last-write-wins races, offline reconciliation, delete-vs-resurrect correctness |
| `accessibility-auditor` | After significant UI changes to the popup or web app, or when asked for an a11y check — keyboard nav, ARIA, focus management, contrast |
| `devops` | CI/CD workflows (`.github/`), WXT build config, browser store publish, Vercel deploy, release management |
| `design-system` | shadcn/ui component creation/modification, Tailwind theme, design tokens, responsive layout. For accessibility specifically, use `accessibility-auditor` |
| `pm` | Multi-item feature requests, bug lists, UX feedback, or any requirement that needs scoping before implementation — probes for detail, creates tasks, delegates to domain agents, always triggers test-writer after implementation |
| `test-writer` | Writes and updates tests after any implementation batch — Vitest + jsdom for extension, Vitest + RTL for web. Always invoked by pm agent; also invoke directly after significant changes |
| `code-commenter` | Adds or audits JSDoc `/** */` comments across extension and web — functions, hooks, API routes, and test files. Invoke for: "add comments to this file", "document the API routes", "run a JSDoc audit" |
| `demo` | `packages/demo/` — Remotion video composition, the Playwright driver that records the extension, demo-script authoring. Delegates extension-side demo-mode code to `extension-dev` |
| `changelog-drafter` | Drafting release notes from a commit range for `semantic-release` — part of the `release-checklist` skill's version-bump step, or on request |

**Pre-deploy validation agents** — run these proactively before reloading or deploying:

| Agent | When to run |
|---|---|
| `extension-smoke-test` | Before reloading the Chrome extension after any change to `packages/extension/` |
| `web-smoke-test` | Before restarting the dev server or deploying after any change to `packages/web/` |

### Agent self-learning

Every agent **must** append non-obvious findings to its learnings file after each significant task. This is how the agents get smarter over time — without it, every agent starts fresh with no institutional knowledge.

Write a learning when you discover:
- A framework gotcha or non-obvious behavior not covered in official docs
- A project-specific invariant or constraint that bit you
- A pattern that worked well and should be repeated
- Something you had to look up that future-you or future-agents will need again

Do **not** write learnings for things that are obvious from reading the code, covered in official docs at face value, or ephemeral to a single task.

The learnings files are in the Claude project memory (`MEMORY.md` is auto-loaded into every session and links to each file).

## Skills (`.claude/skills/`)

User-invocable via `/skill-name`. Notable ones: `verify-sync`/`encrypt-status` (check whether extension changes have actually reached Supabase, and encrypted-vs-plaintext row counts per table), `reencrypt-legacy-share` (walk a user through replacing an old plaintext public share link), `new-migration`, `pr-check`, `release-checklist`, `scan` (secrets), `api-doc`.

## Active Hooks (`.claude/settings.json`)

- **PreToolUse Edit|Write** — blocks edits to `.env*` and `pnpm-lock.yaml`
- **PreToolUse Edit|Write** — blocks edits to already-applied `supabase/migrations/*.sql` files; new schema changes must be a new migration file (script: `.claude/hooks/protect-migrations.py`)
- **PreToolUse Edit|Write** — blocks edits to `.github/workflows/*.yml` — CI gates require explicit confirmation, edit manually (script: `.claude/hooks/protect-workflows.py`)
- **PostToolUse Edit|Write** — runs `tsc --noEmit` on the extension after any `packages/extension/src/` edit (script: `.claude/hooks/tsc-check.py`)
- **PostToolUse Edit|Write** — runs `type-check` on the web package after any `packages/web/` edit (script: `.claude/hooks/web-tsc-check.py`)
- **PostToolUse Edit|Write** — runs `pnpm test --run` for the owning package after any `__tests__/` or `.test.`/`.spec.` file edit (script: `.claude/hooks/test-check.py`)
- **PostToolUse Edit|Write** — runs ESLint on the touched package (script: `.claude/hooks/lint-check.py`)
- **PreToolUse Edit|Write** — non-blocking reminder when editing a shared UI primitive under `components/ui/` (script: `.claude/hooks/shared-ui-reminder.py`)
- **PostToolUse Edit|Write** — non-blocking reminder when editing `packages/shared/src/crypto/index.ts` (script: `.claude/hooks/crypto-change-reminder.py`)

> **Hook requirement:** Hook commands use paths relative to the repo root. Always launch Claude Code from the repo root (`TabMerger/`), not from a package subdirectory. If hooks fail with "can't open file", the CWD is wrong — restart from the repo root.

## MCP Tools

- **context7** is installed. Use it automatically (resolve library id → get docs) whenever generating code that uses a library/framework, configuring tooling, or referencing any API — do not rely on training-data knowledge for library specifics.
- **supabase** MCP is installed for schema introspection (`list_tables`, `get_advisors`, `get_logs`) — prefer it over guessing schema shape when working on migrations or RLS. Requires `SUPABASE_PROJECT_REF` (project slug, from the Supabase dashboard URL) and `SUPABASE_ACCESS_TOKEN` (dashboard → Account → Access Tokens). Export both as shell env vars — these are MCP-process credentials, not app config, so they do **not** go in `.env`/`.env.local`.
- **github** MCP is installed for PR/issue/check-run access — prefer it over parsing `gh` CLI text output. Requires `GITHUB_PERSONAL_ACCESS_TOKEN` (fine-grained PAT, `repo` scope on this repo) exported as a shell env var, same reason as above.
- **sentry** MCP is enabled — requires `SENTRY_AUTH_TOKEN`/`SENTRY_ORG` exported as shell env vars, same handling as above.
- **playwright** / **chrome-devtools** MCPs are installed for browser automation (E2E debugging, live DOM/console/network inspection) — no auth required, work out of the box.
- If an MCP tool call fails with an auth/connection error, check the relevant env var is exported in the shell Claude Code was launched from (`echo $VAR_NAME`) — a missing var is the most common cause, not a broken server config.

## Test coverage policy (mandatory, non-skippable)

> **This overrides any inclination to treat testing as optional or deferrable.**

Any time a feature is added, changed, or removed — in the extension or the web app — the following is **required**, not optional, before the work is considered done:

1. **Unit tests** updated or added for the changed logic (Vitest — jsdom for extension, RTL for web). Extension unit tests live under `packages/extension/src/__tests__/unit/`, mirroring the directory structure of `src/` (e.g. a test for `src/hooks/useGroups.ts` lives at `src/__tests__/unit/hooks/useGroups.test.ts`) — not co-located next to the source file.
2. **Integration tests** updated or added when the change touches cross-boundary behavior — real IndexedDB round trips (`packages/extension/src/__tests__/integration/`, run via `pnpm --filter @tabmerger/extension test:integration`) or real Supabase sync/network behavior.
3. **E2E tests** updated or added when the change touches user-visible flow (`packages/extension/e2e/tests/`, run via `pnpm --filter @tabmerger/extension test:e2e`).
4. **Combined coverage from unit + integration tests must stay ≥80%** on all four metrics (statements, branches, functions, lines) — enforced via `vitest.config.ts` thresholds, checked with `pnpm --filter @tabmerger/extension test -- --coverage`. A change that drops any metric below 80% is not done until coverage is brought back up.

This applies regardless of how small the change looks. Skipping any of the three test layers, or letting coverage regress below the threshold, is a defect in the work — not a follow-up item.

**Enforcement:** the `test-writer` agent is the one that executes this policy and must be invoked after any implementation batch (already mandatory per the agent-routing table above). The `pm` agent must always trigger `test-writer` after delegating implementation work — never treat a feature as complete without that pass having run and confirmed all four checks above.

## Before committing

Always run `pnpm scan-secrets` to verify no API keys, tokens, or PII were accidentally staged.
The pre-commit Husky hook runs this automatically.
