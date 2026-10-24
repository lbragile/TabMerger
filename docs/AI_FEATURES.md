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
| Dev usage counter (Settings → Dev) | `packages/extension/src/mocks/devAiUsage.ts` |
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
| `POST /api/ai/dev-usage` | `{ count }` | `{ count }` | — | — | Extension Settings → Dev usage Set/Reset only |

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
  false even for `pro_ai`, every AI mutation throws before `fetch`, and `useAiUsage` doesn't query.
  No AI requests leave the extension.

### Turning it on

- **Web, per Vercel environment:** set `NEXT_PUBLIC_AI_ENABLED=true` for Preview and/or Production,
  then **redeploy** — `NEXT_PUBLIC_*` is inlined at build time, so a restart or env edit alone
  does nothing to the client bundle. Also needs `ANTHROPIC_API_KEY` (and, for organize, working
  model access for the workflow agent — TODO (owner): document which credentials the
  `anthropic/claude-sonnet-4-6` workflow model uses in each environment).
- **Extension, local dev:** add `VITE_AI_ENABLED=true` to `packages/extension/.env.local` and
  restart `pnpm dev:extension`. Dev builds call the web app at `VITE_WEB_APP_URL`
  like any other build (there is no client-side AI mock). The account still needs `pro_ai` for `aiFeatures`.
  To answer those calls without a provider key, see [Mock AI in development](#mock-ai-in-development).
- **Extension, store builds:** `.github/workflows/publish.yml` does not pass `VITE_AI_ENABLED`, and
  the extension's `.env.production` / `.env.beta` don't set it, so CI-built store zips ship with AI
  off. Turning it on for users requires adding it to the build and releasing a new version.
  TODO (owner): decide where the production value will live (workflow env vs. `.env.production`).
- Web and extension flags are independent; turn the web one on first, or an enabled extension will
  get 503 `ai_disabled`.

### Mock AI in development

The only dev AI mock lives on the server, so the web app and the extension (whose dev build posts
to the local web app) can use every AI feature without a provider key and without spending money.

1. Add `AI_MOCK=true` to `packages/web/.env.local` (and optionally `AI_MOCK_SCENARIO`, below).
   AI must also be on (`NEXT_PUBLIC_AI_ENABLED=true` or `NEXT_PUBLIC_AI_BYOK_ENABLED=true`).
2. Restart `pnpm dev:web`. The first AI call logs `AI mock mode: responses are fake`.

It's on only when `AI_MOCK` is exactly `true`, `NODE_ENV` is `development` (`next dev`) and
`VERCEL_ENV`/`VERCEL` are unset. A production build inlines `NODE_ENV=production`, so it can never
run in a deployed or `next start` build, and tests (`NODE_ENV=test`) ignore it. It's server-only:
never use a `NEXT_PUBLIC_` name for it.

What's fake (`packages/web/lib/ai-mock.ts`): only the model call in `runAiTask` (`lib/ai.ts`):
Claude's `countTokens`/`create`, or the OpenAI/Google request for an own key, and the provider
check in `/api/ai/byok/verify`. Everything else runs for real: the flags, auth, plan and option
checks, body validation and prompt cleaning, credit reservation and settlement, and each task's own
parser. Organize's model call goes through the same `runAiTask` in its route (the workflow never
calls a model), so the proposal it hands to the workflow is the mock's.

- **Answers** are built from the request, deterministically: group-tabs groups by site, name-group
  uses the main site or the commonest title words, tab-summary starts with `[Mock summary]`,
  suggest-sessions suggests merging groups on the same site (or archiving one-tab groups, or saving
  the two largest as a session), organize merges groups on the same site and deletes empty ones.
- **Credits:** managed calls report token usage estimated from the prompt and answer sizes
  (about 4 characters per token), so `ai_usage` moves and the caps behave as usual. Own-key calls
  bill no credits. Use `/api/ai/dev-usage` to set `credits_used` near the cap.
- **Own keys:** verify accepts any key that passes the format check, with no network call, so a
  dummy key such as `sk-ant-mock-000000000000000000000000` can be saved in the extension.
- **Header:** mocked AI responses (success and errors) carry `x-tabmerger-ai-mock: 1`; check it in
  DevTools → Network.

`AI_MOCK_SCENARIO` (unknown values fall back to `ok` with a warning in the server log):

| Value | Managed | Own key (and verify) |
| --- | --- | --- |
| `ok` (default) | 200 | 200 |
| `slow` | 200 after about 1.5 s | 200 after about 1.5 s |
| `error:rate_limited` | 503 `ai_overloaded` | 503 `byok_rate_limited` |
| `error:provider_error` | 503 `ai_overloaded` | 503 `ai_overloaded` |
| `error:invalid_key` | 500 `ai_failed` (TabMerger's key rejected) | 400 `byok_key_invalid` |
| `error:over_quota` | 429 `ai_quota_exceeded` (the real reservation is refused; `needed` is huge, `remaining` is real) | 402 `byok_billing` |

Thrown errors release the managed reservation, as a real failed call would. `next dev` reloads
`.env.local` when it changes; restart it if a new value does not take effect.

---

## Known gaps

- **tab-summary contract mismatch:** `useTabSummary` posts `{ url, title }`, but the route requires
  `{ tab: { id: number, … } }`, so real calls return 400.
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
