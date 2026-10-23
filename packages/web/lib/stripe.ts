import Stripe from 'stripe'
import { isEntitledSubscriptionStatus, type AiMode } from '@tabmerger/shared'
import type { CheckoutInterval, CheckoutTier } from './checkoutAnalytics'

/**
 * True when a real Stripe secret key was supplied. False in any environment missing
 * `STRIPE_SECRET_KEY` (CI builds, a fresh checkout before `.env.local` is populated) — every
 * exported operation below checks this and throws a clear config error before calling Stripe,
 * instead of either crashing at import time or sending a real request with a placeholder key.
 */
export const isStripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY)

// ponytail: `new Stripe(undefined)` throws "Neither apiKey nor config.authenticator provided" at
// construction time -- same bug class as the extension's supabase.ts crash (commit d45989c).
// `next build` evaluates every route module (including app/api/billing-portal, app/api/checkout,
// app/api/checkout/credits, app/api/webhooks/stripe) during "Collecting page data" to statically
// analyze it, even though the route handler itself never runs during build -- so a missing
// STRIPE_SECRET_KEY killed the *entire* build, not just disabled billing. The placeholder string
// keeps construction safe; it is never used for a real request because every operation below
// refuses to run without isStripeConfigured, so a fake key can't silently no-op a real charge.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_not_configured', {
  apiVersion: '2025-06-30.basil' as Stripe.LatestApiVersion,
  typescript: true,
})

/**
 * Checkout Sessions are created with Adaptive Pricing on: the customer sees and pays the
 * price in their local currency, with Stripe's conversion fee built into that amount (the
 * customer pays it), while we're credited the USD price. Our Prices stay USD-only.
 *
 * Adaptive Pricing for SUBSCRIPTIONS needs API version 2026-03-25.dahlia or later, so the
 * Checkout calls alone use it (per-request `apiVersion`); the client above stays on basil so
 * nothing else (portal, subscriptions, webhooks) changes shape. Stripe decides per session
 * whether to convert (location, currency support), so a session can still show USD.
 */
const CHECKOUT_API_VERSION = '2026-03-25.dahlia'
const LOCAL_CURRENCY_CHECKOUT = { adaptive_pricing: { enabled: true } } as const

// Re-export client-safe tier constants from their own module so that
// client components can import TIERS without pulling in the Stripe SDK.
export { TIERS, getStripePriceId, getPlanForPriceId, getPlanPriceIds } from './tiers'
export type { TierKey, BillingInterval } from './tiers'
import { getPlanForPriceId, type BillingInterval } from './tiers'
import { planChangeTiming } from './planChangeTiming'

/**
 * Shown next to the pay button of the credit-pack checkout (`custom_text.submit`, at most 1,200
 * characters). The terms page (section 3) says the same.
 */
export const CREDIT_PACK_REFUND_NOTICE =
  'AI credit packs are non-refundable, including if you cancel your subscription. Credits are for the current month and are never exchanged for money.'

export async function createCheckoutSession({
  userId,
  priceId,
  customerEmail,
  customerId,
  successUrl,
  cancelUrl,
  tier,
  interval,
  aiMode,
}: {
  userId: string
  priceId: string
  customerEmail?: string
  customerId?: string
  successUrl: string
  cancelUrl: string
  /** Plan and interval, already validated by the route; stamped on the session for analytics. */
  tier?: CheckoutTier
  interval?: CheckoutInterval
  /** Pro AI's option (TabMerger's key or the customer's own), validated by the route; analytics only. */
  aiMode?: AiMode
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    ...(customerId
      ? { customer: customerId }
      : customerEmail
        ? { customer_email: customerEmail }
        : {}),
    line_items: [{ price: priceId, quantity: 1 }],
    // Subscriptions already save the card to charge renewals automatically, but with
    // allow_redisplay: 'limited' (usable only for this subscription's own charges).
    // This opt-in checkbox lets the customer explicitly allow it to be prefilled for
    // other purchases too (e.g. an AI credit-pack top-up) instead of typing a card in
    // again — same mechanism as the credit-pack checkout in createCreditPackCheckoutSession.
    saved_payment_method_options: { payment_method_save: 'enabled' },
    // Shows Stripe's "Add promotion code" field. The codes are created and restricted in the
    // Stripe Dashboard, not here: the coupon sets the discount, how long it lasts and which
    // products it applies to; the promotion code on top sets redemption limits and expiry.
    // Stripe validates the code on its own page, so nothing on our side decides a price.
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    // user_id on session metadata is a fallback readable from session object directly.
    // tier/interval/ai_mode let the checkout.session.expired webhook report which plan was
    // abandoned without another Stripe call. The webhook re-validates them; none is ever trusted
    // for billing (the subscription's tier and AI option come from its price).
    metadata: {
      user_id: userId,
      ...(tier ? { tier } : {}),
      ...(interval ? { interval } : {}),
      ...(aiMode ? { ai_mode: aiMode } : {}),
    },
    // user_id on subscription_data metadata travels with the subscription object
    subscription_data: {
      metadata: { user_id: userId },
    },
    ...LOCAL_CURRENCY_CHECKOUT,
  }, { apiVersion: CHECKOUT_API_VERSION })

  if (!session.url) throw new Error('Failed to create checkout session')
  return session.url
}

/**
 * Creates a one-time (mode: 'payment') Checkout Session for the AI credit pack top-up.
 * user_id is stamped on session metadata (not subscription_data — there's no subscription
 * here) since it's the only place the webhook can recover the buyer for a one-time payment.
 */
export async function createCreditPackCheckoutSession({
  userId,
  quantity = 50,
  customerEmail,
  customerId,
  successUrl,
  cancelUrl,
}: {
  userId: string
  quantity?: number
  customerEmail?: string
  customerId?: string
  successUrl: string
  cancelUrl: string
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const priceId = process.env.STRIPE_AI_CREDIT_PACK_PRICE_ID
  if (!priceId) throw new Error('STRIPE_AI_CREDIT_PACK_PRICE_ID not configured')

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    ...(customerId
      ? { customer: customerId }
      : customerEmail
        ? { customer_email: customerEmail, customer_creation: 'always' }
        : {}),
    // adjustable_quantity lets the customer change the pack size on Stripe's own Checkout
    // page, not just before landing there — mirrors the same 50-500 clamp the
    // /api/checkout/credits route already enforces server-side on `quantity`. One unit is
    // $0.05, so the smallest pack is $2.50, clear of Stripe's $0.50 minimum charge. The
    // credits granted are not the quantity: the webhook converts the USD amount actually paid
    // with creditsForPayment() ($2.50 funds 820 credits).
    line_items: [{ price: priceId, quantity, adjustable_quantity: { enabled: true, minimum: 50, maximum: 500 } }],
    // Shows an opt-in "Save my payment method for future purchases" checkbox on
    // Checkout — the customer chooses, nothing is saved silently. Requires an
    // actual Customer object (either the existing one, or a freshly created one
    // via customer_creation above when we only had an email).
    saved_payment_method_options: { payment_method_save: 'enabled' },
    // Same "Add promotion code" field as the subscription checkout; codes are created and
    // restricted in the Stripe Dashboard. A coupon that isn't limited to specific products
    // works here too, so limit subscription coupons to the plan's product. The webhook grants
    // credits from the USD amount paid, so a discounted pack grants proportionally fewer
    // credits and a free one grants none.
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: userId, type: 'ai_credit_pack' },
    // The refund policy, where the pack is bought: packs are never refunded (cancelling the
    // subscription included) and unused credits don't turn into money.
    custom_text: { submit: { message: CREDIT_PACK_REFUND_NOTICE } },
    ...LOCAL_CURRENCY_CHECKOUT,
  }, { apiVersion: CHECKOUT_API_VERSION })

  if (!session.url) throw new Error('Failed to create checkout session')
  return session.url
}

/**
 * Language/format for every Billing Portal session. With Stripe's default ("auto") the portal
 * shows our USD prices as a bare "$42.99", which a Canadian reads as CAD. en-CA makes Stripe
 * write "US$42.99" for everyone, so the currency is never ambiguous. The site is English-only.
 */
const PORTAL_LOCALE = 'en-CA' satisfies Stripe.BillingPortal.SessionCreateParams.Locale

export async function createBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string
  returnUrl: string
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: PORTAL_LOCALE,
  })

  return session.url
}

/** Why a plan switch couldn't start; the route maps each to a status code. */
export class PlanSwitchError extends Error {
  constructor(
    readonly reason: 'no_subscription' | 'already_on_price' | 'already_scheduled' | 'cancel_scheduled'
  ) {
    super(reason)
  }
}

/**
 * What a plan switch did (see `classifyPlanChange()` in lib/tiers.ts):
 * - `portal`: the customer confirms on Stripe's "confirm plan change" page at `url`;
 * - `applied_now`: the subscription was moved now with a prorated charge. `url` is the invoice
 *   to pay when the payment needs the customer (3-D Secure, a declined card), otherwise null; until
 *   it is paid the change stays pending (`payment_behavior: 'pending_if_incomplete'`);
 * - `scheduled`: the change takes effect at `effectiveAt` (unix seconds, the end of the paid
 *   period), with no proration.
 */
export type PlanSwitchResult =
  | { kind: 'portal'; url: string }
  | { kind: 'applied_now'; url: string | null }
  | { kind: 'scheduled'; effectiveAt: number }

const idOf = (value: string | { id: string } | null | undefined): string | undefined =>
  typeof value === 'string' ? value : value?.id

/**
 * Moves the customer's paid subscription (one whose price is in `planPriceIds`) to
 * `targetPriceId`, following the refund policy (docs/PAYMENTS.md, "Refund policy"):
 *
 * - **Upgrades** (nothing gets cheaper or shorter) apply now, charged prorated against the unused
 *   time: through the Billing Portal's "confirm plan change" page when both prices are ones the
 *   portal lists (Pro, TabMerger-managed Pro AI), otherwise by updating the subscription directly
 *   with `always_invoice`. The portal can't list own-key prices: it allows one price per product
 *   and interval, and they share the Pro AI product with the managed ones.
 * - **Interval shortening** on the same plan (yearly → monthly) goes to the portal, whose
 *   `shortening_interval` condition defers it to the end of the term; on an own-key price it is
 *   scheduled here instead.
 * - **Downgrades** (Pro AI → Pro, managed → own key, or shortening plus another change) are
 *   scheduled here for the end of the paid period with no proration: a subscription schedule whose
 *   current phase ends with the period and whose next phase is the new price. Nothing is refunded
 *   or credited, and access to the current plan lasts until then.
 *
 * Stripe fires `customer.subscription.updated` when the price actually changes (now, or when the
 * schedule's next phase starts), and the webhook records the new tier, interval, AI option and
 * credit allowance, so nothing is written to the database here.
 *
 * Portal sessions use `STRIPE_PORTAL_CONFIGURATION_ID` when set (otherwise the account default),
 * which must list the target price under subscription updates or Stripe rejects the session.
 */
export async function createPlanSwitchSession({
  customerId,
  targetPriceId,
  planPriceIds,
  returnUrl,
}: {
  customerId: string
  targetPriceId: string
  planPriceIds: readonly string[]
  returnUrl: string
}): Promise<PlanSwitchResult> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const { data: subscriptions } = await stripe.subscriptions.list({ customer: customerId, limit: 10 })
  const subscription = subscriptions.find(
    (s) =>
      isEntitledSubscriptionStatus(s.status) &&
      s.items.data.length === 1 &&
      planPriceIds.includes(s.items.data[0].price.id)
  )
  if (!subscription) throw new PlanSwitchError('no_subscription')

  const item = subscription.items.data[0]
  if (item.price.id === targetPriceId) throw new PlanSwitchError('already_on_price')
  // A deferred change (ours, or the portal's yearly→monthly) is a subscription schedule. While it
  // is pending, Stripe won't take another update, so say so instead of failing.
  if (subscription.schedule) throw new PlanSwitchError('already_scheduled')
  // A subscription set to end can't be given a schedule, and changing it would undo nothing the
  // customer asked for. They renew it in the portal first.
  if (subscription.cancel_at_period_end || subscription.cancel_at) {
    throw new PlanSwitchError('cancel_scheduled')
  }

  // One rule for the server and the plan-change confirmation dialog (lib/planChangeTiming.ts),
  // so what the dialog promises is what happens here.
  const to = getPlanForPriceId(targetPriceId)
  const timing = planChangeTiming(getPlanForPriceId(item.price.id), to)

  if (timing === 'end_of_period') {
    return scheduleChangeAtPeriodEnd(subscription.id, targetPriceId, to?.interval ?? null)
  }
  if (timing === 'now') {
    return applyUpgradeNow(subscription.id, item.id, targetPriceId)
  }
  // 'portal' (an upgrade, charged prorated) or 'portal_end_of_period' (yearly → monthly, deferred
  // by the configuration's shortening_interval condition).

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: PORTAL_LOCALE,
    ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID
      ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
      : {}),
    flow_data: {
      type: 'subscription_update_confirm',
      subscription_update_confirm: {
        subscription: subscription.id,
        items: [{ id: item.id, price: targetPriceId, quantity: 1 }],
      },
      after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
    },
  })

  return { kind: 'portal', url: session.url }
}

/**
 * An upgrade the portal can't offer, applied now: the item moves to the new price and Stripe
 * invoices the prorated difference at once (`always_invoice`). With `pending_if_incomplete` the
 * new price only takes effect once that invoice is paid; until then the subscription keeps its
 * plan and `pending_update` is set, and the invoice's hosted page is where the customer pays.
 */
async function applyUpgradeNow(
  subscriptionId: string,
  itemId: string,
  targetPriceId: string
): Promise<PlanSwitchResult> {
  const updated = await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: targetPriceId, quantity: 1 }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
    expand: ['latest_invoice'],
  })
  const invoice = updated.latest_invoice
  const url =
    updated.pending_update && invoice && typeof invoice !== 'string'
      ? invoice.hosted_invoice_url ?? null
      : null
  return { kind: 'applied_now', url }
}

/**
 * Schedules a change for the end of the current paid period, with no proration (Stripe's
 * documented "schedule a downgrade for an existing subscription": a schedule made from the
 * subscription, then updated with the current phase kept as is and a next phase on the new
 * price). `end_behavior: 'release'` leaves the subscription running on the new price afterwards.
 * If the update fails, the half-made schedule is released so the subscription isn't left locked
 * (a subscription with a schedule can't be changed or cancelled in the portal).
 */
async function scheduleChangeAtPeriodEnd(
  subscriptionId: string,
  targetPriceId: string,
  targetInterval: BillingInterval | null
): Promise<PlanSwitchResult> {
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId })
  try {
    const current = schedule.phases[0]
    if (!current) throw new Error('Subscription schedule has no current phase')

    // Stripe unsets any phase field an update leaves out, so the current phase is passed back
    // with its items, discounts, tax rates and metadata.
    const discounts = current.discounts.flatMap((d): Stripe.SubscriptionScheduleUpdateParams.Phase.Discount[] => {
      const discount = idOf(d.discount)
      if (discount) return [{ discount }]
      const coupon = idOf(d.coupon)
      if (coupon) return [{ coupon }]
      const promotionCode = idOf(d.promotion_code)
      return promotionCode ? [{ promotion_code: promotionCode }] : []
    })
    const taxRates = (current.default_tax_rates ?? []).map((rate) => idOf(rate)).filter(Boolean) as string[]

    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        {
          items: current.items.map((phaseItem) => ({
            price: idOf(phaseItem.price)!,
            quantity: phaseItem.quantity ?? 1,
          })),
          start_date: current.start_date,
          end_date: current.end_date,
          proration_behavior: 'none',
          ...(discounts.length > 0 ? { discounts } : {}),
          ...(taxRates.length > 0 ? { default_tax_rates: taxRates } : {}),
          ...(current.metadata && Object.keys(current.metadata).length > 0
            ? { metadata: current.metadata }
            : {}),
        },
        {
          items: [{ price: targetPriceId, quantity: 1 }],
          // No credit for the period that just ended and no charge beyond the new price's own
          // renewal: the change lands exactly on the period boundary.
          proration_behavior: 'none',
          duration: { interval: targetInterval === 'yearly' ? 'year' : 'month', interval_count: 1 },
        },
      ],
    })

    return { kind: 'scheduled', effectiveAt: current.end_date }
  } catch (err) {
    await stripe.subscriptionSchedules.release(schedule.id).catch((releaseErr: unknown) => {
      console.error(`Plan switch: releasing unfinished schedule ${schedule.id} failed`, releaseErr)
    })
    throw err
  }
}
