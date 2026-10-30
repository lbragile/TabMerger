# AI Features

AI features belong to the **Pro AI** tier (`pro_ai`, see [PAYMENTS.md](PAYMENTS.md)) and are
currently **off everywhere behind a coming-soon flag** (see [Coming-soon flag](#coming-soon-flag)).

Authoritative code:

| Concern | File |
| --- | --- |
| Route handlers | `packages/web/app/api/ai/*/route.ts` |
| Haiku prompts + model constant | `packages/web/lib/ai.ts` (`AI_MODEL`) |
| Organize: groups for the prompt, proposal cleaning | `packages/web/lib/ai-organize.ts`, `sanitizeOrganizeProposal` in `packages/web/lib/ai.ts` |
| Shared organize types | `OrganizeAction`, `OrganizeResponse` in `packages/shared/src/types/index.ts` |
| Tier check + credit metering | `packages/web/lib/ai-usage.ts` |
| Kill switch | `packages/web/lib/ai-guard.ts`, `packages/web/lib/aiFlag.ts`, `packages/shared/src/utils/flags.ts` |
| Extension callers | `packages/extension/src/hooks/useAI.ts`, `useAiUsage.ts`, `src/lib/aiFlag.ts` |
| Dev "Credits used this month" control (Settings → Dev) | `packages/extension/src/components/Settings/DevAiCredits.tsx` |
| Schema | `supabase/migrations/006_ai_usage.sql`, `014_ai_credit_purchases.sql`, `017_rename_ai_usage_credits.sql` |

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
| `POST /api/ai/name-group` | `{ tabs: {id,title,url}[] }` | `{ names, name }` (`AINameGroupResponse`) | 1 | Haiku 4.5 | Group context menu → AI rename (`useNameGroup`) |
| `POST /api/ai/tab-summary` | `{ tab: {id:number,title,url} }` | `{ summary }` | 1 | Haiku 4.5 | Tab hover preview (`useTabSummary`) — see gaps |
| `POST /api/ai/suggest-sessions` | `{ groups: {id,name,tabs}[] }` | `{ message, staleGroupIds, suggestion }` | 5 | Haiku 4.5 | `AIGroupSuggestion` banner, automatic, once per day (`useSuggestSessions`) |
| `POST /api/ai/organize` | `{ groups?: {id,name,tabs,permanent?}[], model? }` | `{ actions: OrganizeAction[] }` | metered like the others | auto: the mid model | Header → AI actions → Organize (`useOrganizeTabs`), reviewed and applied in the popup |
| `POST /api/ai/describe-group` | `{ groupName, tabs: {title,url}[], model? }` (`AIDescribeGroupRequest`) | `{ description }` (`AIDescribeGroupResponse`) | metered like the others | auto: the cheapest model (Haiku 5.5 / GPT-6 Luna / Gemini 3.1 Flash-Lite) | Describe group, written into the group's note |
| `POST /api/ai/dev-usage` | `{ count }` (credits) | `{ count }` | — | — | Extension Settings → Dev → "Credits used this month" Set/Reset only |

Notes:

- Haiku 4.5 = `claude-haiku-4-5-20251001` (`AI_MODEL`). Prompts, `max_tokens` and parsing are in
  `lib/ai.ts`; no temperature is set. Read the file rather than copying prompts here.
- `suggestion` is a deprecated alias of `message`, kept for already-shipped extension builds.
  `suggestSessions` only lets the model see/return group **names**, then maps them back to IDs.
- **Organize** is a synchronous route like the others: one model call, answered as
  `{ actions }` (merge / rename / delete / reorder; no changes needed is `{ actions: [] }`). The
  extension shows the proposal in the popup for review and applies the accepted actions to its
  local groups, which then sync (re-encrypted) through the normal path. The server stores nothing
  and writes nothing. `sanitizeOrganizeProposal` keeps only ids from the request, never names a
  permanent group (Now Open) in merge / rename / delete, and cleans and caps rename text at 30
  characters; the extension still checks the ids against its own groups before applying. Organize
  used to be a Workflow DevKit run with a web-dashboard approval page; that path is gone (see
  [Known gaps](#known-gaps) for what is left of it).
- **Name group** answers `{ names, name }`. `names` holds 1 to `AI_NAME_GROUP_SUGGESTIONS` (3)
  distinct suggestions, best first; `name` is always `names[0]`, kept for extension builds that
  read only `name`. The prompt asks for 3 names that differ in angle (topic, purpose, site), each
  2-4 words in Title Case, at most 30 characters, without quotes. The schema is `{ names: string[] }`
  with the count in the prompt and the field description only, because Claude's structured
  outputs reject `maxItems` and any `minItems` above 1. `cleanGroupNames` unquotes and cleans
  each name, drops empties and case-insensitive duplicates, and keeps at most 3; with none left
  the answer is 502 `ai_failed` (still charged). The credit estimate assumes about 40 output
  tokens.
- **Describe group** writes 1-3 plain sentences about what a saved group holds (topic, purpose,
  notable sites), at most `AI_MAX_GROUP_DESCRIPTION_LENGTH` (300) characters, which the extension
  puts in the group's note. The body is validated by `parseDescribeGroupBody` (`groupName` cleaned
  and cut to 100 characters, an unnamed group sends `''`; 1 to 1,000 tabs, each with a string
  `title` and `url`). The task is `describeGroupTask`: constant instructions, the group name and
  tabs only in the `<tab_data>` turn, a strict `{ description }` schema. An answer longer than the
  cap is cut back to a word boundary; an empty answer is 502 `ai_failed` (still charged, like any
  unusable answer).
- **dev-usage** returns 404 unless `NODE_ENV === 'development'`. It sets `ai_usage.credits_used`
  for the current month; `count: 0` also deletes this month's `ai_credit_purchases` rows.

---

## E2E encryption constraint

For signed-in Pro users `groups.windows` / `name` are ciphertext in Supabase and the server has no
key. Any route that needs group **content** must receive it client-decrypted in the request body:

- `suggest-sessions`, `describe-group` and `group-tabs`/`name-group`/`tab-summary` take all
  content from the body and never read group rows.
- `organize`: the extension sends its decrypted `groups` unless it has confirmed there is no
  encryption key; with no groups in the body the route reads `groups` from the DB, and refuses
  with a 400 before the model call if any stored row is not a plaintext array. The proposal is
  applied by the extension, never by the server, so encrypted groups are merged and renamed like
  any other.

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
- Describe group is metered like every other managed call (count, reserve, call, settle; see
  [Prompt caching](#prompt-caching) for how cache tokens are priced) and unmetered on an own key.
  Its estimate (`estimateAiCredits(model, 'describeGroup', tabs)`) assumes about 90 output tokens.
- Per-feature toggles in extension Settings (`aiAutoGroupEnabled`, `aiNameGroupEnabled`,
  `aiSuggestSessionsEnabled`, `aiOrganizeEnabled`, `aiTabSummaryEnabled`) and a daily throttle
  (`aiDailyThrottle`, applies only to the automatic suggest-sessions call).

---

## Prompt caching

Every task sends its constant instructions as the system prompt and the request's tab data as one
`<tab_data>` user turn (`lib/ai.ts`). Only the instructions are the same from one request to the
next, so they are the only part worth caching. No request data ever goes into the system prompt.

| Provider | What happens | Why |
| --- | --- | --- |
| Anthropic (managed and own key) | `buildAiRequest` puts an explicit `cache_control: { type: 'ephemeral' }` (5-minute) breakpoint on the system block, in both the `count_tokens` and the `create` params. The data turn has no breakpoint, and top-level automatic caching is not used. | The cached prefix (output format, thinking/effort settings, instructions) is identical for every request of a task on a model. Managed traffic shares one workspace, so it is reused across users. Own-key traffic is reused within the customer's own workspace, for example during bursts of tab-summary hovers. Automatic caching would mark the last block, the unique data turn, which costs the write premium and never gets a read. A prefix under the model's minimum (512 tokens on the Claude 5.x models) is just not cached: no error and no write charge. |
| OpenAI (own key) | Caching is turned off: `prompt_cache_options: { mode: 'explicit' }` with no breakpoints. No `prompt_cache_key` is sent. | On the GPT-6 models a cache write costs 1.25x input. The default implicit breakpoint sits at the end of the last user message, so any request of 1,024+ tokens would pay a 1.25x write on its unique tab data. The instructions are far below OpenAI's 1,024-token minimum, and hidden content such as the schema doesn't count toward it. Revisit if a task's instructions ever pass 1,024 tokens: a breakpoint after them would then pay off. That needs the instructions moved into a developer message, because top-level `instructions` can't carry a breakpoint. |
| Google (own key) | No request change. Gemini's implicit caching is on by default. Explicit `cachedContents` is not used. | Implicit caching needs no setup, and Google passes on the savings when a request hits the cache. Explicit caches need per-key cache resources and a storage fee. They also need a 4,096-token minimum on Gemini 3.8 Flash and 4 Argon, and Gemini 4 Argon doesn't support them at all. |

Nobody has to configure anything for their own key. An Anthropic key gets the same breakpoint in
the customer's own workspace, and OpenAI and Gemini keys need no setup.

**How managed metering prices cache tokens.** `usageCredits` in `lib/ai.ts` reads `response.usage`:

- `input_tokens` are charged at the base input price.
- `cache_creation_input_tokens` are charged at the write price: 1.25x base for 5-minute writes, 2x for 1-hour writes. That field is the authoritative count of written tokens. `usage.cache_creation` only says how many of them were 1-hour writes (clamped to between 0 and the written count), and the rest are 5-minute writes. TabMerger only requests 5-minute writes, so a response reporting 1-hour writes is logged.
- `cache_read_input_tokens` are charged at the model's cache-read price.
- Output, thinking included, is charged at the output price.

The cache-read prices are in `AI_MODELS` (`cacheReadCentsPerMTok`), and the write multipliers are in
`AI_CACHE_WRITE_MULTIPLIER` (`@tabmerger/shared`). Cache-read prices:

- Haiku 5.5: $0.01/MTok, or $0.05 for prompts over 100K tokens.
- Sonnet 5.5: $0.10/MTok.
- Opus 5.5: $0.20/MTok.

Source: <https://platform.claude.com/docs/en/about-claude/pricing>, checked 2026-10-25.

Haiku 5.5's long-context tier is still chosen from the total input, cache tokens included.

The reservation (`aiReservationCredits`) takes the counted input plus a 2% margin
(`AI_RESERVE_INPUT_MARGIN_PERCENT`, since `count_tokens` is an estimate) and prices all of it as
5-minute writes, the dearest way input can be billed. It picks the price tier from that padded
total, so a count within about 2% of a long-context threshold is already reserved at the
long-context prices. This keeps the reservation an upper bound, and settling only refunds, as long
as the real input stays within the margin.

Settling has these safeguards:

- A settle that charges more than the reservation still goes through, but is logged (model id only).
- Usage that isn't a finite number is never settled: the reservation stays as the charge.
- A count that isn't finite refuses the call (500 `ai_failed`) before anything is reserved.
- A response whose `inference_geo` isn't `global`, or whose `service_tier` isn't `standard`, is logged as a warning, because the credit prices assume global standard inference. With
`AI_MOCK=true`, the mock reports cache writes and reads the same way, but only for a marked prefix
of at least 512 estimated tokens.

---

## Coming-soon flag

| Package | Variable | Read in |
| --- | --- | --- |
| web | `NEXT_PUBLIC_AI_ENABLED` | `lib/aiFlag.ts` (`AI_ENABLED`, UI), `lib/ai-guard.ts` and `app/api/checkout/*` (per call) |
| extension | `VITE_AI_ENABLED` | `src/lib/aiFlag.ts` (`AI_ENABLED`) |

Both go through `isAiEnabled()`: **on only for the exact string `"true"`** — unset, `"TRUE"`,
`"1"`, `" true"` are all off.

When off:

- **Every `/api/ai/*` handler** (including dev-usage) returns
  `503 { error: 'ai_disabled' }` as its first statement — no auth lookup, no `ai_usage` read/write,
  no model call.
- **Checkout** rejects Pro AI and credit packs with the same 503 (see [PAYMENTS.md](PAYMENTS.md#ai-flag-and-payments)).
- **Web UI** shows "Coming soon" (`AI_COMING_SOON_LABEL`) on the pricing card, features page, FAQ
  and landing sections; dashboard/account hide AI usage.
- **Extension** hides every AI entry point (Header AI actions menu, AI rename via `aiFeatures`,
  hover summary, suggestion banner, Settings AI section), `useEntitlements().aiFeatures` is forced
  false even for `pro_ai`, every AI mutation throws before `fetch`, and `useAiUsage` doesn't query.
  No AI requests leave the extension.

### Turning it on

- **Web, per Vercel environment:** set `NEXT_PUBLIC_AI_ENABLED=true` for Preview and/or Production,
  then **redeploy** — `NEXT_PUBLIC_*` is inlined at build time, so a restart or env edit alone
  does nothing to the client bundle. Also needs `ANTHROPIC_API_KEY` for managed calls.
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
parser. Organize goes through the same `runAiTask`, so its `{ actions }` answer is the mock's.

- **Answers** are built from the request, deterministically: group-tabs groups by site, name-group
  gives 3 distinct names (the main site plus the top title word, the top title words, and
  "<Site> Research"), tab-summary starts with `[Mock summary]`,
  describe-group starts with `[Mock description]` and names the main site, the commonest title
  words and how many other sites there are,
  suggest-sessions suggests merging groups on the same site (or archiving one-tab groups, or saving
  the two largest as a session), organize merges groups on the same site and deletes empty ones.
- **Credits:** managed calls report token usage estimated from the prompt and answer sizes
  (about 4 characters per token), so `ai_usage` moves and the caps behave as usual. Own-key calls
  bill no credits. Use `/api/ai/dev-usage` (extension dev build: Settings → Dev → "Credits used
  this month") to set `credits_used` near the cap. The extension's credits meter reads the real
  `ai_usage` row in every build, dev included.
- **Own keys:** verify accepts any key that passes the format check, with no network call, so a
  dummy key such as `sk-ant-mock-000000000000000000000000` can be saved in the extension. A
  development build of the extension has a "Use test key" button in Settings → AI (once a provider
  is picked) that saves that provider's dummy key (`AiTestKeyButton.tsx`); production builds drop it.
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

TODO (owner): cost estimates for current models (old figures were for earlier Haiku pricing and were
removed).

---

## Manual QA (flag on, `pro_ai` + `active` account)

Open the popup, right-click → Inspect → Network, then:

| Feature | Trigger | Expect |
| --- | --- | --- |
| Auto-group | Header → AI actions → Auto-group | `POST /api/ai/group-tabs` 200, groups created |
| AI rename | Group context menu → AI rename | `POST /api/ai/name-group` 200 `{ names, name }`, up to 3 suggestions |
| Suggestions | Automatic on popup open, once/day | `POST /api/ai/suggest-sessions` 200, banner |
| Organize | Header → AI actions → Organize | `POST /api/ai/organize` 200 `{ actions }`, proposal shown in the popup for review |
| Describe group | Describe group action on a saved group | `POST /api/ai/describe-group` 200 `{ description }`, the group's note is filled |
| Tab summary | Hover a tab | `POST /api/ai/tab-summary` (currently 400, see gaps) |

After each call, `ai_usage.credits_used` for the user rises by the route's cost and
`X-AI-Requests-Remaining` matches. For the quota path, set usage near the cap with
`/api/ai/dev-usage` (local web dev) or temporarily lower `AI_MONTHLY_CAP`, and confirm
`AIQuotaExceededPrompt` renders. With the flag off, every route above returns 503 `ai_disabled`.
