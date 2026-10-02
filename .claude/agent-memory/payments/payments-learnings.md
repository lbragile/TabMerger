---
name: payments-learnings
description: Non-obvious Stripe/webhook learnings for TabMerger payments work
metadata:
  type: project
---

## One-time AI credit pack purchases (mode: 'payment', not subscription)

- No script/dashboard-automation convention exists in this repo for creating Stripe
  products/prices (checked `scripts/` and grepped for `stripe.products.create` — nothing).
  Subscription prices are apparently created manually in the Stripe dashboard and referenced
  purely by env var (`STRIPE_PRO_MONTHLY_PRICE_ID` etc in `packages/web/.env.example`). Followed
  that same pattern for the credit pack: added `STRIPE_AI_CREDIT_PACK_PRICE_ID` to `.env.example`
  with a comment that it must be created as a one-time (non-recurring) Price in the dashboard.
- `checkout.session.completed` already had a `if (session.mode !== 'subscription') break` guard
  at the very top — one-time payment sessions were silently no-op'd before this change. Added an
  earlier branch for `session.mode === 'payment'` that dispatches on `session.metadata.type` so
  future one-time-purchase types (if any) can be added without touching the subscription path.
- Idempotency for one-time purchases uses a DB unique constraint (`ai_credit_purchases.stripe_checkout_session_id`)
  rather than an upsert-by-id like subscriptions do — a straight `insert` that swallows Postgres
  error code `23505` (unique violation) as a no-op. Simpler than upsert because credit purchases
  have no "current state" to overwrite, just a append-only ledger of grants.
  Migration: `supabase/migrations/014_ai_credit_purchases.sql` (created by the database agent
  in parallel — table/column names matched what I needed on the first guess: `user_id`, `month`
  ('YYYY-MM', same format as `ai_usage.month`), `credits`, `stripe_checkout_session_id`).
- The credit-pack purchase and the "spend a purchased credit once you've hit the cap" logic landed
  as separate changes: `packages/web/lib/ai-usage.ts` now adds the month's summed
  `ai_credit_purchases.credits` to the base cap. When touching either side, check both.
- Reused the subscription checkout's env-var-driven price lookup pattern but did NOT reuse
  `createCheckoutSession` (mode is hardcoded 'subscription' there, with `subscription_data.metadata`
  that doesn't apply to one-time payments) — added a sibling `createCreditPackCheckoutSession`
  in `lib/stripe.ts` instead of overloading one function for two Stripe checkout modes.

## GA4 server-side conversion tracking (checkout_completed)

- Added a `checkout_completed` GA4 Measurement Protocol event fired from
  `packages/web/app/api/webhooks/stripe/route.ts`, inside the `checkout.session.completed`
  handler, right after `upsertSubscription` succeeds. Deliberately NOT a client-side gtag call —
  checkout success redirects aren't a reliable "did payment actually succeed" signal; the webhook
  post-signature-verification is.
- Reused the existing `getTierFromPriceId` price-ID→tier env var mapping (do not duplicate it) —
  refactored it into `getTierAndBilling()` which returns `{ tier, billing: 'monthly'|'yearly'|null }`
  from the same env vars (`STRIPE_PRO_MONTHLY_PRICE_ID` etc), since GA needed billing period too.
- `client_id` for the Measurement Protocol call is `sha256(userId)` (Node `crypto.createHash`, not
  Web Crypto — this runs server-side in a webhook, no need for `crypto.subtle`). Never send the raw
  Stripe customer ID or Supabase user ID as `client_id`.
- New env var: `GA_API_SECRET` (server-only, no `NEXT_PUBLIC_` prefix) — reused
  `NEXT_PUBLIC_GA_MEASUREMENT_ID` for measurement_id since it's already public-safe.
- The GA POST is wrapped in try/catch inside its own `trackCheckoutCompleted` function and awaited
  but never throws — a GA outage must never turn the webhook's 200 into a 500 (Stripe would retry
  the whole event on a non-2xx).
- Extension's `packages/extension/src/lib/analytics.ts` is the reference implementation for the MP
  request shape (`?measurement_id=&api_secret=` query params, `{ client_id, events: [{name, params}] }`
  body) — but it's fire-and-forget with `.catch(() => {})`; the webhook version awaits so tests can
  assert on it, still wrapped in try/catch so failures don't propagate.
- Test pattern: `vi.stubGlobal('fetch', fetchMock)` + `vi.unstubAllGlobals()` at the end — the
  existing `stripeWebhook.test.ts` doesn't mock global fetch elsewhere, so this is additive and safe.

## First-purchase upgrade silently failing — trigger-created default row + onConflict mismatch + swallowed 23505

- Bug class: a DB trigger (`handle_new_user()` in `001_initial_schema.sql`) pre-inserts a
  `public.subscriptions` row at signup with `id = 'free_' || user_id`, `tier='free'`,
  `status='active'`. The webhook's `upsertSubscription()` then did
  `.upsert({ id: <stripe_sub_id>, user_id, ... }, { onConflict: 'id' })`. On a first purchase
  the Stripe sub id is brand new, so `onConflict:'id'` matches nothing → Postgres tries INSERT →
  violates `subscriptions_user_id_key` UNIQUE(user_id) (added in `012_dedupe_and_unique_subscriptions.sql`)
  → error `23505`. `upsertSubscription` logs and swallows the error (handler always returns 200
  so Stripe never retries), so the row is never upgraded and the user stays on `free` forever.
- Fix was one line: `{ onConflict: 'id' }` → `{ onConflict: 'user_id' }`. Migration 012's own
  comment already stated the constraint was named so it could be targeted by an
  `onConflict: 'user_id'` upsert — the code just never matched that intent. Keep `id: subscription.id`
  in the payload: the conflict-on-user_id path rewrites the existing `free_<uuid>` row in place and
  its primary key becomes the Stripe sub id. Safe because NO table has an FK to `subscriptions.id`
  (grepped `references public.subscriptions` / `subscription_id` — nothing; `groups`/`sessions`/etc
  FK to `profiles.id`, not here).
- `onConflict: 'user_id'` upsert inherently covers both insert (no row for user — e.g. trigger row
  somehow deleted) and update (the normal case). No separate defensive "row missing" branch needed.
- Downstream handlers after the fix: `customer.subscription.updated` calls the same
  `upsertSubscription` (now also conflict-on-user_id — good, keeps one row per user).
  `customer.subscription.deleted` does `.update(...).eq('id', subscription.id)` — resolves fine
  once the row's id is the Stripe sub id (i.e. after any successful `upsertSubscription`). If a sub
  is created+deleted before `checkout.session.completed` ever lands, that `.eq('id', ...)` is a
  harmless no-op (user stays free = correct). Pre-existing, not introduced by this fix.
  `invoice.payment_failed` keys on `user_id` — unaffected. `creditAiCreditPack` writes
  `ai_credit_purchases` — unrelated.
- General rule for this repo: any `subscriptions` write from the webhook must conflict on
  `user_id`, never `id`, because of the signup-trigger default row. Same trap will bite any future
  handler that upserts that table.
- Tests: handler tests fully mock Supabase, so the meaningful assertion is
  `expect(mockUpsert).toHaveBeenCalledWith(objectContaining({...}), { onConflict: 'user_id' })`
  plus `not.toHaveBeenCalledWith(anything(), { onConflict: 'id' })`. Added to
  `packages/web/__tests__/stripeWebhook.test.ts`.

## Stripe redirect URLs on Vercel preview deploys (absoluteUrl resolver)

- `NEXT_PUBLIC_APP_URL` is a build-time-inlined constant (`NEXT_PUBLIC_*` convention) — it cannot
  vary per Vercel Preview deployment, and CLI/`--prebuilt` preview deploys from GitHub Actions get
  no stable per-branch alias (`vercel inspect` confirmed), so a fixed value is wrong for every
  preview. Fixed by resolving the base URL at *runtime* in `lib/utils.ts` `absoluteUrl()`: if
  `VERCEL_ENV === 'preview'` and `VERCEL_URL` is set, use `https://${VERCEL_URL}` (this
  deployment's own host) ahead of `NEXT_PUBLIC_APP_URL`; otherwise validate+use
  `NEXT_PUBLIC_APP_URL`; otherwise fall back to `VERCEL_URL` **except in production**; otherwise
  throw. Production fails CLOSED (payments-security-reviewer): falling back to the deployment's
  `*.vercel.app` host would send paying customers somewhere that may sit behind deployment
  protection and doesn't carry their session cookies. `validateBaseUrl` also rejects userinfo and
  any path/query/fragment — a base URL must be a bare origin. Never derive the
  host from the incoming request (`Host`/`x-forwarded-host`/`nextUrl.origin`) — that's an open
  host-header surface on a Stripe redirect target that Vercel's own env vars avoid entirely.
- `VERCEL_ENV`/`VERCEL_URL` are NOT `NEXT_PUBLIC_*`, so unlike `NEXT_PUBLIC_APP_URL` they're read
  fresh at request time, not inlined at build time — that's exactly why they can vary per preview.
- Old `absoluteUrl` never validated or threw — a malformed `NEXT_PUBLIC_APP_URL` silently produced
  an invalid URL string that Stripe rejected at checkout-session-creation time with
  `StripeInvalidRequestError code: 'url_invalid'`, which is how this was actually diagnosed (from
  Vercel runtime logs, not locally — the bug is invisible in local dev where the env var is
  normally valid). The new resolver validates with `new URL()` (scheme must be http/https, no
  embedded quotes/whitespace) and throws a descriptive error instead of ever handing Stripe garbage.
- Test gotcha: none of the route-level tests (`checkout.test.ts`, `portal.test.ts`,
  `checkout-credits-route.test.ts`) ever stubbed `NEXT_PUBLIC_APP_URL` — they worked before only
  because the old code silently interpolated `"undefined/path"` without throwing. Making
  `absoluteUrl` throw on missing/invalid config broke all of them. Fix: set a suite-wide default
  (`process.env.NEXT_PUBLIC_APP_URL ??= 'https://tabmerger.app'`) in `vitest.setup.tsx` rather than
  touching every unrelated route test. Tests in `utils.test.ts` that need it *absent* (e.g. testing
  the "throws" path) must `delete process.env.NEXT_PUBLIC_APP_URL` directly and restore the
  suite-wide default in their own `afterEach` — `vi.unstubAllEnvs()` alone only restores to
  whatever the value was at the time of the *first* `vi.stubEnv()` call in that test, not to a
  value set later by `delete`.
- Checked the known `onConflict: 'id'` vs `'user_id'` webhook bug (see the entry above,
  "First-purchase upgrade silently failing") while in this file — it is already fixed in the
  current `app/api/webhooks/stripe/route.ts` (`upsertSubscription` uses
  `{ onConflict: 'user_id' }` with the same explanatory comment). No longer an open issue as of
  2026-09-24.

## Price repricing (AI credit pack $0.10 → $0.05/credit)

- Prices are immutable in Stripe — repricing means `stripe.prices.create` a new Price on the same
  Product, then `stripe.prices.update(oldId, {active: false})` to archive (never delete — deleting
  fails once a Price has usage history, and archiving is enough to stop it being reused since
  Checkout still needs a live env-var-referenced price ID).
- No CLI/script convention exists for this either (same finding as the original credit-pack setup
  above) — ran it as an ad hoc `node -e` one-liner requiring `stripe` from `packages/web` so it
  picks up the already-installed SDK, reading `process.env.STRIPE_SECRET_KEY` from the shell (test
  mode key was already exported in the dev shell, not read from `.env.local` by a bare `node -e`).
- The clamp range `[50, 500]` in both `route.ts` and `stripe.ts`'s `adjustable_quantity` didn't need
  to change from the price cut alone — it only exists to stay above Stripe's $0.50 minimum charge,
  and 50 units at $0.05 is still $2.50, comfortably clear. Only the comments needed updating. Don't
  assume a price change always means a clamp/limit change — check the actual constraint math first.

## AI "coming soon" flag in checkout (2026-09-26)

(Reconstructed — the agent's original note for this was lost while merging a stray
`packages/.claude/` memory folder.)
- While `NEXT_PUBLIC_AI_ENABLED` isn't exactly `"true"`, `app/api/checkout/route.ts` rejects
  `tier === 'proAi'` at any interval and `app/api/checkout/credits/route.ts` rejects every
  credit pack — both return 503 `{ error: AI_DISABLED_ERROR }` from `lib/ai-guard.ts`, placed
  after auth and before any Stripe call. Use that shared constant, not an inline 403 (see
  ai-disabled-checkout-convention.md).
- The flag helper is `isAiEnabled()` in `packages/shared/src/utils/flags.ts`; the web app reads it
  through `lib/aiFlag.ts`.
- Latent footgun (payments-security-reviewer): the checkout wire tier is camelCase `'proAi'`
  while the DB/Stripe tier is snake_case `'pro_ai'`. Safe today (strict `===` everywhere), but
  a future refactor could mix them — worth a single `PRO_AI_TIER` constant.
