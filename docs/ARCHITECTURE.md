# Architecture

TabMerger is a **pnpm monorepo**:

```text
packages/
  extension/   WXT browser extension (MV3) — Chrome, Firefox, Edge
  web/         Next.js marketing site, dashboard/account, API routes
  shared/      Types, constants, E2E crypto primitives, feature-flag helper
  demo/        Remotion + Playwright walkthrough-video pipeline (dev tooling, not shipped)
supabase/      Postgres migrations, RLS, seed data, local stack config
docs/          This directory
.github/       CI, store publish, Vercel preview deploy
.claude/       Agent definitions, skills, specs (.claude/plans/)
```

Related docs: [DATABASE.md](DATABASE.md) (workflow) · [database-schema.md](database-schema.md) (per-table reference) · [PUBLISHING.md](PUBLISHING.md) · [RELEASE_SANITY_CHECK.md](RELEASE_SANITY_CHECK.md) · [AI_FEATURES.md](AI_FEATURES.md) · [PAYMENTS.md](PAYMENTS.md).

---

## Extension (`packages/extension`)

**Stack:** WXT (`manifestVersion: 3` for every target), React 19, Tailwind, shadcn/ui, @dnd-kit.

**Entry points** (`src/entrypoints/`):

- `popup/` — the whole UI, fixed **800×600** (`popup/index.html`), no outer scrollbars.
- `background.ts` — the service worker (see below).

There is no content script. Tab-preview metadata (OG image/description) comes from the web app's server-side `GET /api/og-preview`, which is why the manifest has **no `host_permissions`** of any kind. Permissions: `tabs`, `tabGroups`, `storage`, `contextMenus`, `alarms`, `notifications`, `identity` (see `wxt.config.ts`).

### State layers

| Layer | Where | Holds |
|---|---|---|
| IndexedDB (`idb`) | `src/lib/localDb.ts` | Primary store: groups, groups state/order, sessions, settings. Offline-first. |
| TanStack Query v5 | `src/lib/queryClient.ts`, hooks | Wraps IndexedDB reads (`staleTime: Infinity`); subscription tier (`useEntitlements`, 30 s poll). |
| Zustand | `src/stores/uiStore.ts` | Ephemeral UI: modals, active group, search, rename target, selection, undo/redo (10 snapshots). |
| Supabase | `src/lib/syncEngine.ts` | Cloud sync of groups (Pro). Last-write-wins on `updatedAt`. |

**Sync** (`src/hooks/useSync.ts` → `syncEngine.performSync`): push `pendingSync` groups, pull all remote groups, merge last-write-wins, re-apply local order. The popup runs it on mount, on the `online` event, every 30 s, and applies Supabase Realtime `groups` changes. The service worker runs the same `performSync` when the web dashboard sends `SYNC_NOW`. The permanent "Now Open" group is device-local and never pushed; each device instead upserts an encrypted Now Open snapshot to `device_sessions` for "Continue on other device" (`src/lib/deviceSessions.ts`). Known sync/IDB race bugs are open — see [TODO.md](../TODO.md).

**E2E encryption** is mandatory for signed-in Pro users. `src/lib/encryptionKey.ts` wraps a random AES-256-GCM data key with a PBKDF2 passphrase key and stores only the wrapped form in `encryption_keys`. The unwrapped data key is cached in `chrome.storage.local` per user, so unlocking is once per device. Primitives live in `packages/shared/src/crypto`. The encrypted columns are listed in [database-schema.md](database-schema.md#e2e-encrypted-columns).

### Background service worker (`src/entrypoints/background.ts`)

- **Context menu:** "Save to TabMerger" → scope (this tab / left / right / all other) → target group. `localDb` announces every groups write so the menu can be rebuilt. Writes made inside the service worker call the listener registered with `registerGroupsChangeListener`. Writes from the popup send a `TM_GROUPS_CHANGED` message with `chrome.runtime.sendMessage`. Rebuilds are debounced (150 ms), and a request that arrives during a rebuild queues one more.
- **Keyboard commands:** `save-current-tab`, `save-tabs-left`, `save-tabs-right`, `save-other-tabs`.
- **Badge:** live open-tab count.
- **URL rules:** on `tabs.onCreated`/`onUpdated`, a tab whose URL matches a rule is saved to that rule's group (`src/lib/urlRuleEngine.ts`).
- **Reminders:** `reminder-*` alarms → notifications. The service worker re-registers any lost alarms on startup.
- **Google sign-in:** `SIGN_IN_WITH_GOOGLE` runs `launchWebAuthFlow` here, not in the popup, because the popup closes as soon as the auth window takes focus.
- **Deferred tab close:** tabs dragged out of Now Open are closed when the popup's port disconnects.
- **Analytics:** install/update events go through the web app's `/api/track` (GA4 Measurement Protocol proxy).

### Web ↔ extension bridge

`externally_connectable.matches` is `${VITE_WEB_APP_URL}/*` for the build mode. `ids` holds the published store ID (`CHROME_EXTENSION_ID`, or `CHROME_EXTENSION_ID_BETA` in beta mode) plus the fixed dev ID. The web app calls `chrome.runtime.sendMessage(EXTENSION_ID, …)`. It gets `EXTENSION_ID` from `packages/web/lib/extensionId.ts`, which uses `NEXT_PUBLIC_CHROME_EXTENSION_ID` and falls back to the dev ID. The extension handles these messages in `onMessageExternal`:

| Message | Effect |
|---|---|
| `PING` | Replies `{type:'PONG', version}` — install probe (`useExtensionInstalled`). |
| `SYNC_AUTH` | `supabase.auth.setSession(access, refresh)` — hands the web session to the extension. Fire-and-forget. |
| `SYNC_NOW` | Runs `performSync`; replies `{ok:true}` or `{ok:false, reason}` with `reason` one of `no-session`, `locked`, `error`. |

These failures are currently silent. A diagnostics screen is proposed in [`.claude/plans/sync-diagnostics-spec.md`](../.claude/plans/sync-diagnostics-spec.md) but has not been built.

### Build modes

`wxt.config.ts` forces `NODE_ENV` from the mode (`scripts/buildEnv.ts`). `development` is a dev build. Every other mode is a production build, so beta and demo don't ship React's dev bundle. `import.meta.env.MODE` keeps the real mode name.

| Mode | Command (in `packages/extension`) | Manifest name | Env file | Web app / Supabase |
|---|---|---|---|---|
| `development` | `pnpm dev`, `pnpm build:dev` | TabMerger DEV | `.env.local` (gitignored) | `http://localhost:3000` / local stack `127.0.0.1:54321` |
| `beta` | `pnpm zip:beta` | TabMerger BETA | `.env.beta` (gitignored) | preview `https://tabmerger-preview.vercel.app` / project `xmofzeq…` |
| `demo` | `pnpm build:extension:demo` | TabMerger | `.env.demo` (committed; only `VITE_DEMO_BUILD=true`) | — (demo data, no backend) |
| `production` | `pnpm build`, `pnpm zip` | TabMerger | `.env.production` (gitignored) | `https://tabmerger.vercel.app` / project `jzgz…` |

In CI there are no env files. `.github/workflows/publish.yml` injects `VITE_SUPABASE_*` and the extension IDs from GitHub secrets. Note that the **store BETA** build from CI is not the same as a locally built beta. It sets `VITE_WEB_APP_URL=https://tabmerger.vercel.app` and uses the same Supabase secrets as stable, so it points at production, not preview.

---

## Web app (`packages/web`)

**Stack:** Next.js 16 App Router (`next@^16`), React 19, deployed on Vercel. `proxy.ts` is the request interceptor (Next 16's replacement for `middleware.ts`).

**Routes:**

- `app/(marketing)/` — landing, features, pricing, faq, changelog, contact, privacy, terms, and the public share page `share/[slug]`.
- `app/(app)/` — `dashboard`, `account`. `proxy.ts` redirects signed-out users to `/auth/sign-in`.
- `app/auth/` — sign-in/sign-up pages. `app/api/auth/{callback,sign-out}`.
- `app/api/`:

| Route | Purpose |
|---|---|
| `checkout`, `checkout/credits` | Stripe Checkout (subscription / AI credit pack). Redirect URLs come from `absoluteUrl()` (`lib/utils.ts`), which uses only `NEXT_PUBLIC_APP_URL`. |
| `billing-portal` (cookie auth), `portal` (Bearer, extension) | Stripe Billing Portal. |
| `webhooks/stripe` | Reads the raw body with `request.text()` for signature verification. Upserts `subscriptions` with `onConflict: 'user_id'` and records `ai_credit_purchases`. |
| `ai/{group-tabs,name-group,suggest-sessions,tab-summary,organize,organize/approve}` | AI features (Bearer JWT, `pro_ai` tier, weighted credits). `organize` runs a Vercel Workflow (`lib/workflows/tabOrganizer.ts`). `ai/dev-usage` is development-only. |
| `share-bundle` | Creates a `shared_bundles` row from **client-decrypted** groups. |
| `groups/[id]/publish` | Sets/clears `groups.public_slug` (see the open item in TODO.md). |
| `sessions/[id]` | Deletes a saved session. |
| `og-preview` | Server-side OG metadata fetch for tab previews and share pages. |
| `track` | GA4 Measurement Protocol proxy for extension events. |
| `contact` | Contact form via Resend. |

- **CORS:** `proxy.ts` answers preflights and adds CORS headers on `/api/*` for `chrome-extension://` and `moz-extension://` origins only. It never sends `Allow-Credentials`, so authenticated routes rely on the Bearer token.
- **Encrypted data:** the dashboard decrypts on the client after a passphrase prompt (`lib/encryption/context.tsx`, which caches the key in `sessionStorage`). Server code never decrypts. A route that needs plaintext content accepts it from the client in the request body, as `organize` and `share-bundle` do.
- **Reviews strip** (`components/marketing/ReviewsStrip.tsx`): shows live store stats only. It tries the Chrome Web Store listing first (`lib/chromeStoreStats.ts`, scraped) and falls back to the Firefox AMO API (`lib/firefoxAddonStats.ts`), whose review text is censored with `obscenity`. No hardcoded testimonials.
- **Analytics & monitoring:** GA4 (`@next/third-parties`), Vercel Analytics and Speed Insights (`app/layout.tsx`), Sentry (`@sentry/nextjs`).

---

## AI features (currently off)

AI is behind a "coming soon" flag. It is off unless the variable is exactly `"true"`:

- Web: `NEXT_PUBLIC_AI_ENABLED` (`lib/aiFlag.ts`). While off, every `/api/ai/*` route returns `503 {error:'ai_disabled'}` before doing any auth or model work (`lib/ai-guard.ts`), and checkout refuses AI purchases.
- Extension: `VITE_AI_ENABLED` (`src/lib/aiFlag.ts`). While off, AI UI is hidden even for `pro_ai` accounts.
- Both parse the value with `isAiEnabled()` in `packages/shared/src/utils/flags.ts`.

When the flag is on, the extension POSTs to `${VITE_WEB_APP_URL}/api/ai/*` with its Supabase JWT. The route checks the tier, meters `ai_usage.credits_used` against a cap of `AI_MONTHLY_CAP` (300) plus that month's purchased credits, and calls `claude-haiku-4-5-20251001` (`lib/ai.ts`). Details are in [AI_FEATURES.md](AI_FEATURES.md).

---

## Shared package (`packages/shared`)

- `src/types` — `Tab`, `ExtWindow`, `Group`, `GroupsState`, `Session`, `Subscription`, `Profile`, `SupabaseGroup`, `SupabaseSession`, `DeviceSession`, AI request/response types, `PricingTier`.
- `src/constants` — `DEFAULT_GROUP_COLOR`, `FIRST_GROUP_TITLE` ("Now Open"), `FREE_TIER_LIMITS` (`{groups: 5, tabs: 50}`), `PRESET_COLORS`, `PRICING_TIERS`, `AI_COMING_SOON_LABEL`.
- `src/crypto` — WebCrypto envelope encryption, `EncryptedBlob` `{v:1,iv,ct}`, `isEncryptedBlob`.
- `src/utils/flags.ts` — `isAiEnabled`.

---

## Entitlements

- **Extension:** `useEntitlements` reads `subscriptions` (30 s poll). A `canceled` status counts as `free`. Per-tier limits come from `TIER_LIMITS` in `src/lib/types.ts`. For free users, groups and tabs beyond `FREE_TIER_LIMITS` are shown locked and creating more is blocked with an upgrade prompt.
- **Web:** AI routes check the tier on the server before any model call. `groups/[id]/publish` requires `pro`/`pro_ai`.
- `entitlements-auditor` checks that what is sold and what is enforced stay in line.

---

## Environments

| | Web | Extension | Supabase project |
|---|---|---|---|
| Local | `pnpm dev:web` → `localhost:3000` | `development` mode | local CLI stack (`supabase start`) |
| Preview | `https://tabmerger-preview.vercel.app`. CI deploys it: `ci.yml` → `deploy-web.yml`, after CI passes on `agentic-revamp`, only when web-relevant paths changed. | Locally built `beta` (`.env.beta`) | `xmofzeq…` |
| Production | `https://tabmerger.vercel.app` | Stable store listing (`production` mode); the CI-built store BETA also points here | `jzgz…` |

TODO (owner): no workflow in `.github/workflows/` deploys web to production (`deploy-web.yml` is preview-only). Document how production web deploys happen, e.g. Vercel Git integration or a manual promote.

The web app and the extension talking to it must use the **same** Supabase project. If they don't, `SYNC_AUTH` tokens are rejected and the dashboard reads a different database.

---

## Release pipeline

semantic-release runs on the `beta` branch. A tag triggers `publish.yml`: prereleases go to the private Chrome BETA listing, and non-prerelease `release` events go to Chrome stable, Firefox AMO and Edge. See [PUBLISHING.md](PUBLISHING.md), [RELEASE_SANITY_CHECK.md](RELEASE_SANITY_CHECK.md) and [`.claude/plans/release-and-beta-channel-spec.md`](../.claude/plans/release-and-beta-channel-spec.md).
