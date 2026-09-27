# AI Features

AI features belong to the **Pro AI** tier (`pro_ai`, see [PAYMENTS.md](PAYMENTS.md)) and are
currently **off everywhere behind a coming-soon flag** (see [Coming-soon flag](#coming-soon-flag)).

Authoritative code:

| Concern | File |
| --- | --- |
| Route handlers | `packages/web/app/api/ai/*/route.ts` |
| Haiku prompts + model constant | `packages/web/lib/ai.ts` (`AI_MODEL`) |
| Organize workflow (durable agent) | `packages/web/lib/workflows/tabOrganizer.ts` |
| Tier check + credit metering | `packages/web/lib/ai-usage.ts` |
| Kill switch | `packages/web/lib/ai-guard.ts`, `packages/web/lib/aiFlag.ts`, `packages/shared/src/utils/flags.ts` |
| Extension callers | `packages/extension/src/hooks/useAI.ts`, `useAiUsage.ts`, `src/lib/aiFlag.ts` |
| Dev fixtures | `packages/extension/src/mocks/` |
| Schema | `supabase/migrations/006_ai_usage.sql`, `014_ai_credit_purchases.sql`, `017_rename_ai_usage_credits.sql`, `004_create_organize_runs.sql` |

---

## Architecture

- **Server-side only.** The Anthropic key (`ANTHROPIC_API_KEY`) lives in the web app. The extension
  never calls a model; it POSTs to `${VITE_WEB_APP_URL}/api/ai/*` with
  `Authorization: Bearer <Supabase access token>`.
- Each route verifies that JWT with the service-role client (`supabase.auth.getUser(token)`).
- CORS for the extension origin is applied by `packages/web/proxy.ts`, including on 503 responses.

Request order in every metered route:

```text
1. aiDisabledResponse()            → 503 { error: 'ai_disabled' }   (first statement, nothing else runs)
2. Bearer token present + valid    → 401
3. checkAndIncrementAIUsage(cost)  → tier === 'pro_ai' AND status === 'active', then charge credits
4. body validation                 → 400
5. model call                      → 500 on failure
   success → 200 + X-AI-Requests-Remaining header
```

`trialing` and `past_due` subscriptions are refused at step 3.

---

## Routes

| Route | Body | Response | Credits | Model | Extension caller |
| --- | --- | --- | --- | --- | --- |
| `POST /api/ai/group-tabs` | `{ tabs: {id,title,url}[] }` | `{ groups: {name,color,tabIds}[] }` | 8 | Haiku 4.5 | Header → AI actions → Auto-group (`useAutoGroup`) |
| `POST /api/ai/name-group` | `{ tabs: {id,title,url}[] }` | `{ name }` | 1 | Haiku 4.5 | Group context menu → AI rename (`useNameGroup`) |
| `POST /api/ai/tab-summary` | `{ tab: {id:number,title,url} }` | `{ summary }` | 1 | Haiku 4.5 | Tab hover preview (`useTabSummary`) — see gaps |
| `POST /api/ai/suggest-sessions` | `{ groups: {id,name,tabs}[] }` | `{ message, staleGroupIds, suggestion }` | 5 | Haiku 4.5 | `AIGroupSuggestion` banner, automatic, once per day (`useSuggestSessions`) |
| `POST /api/ai/organize` | `{ groups?: {id,name,tabs,permanent?}[] }` | `{ runId, token }` | 8 | `anthropic/claude-sonnet-4-6` via `@workflow/ai` `DurableAgent` | Header → AI actions → Organize (`useOrganizeTabs`) |
| `GET /api/ai/organize?runId=` | — | NDJSON progress stream | 0 | — | Web dashboard `OrganizeProposal` |
| `POST /api/ai/organize/approve` | `{ token, approved, actions? }` | `{ ok: true }` | 0 | — | Web dashboard `OrganizeProposal` |
| `POST /api/ai/dev-usage` | `{ count }` | `{ count }` | — | — | Dev fetch mock only |

Notes:

- Haiku 4.5 = `claude-haiku-4-5-20251001` (`AI_MODEL`). Prompts, `max_tokens` and parsing are in
  `lib/ai.ts`; no temperature is set. Read the file rather than copying prompts here.
- `suggestion` is a deprecated alias of `message`, kept for already-shipped extension builds.
  `suggestSessions` only lets the model see/return group **names**, then maps them back to IDs.
- **Organize** is a durable workflow: POST starts it (recording `run_id → user_id` in
  `organize_runs`); GET streams progress after an ownership check (404 for someone else's run);
  the workflow suspends on a hook until `approve` resumes it. `approve` requires active `pro_ai`
  and checks the hook token starts with `org-<userId>-`. The approver may send an edited
  `actions` list. Applying never deletes or drains the permanent "Now Open" group (position 0).
- **dev-usage** returns 404 unless `NODE_ENV === 'development'`. It sets `ai_usage.credits_used`
  for the current month; `count: 0` also deletes this month's `ai_credit_purchases` rows.

---

## E2E encryption constraint

For signed-in Pro users `groups.windows` / `name` are ciphertext in Supabase and the server has no
key. Any route that needs group **content** must receive it client-decrypted in the request body:

- `suggest-sessions` and `group-tabs`/`name-group`/`tab-summary` already take all content from the
  body.
- `organize`: the extension sends decrypted `groups` when `hasEncryptionKey()` is true; with an
  empty body the workflow falls back to reading `groups` from the DB (plaintext users only).
- When applying an approved plan, `rename` and `merge` on ciphertext groups are **skipped** and
  returned in `skipped` (the server can't write inside the blob); `delete` and `reorder` still
  apply server-side.

Run the `encrypted-column-auditor` agent before merging any new AI route.

---

## Usage metering and credits

- Monthly pool: `AI_MONTHLY_CAP = 300` credits per user per UTC month (`'YYYY-MM'`).
  Per-call cost: `CREDIT_COSTS` in `lib/ai-usage.ts` (table above).
- `ai_usage(user_id, month, credits_used)` — `credits_used` was `request_count` before migration 017.
  Users can read their own row (RLS); only the service role writes.
- Effective cap = 300 + sum of `ai_credit_purchases.credits` for the month (`getEffectiveCap`, also
  used by the dashboard/account pages). Credit packs are bought via `/api/checkout/credits` and
  granted by the Stripe webhook, idempotent on `stripe_checkout_session_id`. No rollover.
- A call is refused when `credits_used + cost > cap`. Read-then-upsert, so concurrent calls can race
  slightly — accepted (not a financial boundary).
- Extension: `useAiUsage()` reads the same tables (it duplicates `AI_MONTHLY_CAP = 300` — keep in
  sync). Each AI hook pre-checks `remaining > 0` and throws `QuotaExceededError`; a server 429 does
  the same. Components then render `AIQuotaExceededPrompt`.
- Per-feature toggles in extension Settings (`aiAutoGroupEnabled`, `aiNameGroupEnabled`,
  `aiSuggestSessionsEnabled`, `aiOrganizeEnabled`, `aiTabSummaryEnabled`) and a daily throttle
  (`aiDailyThrottle`, applies only to the automatic suggest-sessions call).

---

## Coming-soon flag

| Package | Variable | Read in |
| --- | --- | --- |
| web | `NEXT_PUBLIC_AI_ENABLED` | `lib/aiFlag.ts` (`AI_ENABLED`, UI), `lib/ai-guard.ts` and `app/api/checkout/*` (per call) |
| extension | `VITE_AI_ENABLED` | `src/lib/aiFlag.ts` (`AI_ENABLED`) |

Both go through `isAiEnabled()`: **on only for the exact string `"true"`** — unset, `"TRUE"`,
`"1"`, `" true"` are all off.

When off:

- **Every `/api/ai/*` handler** (including organize GET/approve and dev-usage) returns
  `503 { error: 'ai_disabled' }` as its first statement — no auth lookup, no `ai_usage` read/write,
  no workflow, no Anthropic call.
- **Checkout** rejects Pro AI and credit packs with the same 503 (see [PAYMENTS.md](PAYMENTS.md#ai-flag-and-payments)).
- **Web UI** shows "Coming soon" (`AI_COMING_SOON_LABEL`) on the pricing card, features page, FAQ
  and landing sections; dashboard/account hide AI usage and the organize panel.
- **Extension** hides every AI entry point (Header AI actions menu, AI rename via `aiFeatures`,
  hover summary, suggestion banner, Settings AI section), `useEntitlements().aiFeatures` is forced
  false even for `pro_ai`, every AI mutation throws before `fetch`, `useAiUsage` doesn't query, and
  the dev fetch mock isn't installed. No AI requests leave the extension.

### Turning it on

- **Web, per Vercel environment:** set `NEXT_PUBLIC_AI_ENABLED=true` for Preview and/or Production,
  then **redeploy** — `NEXT_PUBLIC_*` is inlined at build time, so a restart or env edit alone
  does nothing to the client bundle. Also needs `ANTHROPIC_API_KEY` (and, for organize, working
  model access for the workflow agent — TODO (owner): document which credentials the
  `anthropic/claude-sonnet-4-6` workflow model uses in each environment).
- **Extension, local dev:** add `VITE_AI_ENABLED=true` to `packages/extension/.env.local` and
  restart `pnpm dev:extension`. In dev builds AI calls are answered by the local fetch mock
  (`src/mocks/devFetchMock.ts`), not the web app; it also best-effort syncs its counter to
  `/api/ai/dev-usage`. The account still needs `pro_ai` for `aiFeatures`.
- **Extension, store builds:** `.github/workflows/publish.yml` does not pass `VITE_AI_ENABLED`, and
  the extension's `.env.production` / `.env.beta` don't set it, so CI-built store zips ship with AI
  off. Turning it on for users requires adding it to the build and releasing a new version.
  TODO (owner): decide where the production value will live (workflow env vs. `.env.production`).
- Web and extension flags are independent; turn the web one on first, or an enabled extension will
  get 503 `ai_disabled`.

---

## Known gaps

- **tab-summary contract mismatch:** `useTabSummary` posts `{ url, title }`, but the route requires
  `{ tab: { id: number, … } }`, so real calls return 400 (the dev mock hides this).
- **Credits charged before body validation** in group-tabs, name-group, tab-summary and
  suggest-sessions: a 400 still costs credits. `organize` parses its body first.
- **403 is unreachable:** `checkAndIncrementAIUsage` returns `remaining: 0` both for "not Pro AI"
  and "over cap", so the routes answer **429** in both cases. The extension therefore shows the
  quota prompt to a non-`pro_ai` caller.
- **Organize hand-off:** the extension opens `/dashboard` without the `organizeRunId` /
  `organizeToken` search params that `dashboard/page.tsx` needs to render `OrganizeProposal`, so the
  approval panel doesn't appear from that hand-off.

TODO (owner): cost estimates for current models (old figures were for earlier Haiku pricing and were
removed).

---

## Manual QA (flag on, `pro_ai` + `active` account)

Open the popup, right-click → Inspect → Network, then:

| Feature | Trigger | Expect |
| --- | --- | --- |
| Auto-group | Header → AI actions → Auto-group | `POST /api/ai/group-tabs` 200, groups created |
| AI rename | Group context menu → AI rename | `POST /api/ai/name-group` 200, title updates |
| Suggestions | Automatic on popup open, once/day | `POST /api/ai/suggest-sessions` 200, banner |
| Organize | Header → AI actions → Organize | `POST /api/ai/organize` 200 `{ runId, token }`, dashboard tab opens |
| Tab summary | Hover a tab | `POST /api/ai/tab-summary` (currently 400, see gaps) |

After each call, `ai_usage.credits_used` for the user rises by the route's cost and
`X-AI-Requests-Remaining` matches. For the quota path, set usage near the cap with
`/api/ai/dev-usage` (local web dev) or temporarily lower `AI_MONTHLY_CAP`, and confirm
`AIQuotaExceededPrompt` renders. With the flag off, every route above returns 503 `ai_disabled`.
