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
  4. caller's subscriptions row is on a paid tier
     with an entitled status                      → 409 { error: 'already_subscribed' } (no Stripe call)
  5. price ID from env via getStripePriceId()     → 500 'Price ID not configured' if unset
  6. stripe.checkout.sessions.create(mode: 'subscription',
       customer = profiles.stripe_customer_id ?? customer_email,
       metadata.user_id AND subscription_data.metadata.user_id,
       allow_promotion_codes: true)
  → { url }  (client navigates to Stripe)
  success → /dashboard?upgraded=1   cancel → /pricing
```

Credit packs: `BuyCreditsButton` → `POST /api/checkout/credits { quantity? }` → auth (401) → AI
flag off → 503 `ai_disabled` → session with `metadata: { user_id, type: 'ai_credit_pack' }`.
Success → `/dashboard?credits=1`, cancel → `/dashboard`.

### One subscription per account

An account holds one subscription. Checkout starts the first one; every later change (another
plan, another interval, cancelling) is made on that subscription in the Billing Portal.

- **Server rule.** `/api/checkout` reads the caller's `subscriptions` row with the caller's own
  cookie-scoped client (RLS lets a user select only their own row). If `tier` is not `free` and
  `status` passes `isEntitledSubscriptionStatus` from `@tabmerger/shared` (active, trialing,
  past_due), it answers `409 { error: 'already_subscribed' }` and creates no Checkout Session. If
  the row can't be read it answers 500, also without a Stripe call. The code is
  `ALREADY_SUBSCRIBED_ERROR` in `packages/web/lib/checkoutErrors.ts`, shared with the pricing card.
  The AI-flag check comes first, so `proAi` is still 503 `ai_disabled` while AI is off.
- **Pricing page.** `PricingCard` gets the user's plan from the page (`currentTier`, set only
  while the subscription is entitled). For a subscriber, every other paid card ("Upgrade to …" or
  "Downgrade to …") posts to `/api/billing-portal`, never `/api/checkout`; the current plan's card
  offers the interval switch (below). If checkout still answers 409 `already_subscribed` (a page
  loaded before the purchase, a second tab), the card shows "You already have a plan. Opening
  billing so you can change it." and opens the portal; if the portal can't be opened it points to
  **Manage billing** on the account page.
- **Credit packs are not subscriptions.** `/api/checkout/credits` doesn't apply this rule: a
  subscriber buys credits on top of their plan.
- A canceled subscription leaves the row on `free`, so the same account can check out again.
- **Pro → Pro AI** is a portal plan change like any other, so the portal configuration must offer
  Pro AI once AI launches (see [Switching between monthly and
  yearly](#switching-between-monthly-and-yearly)).

### Promotion codes

Both checkouts (subscription and credit pack) pass `allow_promotion_codes: true`, so Stripe's page
shows an "Add promotion code" field. Codes exist only in Stripe, separately in test and live mode:
the app doesn't know about them and the pricing page doesn't change. Stripe validates the code; the
webhook grants the tier from the subscription's price and credits from the line-item quantity, so
a discounted or free checkout grants exactly what a full-price one does.

To create a code (Dashboard → Products → Coupons → **+ New**, in the right mode):

1. **Coupon**: percentage or fixed amount (USD). Under **Apply to specific products** pick the
   product it's for (e.g. TabMerger Pro). Without that, the coupon also works on the credit pack.
2. **Duration**: "once" discounts only the first invoice. A multi-month or "forever" duration
   keeps discounting later invoices, including the prorated charge of a monthly → yearly switch
   made while the coupon is still running. Prefer "once" unless that is intended.
3. Turn on **Use customer-facing promotion codes**, enter the code, and set its limits: number of
   redemptions, expiry date, first-time order only, minimum order value.
4. Check it in test mode first: start a checkout, enter the code, pay with `4242 4242 4242 4242`.

Things to know:

- Stripe has no "once per customer" limit. A code with no redemption limit can be used again by
  the same customer; on the credit pack every use is a new pack of up to 500 credits. For
  credit-pack codes, set a redemption limit or restrict the code to one customer rather than
  relying on "first-time order only".
- A 100%-off code completes checkout without a charge. The subscription checkout still asks for a
  card and renewals charge full price once the coupon's duration ends; the credit pack asks for
  no card.
- The GA4 `checkout_completed` value is the list price, not the discounted amount.
- The Billing Portal has its own switches (Dashboard → Settings → Billing → Customer portal):
  **Use promotion codes** (enter a code when changing plan) and **Retention coupons** (an offer
  shown before cancelling). Stripe ships both off, and neither is affected by the checkout
  setting. Note that the CLI snippet under [Switching between monthly and
  yearly](#switching-between-monthly-and-yearly) turns the first one on.

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
| Pricing page, a subscriber choosing another plan (upgrade or downgrade) | `POST /api/billing-portal` | cookie | `/dashboard` |
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
| `checkout.session.completed` | `mode: 'payment'` + `metadata.type === 'ai_credit_pack'` → insert `ai_credit_purchases` (quantity from `listLineItems`; idempotent on unique `stripe_checkout_session_id`: 23505 is answered 200, any other insert error 500). `mode: 'subscription'` → retrieve subscription, resolve user (`subscription.metadata.user_id` → `session.metadata.user_id` → profile by `stripe_customer_id`), save `stripe_customer_id` on the profile, upsert subscription, fire GA4 `checkout_completed` (no-op without `GA_API_SECRET`). |
| `customer.subscription.updated` | Retrieve the subscription's current state from Stripe by the id in the event → resolve the user (order below) → upsert that state, unless the user's row does not track this subscription and it is not entitled (then nothing is written). The object embedded in the event is not written. |
| `customer.subscription.deleted` | `status = 'canceled'`, `tier = 'free'` on the row whose `subscriptions.id` is the event's subscription id. No user or profile lookup, no retrieve. |
| `invoice.payment_failed` | Retrieve the current state of the invoice's subscription from Stripe → write its status (`past_due` while Stripe retries the payment) on the row whose `subscriptions.id` is that id. No user or profile lookup; an invoice that bills no subscription changes nothing. |

Anything else is ignored with 200. A database error, or a failed read from Stripe, while one of
these is being recorded is answered with 500, so Stripe sends the event again (see "What the
handler answers").

**What is written is Stripe's current state.** Stripe does not deliver events in order and can
deliver one again much later, so the object embedded in an event may be older than what the row
already holds. An event therefore only says *which* subscription changed:

- `customer.subscription.updated` and `invoice.payment_failed` read the subscription from Stripe
  by that id (`retrieveCurrentSubscription()`, the same call a completed checkout makes) and write
  what it is now. A subscription that has ended is still returned, with status `canceled`, so an
  update that arrives after the cancellation writes the ended state again.
- `customer.subscription.deleted` needs no read: ending is final at Stripe, so it is correct
  whenever and however often it arrives.
- The id in the event stays the key. If Stripe answers with a different subscription, nothing is
  written (500). If Stripe has no subscription with that id (`resource_missing`), nothing is
  written and the event is answered 200 with the "matched no subscription row or user" line. If
  the read fails for any other reason, nothing is written (500): the embedded object is never
  used in its place.

One Stripe API call is made per `updated` and per `payment_failed` event.

**Which row an event changes.** After the first purchase the row's `id` is the Stripe subscription
id, and that id is the key:

- A cancellation or a failed payment is applied by subscription id, to that row only. The customer
  named in the event plays no part.
- An update needs a user for the upsert. `resolveSubscriptionUserId()` is given the subscription
  retrieved from Stripe (whose id is the event's), tries these in order and takes the first that
  resolves; a later key never overrides an earlier one:
  1. the `user_id` of the row already stored under the subscription id;
  2. `subscription.metadata.user_id` (stamped server-side by `createCheckoutSession`), used only
     when no row holds that subscription id yet, and only if it is shaped like a user id and a
     profile with that id exists;
  3. the profile whose `stripe_customer_id` is the subscription's customer.

  A lookup that fails with a database error is not a miss: the handler answers 500 and no weaker
  key is tried in its place.
- The upsert rewrites the user's one row, so a subscription that row does not track yet (the user
  was resolved by key 2 or 3, not key 1) may take the row over only while its status at Stripe is
  entitled (`isEntitledSubscriptionStatus`: active, trialing, past_due). That is how a new plan
  starts when its update arrives before the completed checkout. If it is not entitled, nothing is
  written and the event is answered with 200 and logged as `Stripe webhook: <event type> ignored:
  the subscription is not the one on record and its status is <status> (subscription <id>)`: an
  event about an ended or unpaid earlier subscription never replaces the plan the row holds. The
  subscription the row tracks (key 1) is written whatever its status.
- A completed checkout is not subject to that rule: the paid session itself says whose row the
  subscription belongs on. A cancellation and a failed payment only ever touch the row stored
  under their subscription id.
- An event that matches no row and no user is answered with 200 and logged as
  `Stripe webhook: <event type> matched no subscription row or user (subscription <id>)`. The line
  holds the event type and the subscription id only.

The invoice's subscription id is read from `parent.subscription_details.subscription`, or from a
top-level `subscription` on payloads of an older API version: an event's shape follows the API
version of the webhook endpoint, not of the SDK client.

**Upsert uses `onConflict: 'user_id'`.** `handle_new_user()` pre-creates a `free_<uuid>` row for
every signup and migration 012 makes `user_id` unique, so the first purchase must rewrite that row
(its `id` becomes the Stripe subscription ID). Conflicting on `id` would 23505 and leave the user on
free. Written columns: `id, user_id, tier, status, stripe_price_id, cancel_at_period_end,
current_period_end` (from the subscription **item**), `updated_at`.

### Stored statuses

`subscriptions.status` holds one of `STORED_SUBSCRIPTION_STATUSES` (`@tabmerger/shared`): `active,
canceled, past_due, trialing, incomplete`, the CHECK list on the column. Stripe has more statuses
than that (`unpaid`, `paused`, `incomplete_expired`, and any it adds later), so every write of
`status` in the handler goes through `toStoredState()`:

- `canceled` is always written with `tier = 'free'`. The status alone ends the entitlement
  (`isEntitledSubscriptionStatus`); the tier follows it so an ended plan is the same row whether a
  `customer.subscription.deleted` event or any other event reported it;
- any other stored status is written as is, with the tier of the subscription's price;
- a status that is not stored is written as `status = 'canceled'`, `tier = 'free'` (the same
  ended state) and logged as `Stripe webhook: <event type> status <status> is not a stored
  status; the row is written as canceled (subscription <id>)`.

The other columns still follow the subscription, and a later event that finds a stored status (a
paused subscription that resumes, an unpaid one that is paid) writes the plan back.

### What the handler answers

**200** — Stripe shows the delivery as successful and does not send it again:

- the event was recorded;
- the price ID matches none of the four env vars → the row is written with tier `free`;
- no row or user matches the event (logged; see "Which row an event changes"), including a
  completed checkout whose user cannot be resolved and a credit pack without `metadata.user_id`;
- Stripe has no subscription with the id an update or a failed payment names (same log line);
- an update is for a subscription the user's row does not track and that is not entitled (logged
  as "ignored: the subscription is not the one on record");
- a credit pack that was already granted (23505 on `stripe_checkout_session_id`);
- an event type the handler does not handle.

**500** — Stripe sends the event again (with backoff, for up to three days in live mode):

- a database read or write fails while the event is being recorded: any lookup in
  `resolveSubscriptionUserId()`, the update by subscription id, the subscription upsert, the
  profile lookup or the `stripe_customer_id` write of a completed checkout, or a credit-pack insert
  with an error other than 23505. Logged as one line: `Stripe webhook: <event type> <step> failed
  (subscription <id>, code <database error code>)`, followed by the database's message for a
  write. The line never holds the error's details, the payload, metadata or an email;
- the subscription cannot be read from Stripe (network, a 5xx, a rate limit), Stripe answers with
  a different subscription, or a completed checkout's subscription is not found. Logged as one
  line, e.g. `Stripe webhook: <event type> subscription retrieve failed (subscription <id>,
  <Stripe error type>, status <HTTP status>)`, without the error object;
- any other call inside the handler throws, e.g. listing a credit pack's line items (logged as
  `Webhook handler error:`).

Every handler leaves the same result when its event is delivered twice: the updates are keyed on
the subscription id, the upsert conflicts on `user_id`, an update, a failed payment and a
completed checkout read the subscription from Stripe again before writing, and a credit pack is
inserted once per session id. For one subscription the order of delivery does not matter either:
whichever of its events is handled last writes the state Stripe has then, or the ended state.

When a customer paid but didn't upgrade, check the Vercel function logs for these lines. A 200
with a "matched no subscription row or user" line or an unknown price shows green in Stripe's
dashboard; a 500 shows there as a failed delivery, which can also be resent by hand.

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

The `default_allowed_updates[1]=promotion_code` line is the API form of the Dashboard's **Use
promotion codes** switch: with it, a customer can enter a promotion code in the portal when
changing plan. Leave that line out (or turn the switch off) to accept codes at checkout only.

List only products that are on sale: while AI is "coming soon", leave **Pro AI** out, or the portal
would let a Pro customer upgrade to it. Add it (both prices) when AI launches. Test mode's default
configuration was set up this way on 2026-09-28. `STRIPE_PORTAL_CONFIGURATION_ID` (optional) makes
the switch use a different configuration than the account default.

**When AI launches**, the portal is the only way from Pro to Pro AI (see [One subscription per
account](#one-subscription-per-account)), so in each mode:

1. Add **TabMerger Pro AI** with its monthly and yearly prices to the configuration's products
   (`features[subscription_update][products][1]…`), next to Pro.
2. Do it on the account's **default** configuration: the pricing page's plan-change button and
   **Manage billing** open the portal through `createBillingPortalSession`, which uses the default.
   Only the interval switch reads `STRIPE_PORTAL_CONFIGURATION_ID`.
3. Expect Pro AI → Pro to apply immediately, with proration: Stripe's portal can defer a change
   to the end of the period only between prices of the same product, and these are two products.
4. Set `STRIPE_PRO_AI_MONTHLY_PRICE_ID` / `STRIPE_PRO_AI_YEARLY_PRICE_ID` in that environment, or
   the webhook maps the new price to `free`.

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

- Only a status in `ENTITLED_SUBSCRIPTION_STATUSES` (`active`, `trialing`, `past_due`; checked
  with `isEntitledSubscriptionStatus` from `@tabmerger/shared`) grants the paid tier. Any other
  status (`canceled`, `incomplete`, …), no row, a query error, or being signed out gives `free`,
  whatever the row's `tier` says.
- With an entitled status, `tier` maps to `TIER_LIMITS` (`packages/extension/src/lib/types.ts`):
  free = 5 groups / 50 tabs / 3 URL rules, no cloud sync; pro = unlimited + `cloudSync` +
  `sessions`; pro_ai = pro + `aiFeatures`. A `tier` that is neither `pro` nor `pro_ai` is `free`.
- Sessions: free keeps up to 3 saved sessions, in the browser only (`FREE_TIER_LIMITS.sessions`,
  enforced in `useSessions`). The `sessions` entitlement of the paid tiers lifts that cap, and
  their `cloudSync` entitlement is what uploads sessions so they sync across devices.
- `aiFeatures` is **ANDed with the AI flag** (`VITE_AI_ENABLED`), so a real `pro_ai` subscriber
  sees no AI while the flag is off. Demo builds (`VITE_DEMO_BUILD=true`) get pro_ai limits, with
  `aiFeatures` still gated by the flag.
- The numbers are not written in `TIER_LIMITS`: it reads `FREE_TIER_LIMITS` and
  `UNLIMITED_TIER_LIMITS` from `packages/shared/src/constants/index.ts`, the single source for
  enforcement and pricing copy.

**Server (AI routes)** — `checkAndIncrementAIUsage` in `packages/web/lib/ai-usage.ts` requires
`tier === 'pro_ai'` **and** `status === 'active'`. `trialing` and `past_due` do **not** get AI.

---

## Revenue tracking

Stripe Dashboard → Reports (MRR, churn, conversion). A server-side GA4 `checkout_completed` event
is sent from the webhook when `NEXT_PUBLIC_GA_MEASUREMENT_ID` and `GA_API_SECRET` are set.
