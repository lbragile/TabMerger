import type { AiMode } from '@tabmerger/shared'

/**
 * How a plan card relates to the visitor's current plan, shared by the pricing page's cards and
 * the home page's teaser so both apply one rule.
 *
 * Tier names come in two shapes: the database's (`subscriptions.tier`: `free`, `pro`, `pro_ai`)
 * and the checkout API / `TIERS` config's (`free`, `pro`, `proAi`). Both are accepted.
 */
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, proAi: 2, pro_ai: 2 }

/** The database shape of a tier name (`proAi` becomes `pro_ai`; the others are unchanged). */
export function normalizeTier(tier: string): string {
  return tier === 'proAi' ? 'pro_ai' : tier
}

export interface PlanCardStatusInput {
  /** This card's plan, in either shape. */
  tier: string
  /** The visitor's plan; undefined when the caller has none to compare against. */
  currentTier?: string
  /** Pro AI cards only: the option on show. */
  aiMode?: AiMode
  /** A Pro AI subscriber's option; treated as TabMerger's AI (`managed`) when unknown. */
  currentAiMode?: AiMode
  /** Whether this card is the one the listing recommends (Pro). */
  highlighted?: boolean
}

export interface PlanCardStatus {
  /** Same tier as the visitor's, whichever Pro AI option is on show. */
  isSameTier: boolean
  /** The visitor's plan exactly: for Pro AI, also the option on show. Shown as "Current". */
  isCurrentPlan: boolean
  /** Below the visitor's tier (a downgrade). */
  isBelowCurrentTier: boolean
  /** Recommended, unless the visitor already has this plan or one above it. */
  showRecommended: boolean
}

export function planCardStatus({
  tier,
  currentTier,
  aiMode = 'managed',
  currentAiMode,
  highlighted = false,
}: PlanCardStatusInput): PlanCardStatus {
  const isProAi = normalizeTier(tier) === 'pro_ai'
  const isSameTier = !!currentTier && normalizeTier(currentTier) === normalizeTier(tier)
  // A Pro AI subscriber's plan is one option: the other option's card is a switch, not "Current".
  const isCurrentPlan = isSameTier && (!isProAi || (currentAiMode ?? 'managed') === aiMode)
  // A signed-out visitor comes in as 'free' (or with no currentTier): below every paid card.
  const isBelowCurrentTier =
    !!currentTier && TIER_RANK[normalizeTier(tier)] < TIER_RANK[normalizeTier(currentTier)]
  // Never recommend a tier the user already has or has surpassed.
  const showRecommended = highlighted && !isCurrentPlan && !isBelowCurrentTier
  return { isSameTier, isCurrentPlan, isBelowCurrentTier, showRecommended }
}
