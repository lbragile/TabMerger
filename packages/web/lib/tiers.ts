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

/**
 * A price marked as US dollars, always with cents (e.g. US$3.58): a bare "$" reads as local
 * dollars in Canada, Australia and elsewhere. For prices shown on their own (account page,
 * dashboard); matches how the Billing Portal shows them (see PORTAL_LOCALE in lib/stripe.ts).
 */
export function formatUsd(amount: number): string {
  return `US$${amount.toFixed(2)}`
}

/**
 * A price in a plan listing, always with cents (e.g. $3.58). Only for listings that also show
 * {@link PRICES_IN_USD_NOTE}, which says the currency once instead of on every price.
 */
export function formatListPrice(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** Footnote under every plan listing (pricing page and the landing page's teaser). */
export const PRICES_IN_USD_NOTE = 'All prices are in US dollars (USD).'

/**
 * What a yearly plan works out to per month, and how much it saves against paying the monthly
 * price for twelve months. The percentage is rounded down so the site never overstates the
 * discount (10.2% shows as 10%).
 */
export function yearlySavings(monthlyPrice: number, yearlyPrice: number) {
  const twelveMonths = monthlyPrice * 12
  return {
    perMonth: yearlyPrice / 12,
    percent: twelveMonths > 0 ? Math.floor(((twelveMonths - yearlyPrice) / twelveMonths) * 100) : 0,
  }
}

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
