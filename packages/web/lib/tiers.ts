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
    yearlyPrice: 42.99,
    stripeMonthlyPriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    stripeYearlyPriceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
    features: [
      'Everything in Free',
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
    yearlyPrice: 85.99,
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

/**
 * Reverse-looks-up a Stripe price ID (as stored on `subscriptions.stripe_price_id`)
 * against the known Pro/Pro AI price IDs to recover the display cost and billing
 * interval. Returns null if the price ID doesn't match a known tier (e.g. a
 * discontinued/legacy price).
 */
export function getPriceInfo(
  priceId: string | null | undefined
): { amount: number; interval: BillingInterval } | null {
  if (!priceId) return null
  for (const tier of [TIERS.pro, TIERS.proAi] as const) {
    if (priceId === tier.stripeMonthlyPriceId) {
      return { amount: tier.monthlyPrice, interval: 'monthly' }
    }
    if (priceId === tier.stripeYearlyPriceId) {
      return { amount: tier.yearlyPrice, interval: 'yearly' }
    }
  }
  return null
}
