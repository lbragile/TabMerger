# Payments & Subscriptions

Stripe Checkout (hosted) + Stripe Billing Portal, synced into Supabase by one webhook.
Authoritative code:

| Concern | File |
| --- | --- |
| Stripe client, checkout/portal session creation | `packages/web/lib/stripe.ts` |
| Tier display prices + env-var price IDs | `packages/web/lib/tiers.ts` (`TIERS`, `getStripePriceId`, `getPriceInfo`, `getPlanForPriceId`) |
| Managed AI allowance from a subscription | `packages/web/lib/aiAllowance.ts` (`subscriptionAiColumns`) |
| Plan switch (interval, Pro AI option) | `packages/web/lib/planSwitch.ts`, `app/api/billing/switch-interval`, `app/api/billing/switch-plan` |
| One-off allowance re-sync | `packages/web/scripts/resync-ai-allowance.ts` (`lib/aiAllowanceResync.ts`) |
| Subscription checkout | `packages/web/app/api/checkout/route.ts` |
| AI credit-pack checkout | `packages/web/app/api/checkout/credits/route.ts` |
| Billing portal (web, cookie auth) | `packages/web/app/api/billing-portal/route.ts` |
| Billing portal (extension, Bearer JWT) | `packages/web/app/api/portal/route.ts` |
| Webhook | `packages/web/app/api/webhooks/stripe/route.ts` |
| Redirect base URL | `packages/web/lib/utils.ts` (`absoluteUrl`) |
| Extension entitlements | `packages/extension/src/hooks/useEntitlements.ts`, `TIER_LIMITS` in `packages/extension/src/lib/types.ts` |
| Schema | `supabase/migrations/001` (subscriptions + `handle_new_user()`), `005` (lifecycle columns), `012` (unique `user_id`), `014` (`ai_credit_purchases`), `022` (`ai_mode`, `ai_monthly_credits`, credit reserve/settle) |

---

## Tiers and prices

| Tier | Monthly | Yearly | DB `subscriptions.tier` | Checkout wire value |
| --- | --- | --- | --- | --- |
| Free | $0 | $0 | `free` | — |
| Pro | $3.99 | $42.99 | `pro` | `pro` |
| Pro AI (TabMerger's key, `managed`) | $7.99 | $85.99 | `pro_ai` | `proAi` (+ `aiMode: 'managed'`, the default) |
| Pro AI (own AI provider key: Anthropic, OpenAI or Google, `byok`) | $5.99 | $64.49 | `pro_ai` | `proAi` + `aiMode: 'byok'` |

Pro AI's two options share the tier `pro_ai` (every entitlement check stays the same);
`subscriptions.ai_mode` says which one, and only AI metering branches on it. The webhook derives
both from the subscription's Price. The yearly toggle badge (`YEARLY_DISCOUNT_PERCENT`) is the
smallest saving of every paid option: 10% (the own-key yearly $64.49 is 10.3% off twelve months).

Display prices live in **two** places that must match each other and the Stripe prices:
`TIERS` in `packages/web/lib/tiers.ts` (what the pricing page renders) and `PRICING_TIERS` in
`packages/shared/src/constants/index.ts`. Stripe is what actually charges — the numbers in code
are display only. Run the `entitlements-auditor` agent after changing either.

> **Naming footgun:** the checkout API and `TIERS` use `proAi`; the database, the webhook, the
> extension and `PRICING_TIERS` use `pro_ai`. `PricingCard.tsx` normalizes between them. Never
> send `pro_ai` to `/api/checkout` (400 `Invalid tier`) or write `proAi` to the DB (fails the
> `tier` CHECK constraint).

**AI credit packs** (one-time, `mode: 'payment'`): quantity 50–500 units of a $0.05 Price
($2.50–$25), clamped server-side and on Stripe's page (`adjustable_quantity`). The credits granted
are not the quantity: the webhook converts the USD amount actually paid with `creditsForPayment()`
from `@tabmerger/shared` (1 credit = $0.001 of AI cost, at most 40% of the payment after fees):
$2.50 → 820 credits, $25 → 9,280. Credits are month-scoped (no rollover). Own-key (BYOK)
subscribers can't buy packs (409 `credits_not_applicable`). Packs are never refunded (see
[Refund policy](#refund-policy)).

**Managed AI allowance** (`subscriptions.ai_monthly_credits`): written by the webhook on every
subscription write with `subscriptionAiColumns()` (`lib/aiAllowance.ts`): the smaller of
`PRO_AI_MONTHLY_CREDITS` (2,600) and `creditsForPayment(what the subscription pays per period, months)`.
"What it pays" is the Price's USD list price (PRICING_TIERS) less the discounts applying to its next
invoices (item, then subscription, else the customer's; `percent_off`, or `amount_off` in USD; any
other discount counts as 100% off and is logged), and never more than the latest invoice actually
charged after discounts (a "once" coupon is gone from the subscription once the first invoice is
finalized). 0 for BYOK, trials, and any tier other than `pro_ai`.

---

## Refund policy

All purchases are non-refundable, except that a change which extends or raises a plan is charged
prorated. The terms page (section 3, `app/[locale]/(marketing)/terms/page.tsx`) states the same
for customers.

| Event | When it takes effect | Money |
| --- | --- | --- |
| Cancel | End of the paid period (access continues until then) | No refund, no proration credit |
| Upgrade or extension: monthly → yearly, Pro → Pro AI, own key → managed | Now, once the customer confirms on Stripe's portal page | Prorated charge against the unused time (`always_invoice`) |
| Downgrade or shortening: yearly → monthly, Pro AI → Pro, managed → own key | End of the paid period | No refund, no credit for unused time |
| AI credit pack | At purchase | Never refunded, including when the subscription is cancelled; unused credits are never paid out |

Where each rule is enforced:

- **Cancelling** happens only in the Billing Portal, whose configurations must cancel at period
  end without prorations (`features[subscription_cancel][mode]=at_period_end`,
  `features[subscription_cancel][proration_behavior]=none`; see [Portal
  configuration](#portal-configuration)). No server code cancels a subscription or issues a
  refund: the webhook only reads from Stripe, and account deletion doesn't exist as a route.
- **Plan changes** go through `/api/billing/switch-plan` and `/api/billing/switch-interval`.
  `classifyPlanChange()` in `lib/tiers.ts` names the change, `planChangeTiming()` in
  `lib/planChangeTiming.ts` picks the timing and `createPlanSwitchSession()` in `lib/stripe.ts`
  applies it (see [Plan changes and timing](#plan-changes-and-timing)). The
  server, not the portal configuration, decides that a downgrade waits.
- **Credit packs**: the credits checkout shows `CREDIT_PACK_REFUND_NOTICE` (`lib/stripe.ts`) next
  to the pay button (`custom_text.submit`). Nothing in the webhook or `lib/ai-usage.ts` calls
  Stripe refunds, credit notes or customer balance adjustments; a pack's credits only add to that
  month's AI cap.

**Decision: refund policy (2026-10-23).** All purchases (subscriptions and AI credit packs) are
non-refundable; a cancelled subscription that bought credit isn't refunded either. The one
exception is a change that extends duration or raises the plan: it is charged now, prorated
against the unused time. Everything that lowers or shortens a plan waits for the end of the paid
period, so unused time is never refunded or credited. Reason: managed AI credits are spent as
they are used, so refunding time after the period's credits are spent would break the rule that
AI cost stays within the share of each payment set aside for it.

Things to know:

- A refund still possible by hand in the Stripe Dashboard is a deliberate exception, not part of
  the flow. The terms say non-waivable refund rights under local law still apply.
- A subscription with a pending scheduled change can't be changed or cancelled in the portal
  (Stripe's limitation). To cancel before the change lands, release the schedule in the Dashboard
  (Subscriptions → the subscription → the schedule → Release), which keeps the current plan.

---

## Environment variables (web, per environment)

| Var | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | API key. Missing → build still succeeds, but every Stripe operation throws `Stripe is not configured` (`isStripeConfigured`). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of **this environment's** webhook endpoint. |
| `STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_YEARLY_PRICE_ID` | Pro recurring prices. |
| `STRIPE_PRO_AI_MONTHLY_PRICE_ID`, `STRIPE_PRO_AI_YEARLY_PRICE_ID` | Pro AI recurring prices (TabMerger's key). |
| `STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID`, `STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID` | Pro AI with the customer's own key ($5.99 / $64.49), on its own product "TabMerger Pro AI (own key)" (see [Own-key Prices and live-mode setup](#own-key-prices-and-live-mode-setup)). Must be active Prices. |
| `STRIPE_AI_CREDIT_PACK_PRICE_ID` | One-time $0.05-per-unit price for credit packs. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Publishable key. |
| `NEXT_PUBLIC_APP_URL` | Base for every Stripe redirect URL (see below). |
| `NEXT_PUBLIC_AI_ENABLED` | Managed Pro AI flag (AI on TabMerger's key); also turns on the own-key option (see below). |
| `NEXT_PUBLIC_AI_BYOK_ENABLED` | Own-key Pro AI flag: launches the own-key option alone, before managed AI (see below). |
| `AI_MOCK`, `AI_MOCK_SCENARIO` | Local development only (`packages/web/.env.local`): fake AI answers with real metering, no provider key needed. Ignored outside `next dev` and on Vercel; never set them in a Vercel environment. See [Mock AI in development](AI_FEATURES.md#mock-ai-in-development). |

Price IDs are mode-specific: preview and local use **test-mode** keys and test-mode price IDs;
production uses live ones. The price IDs are also the webhook's only way to map a subscription to a
tier, so a price ID that isn't in these vars resolves to `free`.

> The repo-root `.env.example` still lists `STRIPE_PRICE_PRO_MONTHLY` etc. — those names are not
> read by any code. Use the names above (as in `packages/web/.env.example`).

---

## Checkout flow

```text
PricingCard → POST /api/checkout { tier: 'pro' | 'proAi', interval: 'monthly' | 'yearly', aiMode?: 'managed' | 'byok' }
  1. Supabase cookie session required            → 401 otherwise
  2. tier / interval / aiMode validated           → 400 (aiMode: missing = managed; byok only with proAi)
  3. tier === 'proAi' && AI flag off              → 503 { error: 'ai_disabled' }   (no Stripe call)
  4. caller's subscriptions row is on a paid tier
     with an entitled status                      → 409 { error: 'already_subscribed' } (no Stripe call)
  5. price ID from env via getStripePriceId(tier, interval, aiMode) → 500 'Price ID not configured' if unset
  6. stripe.checkout.sessions.create(mode: 'subscription',
       customer = profiles.stripe_customer_id ?? customer_email,
       metadata.user_id AND subscription_data.metadata.user_id,
       metadata.tier / interval / ai_mode (analytics only),
       allow_promotion_codes: true)
  → { url }  (client navigates to Stripe)
  success → /dashboard?upgraded=1   cancel → [/<locale>]/pricing?checkout=canceled&tier=…&interval=… (counted once as checkout_canceled, then stripped)
```

Credit packs: `BuyCreditsButton` → `POST /api/checkout/credits { quantity? }` → auth (401) → AI
flag off → 503 `ai_disabled` → the caller's row is `pro_ai` with `ai_mode = 'byok'` → 409
`credits_not_applicable` (row unreadable → 500) → session with
`metadata: { user_id, type: 'ai_credit_pack' }` and the non-refundable notice as
`custom_text.submit.message` (`CREDIT_PACK_REFUND_NOTICE`, English, at most 1,200 characters).
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
- **Pro ↔ Pro AI** is a plan change on that subscription through `/api/billing/switch-plan`
  `{ tier }` (see [Plan changes and timing](#plan-changes-and-timing)), never a second checkout.

### Promotion codes

Both checkouts (subscription and credit pack) pass `allow_promotion_codes: true`, so Stripe's page
shows an "Add promotion code" field. Codes exist only in Stripe, separately in test and live mode:
the app doesn't know about them and the pricing page doesn't change. Stripe validates the code; the
webhook grants the tier from the subscription's price, so a discounted or free checkout gets the
same plan as a full-price one. AI credits follow the money: a discount lowers the managed monthly
allowance and a credit pack's credits in proportion, and a 100%-off code funds none.

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
  setting. Note that the plan-change configuration under [Portal
  configuration](#portal-configuration) turns the first one on.

### Redirect URLs

All success/cancel/portal-return URLs come from `absoluteUrl()` in `packages/web/lib/utils.ts`:

- Reads **only** `NEXT_PUBLIC_APP_URL`. No `VERCEL_URL` fallback, and never the request's
  `Host`/`x-forwarded-host` (open-redirect surface).
- Validated: absolute `http(s)` origin only — no whitespace/quotes, userinfo, path, query or hash.
- Fails closed: missing or invalid → throws, so the route returns 500 rather than handing Stripe a
  bad URL.
- Values: production `https://tabmerger.com`; preview `https://preview.tabmerger.com`
  (fixed alias that `.github/workflows/deploy-web.yml` re-points at each preview deploy); local
  `http://localhost:3000`.

### Billing portal

| Entry point | Route / call | Auth | Return URL |
| --- | --- | --- | --- |
| Account page "Manage billing" link | `createBillingPortalSession` in the server component | cookie | `/account` |
| Pricing page, a subscriber choosing another plan (upgrade or downgrade) | `POST /api/billing-portal` | cookie | `/dashboard` |
| Extension Settings | `POST /api/portal` | Bearer JWT | `/dashboard` |

Both routes need `profiles.stripe_customer_id` (400 / 404 respectively when absent). These
sessions use the account's **default** portal configuration, which offers no plan switching (see
[Portal configuration](#portal-configuration)): a subscriber changing plan from the pricing page
should call `/api/billing/switch-plan { tier }` instead of `/api/billing-portal`.

---

## Webhook (`/api/webhooks/stripe`)

- **Must read `req.text()`** and pass the raw string to `stripe.webhooks.constructEvent`. Parsing
  JSON first breaks signature verification. Missing header or bad signature → 400.
- Uses the service-role Supabase client (no user session).

Events handled (the `switch`):

| Event | Effect |
| --- | --- |
| `checkout.session.completed` | `mode: 'payment'` + `metadata.type === 'ai_credit_pack'` → insert `ai_credit_purchases` (credits = `creditsForPayment(USD paid)`: `currency_conversion.amount_total` when `source_currency` is usd, else `amount_total` when `currency` is usd, else 0 and a log line; idempotent on unique `stripe_checkout_session_id`: 23505 is answered 200, any other insert error 500). `mode: 'subscription'` → retrieve subscription, resolve user (`subscription.metadata.user_id` → `session.metadata.user_id` → profile by `stripe_customer_id`), save `stripe_customer_id` on the profile, upsert subscription, fire GA4 `checkout_completed` and `purchase` after the response (`after()`; random `client_id` per event; `transaction_id` = HMAC of the session id keyed with `STRIPE_WEBHOOK_SECRET`; no `user_id`; no-op without `GA_API_SECRET`). |
| `checkout.session.expired` | Analytics only, after the response: `mode: 'subscription'` with a uuid `metadata.user_id` → GA4 `checkout_abandoned` (tier/interval from session metadata, re-validated; random `client_id`; no `user_id` sent). No database or Stripe call; always 200. See `docs/ANALYTICS.md`. |
| `customer.subscription.updated` | Retrieve the subscription's current state from Stripe by the id in the event → resolve the user (order below) → upsert that state, unless the user's row does not track this subscription and it is not entitled (then nothing is written). The object embedded in the event is not written. |
| `customer.discount.created`, `.updated`, `.deleted` | A coupon was applied, changed or removed (including a repeating one ending). The discount's subscription (or, for a discount on the customer, the Stripe subscription stored on the row of the profile holding that customer) is handled exactly like `customer.subscription.updated`, which rewrites `ai_monthly_credits`. No subscription found → 200 + the "matched no subscription row or user" line. |
| `customer.subscription.deleted` | `status = 'canceled'`, `tier = 'free'`, `ai_monthly_credits = 0` on the row whose `subscriptions.id` is the event's subscription id. No user or profile lookup, no retrieve. |
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
free. Written columns: `id, user_id, tier, status, ai_mode, ai_monthly_credits, stripe_price_id,
cancel_at_period_end, current_period_end` (from the subscription **item**), `updated_at`. The
subscription is read with `expand: discounts, items.data.discounts, latest_invoice, customer` so the
allowance can be priced; a coupon given only by id is read with `coupons.retrieve` (missing → counts
as 100% off; any other failure → 500).

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
   `https://preview.tabmerger.com/api/webhooks/stripe`. Endpoints already on the old
   `*.vercel.app` hosts can stay: those hosts serve the same deployment and keep `/api/*`.
2. Subscribe it to `checkout.session.completed`, `checkout.session.expired`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`,
   `customer.discount.created`, `customer.discount.updated`, `customer.discount.deleted`.
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

### Plan changes and timing

Every change to a paid subscription's price goes through one server function,
`startPlanSwitch()` in `lib/planSwitch.ts`, behind two routes:

- `POST /api/billing/switch-interval { interval }`: the current plan's card on `/pricing`
  ("Switch to yearly/monthly billing"). Keeps the tier and, for Pro AI, the option.
- `POST /api/billing/switch-plan { tier?, interval?, aiMode? }`: any other change. A field left out
  keeps the current value; `tier` is the wire name (`pro` | `proAi`), and Pro → Pro AI without an
  `aiMode` is managed. `aiMode` for Pro is 403; a Pro AI option that isn't on sale is 503
  `ai_disabled` (managed needs `NEXT_PUBLIC_AI_ENABLED`; own key either flag); Pro never depends on
  the flags.

Both look the Stripe subscription up among the current tier's Prices, then refuse with 409 when it
is already on the target price, when a change is already scheduled (`subscription.schedule` is set:
"A billing change is already scheduled for the end of this term."), or when it is set to cancel
("Your plan is set to end at the end of this term…"). None of them writes the subscription row:
`customer.subscription.updated` does, when the price actually changes. The one exception is the
ended-plan correction below, which only ever ends a row.

`classifyPlanChange()` (`lib/tiers.ts`) compares the current and target Price on three ranks (tier
Pro < Pro AI, option own key < managed, interval monthly < yearly). `planChangeTiming()`
(`lib/planChangeTiming.ts`, pure and client-safe) turns that into the timing, and both
`createPlanSwitchSession()` (`lib/stripe.ts`) and the pricing page's confirmation dialog use it, so
what the dialog promises is what the server does:

| Change | Timing | How | Route answers |
| --- | --- | --- | --- |
| Nothing lower or shorter: monthly → yearly, Pro → Pro AI (either option), own key → managed, or several of these | `portal` | Billing Portal "confirm plan change" flow. The customer confirms on Stripe's page, which shows the amount and the card; the prorated difference is charged now (`always_invoice`). The pricing page shows no dialog of its own. | `{ url }` (Stripe page) |
| Only the interval shortens (yearly → monthly) on the same plan and option | `portal_end_of_period` | Same flow; the configuration's `shortening_interval` condition defers it to the end of the term (all of a plan option's Prices are on one product) | `{ url }` |
| The tier or option goes down (Pro AI → Pro, managed → own key), or the interval shortens together with another change | `end_of_period` | Subscription schedule: `subscriptionSchedules.create({ from_subscription })`, then `update` with `end_behavior: 'release'`, `proration_behavior: 'none'`, the current phase passed back unchanged (items, start/end, discounts, tax rates, metadata) and a next phase on the new price with `proration_behavior: 'none'` and a `duration` of one interval. If the update fails, the schedule is released again. | `{ applied: 'end_of_period', effectiveAt (ISO), url: /account }` |
| A price this environment doesn't know | `end_of_period` | (fails closed: nothing is charged or credited now) | as above |

The pricing page confirms only the `end_of_period` and `portal_end_of_period` changes in its own
dialog ("changes on {date}, no refund"); an upgrade goes straight to Stripe's page. Before any of
this, `createPlanSwitchSession()` retrieves the target Price and refuses an archived one
(`price_unavailable`).

Why the server and not the portal decides downgrades:

- The portal defers a change only **between prices of one product**. Each plan option is its own
  product (Pro, Pro AI managed, Pro AI own key), so Pro AI → Pro and managed → own key cross
  products and would apply at once with a proration credit.
- Its `decreasing_item_amount` condition also fires when a subscription moves from a shorter to a
  longer interval that is cheaper in the long term (Stripe's documentation). Every yearly price here
  is cheaper than twelve months, so that condition would defer **monthly → yearly** too. Don't add
  it.
- The portal **can't list two Prices of one product with the same interval** (Stripe's portal
  limitations). That is why the own-key Prices are on their own product (**TabMerger Pro AI (own
  key)**), not on the managed Pro AI product.

**Errors.** Every error answer carries a `code` next to the English `error`
(`PLAN_SWITCH_ERROR_CODES` in `lib/checkoutErrors.ts`), and the pricing page shows a message per
code (`pricing.planChange.errors.*` in every locale): `no_billing_account` (400), `no_paid_plan`
(403), `already_on_price`, `already_scheduled`, `cancel_scheduled`, `pay_or_resume` (409), `price_unavailable`
(503: the Price isn't configured in this environment, or Stripe has it archived; logged with the
price), `switch_failed` (500: logged as one line with the Stripe error's type, code, param, HTTP
status, request id and message, never the error object). `503 { error: 'ai_disabled' }` keeps its
own message. Anything else shows "Couldn't start the switch".

**A row that still shows a plan Stripe has ended** (a missed or failed webhook delivery, e.g. a
cancel while `stripe listen` wasn't running) is corrected by the switch itself. When the customer
has no entitled subscription at Stripe at all (the whole list read: `subscriptions.list` without a
status leaves out canceled ones), `resyncEndedSubscription()` (`lib/subscriptionSync.ts`, the
webhook's retrieve, stored-state and update-by-id steps) writes the row's own subscription's state,
keyed on its id, only if that subscription is this customer's and not entitled, always with tier
`free`. It logs one line
(`Plan switch: corrected a row whose plan had ended at Stripe (subscription …: pro/active ->
free/canceled)`) and answers 403 `no_paid_plan` with `checkout: { tier, interval, aiMode? }`, the
plan asked for; the pricing page posts that to `/api/checkout` (which checks the row again) and
follows the URL. If one of the customer's subscriptions can still come back (`unpaid`, `paused`,
`incomplete`: `OPEN_SUBSCRIPTION_STATUSES` in `lib/stripe.ts`), the row is corrected the same way
but the answer is 409 `pay_or_resume` with no `checkout`: the customer pays or resumes it in Manage
billing, since a new checkout would leave two subscriptions billing once the old invoice is paid.
A live subscription on a price this deployment doesn't know is never treated as
ended (plain 403, no write, and `/api/checkout` still answers 409). A customer id Stripe doesn't
have (`resource_missing`, HTTP 400 on a list) is 400 `no_billing_account`, never a 500.

When a schedule's next phase starts, Stripe updates the subscription to that phase's price and
fires `customer.subscription.updated`; the webhook writes the new tier, `ai_mode` and
`ai_monthly_credits` from that price like any other update (tested in
`__tests__/stripeWebhookAiAllowance.test.ts`). Until then the row keeps the plan that was paid for.
Creating the schedule also fires an update (the subscription gains `schedule`); it rewrites the same
plan. A pending schedule blocks portal changes and cancellation (see [Refund
policy](#refund-policy)).

### Portal configuration

**1. Default configuration** (account page **Manage billing**, `/api/billing-portal`,
`/api/portal`, the no-code login link): payment methods, invoices and cancellation, **no plan
switching**. Decision: a configuration can't tell an upgrade from a downgrade across products, so
any product it lists could be reached from any other, at once and with a proration credit; plan
changes are made only through the routes above, where the server picks the timing. Set it in each
mode (Dashboard → Settings → Billing → Customer portal, or the CLI):

```bash
stripe billing_portal configurations update <default bpc_…> [--live] \
  -d "features[subscription_update][enabled]=false" \
  -d "features[subscription_cancel][enabled]=true" \
  -d "features[subscription_cancel][mode]=at_period_end" \
  -d "features[subscription_cancel][proration_behavior]=none"
```

In the Dashboard: Subscriptions → "Customers can switch plans" off; "Customers can cancel
subscriptions" on, "Cancel at end of billing period", and no prorations on cancellation.

**2. Plan-change configurations: made by the server, one per target Price.** Nothing to set up.
`planChangePortalConfiguration()` in `lib/stripe.ts` finds (by metadata
`tabmerger_plan_change: v1:<price id>`) or creates a configuration whose subscription updates list
**only the target Price** (`always_invoice`, `shortening_interval`, promotion codes allowed, no
quantity changes; cancellation at period end without proration), and caches its id in memory. They
show up in the Dashboard as "TabMerger plan change to price_… (v1)"; leave them. Bumping
`PLAN_CHANGE_CONFIGURATION_VERSION` makes new ones on the next switch.

Why one per target (the flow-escape finding, checked against Stripe's documentation on
2026-10-23):

- A deep-linked session (`flow_data: subscription_update_confirm`) only **hides** the rest of the
  portal: "Navigational components to access the rest of the customer portal are hidden". It is
  still a portal session of its configuration (`after_completion` only chooses where the customer
  goes after confirming: `redirect`, `hosted_confirmation` or `portal_homepage`), and sessions stay
  usable for up to an hour after the last activity. Stripe documents no way to lock a session to
  the confirm page.
- So a configuration that lists several plans would let a customer who reaches the generic "update
  plan" page pick a downgrade there, applied at once with a proration credit.
- With only the target Price listed, the only change such a session can make is the one the
  customer is confirming. After it, the subscription is on that Price and there is nothing left to
  switch to.
- Stripe doesn't need the subscription's **current** Price in the configuration for
  `subscription_update_confirm`: checked in test mode on 2026-10-23 (a Pro subscription → the
  own-key monthly Price, configuration listing only that Price: session created). An **archived**
  Price can't be listed at all ("Only active, per unit licensed prices are supported").

`STRIPE_PORTAL_CONFIGURATION_ID` is no longer read.

### Own-key Prices and live-mode setup

The own-key option is its own product, **TabMerger Pro AI (own key)**, with a $5.99 monthly and a
$64.49 yearly Price (matching `PRICING_TIERS`). In test mode it exists; the two own-key Prices that
used to sit on the managed Pro AI product are archived. The env vars must name the new Prices: a
switch to an archived Price is refused (`price_unavailable`), and before that refusal existed it
failed as "Couldn't start the switch".

Owner steps for **live mode** (and to re-check test mode):

1. Stripe (live) → Products → **+ Add product** "TabMerger Pro AI (own key)", with two recurring
   USD Prices: $5.99 / month and $64.49 / year (per unit, quantity 1).
2. If live own-key Prices exist on the managed Pro AI product, archive them (Prices can't be moved
   or deleted).
3. Put the new ids in `STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID` / `STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID`
   for production (and the test-mode ids for preview and `packages/web/.env.local`), then redeploy.
   A price id that isn't in these vars maps to `free` in the webhook.
4. Default portal configuration: plan switching off, cancellation at period end with no proration
   (command above).
5. Optionally remove `STRIPE_PORTAL_CONFIGURATION_ID` from each environment (unused).
6. In test mode, try Pro → Pro AI own key (Stripe's confirm page, charged prorated), own key →
   managed, and Pro AI → Pro (scheduled; the price changes at the period end).

### After deploying migration 022: re-sync existing allowances

Migration 022 adds `ai_mode` / `ai_monthly_credits` with defaults (`managed`, 0) and no backfill, so
an existing managed Pro AI subscriber has a 0 allowance until a Stripe event rewrites the row. Run
the re-sync once per environment after the migration **and** this code are deployed (it uses the
same `subscriptionAiColumns()` as the webhook and only writes rows whose values differ):

```bash
cd packages/web
# Dry run: prints counts and Stripe subscription ids only (no emails or user ids).
pnpm dlx tsx --env-file=<file with that environment's values> scripts/resync-ai-allowance.ts
# Then write:
pnpm dlx tsx --env-file=<same file> scripts/resync-ai-allowance.ts --apply
```

It needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (test mode for
preview, live for production) and the Pro AI price ids including the two BYOK ones. Exit code 2
lists rows that failed (Stripe or write errors): run it again.

Credit-pack rows: 022 converts the existing `ai_credit_purchases.credits` to the new unit once;
every pack granted by this webhook is already in the new unit.

---

## AI flags and payments

Two flags, each on only when it is the exact string `"true"` (unset = off), combined by
`aiAvailability(NEXT_PUBLIC_AI_ENABLED, NEXT_PUBLIC_AI_BYOK_ENABLED)` from `@tabmerger/shared` and
read on every request:

| | `managed` (TabMerger's key) | `byok` (own key) |
| --- | --- | --- |
| On when | `NEXT_PUBLIC_AI_ENABLED` | `NEXT_PUBLIC_AI_ENABLED` **or** `NEXT_PUBLIC_AI_BYOK_ENABLED` |
| `/api/checkout` `proAi` with that `aiMode` | sold | sold |
| `/api/checkout/credits` | sold (packs are managed-only) | — |
| `/api/billing/switch-plan`, `/api/billing/switch-interval` for a Pro AI subscription | allowed when the option switched to (or kept) is on | same |

So the own-key option can launch alone (`NEXT_PUBLIC_AI_BYOK_ENABLED=true`): own-key checkouts and
switches work, managed checkouts, switches to managed and credit packs answer
`503 { error: 'ai_disabled' }`. Every refusal comes after the auth check and before any Stripe call.
Pro checkouts and Pro interval switches never depend on either flag.

While neither option is on:

- `/api/checkout` rejects `tier: 'proAi'` at **both** intervals and either `aiMode`, and
  `/api/checkout/credits` rejects every request, with `503 { error: 'ai_disabled' }`.
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
