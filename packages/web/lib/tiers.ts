import { getPricingTier, type PricingTier } from '@tabmerger/shared'

/** Name, prices, features and limits come from the shared PRICING_TIERS, the single source. */
function display(tier: PricingTier) {
  const { name, monthlyPrice, yearlyPrice, features, limits } = tier
  return { name, monthlyPrice, yearlyPrice, features, limits }
}

export const TIERS = {
  free: display(getPricingTier('free')),
  pro: {
    ...display(getPricingTier('pro')),
    stripeMonthlyPriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    stripeYearlyPriceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  },
  proAi: {
    ...display(getPricingTier('pro_ai')),
    stripeMonthlyPriceId: process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID,
    stripeYearlyPriceId: process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID,
  },
}

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
