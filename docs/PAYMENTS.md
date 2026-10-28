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
$2.50 → 820 credits, $25 → 9,280. Credits are month-scoped (no rollover). Packs are sold only to
an account that can spend them, the AI routes' rule: `pro_ai` on an entitled status (`hasProAi()`:
active, trialing, past_due) with `ai_mode = 'managed'`. Anyone else (free, Pro, no row, Pro AI
incomplete/canceled/unpaid/paused) gets 403 `credits_not_available` (`CREDITS_NOT_AVAILABLE_ERROR`
in `lib/checkoutErrors.ts`); an entitled own-key (BYOK) subscriber gets 409
`credits_not_applicable`. Packs are never refunded (see [Refund policy](#refund-policy)).

**Managed AI allowance** (`subscriptions.ai_monthly_credits`): written by the webhook on every
subscription write with `subscriptionAiColumns()` (`lib/aiAllowance.ts`): the smaller of
`PRO_AI_MONTHLY_CREDITS` (2,500) and `creditsForPayment(what the subscription pays per period, months)`.
"What it pays" is the Price's USD list price (PRICING_TIERS) less the discounts applying to its next
invoices (item, then subscription, else the customer's; `percent_off`, or `amount_off` in USD; any
other discount counts as 100% off and is logged), and never more than the latest invoice actually
charged after discounts (a "once" coupon is gone from the subscription once the first invoice is
finalized). 0 for BYOK, trials, and any tier other than `pro_ai`.

A mid-period upgrade into managed (own key → managed, Pro → Pro AI managed, charged now with
proration) earns, until the next renewal, that allowance scaled by the time its invoice charged
for: the latest invoice is the upgrade's (`billing_reason: subscription_update`) and has a positive
proration line for the current price, whose period runs from the upgrade to the period end; that
span in months of the price's period (a month, or a twelfth of a year), capped at 1, is the share.
Measured on test clocks on 2026-10-26 (a 31-day period): 15 days left → 1,209 credits, 1 day left →
80, both for own key → managed and Pro → Pro AI; the renewal's `subscription_cycle` invoice brought
2,500 back. It is computed from the invoice and the current period, never the clock, so a
redelivered event or a later update in the same period writes the same figure. An upgrade that
restarts the period (monthly → yearly: a full charge, no proration line for the new price) gets the
full allowance. Credit packs are separate grants (`ai_credit_purchases`) and are unaffected.

On an upgrade's invoice the discount share ("never more than the latest invoice charged") is read
from the current price's own line (`discount_amounts` against its `amount`), not from the invoice's
subtotal, which nets the new charge against the old price's unused time: a coupon that discounts
only the new price would otherwise read as a much bigger share of that small net figure. On the
pinned API version Stripe applies the discount inside a proration line's `amount` and reports
`discount_amounts` of 0 there (test mode, 2026-10-26: a 20% managed-only coupon turned the 15-day
managed line from 387 into 310), so the subscription's own discounts price it: a 20% coupon gives
0.8 × the time share.

While a mid-period upgrade's invoice isn't `paid`, the share is 0; the next subscription write
(its status after a failed or retried payment, the renewal, a later update) re-reads the invoice.
Only a Dashboard or API update can change the price before payment: the portal's confirm page makes
a failed upgrade payment a **pending update** (test clock and a declining card, 2026-10-26). The old
price stays, the subscription stays `active` with `pending_update` set, and the latest invoice is
the open `subscription_update` invoice listing the new price; paying it applies the price
(`customer.subscription.pending_update_applied`, then `customer.subscription.updated` with the
invoice paid); unpaid, the update expires after about 23 hours and the invoice goes `void`. Because
that invoice charges nothing for the current price, it doesn't lower the allowance of the plan
already paid for.

The allowance is counted against usage per **UTC calendar month** (`ai_usage`), not per billing
period. So a share granted after a mid-period upgrade applies again as the cap of the next calendar
month when the renewal falls after that month starts (an upgrade on the 20th with renewal on the
10th: the share caps the rest of this month and again the 1st to the 10th). Bounded at about twice
the share before the renewal restores the full figure; accepted.

---

## Refund policy

All purchases are non-refundable, and no plan change ever leaves a refund or a credit. The only
proration is on a change that extends or raises a plan: it is charged now, with the unused time
of the old plan netted against the new charge. The terms page (section 3,
`app/[locale]/(marketing)/terms/page.tsx`) states the policy for customers.

| Event | When it takes effect | Money |
| --- | --- | --- |
| Cancel | End of the paid period (access continues until then) | No refund, no proration credit |
| Upgrade or extension: monthly → yearly, Pro → Pro AI, own key → managed | Now, once the customer confirms on Stripe's portal page | Prorated charge against the unused time (`always_invoice`) |
| Downgrade or shortening: yearly → monthly, Pro AI → Pro, managed → own key (with or without an interval change), own key → Pro | End of the paid period | No refund, no credit for unused time |
| AI credit pack | At purchase | Never refunded, including when the subscription is cancelled; unused credits are never paid out |

Where each rule is enforced:

- **Cancelling** happens only on Stripe's Billing Portal pages (the home page, or the cancel flow
  the account page opens while a plan change is scheduled), whose configurations must cancel at period
  end without prorations (`features[subscription_cancel][mode]=at_period_end`,
  `features[subscription_cancel][proration_behavior]=none`; see [Portal
  configuration](#portal-configuration)). No server code cancels a subscription or issues a
  refund: the webhook only reads from Stripe, and account deletion doesn't exist as a route.
- **Plan changes** go through `/api/billing/switch-plan` and `/api/billing/switch-interval`.
  `classifyPlanChange()` in `lib/tiers.ts` names the change, `planChangeTiming()` in
  `lib/planChangeTiming.ts` picks the timing and `createPlanSwitchSession()` in `lib/stripe.ts`
  applies it (see [Plan changes and timing](#plan-changes-and-timing)). The server decides the
  timing; a downgrade waits either because Stripe's confirm page defers it (the plan-change
  configuration's conditions) or because the server schedules it. The webhook's [plan-change
  alarm](#plan-change-alarm) logs any plan change that lowers a plan at once or leaves a credit.
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

**Decision: the portal defers cross-product downgrades (2026-10-26).** This replaces the earlier
decision of the same day that switched the Pro AI setup option (managed → own key) at once with a
balance credit. Each plan option stays its own Stripe product, and the plan-change portal
configuration (v2, now v3) uses both `schedule_at_period_end` conditions, `decreasing_item_amount` and
`shortening_interval`. Stripe's confirm page then defers every downgrade whose interval doesn't
shorten (Pro AI → Pro, managed → own key, own key → Pro, also with monthly → yearly) to the end of
the period, with no proration and no credit, while upgrades stay immediate and charged. Downgrades
that also shorten the interval stay on the server's own schedule. Consequences:

- Managed → own key keeps TabMerger's AI and its allowance until the period ends; the webhook
  writes `ai_mode = 'byok'`, `ai_monthly_credits = 0` when the price changes at the period end.
- This relies on behaviour Stripe doesn't document: its docs say the portal defers only between
  prices of one product. It was verified in test mode on 2026-10-26 on the real confirm page with
  test clocks (see [Plan changes and timing](#plan-changes-and-timing)). The webhook's [plan-change
  alarm](#plan-change-alarm) logs a change that lands at once or leaves a credit.
- Fallback if Stripe changes this: put all six Prices on one product, the documented case for the
  portal's deferral. Probed in test mode on 2026-10-26 (test product `prod_VW3tmXQ4COYzFc`): every
  same-interval downgrade was deferred, but a downgrade with a longer interval (Pro AI monthly →
  Pro yearly) applied at once within one product, so those would move to the server's schedule;
  the confirm page, Checkout and invoices would show only the product name plus the price; and
  `PLAN_PRICES` would have to map the legacy Price ids too. The other fallback is the server
  schedule for every downgrade, as before this decision (the dialog and timings already support
  it: `end_of_period`).

Things to know:

- A refund still possible by hand in the Stripe Dashboard is a deliberate exception, not part of
  the flow. The terms say non-waivable refund rights under local law still apply.
- A subscription with a pending scheduled change can't be changed or cancelled from the portal
  home (Stripe's limitation). Measured in test mode on 2026-10-26 for a portal-made and a
  server-made schedule: the home page (default configuration, cancellation on) lists the plan with
  "Plan updates on {date}" and the next amount, and shows no cancel control. A portal session
  created with `flow_data.type = subscription_cancel` for that subscription did work: its "Cancel
  plan" page released the schedule (status `released`, the current price kept) and set
  `cancel_at_period_end`. The account page opens that flow with its **Cancel subscription** button
  while a change is scheduled (see [Billing portal](#billing-portal)). By hand, the same is done in
  the Dashboard: release the schedule (Subscriptions → the subscription → the schedule → Release),
  which keeps the current plan, then cancel at period end.
- **Undoing a scheduled change** ("Keep my current plan" on the account page,
  `POST /api/billing/keep-current-plan`) releases the schedule and does nothing else: the
  subscription keeps its current price, period and discounts, and nothing is prorated, invoiced,
  charged or credited (verified on test clocks, see [Billing portal](#billing-portal)). Releasing
  unlocks the portal again, so its home page offers cancellation and plan changes as usual.

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
flag off → 503 `ai_disabled` → row unreadable → 500 → not `hasProAi()` (no entitled `pro_ai`) → 403
`credits_not_available` → `ai_mode = 'byok'` → 409 `credits_not_applicable` → session with
`metadata: { user_id, type: 'ai_credit_pack' }` and the non-refundable notice as
`custom_text.submit.message` (`CREDIT_PACK_REFUND_NOTICE`, English, at most 1,200 characters).
Success → `/dashboard?credits=1`, cancel → `/dashboard`.

### One subscription per account

An account holds one subscription. Checkout starts the first one; every later change (another
plan, another interval, cancelling) is made on that subscription in the Billing Portal.

- **Server rule.** `/api/checkout` reads the caller's `subscriptions` row with the caller's own
  cookie-scoped client (RLS lets a user select only their own row). If `tier` is not `free` and
  `status` passes `isEntitledSubscriptionStatus` from `@tabmerger/shared` (active, trialing,
  past_due), it answers `409 { error: 'already_subscribed', recorded: true }` and creates no
  Checkout Session. If the row can't be read it answers 500, also without a Stripe call. The codes
  are in `packages/web/lib/checkoutErrors.ts`, shared with the pricing card. The AI-flag check
  comes first, so `proAi` is still 503 `ai_disabled` while AI is off, before any Stripe call.
- **Stripe is asked too** (`checkStripeBeforeCheckout()`, `lib/checkoutGuard.ts`), because the row
  can be behind Stripe (a missed webhook delivery) and a row that says free must not sell a second
  subscription. When the profile has a `stripe_customer_id`, all of that customer's subscriptions
  that aren't canceled are listed (100 per page, at most 5 pages, more is a failure):
  - any entitled one (active, trialing, past_due, on any price): 409 `already_subscribed`. On a
    single price this deployment sells, it is read again by id and written to the row with the
    webhook's own upsert (`recordLiveSubscription()`, `lib/subscriptionSync.ts`), only if it is this
    customer's, still entitled, and its metadata names no other user; `recorded` says whether the
    row now shows it. On any other price nothing is written and one line is logged.
  - one that can come back (`unpaid`, `paused`, `incomplete`): 409 `pay_or_resume` (pay or resume it
    in Manage billing; a new one would bill next to it once paid).
  - the list can't be read: 503 `billing_check_failed`, logged with the Stripe error's type, code,
    status and request id. Nothing is sold (fail closed).
  - Stripe has no such customer (`resource_missing` with param `customer`, on the first page only):
    the stale id is dropped and Checkout makes a new customer (the completed webhook links it to the
    profile). No subscription can exist on a customer Stripe doesn't have, and profiles are
    server-managed, so refusing would lock the account out of buying for good. The plan switch
    treats the same answer the other way (400 `no_billing_account`, nothing written) because it can
    only change or end plans: there a wrong key or mode, which makes every customer look missing,
    must never end real plans, while checkout can only sell a new one. A `resource_missing` on a
    later page or for any other param (a bad cursor) fails closed with 503.
  - The profile read itself fails (anything but "no row"): 503 `billing_check_failed`, no Stripe
    call. Reading it as "no customer" would skip this check and sell on a new customer.
  - A live subscription written up to the row is read once more after the write; if it ended in
    between (a `customer.subscription.deleted` that matched no row yet), the row is written back
    down to free under that id.
  - No customer yet: nothing to ask.
- **Two tabs.** After a subscription Checkout Session is created for a customer, the customer's
  other open subscription-mode sessions are expired (`checkout.sessions.list({ customer, status:
  'open' })`, then `expire`), so only the newest can be paid. A session that can't be expired any
  more (Stripe answers 400) is read again: if it completed as a subscription, a plan went live
  during this checkout, so the new session is expired too and the answer is 409
  `already_subscribed` with no URL (the completed session's webhook records the plan). Any other
  failure is logged and the new checkout goes ahead. Credit-pack sessions are left alone. A first
  purchase has no customer yet, so two first checkouts in two tabs are not covered by this.
- **Pricing page.** `PricingCard` gets the user's plan from the page (`currentTier`, set only
  while the subscription is entitled). For a subscriber, every other paid card ("Upgrade to …" or
  "Downgrade to …") posts to `/api/billing-portal`, never `/api/checkout`; the current plan's card
  offers the interval switch (below). If checkout still answers 409 `already_subscribed` (a page
  loaded before the purchase, a second tab, a row the server just caught up from Stripe), the card
  says "You already have a plan. This page now shows it, so you can change it here." and refreshes
  the page when `recorded` is true; otherwise it shows "You already have a plan. Opening billing so
  you can change it." and opens the portal (pointing to **Manage billing** if that fails). 409
  `pay_or_resume` shows the pay-or-resume message; any other failure "Couldn't start checkout".
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
  setting. The plan-change configurations under [Portal configuration](#portal-configuration)
  keep codes off too (v3), so no code can be entered on the plan-change confirm page.

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
| Account page "Cancel subscription" (only while a plan change is scheduled) | `POST /api/billing/cancel-subscription` → `createCancelSubscriptionSession()` | cookie | `/account` |
| Account page "Keep my current plan" (only while a plan change is scheduled; no portal page) | `POST /api/billing/keep-current-plan` → `keepCurrentPlan()` | cookie | none (`router.refresh()`) |

**Cancelling while a plan change is scheduled.** The portal's home page shows no cancel control for
a subscription with a pending schedule. The account page reads the pending change from Stripe
(`getPendingPlanChange()`: the schedule's next phase, only for the caller's own customer) and shows
"Changes to {plan} on {date}" with a **Cancel subscription** button. The route takes no input: it
uses the caller's newest `subscriptions` row and checks at Stripe that the subscription belongs to
the caller's `profiles.stripe_customer_id` (404 `no_subscription` otherwise, also for an unknown
id); 409 `already_canceling` when it is already set to end, 409 `not_entitled` when it has ended,
400 `no_billing_account`, 500 `cancel_failed` (also when reading the profile or the row fails: a
failed read is logged as one line with its error code, never answered as "no billing account" or
"no subscription"). It opens a portal session with
`flow_data.type: subscription_cancel` on its own configuration (metadata `tabmerger_cancel: v1`,
found among the active configurations or created: cancellation `at_period_end` with
`proration_behavior: none`, no plan switching, payment methods and invoices) and
`after_completion` back to `/account`. Stripe's page is the confirmation; our server changes
nothing. Verified on test clocks on 2026-10-26 for a server-made schedule (Pro AI Y → Pro M) and a
portal-made one (managed M → own key M): confirming released the schedule, kept the current price
and set `cancel_at_period_end`; at the period end the subscription was `canceled` with no renewal
invoice, a customer balance of 0 and no credit notes. A second request answered
`already_canceling`; another customer's id was refused (`not_found`).

**Undoing a scheduled change ("Keep my current plan").** Next to **Cancel subscription** the account
page offers **Keep my current plan**, which cancels the scheduled change without a Stripe page (the
portal has no control for it either). `POST /api/billing/keep-current-plan` takes no input: like
the cancel route it uses the caller's newest `subscriptions` row and `profiles.stripe_customer_id`.
`keepCurrentPlan()` (`lib/stripe.ts`) retrieves the subscription again with `expand: ['schedule']`,
requires `subscription.customer` to be the caller's customer (else 404 `no_subscription`), reads
the pending change exactly as the notice does (`pendingChangeOf()`, shared with
`getPendingPlanChange()`), requires the schedule to name that subscription and customer, and then
calls `subscriptionSchedules.release(schedule.id)`, the only write. No id from the client is used.
Answers: `{ ok: true }`; 401; 400 `no_billing_account`; 404 `no_subscription`; 409
`no_scheduled_change` (nothing scheduled, already undone, already landed, or a schedule that isn't
this subscription's); 500 `keep_plan_failed` (a failed database read, logged with its code, or a
Stripe failure). A release that fails because the schedule was released meanwhile (a second tab:
Stripe answers 400 `invalid_request_error` with no `code`, "You cannot release a subscription
schedule that is currently in the `released` status") is detected by reading the subscription
again and answered 409. The button then refreshes the page: the notice is replaced by "Your plan
stays {plan}." (`ScheduledChangeNotice` stays mounted across the refresh), and the usual cancel
note returns because the portal home offers cancellation again. The webhook records the
`customer.subscription.updated` Stripe sends (`previous_attributes: schedule`; no price change, so
the plan-change alarm stays quiet).

Releasing changes nothing about money. Verified on test clocks on 2026-10-27 with a 10% `forever`
coupon on each subscription, for a portal-made deferral (Pro AI managed M → Pro M, confirmed on
Stripe's page; phases on `create_prorations`) and a server-made schedule (Pro AI Y → Pro M; phases
on `none`): after the release the schedule was `released` with `released_subscription` set, the
subscription had `schedule: null`, the same price, period and discount, no new invoice, no pending
invoice items and a customer balance of 0; the next-invoice preview was the current price
(Pro AI M $7.19, Pro AI Y $77.39 after the coupon). Past the period end each renewed with one
`subscription_cycle` invoice on the current price (same totals), balance 0. A second call answered
`no_scheduled_change`; another customer's subscription was refused (`not_found`).

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
| `customer.subscription.updated` | Retrieve the subscription's current state from Stripe by the id in the event → resolve the user (order below) → upsert that state, unless the user's row does not track this subscription and it is not entitled (then nothing is written). The object embedded in the event is not written. Then the log-only [plan-change alarm](#plan-change-alarm). |
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
`createPlanSwitchSession()` (`lib/stripe.ts`) and the client's plan-change flow (`usePlanChange`)
use it, so the step that confirms a change matches what the server does:

| Change | Timing | How | Route answers |
| --- | --- | --- | --- |
| Nothing lower or shorter: monthly → yearly, Pro → Pro AI (either option), own key → managed, or several of these | `portal` | Billing Portal "confirm plan change" flow. The customer confirms on Stripe's page, which shows the amount and the card; the prorated difference is charged now (`always_invoice`). Before the session is made, `invoices.createPreview` (the subscription, its item on the target price, `always_invoice`) prices that invoice: a total below zero is refused with 409 `switch_needs_support`, and a failed preview with 500 `switch_failed` (fails closed). The pricing page shows no dialog of its own. | `{ url }` (Stripe page) |
| Only the interval shortens (yearly → monthly) on the same plan and option | `portal_end_of_period` | Same flow; the configuration's `shortening_interval` condition defers it to the end of the term (all of a plan option's Prices are on one product) | `{ url }` |
| A downgrade whose interval doesn't shorten: Pro AI → Pro, managed → own key, own key → Pro (same interval, or monthly → yearly) | `portal_end_of_period` | Same flow to the target's product; the configuration's `decreasing_item_amount` condition makes the confirm page create a subscription schedule that changes the price at the period end (undocumented across products: see the matrix below and the [plan-change alarm](#plan-change-alarm)) | `{ url }` |
| The interval shortens together with another change (e.g. Pro yearly → Pro AI monthly, Pro AI yearly → Pro monthly) | `end_of_period` | Subscription schedule: `subscriptionSchedules.create({ from_subscription })`, then `update` with `end_behavior: 'release'`, `proration_behavior: 'none'`, the current phase passed back unchanged (items, start/end, discounts, tax rates, metadata) and a next phase on the new price with `proration_behavior: 'none'` that ends one second after it starts (`end_date` = period end + 1), as the portal's own deferred changes do, so the schedule releases the subscription right after the price changes. That phase carries the subscription's own discounts whose coupon applies to the target product (no `applies_to`, or one listing it); a coupon restricted to other products is dropped. If the update fails, the schedule is released again. | `{ applied: 'end_of_period', effectiveAt (ISO), url: /account }` |
| A price this environment doesn't know | `end_of_period` | (fails closed: nothing is charged or credited now) | as above |

The pricing page, the account page and the dashboard (all through `usePlanChange`) confirm only
the `end_of_period` changes in their own dialog ("changes on {date}, no refund"): the server
schedules those on the POST and no Stripe page follows. A change on a price this environment
doesn't sell is one of these (the client, like the server, can't classify it). Both portal timings
go straight to Stripe's confirm page, which is the confirmation step: it shows "Updates on {date}"
for a `portal_end_of_period` change (managed → own key included) and the prorated amount and the
card for an upgrade (own key → managed included). Before any of this, `createPlanSwitchSession()`
retrieves the target Price and refuses an archived one (`price_unavailable`).

While a change is already scheduled, the switch routes answer 409 `already_scheduled`, so the
pricing page doesn't offer one: it reads the pending change on the server
(`getCurrentPlan({ withPendingChange: true })` in `lib/currentPlan.ts`, which reuses
`getPendingPlanChange()` with the user's own `profiles.stripe_customer_id` and subscription; a
failed read counts as none). The card the change moves to (its plan, the interval on show and, for
Pro AI, the option on show) says "Starts {date}" in place of its button; every other change button
on the paid cards (other plans, "Switch to … billing", the Pro AI option switch) is replaced by a
note that points to the account page, where the change shows with **Keep my current plan** (undoes
it) and **Cancel subscription**. A target
price this environment doesn't sell gets the note on every card. The home page's teaser makes no
Stripe call (the option is off by default).

Which changes the portal defers and which the server schedules. Measured in test mode on
2026-10-26 (API 2025-06-30.basil): a per-target configuration with `always_invoice` and the
conditions `[decreasing_item_amount, shortening_interval]`, the real confirm page clicked in a
headless browser (no API submits a portal session), then a test clock advanced past the period end.
Prices: Pro $3.99 / $42.99, Pro AI $7.99 / $85.99, own key $5.99 / $64.49, each option its own
product. Pro AI M → own key M and own key M → Pro Y were run again through the app's own
`createPlanSwitchSession()` with the v2 configuration (v3 differs only in having no promotion
codes): both deferred and landed, and the
landing `customer.subscription.updated` still had the schedule attached.

| From → to | Portal result | Timing |
| --- | --- | --- |
| Pro AI M → Pro M, Pro AI M → own key M, own key M → Pro M | Deferred; landed on the target at the period end, renewal invoice = the new price, no credit | `portal_end_of_period` |
| Pro AI Y → Pro Y, Pro AI Y → own key Y, own key Y → Pro Y | Deferred; landed, no credit | `portal_end_of_period` |
| Pro AI M → Pro Y, Pro AI M → own key Y, own key M → Pro Y (downgrade, longer interval) | Deferred; landed with a full yearly invoice and a new anchor, no credit | `portal_end_of_period` |
| Pro AI Y → Pro AI M (same product, shorter) | Deferred; landed | `portal_end_of_period` |
| Pro Y → Pro AI M (shorter + another change) | **Applied at once with a -$35.00 balance credit** | `end_of_period` (server schedule) |
| Every upgrade tried (Pro M → Pro Y / Pro AI M / Pro AI Y / own key Y, own key M → Pro AI M / Pro AI Y, own key Y → Pro AI Y, Pro Y → Pro AI Y, Pro AI M → Pro AI Y) | Applied at once, prorated charge | `portal` |

Kept on the server's schedule (`end_of_period`) because the portal applied one of them at once
with a credit: every "shorter interval plus another change" pair. Stripe's documentation says the
portal can only defer "between prices that have the same product", so the cross-product rows
above rely on undocumented behaviour (they seem to compare per-month amounts). The [plan-change
alarm](#plan-change-alarm) is there for the day that changes; the fallbacks are under the decision
in [Refund policy](#refund-policy).

Other portal facts behind this:

- With `shortening_interval` alone (the v1 configuration), a cheaper switch on the same interval
  applied at once with a balance credit (managed → own key monthly: -$2.00; Pro AI Y → Pro Y with
  both Prices on one product: -$43.00), which is why v2 adds `decreasing_item_amount`.
- `decreasing_item_amount` never deferred monthly → yearly within one product, even when the
  yearly costs less per month (Pro M → Pro Y applied at once, charged). Across products it
  deferred monthly → yearly only when the plan also went down (Pro AI M → Pro Y). So it doesn't
  hold back upgrades here.
- When the portal defers, it makes a subscription schedule (`end_behavior: release`): phase 1 the
  current price to the period end, phase 2 the target price lasting one second. The subscription
  gains `schedule` (so the switch routes answer `already_scheduled` until it lands), the price
  changes at the period end, and the schedule is released.
- The portal's phase 2 carries **every** subscription-level discount, including a coupon that
  `applies_to` only the old product (measured 2026-10-26: managed M with a 50% managed-only coupon
  and a 10% coupon → own key M; both discounts were still on the subscription after the landing).
  The managed-only coupon then discounts nothing on own key, but an upgrade back to managed nets
  the full unused own-key time against a half-price managed charge: the preview was -$1.79. The
  upgrade preview above refuses that switch (`switch_needs_support`).
- The server schedule (one-second phase 2) was run the same day on a test clock: Pro AI Y with
  three coupons (managed-only 50%, any 10%, Pro-only 20%) → Pro M. At the period end the price
  changed with one `subscription_update` invoice of $3.99 less 10% and 20% ($2.87, no proration
  lines), the managed-only coupon was gone, the schedule was `released` one second later, and the
  next renewal a month later was an ordinary $2.87 `subscription_cycle` invoice. The landing
  `customer.subscription.updated` still had `schedule` set on its object, so the alarm stays quiet.
- The portal **can't list two Prices of one product with the same interval** (Stripe's portal
  limitations). That is why the own-key Prices are on their own product (**TabMerger Pro AI (own
  key)**), not on the managed Pro AI product.

### Plan-change alarm

`customer.subscription.updated` runs a report-only check after the row is written
(`planChangeAlarms()` in `lib/planChangeAlarm.ts`). It never changes anything at Stripe or in the
database and never changes the answer: the check sits in a `try/catch`, and a failure inside it is
logged as one line (`Stripe webhook: plan-change alarm check failed …`) while the event still gets
its 200. Each alarm is one `console.error` line starting `Stripe webhook: PLAN_CHANGE_ALARM` with
the alarm, the subscription id, and either the two plans (`proAi/managed/monthly -> pro/monthly`)
or the invoice id and amounts; never a customer, email, metadata or Stripe object. The same text
goes to Sentry (`captureMessage`, level `error`, fingerprint `plan-change-alarm/<kind>`, tag
`plan_change_alarm`), so every occurrence of one signal lands in one Sentry issue, which can alert
a person; the webhook flushes Sentry in `after()` so a frozen serverless function doesn't drop it.
Sentry only sends where `NEXT_PUBLIC_SENTRY_DSN` is set (`instrumentation.ts`).

- `lowered_at_once`: `previous_attributes` show a price change that `classifyPlanChange()` doesn't
  call an upgrade, and the subscription in the event has no `schedule`. A deferred change (the
  portal's or the server's) lands while its schedule is still attached; Stripe detaches it in a
  later update. Prices this deployment doesn't sell are skipped.
- `credit`: the update set a new `latest_invoice` (read from Stripe with `latest_invoice`
  expanded) with `billing_reason: subscription_update` and a negative total, or one that moved
  the customer balance further into credit. An upgrade can't do that at our list prices: every
  upgrade's new price is at least the old one on the same interval, and every yearly price ($42.99
  and up) is above every monthly one ($7.99 at most), so the unused time netted against the new
  charge never exceeds it.

Credit paths it covers beyond the portal's deferral: a coupon already on the subscription (or the
customer) that discounts the new price more than the old one, e.g. one that `applies_to` only the
target product, can make an upgrade's invoice negative. The upgrade preview refuses those switches
before the portal opens (`switch_needs_support`); the `credit` alarm is the backstop for anything
the preview didn't predict (a coupon added between the preview and the confirm click, or a
Dashboard change). Promotion codes can't be entered on the plan-change confirm page (v3
configuration).

Search the function logs for `PLAN_CHANGE_ALARM`, or the Sentry issues fingerprinted
`plan-change-alarm`. It needs no extra webhook event: `customer.subscription.updated` is already subscribed.
What it doesn't see: a credit that arrives as proration lines on a later renewal invoice (a change
made with `create_prorations` instead of `always_invoice`, e.g. by hand in the Dashboard), and an
invoice that a later update replaced before the event was handled.

**When the alarm fires (runbook).**

1. Open the subscription in the Stripe Dashboard (the id is in the alarm) and read the invoice the
   alarm names: its total, and the customer's credit balance after it.
2. `credit`: remove the credit with a balance adjustment. Customers → the customer → **Credit
   balance** → **Adjust balance**, as a debit equal to the credit the invoice created, with a
   note naming the invoice. Nothing is paid out (a balance credit only lowers future invoices),
   and the terms allow a credit given by mistake to be removed. This is a Dashboard step on
   purpose: no server code adjusts balances (`__tests__/refundPolicy.test.ts`).
3. `lowered_at_once`: the customer is already on the lower plan, which is what they asked for
   (only the timing is wrong). Handle any `credit` alarm on the same change as above; nothing else
   to undo.
4. If the cause is the portal no longer deferring cross-product downgrades, send every downgrade
   to the server schedule: in `planChangeTiming()` (`lib/planChangeTiming.ts`), make the
   cross-product downgrade branch (`if (from && to && !(… yearly → monthly …))`) return
   `end_of_period` instead of `portal_end_of_period`, update `planChangeTiming.test.ts`, and
   deploy. `usePlanChange` reads the same function, so those changes get its "changes on {date}"
   dialog at once, and `createPlanSwitchSession()` schedules those changes itself. Same-product yearly →
   monthly (documented portal behaviour) can stay on the portal.

**Errors.** Every error answer carries a `code` next to the English `error`
(`PLAN_SWITCH_ERROR_CODES` in `lib/checkoutErrors.ts`), and the pricing page shows a message per
code (`pricing.planChange.errors.*` in every locale): `no_billing_account` (400), `no_paid_plan`
(403), `already_on_price`, `already_scheduled`, `cancel_scheduled`, `pay_or_resume`,
`switch_needs_support` (409: an upgrade whose previewed invoice would be a credit; the message
says the change can't be made now and to email support), `price_unavailable`
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
plan. A pending schedule blocks portal changes and cancellation from the portal home (see [Refund
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
`tabmerger_plan_change: v3:<price id>`, among active configurations) or creates a configuration
whose subscription updates list **only the target Price** (`always_invoice`,
`schedule_at_period_end` conditions `decreasing_item_amount` and `shortening_interval`,
`default_allowed_updates: ['price']` so no promotion codes, no quantity changes; cancellation at
period end without proration), and caches its id in memory. They show up in the Dashboard as
"TabMerger plan change to price_… (v3)"; leave
them. Bumping `PLAN_CHANGE_CONFIGURATION_VERSION` makes new ones on the next switch.

A configuration found by metadata is used only when its features still match: for a plan change,
subscription updates on with `default_allowed_updates` exactly `['price']`, `always_invoice`, both
conditions, a single product entry listing only the target Price (no adjustable quantity), and
cancellation at period end with no proration; for the cancellation configuration (`tabmerger_cancel:
v1`), cancellation at period end with no proration and subscription updates off. One edited in the
Dashboard is skipped (a warning names its id) and a new one is made with the same metadata; the
edited one can then be deactivated. The lookup pages through the whole list of active, non-default
configurations, with `data.features.subscription_update.products` expanded (Stripe leaves the
products out of a list otherwise).

Configuration changes (2026-10-26): v1 had `shortening_interval` only; v2 adds
`decreasing_item_amount`, which is what defers the cross-product downgrades (see [Plan changes and
timing](#plan-changes-and-timing)); v3 turns promotion codes off, because a code entered on the
confirm page could discount an upgrade's new price below the unused time netted against it and
leave a credit. Older versions are no longer looked up; a portal session already opened on one
(they live up to an hour after the last activity) behaves as that version did. Deactivated
configurations are never reused. In test mode the v1 and v2 plan-change configurations were
deactivated on 2026-10-26.

**Runbook: deactivate the old plan-change configurations in live mode** (once, at least an hour
after the deploy that ships v3, so no session is still open on them). Live access is the owner's
step. List the active configurations, and deactivate each whose metadata `tabmerger_plan_change`
starts with `v1:` or `v2:` (leave `v3:…`, `tabmerger_cancel: v1` and the default):

```bash
stripe billing_portal configurations list --live -d active=true -d limit=100
stripe billing_portal configurations update <bpc_… with v1:/v2: metadata> --live -d active=false
```

The Dashboard's Customer portal settings show only the default configuration, so use the CLI (or
the API). Afterwards the list should hold only `v3:` plan-change configurations, one cancellation
configuration and the default.

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
