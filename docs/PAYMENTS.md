# Payments & Subscriptions

Stripe Checkout (hosted) + Stripe Billing Portal, synced into Supabase by one webhook.
Authoritative code:

| Concern | File |
| --- | --- |
| Stripe client, checkout/portal session creation | `packages/web/lib/stripe.ts` |
| Tier display prices + env-var price IDs | `packages/web/lib/tiers.ts` (`TIERS`, `getStripePriceId`, `getPriceInfo`) |
| Subscription checkout | `packages/web/app/api/checkout/route.ts` |
| AI credit-pack checkout | `packages/web/app/api/checkout/credits/route.ts` |
| Billing portal (web, cookie auth) | `packages/web/app/api/billing-portal/route.ts` |
| Billing portal (extension, Bearer JWT) | `packages/web/app/api/portal/route.ts` |
| Webhook | `packages/web/app/api/webhooks/stripe/route.ts` |
| Redirect base URL | `packages/web/lib/utils.ts` (`absoluteUrl`) |
| Extension entitlements | `packages/extension/src/hooks/useEntitlements.ts`, `TIER_LIMITS` in `packages/extension/src/lib/types.ts` |
| Schema | `supabase/migrations/001` (subscriptions + `handle_new_user()`), `005` (lifecycle columns), `012` (unique `user_id`), `014` (`ai_credit_purchases`) |

---

## Tiers and prices

| Tier | Monthly | Yearly | DB `subscriptions.tier` | Checkout wire value |
| --- | --- | --- | --- | --- |
| Free | $0 | $0 | `free` | — |
| Pro | $3.99 | $42.99 | `pro` | `pro` |
| Pro AI | $7.99 | $85.99 | `pro_ai` | `proAi` |

Display prices live in **two** places that must match each other and the Stripe prices:
`TIERS` in `packages/web/lib/tiers.ts` (what the pricing page renders) and `PRICING_TIERS` in
`packages/shared/src/constants/index.ts`. Stripe is what actually charges — the numbers in code
are display only. Run the `entitlements-auditor` agent after changing either.

> **Naming footgun:** the checkout API and `TIERS` use `proAi`; the database, the webhook, the
> extension and `PRICING_TIERS` use `pro_ai`. `PricingCard.tsx` normalizes between them. Never
> send `pro_ai` to `/api/checkout` (400 `Invalid tier`) or write `proAi` to the DB (fails the
> `tier` CHECK constraint).

**AI credit packs** (one-time, `mode: 'payment'`): quantity 50–500 credits, clamped server-side
and on Stripe's page (`adjustable_quantity`). Credits are month-scoped (no rollover).
TODO (owner): confirm the credit-pack price — `packages/web/.env.example` says "$2.99 for +50 AI
calls" while code comments assume $0.05/credit ($2.50 for 50); only the Stripe price is authoritative.

---

## Environment variables (web, per environment)

| Var | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | API key. Missing → build still succeeds, but every Stripe operation throws `Stripe is not configured` (`isStripeConfigured`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of **this environment's** webhook endpoint. |
| `STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_YEARLY_PRICE_ID` | Pro recurring prices. |
| `STRIPE_PRO_AI_MONTHLY_PRICE_ID`, `STRIPE_PRO_AI_YEARLY_PRICE_ID` | Pro AI recurring prices. |
| `STRIPE_AI_CREDIT_PACK_PRICE_ID` | One-time per-credit price for credit packs. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Publishable key. |
| `NEXT_PUBLIC_APP_URL` | Base for every Stripe redirect URL (see below). |
| `NEXT_PUBLIC_AI_ENABLED` | AI coming-soon flag (see below). |

Price IDs are mode-specific: preview and local use **test-mode** keys and test-mode price IDs;
production uses live ones. The price IDs are also the webhook's only way to map a subscription to a
tier, so a price ID that isn't in these vars resolves to `free`.

> The repo-root `.env.example` still lists `STRIPE_PRICE_PRO_MONTHLY` etc. — those names are not
> read by any code. Use the names above (as in `packages/web/.env.example`).

---

## Checkout flow

```text
PricingCard → POST /api/checkout { tier: 'pro' | 'proAi', interval: 'monthly' | 'yearly' }
  1. Supabase cookie session required            → 401 otherwise
  2. tier / interval validated                    → 400
  3. tier === 'proAi' && AI flag off              → 503 { error: 'ai_disabled' }   (no Stripe call)
  4. price ID from env via getStripePriceId()     → 500 'Price ID not configured' if unset
  5. stripe.checkout.sessions.create(mode: 'subscription',
       customer = profiles.stripe_customer_id ?? customer_email,
       metadata.user_id AND subscription_data.metadata.user_id)
  → { url }  (client navigates to Stripe)
  success → /dashboard?upgraded=1   cancel → /pricing
```

Credit packs: `BuyCreditsButton` → `POST /api/checkout/credits { quantity? }` → auth (401) → AI
flag off → 503 `ai_disabled` → session with `metadata: { user_id, type: 'ai_credit_pack' }`.
Success → `/dashboard?credits=1`, cancel → `/dashboard`.

Downgrades from the pricing page go to `/api/billing-portal`, never `/api/checkout`.

### Redirect URLs

All success/cancel/portal-return URLs come from `absoluteUrl()` in `packages/web/lib/utils.ts`:

- Reads **only** `NEXT_PUBLIC_APP_URL`. No `VERCEL_URL` fallback, and never the request's
  `Host`/`x-forwarded-host` (open-redirect surface).
- Validated: absolute `http(s)` origin only — no whitespace/quotes, userinfo, path, query or hash.
- Fails closed: missing or invalid → throws, so the route returns 500 rather than handing Stripe a
  bad URL.
- Values: production `https://tabmerger.vercel.app`; preview `https://tabmerger-preview.vercel.app`
  (fixed alias that `.github/workflows/deploy-web.yml` re-points at each preview deploy); local
  `http://localhost:3000`.

### Billing portal

| Entry point | Route / call | Auth | Return URL |
| --- | --- | --- | --- |
| Account page "Manage billing" link | `createBillingPortalSession` in the server component | cookie | `/account` |
| Pricing page downgrade | `POST /api/billing-portal` | cookie | `/dashboard` |
| Extension Settings | `POST /api/portal` | Bearer JWT | `/dashboard` |

Both routes need `profiles.stripe_customer_id` (400 / 404 respectively when absent).

---

## Webhook (`/api/webhooks/stripe`)

- **Must read `req.text()`** and pass the raw string to `stripe.webhooks.constructEvent`. Parsing
  JSON first breaks signature verification. Missing header or bad signature → 400.
- Uses the service-role Supabase client (no user session).

Events handled (the `switch`):

| Event | Effect |
| --- | --- |
| `checkout.session.completed` | `mode: 'payment'` + `metadata.type === 'ai_credit_pack'` → insert `ai_credit_purchases` (quantity from `listLineItems`; idempotent on unique `stripe_checkout_session_id`, 23505 ignored). `mode: 'subscription'` → retrieve subscription, resolve user (`subscription.metadata.user_id` → `session.metadata.user_id` → profile by `stripe_customer_id`), save `stripe_customer_id` on the profile, upsert subscription, fire GA4 `checkout_completed` (no-op without `GA_API_SECRET`). |
| `customer.subscription.updated` | Profile by customer ID → upsert subscription. |
| `customer.subscription.deleted` | `status = 'canceled'`, `tier = 'free'` (matched on `subscriptions.id`). |
| `invoice.payment_failed` | `status = 'past_due'` (matched on `user_id`). |

Anything else is ignored with 200.

**Upsert uses `onConflict: 'user_id'`.** `handle_new_user()` pre-creates a `free_<uuid>` row for
every signup and migration 012 makes `user_id` unique, so the first purchase must rewrite that row
(its `id` becomes the Stripe subscription ID). Conflicting on `id` would 23505 and leave the user on
free. Written columns: `id, user_id, tier, status, stripe_price_id, cancel_at_period_end,
current_period_end` (from the subscription **item**), `updated_at`.

### Known gap: 200 without an upgrade

The handler returns 200 (so Stripe shows the delivery as successful and does not retry) when:

- the price ID matches none of the four env vars → tier silently resolves to `free`;
- the Supabase upsert fails → only `console.error('upsertSubscription error:', …)`. This includes a
  Stripe status outside the DB CHECK list (`active, canceled, past_due, trialing, incomplete`), e.g.
  `unpaid`, `paused`, `incomplete_expired`;
- the user or profile can't be resolved (logged for `checkout.session.completed`, silent for the
  other three events);
- a credit-pack insert fails with anything other than 23505, or lacks `metadata.user_id`.

Only a thrown error (e.g. the Stripe API call inside the handler failing) returns 500. When a
customer paid but didn't upgrade, check the Vercel function logs for these messages — Stripe's
dashboard will show green.

---

## Per-environment setup

Each environment (production, preview, local) needs its **own** Stripe webhook destination:

1. Stripe Dashboard (live mode for production, **test mode** for preview) → Webhooks → add endpoint
   `<NEXT_PUBLIC_APP_URL>/api/webhooks/stripe`, e.g.
   `https://tabmerger-preview.vercel.app/api/webhooks/stripe`.
2. Subscribe it to `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`.
3. Put that endpoint's signing secret in the environment's `STRIPE_WEBHOOK_SECRET` (Vercel env var
   for that environment), alongside the matching-mode `STRIPE_SECRET_KEY` and price IDs.
4. Redeploy (`NEXT_PUBLIC_*` values are inlined at build time).

A preview without its own test-mode endpoint never upgrades anyone: checkouts succeed on Stripe,
the webhook is never delivered, and the user stays on `free`. This has happened. Verify with
Stripe → Webhooks → the endpoint's delivery log after a test checkout.

**Local dev:** use the Stripe CLI instead of a dashboard endpoint and put the `whsec_…` it prints in
`packages/web/.env.local`:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Test card `4242 4242 4242 4242`, any future expiry, any CVC. Useful triggers:
`stripe subscriptions cancel sub_…`, or the Billing Portal.

TODO (owner): record which Stripe account/mode and endpoint IDs back production and preview.

### Switching between monthly and yearly

The current plan's card on `/pricing` offers "Switch to yearly/monthly billing". It calls
`POST /api/billing/switch-interval`, which opens the Billing Portal directly on Stripe's "confirm
plan change" page for the same plan at the other interval. The `customer.subscription.updated`
webhook records the new price when it takes effect; the route never writes the subscription row.

Timing (a product decision, 2026-09-28):

- **Monthly → yearly** applies immediately. Stripe charges the yearly price minus credit for the
  unused part of the month (`always_invoice`), and the new term starts that day.
- **Yearly → monthly** waits for the end of the paid year (`schedule_at_period_end` condition
  `shortening_interval`). Stripe attaches a subscription schedule; while it's pending, another
  switch returns 409 "A billing change is already scheduled…", shown on the card.

**Each mode's portal configuration must list the plan's prices**, or Stripe rejects the session
("configuration … does not include the price in its `features[subscription_update][products]`")
and the button shows "Couldn't start the switch". Listing them also gives **Manage billing** its
own "Update subscription" option with both intervals. In Dashboard → Settings → Billing →
Customer portal → Subscriptions, turn on "Customers can switch plans", add **TabMerger Pro** with
its monthly and yearly prices, set quantity changes off and prorations to invoice immediately,
and under "when to apply changes" choose end of billing period for changes that shorten the
billing interval.
Or, with the CLI:

```bash
stripe billing_portal configurations update <bpc_…> [--live] \
  -d "features[subscription_update][enabled]=true" \
  -d "features[subscription_update][default_allowed_updates][0]=price" \
  -d "features[subscription_update][default_allowed_updates][1]=promotion_code" \
  -d "features[subscription_update][proration_behavior]=always_invoice" \
  -d "features[subscription_update][schedule_at_period_end][conditions][0][type]=shortening_interval" \
  -d "features[subscription_update][products][0][product]=<Pro product>" \
  -d "features[subscription_update][products][0][prices][0]=<Pro monthly price>" \
  -d "features[subscription_update][products][0][prices][1]=<Pro yearly price>" \
  -d "features[subscription_update][products][0][adjustable_quantity][enabled]=false"
```

List only products that are on sale: while AI is "coming soon", leave **Pro AI** out, or the portal
would let a Pro customer upgrade to it. Add it (both prices) when AI launches. Test mode's default
configuration was set up this way on 2026-09-28. `STRIPE_PORTAL_CONFIGURATION_ID` (optional) makes
the switch use a different configuration than the account default.

---

## AI flag and payments

While `NEXT_PUBLIC_AI_ENABLED` is anything other than the exact string `"true"` (unset = off):

- `/api/checkout` rejects `tier: 'proAi'` at **both** intervals, and `/api/checkout/credits` rejects
  every request, with `503 { error: 'ai_disabled' }` — after the auth check, before any Stripe call.
- The pricing UI still shows the Pro AI card and its price, but `PricingCard.tsx` disables the
  button and labels it "Coming soon" (`AI_COMING_SOON_LABEL`); the landing-page
  `PricingTeaser.tsx` shows a "Coming soon" badge on the Pro AI card.
- Existing `pro_ai` rows are untouched; the extension and AI routes simply don't expose AI.

Details and how to turn it on: [AI_FEATURES.md](AI_FEATURES.md#coming-soon-flag).

---

## Entitlements

**Extension** — `useEntitlements()` reads `subscriptions` (`tier, status, cancel_at_period_end,
current_period_end, stripe_price_id`) for the signed-in user, polling every 30 s (no Realtime).

- Signed out, no row, query error, or `status === 'canceled'` → `free`.
- Otherwise `tier` maps to `TIER_LIMITS` (`packages/extension/src/lib/types.ts`):
  free = 5 groups / 50 tabs, no sync, no sessions; pro = unlimited + `cloudSync` + `sessions`;
  pro_ai = pro + `aiFeatures`.
- `past_due` / `trialing` / `incomplete` keep the paid tier in the extension.
- `aiFeatures` is **ANDed with the AI flag** (`VITE_AI_ENABLED`), so a real `pro_ai` subscriber
  sees no AI while the flag is off. Demo builds (`VITE_DEMO_BUILD=true`) get pro_ai limits, with
  `aiFeatures` still gated by the flag.
- The 5/50 limits are hard-coded in `TIER_LIMITS`; keep them equal to `FREE_TIER_LIMITS` in
  `packages/shared/src/constants/index.ts`.

**Server (AI routes)** — `checkAndIncrementAIUsage` in `packages/web/lib/ai-usage.ts` requires
`tier === 'pro_ai'` **and** `status === 'active'`. `trialing` and `past_due` do **not** get AI.

---

## Revenue tracking

Stripe Dashboard → Reports (MRR, churn, conversion). A server-side GA4 `checkout_completed` event
is sent from the webhook when `NEXT_PUBLIC_GA_MEASUREMENT_ID` and `GA_API_SECRET` are set.
