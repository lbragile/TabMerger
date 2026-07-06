import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiVersion: '2025-06-30.basil' as any,
  typescript: true,
})

export const TIERS = {
  free: {
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: [
      'Up to 5 groups',
      'Up to 50 tabs',
      'Local storage only',
      'Import & export',
      'Drag & drop',
    ],
    limits: { groups: 5, tabs: 50 },
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 3.99,
    yearlyPrice: 34.99,
    stripeMonthlyPriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    stripeYearlyPriceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
    features: [
      'Unlimited groups & tabs',
      'Cloud sync across devices',
      'Session save & restore',
      'Keyboard shortcuts',
      'Priority support',
    ],
    limits: { groups: Infinity, tabs: Infinity },
  },
  proAi: {
    name: 'Pro AI',
    monthlyPrice: 7.99,
    yearlyPrice: 69.99,
    stripeMonthlyPriceId: process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID,
    stripeYearlyPriceId: process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID,
    features: [
      'Everything in Pro',
      'AI auto-grouping of tabs',
      'AI group name suggestions',
      'Smart session suggestions',
      'Tab preview with AI summary',
    ],
    limits: { groups: Infinity, tabs: Infinity },
  },
} as const

export type TierKey = keyof typeof TIERS
export type BillingInterval = 'monthly' | 'yearly'

export function getStripePriceId(
  tier: 'pro' | 'proAi',
  interval: BillingInterval
): string | undefined {
  const tierConfig = TIERS[tier]
  return interval === 'monthly'
    ? tierConfig.stripeMonthlyPriceId
    : tierConfig.stripeYearlyPriceId
}

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
