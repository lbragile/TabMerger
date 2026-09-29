import Stripe from 'stripe'
import { isEntitledSubscriptionStatus } from '@tabmerger/shared'

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

// Re-export client-safe tier constants from their own module so that
// client components can import TIERS without pulling in the Stripe SDK.
export { TIERS, getStripePriceId } from './tiers'
export type { TierKey, BillingInterval } from './tiers'

export async function createCheckoutSession({
  userId,
  priceId,
  customerEmail,
  customerId,
  successUrl,
  cancelUrl,
}: {
  userId: string
  priceId: string
  customerEmail?: string
  customerId?: string
  successUrl: string
  cancelUrl: string
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
    success_url: successUrl,
    cancel_url: cancelUrl,
    // user_id on session metadata is a fallback readable from session object directly
    metadata: { user_id: userId },
    // user_id on subscription_data metadata travels with the subscription object
    subscription_data: {
      metadata: { user_id: userId },
    },
  })

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
    // adjustable_quantity lets the customer change the call count on Stripe's own
    // Checkout page, not just before landing there — mirrors the same 50-500 clamp
    // the /api/checkout/credits route already enforces server-side on `quantity`.
    // Minimum is 50 (not 1) since at $0.05/credit a smaller purchase risks Stripe's
    // $0.50 minimum-charge floor and gets eaten by per-transaction processing fees.
    line_items: [{ price: priceId, quantity, adjustable_quantity: { enabled: true, minimum: 50, maximum: 500 } }],
    // Shows an opt-in "Save my payment method for future purchases" checkbox on
    // Checkout — the customer chooses, nothing is saved silently. Requires an
    // actual Customer object (either the existing one, or a freshly created one
    // via customer_creation above when we only had an email).
    saved_payment_method_options: { payment_method_save: 'enabled' },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: userId, type: 'ai_credit_pack' },
  })

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

/** Why an interval switch couldn't start; the route maps each to a status code. */
export class IntervalSwitchError extends Error {
  constructor(readonly reason: 'no_subscription' | 'already_on_price' | 'already_scheduled') {
    super(reason)
  }
}

/**
 * Opens the Billing Portal straight on its "confirm plan change" page, moving the customer's
 * paid subscription (one whose price is in `planPriceIds`) to `targetPriceId`. The portal
 * configuration decides the timing: monthly→yearly applies now with a prorated charge, and
 * yearly→monthly (a shorter interval) waits for the end of the term. Either way Stripe fires
 * `customer.subscription.updated` when the price changes, which the webhook turns into the new
 * tier/interval, so nothing is written here.
 *
 * The portal configuration must list `targetPriceId` under subscription updates, or Stripe
 * rejects the session. `STRIPE_PORTAL_CONFIGURATION_ID` picks that configuration; without it,
 * the account's default configuration is used.
 */
export async function createIntervalSwitchSession({
  customerId,
  targetPriceId,
  planPriceIds,
  returnUrl,
}: {
  customerId: string
  targetPriceId: string
  planPriceIds: readonly string[]
  returnUrl: string
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const { data: subscriptions } = await stripe.subscriptions.list({ customer: customerId, limit: 10 })
  const subscription = subscriptions.find(
    (s) =>
      isEntitledSubscriptionStatus(s.status) &&
      s.items.data.length === 1 &&
      planPriceIds.includes(s.items.data[0].price.id)
  )
  if (!subscription) throw new IntervalSwitchError('no_subscription')

  const item = subscription.items.data[0]
  if (item.price.id === targetPriceId) throw new IntervalSwitchError('already_on_price')
  // The portal defers yearly→monthly to the end of the term by attaching a subscription schedule.
  // While that's pending, Stripe won't take another update, so say so instead of failing.
  if (subscription.schedule) throw new IntervalSwitchError('already_scheduled')

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

  return session.url
}
