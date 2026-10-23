import { getPricingTier, type AiMode, type PricingTier } from '@tabmerger/shared'

/** Name, prices, features and limits come from the shared PRICING_TIERS, the single source. */
function display(tier: PricingTier) {
  const { name, monthlyPrice, yearlyPrice, features, limits } = tier
  return { name, monthlyPrice, yearlyPrice, features, limits }
}

const PRO_AI = getPricingTier('pro_ai')
if (!PRO_AI.byok) throw new Error('PRICING_TIERS: Pro AI has no bring-your-own-key option')
const PRO_AI_BYOK = PRO_AI.byok

export const TIERS = {
  free: display(getPricingTier('free')),
  pro: {
    ...display(getPricingTier('pro')),
    stripeMonthlyPriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    stripeYearlyPriceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  },
  proAi: {
    ...display(PRO_AI),
    stripeMonthlyPriceId: process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID,
    stripeYearlyPriceId: process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID,
    /**
     * The bring-your-own-key option of Pro AI: same tier (`pro_ai`), cheaper, AI billed to the
     * customer's own AI provider key (Anthropic, OpenAI or Google). Stored as
     * `subscriptions.ai_mode = 'byok'`.
     */
    byok: {
      monthlyPrice: PRO_AI_BYOK.monthlyPrice,
      yearlyPrice: PRO_AI_BYOK.yearlyPrice,
      features: PRO_AI_BYOK.features,
      stripeMonthlyPriceId: process.env.STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID,
      stripeYearlyPriceId: process.env.STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID,
    },
  },
}

export type TierKey = keyof typeof TIERS
export type BillingInterval = 'monthly' | 'yearly'

/** The paid plans checkout sells, by their wire name (`proAi`, not the database's `pro_ai`). */
export type PaidTierKey = 'pro' | 'proAi'

// Price formatting lives in @tabmerger/shared so the extension writes prices the same way;
// re-exported here so web code keeps importing it alongside TIERS.
export { formatUsd, formatListPrice, PRICES_IN_USD_NOTE } from '@tabmerger/shared'

/**
 * The yearly discount every paid option advertises (10%), on the Monthly/Yearly toggle's badge
 * and in each card's "save N%" line. A shared test holds every yearly price to a real saving of
 * at least this and under one point more, so the figure is true for each option.
 */
export { YEARLY_DISCOUNT_PERCENT } from '@tabmerger/shared'

/**
 * What a yearly plan works out to per month, and how much it really saves against paying the
 * monthly price for twelve months (rounded down: 10.2% is 10). The listings show the advertised
 * `YEARLY_DISCOUNT_PERCENT` rather than this figure; `percent` only says whether there is a saving.
 */
export function yearlySavings(monthlyPrice: number, yearlyPrice: number) {
  const twelveMonths = monthlyPrice * 12
  return {
    perMonth: yearlyPrice / 12,
    percent: twelveMonths > 0 ? Math.floor(((twelveMonths - yearlyPrice) / twelveMonths) * 100) : 0,
  }
}

/**
 * Each paid plan's yearly saving, shared by every plan listing (pricing page, landing teaser).
 * `proAiByok` is Pro AI's bring-your-own-key option.
 */
export const YEARLY_SAVINGS = {
  pro: yearlySavings(TIERS.pro.monthlyPrice, TIERS.pro.yearlyPrice),
  proAi: yearlySavings(TIERS.proAi.monthlyPrice, TIERS.proAi.yearlyPrice),
  proAiByok: yearlySavings(TIERS.proAi.byok.monthlyPrice, TIERS.proAi.byok.yearlyPrice),
}

// "$3.58/mo billed yearly · save 10%" is written per locale by `useYearlySubtext`
// (components/pricing/useYearlySubtext.ts).

/**
 * One Stripe recurring Price we sell: which plan, option and interval it is, its USD list price
 * (from PRICING_TIERS) and the env var holding its id. Every price-id lookup in the web app goes
 * through this table, so a new Price is added in one place.
 */
export interface PlanPrice {
  /** Wire name, as checkout and the pricing cards use it. */
  tierKey: PaidTierKey
  /** Database name, as `subscriptions.tier` stores it. */
  tier: 'pro' | 'pro_ai'
  interval: BillingInterval
  /** Pro AI's option; null for Pro, which has no AI. */
  aiMode: AiMode | null
  /** USD list price for one billing period. */
  amount: number
  envVar: string
}

const PLAN_PRICES: readonly PlanPrice[] = [
  { tierKey: 'pro', tier: 'pro', interval: 'monthly', aiMode: null, amount: TIERS.pro.monthlyPrice, envVar: 'STRIPE_PRO_MONTHLY_PRICE_ID' },
  { tierKey: 'pro', tier: 'pro', interval: 'yearly', aiMode: null, amount: TIERS.pro.yearlyPrice, envVar: 'STRIPE_PRO_YEARLY_PRICE_ID' },
  { tierKey: 'proAi', tier: 'pro_ai', interval: 'monthly', aiMode: 'managed', amount: TIERS.proAi.monthlyPrice, envVar: 'STRIPE_PRO_AI_MONTHLY_PRICE_ID' },
  { tierKey: 'proAi', tier: 'pro_ai', interval: 'yearly', aiMode: 'managed', amount: TIERS.proAi.yearlyPrice, envVar: 'STRIPE_PRO_AI_YEARLY_PRICE_ID' },
  { tierKey: 'proAi', tier: 'pro_ai', interval: 'monthly', aiMode: 'byok', amount: TIERS.proAi.byok.monthlyPrice, envVar: 'STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID' },
  { tierKey: 'proAi', tier: 'pro_ai', interval: 'yearly', aiMode: 'byok', amount: TIERS.proAi.byok.yearlyPrice, envVar: 'STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID' },
]

/**
 * The env var's value, read when called (not at import) so the server always sees the current
 * environment. Price ids aren't `NEXT_PUBLIC_*`: in the browser this is always undefined.
 */
function priceIdOf(plan: PlanPrice): string | undefined {
  return process.env[plan.envVar] || undefined
}

/**
 * The Stripe Price id for a plan, interval and (Pro AI only) AI option; undefined when its env
 * var is unset. `aiMode` is ignored for Pro.
 */
export function getStripePriceId(
  tier: PaidTierKey,
  interval: BillingInterval,
  aiMode: AiMode = 'managed'
): string | undefined {
  const plan = PLAN_PRICES.find(
    (p) => p.tierKey === tier && p.interval === interval && (tier === 'pro' || p.aiMode === aiMode)
  )
  return plan ? priceIdOf(plan) : undefined
}

/** Every configured Price id of one plan option, both intervals (for the plan-switch routes). */
export function getPlanPriceIds(tier: PaidTierKey, aiMode: AiMode | null = null): string[] {
  return PLAN_PRICES.filter((p) => p.tierKey === tier && (aiMode === null || p.aiMode === aiMode))
    .map(priceIdOf)
    .filter((id): id is string => Boolean(id))
}

/**
 * The plan a Stripe Price id is, or null for a price we don't sell (a discontinued or legacy
 * price, or one whose env var isn't set here). The webhook maps a subscription to its tier,
 * interval and AI option with this.
 */
export function getPlanForPriceId(priceId: string | null | undefined): PlanPrice | null {
  if (!priceId) return null
  return PLAN_PRICES.find((p) => priceIdOf(p) === priceId) ?? null
}

/**
 * How a plan change is applied under the refund policy (docs/PAYMENTS.md, "Refund policy"):
 *
 * - `upgrade`: nothing gets cheaper or shorter (Pro → Pro AI, own key → managed, monthly →
 *   yearly, or several of these). Applied now through the Billing Portal, which charges the
 *   difference prorated against the unused time (`always_invoice`).
 * - `shorter_interval`: only the interval shortens (yearly → monthly) on the same plan and option.
 *   Sent to the portal too, whose `shortening_interval` condition defers it to the end of the term.
 * - `downgrade`: the tier or the AI option goes down (Pro AI → Pro, managed → own key), or the
 *   interval shortens together with another change. The server schedules it for the end of the
 *   paid period without proration, so unused time is never refunded or credited. The portal can't
 *   do this: it defers only between prices of one product, and its `decreasing_item_amount`
 *   condition would defer monthly → yearly as well.
 *
 * A price this environment doesn't know is treated as a `downgrade`: nothing is charged or
 * credited now. The caller rejects a change to the same price before asking.
 */
export type PlanChangeKind = 'upgrade' | 'shorter_interval' | 'downgrade'

const TIER_RANK: Record<PaidTierKey, number> = { pro: 0, proAi: 1 }
const AI_MODE_RANK: Record<AiMode, number> = { byok: 0, managed: 1 }
const INTERVAL_RANK: Record<BillingInterval, number> = { monthly: 0, yearly: 1 }

export function classifyPlanChange(
  from: Pick<PlanPrice, 'tierKey' | 'interval' | 'aiMode'> | null,
  to: Pick<PlanPrice, 'tierKey' | 'interval' | 'aiMode'> | null
): PlanChangeKind {
  if (!from || !to) return 'downgrade'
  const tier = TIER_RANK[to.tierKey] - TIER_RANK[from.tierKey]
  // The AI option only compares within Pro AI; a tier change already decides the direction.
  const aiMode =
    tier === 0 && from.aiMode && to.aiMode ? AI_MODE_RANK[to.aiMode] - AI_MODE_RANK[from.aiMode] : 0
  const interval = INTERVAL_RANK[to.interval] - INTERVAL_RANK[from.interval]

  if (tier < 0 || aiMode < 0) return 'downgrade'
  if (interval < 0) return tier === 0 && aiMode === 0 ? 'shorter_interval' : 'downgrade'
  return 'upgrade'
}

/**
 * Reverse-looks-up a Stripe price ID (as stored on `subscriptions.stripe_price_id`)
 * against the known Pro/Pro AI price IDs to recover the display cost, billing
 * interval and Pro AI option (`aiMode`, null for Pro). Returns null if the price ID doesn't
 * match a known price (e.g. a discontinued/legacy price).
 */
export function getPriceInfo(
  priceId: string | null | undefined
): { amount: number; interval: BillingInterval; aiMode: AiMode | null } | null {
  const plan = getPlanForPriceId(priceId)
  return plan ? { amount: plan.amount, interval: plan.interval, aiMode: plan.aiMode } : null
}
