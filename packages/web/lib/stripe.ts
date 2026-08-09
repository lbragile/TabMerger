import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
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
    // Minimum is 50 (not 1) since at $0.10/call a smaller purchase risks Stripe's
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

export async function createBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string
  returnUrl: string
}): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })

  return session.url
}
