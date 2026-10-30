import { useTranslations } from 'next-intl'
import { FREE_TIER_LIMITS, PRO_AI_MONTHLY_CREDITS, type AiMode } from '@tabmerger/shared'
import type { TierKey } from '@/lib/tiers'

/** A key under `pricing.features` and the values its message needs. */
interface FeatureLine {
  key:
    | 'upToGroups'
    | 'upToTabs'
    | 'upToUrlRules'
    | 'saveSessions'
    | 'localOnly'
    | 'importExport'
    | 'dragDrop'
    | 'shortcuts'
    | 'everythingInFree'
    | 'unlimited'
    | 'cloudSync'
    | 'sessionsSynced'
    | 'autoBackups'
    | 'prioritySupport'
    | 'everythingInPro'
    | 'aiGrouping'
    | 'aiNames'
    | 'aiDescribe'
    | 'smartSessions'
    | 'aiOrganize'
    | 'tabPreview'
    | 'aiCreditsMonthly'
    | 'ownApiKey'
    | 'chooseModel'
  count?: number
  /** "Everything in X": a capability the plan below already has (a check mark, not a +). */
  inherited?: boolean
}

/**
 * Each plan's feature lines, in the order `PRICING_TIERS` (`@tabmerger/shared`) lists them. The
 * shared list stays the single source of what is sold; a test renders these in English and
 * checks they read exactly like it, so the two can't drift.
 */
export const TIER_FEATURE_LINES: Record<TierKey, readonly FeatureLine[]> = {
  free: [
    { key: 'upToGroups', count: FREE_TIER_LIMITS.groups },
    { key: 'upToTabs', count: FREE_TIER_LIMITS.tabs },
    { key: 'upToUrlRules', count: FREE_TIER_LIMITS.urlRules },
    { key: 'saveSessions', count: FREE_TIER_LIMITS.sessions },
    { key: 'localOnly' },
    { key: 'importExport' },
    { key: 'dragDrop' },
    { key: 'shortcuts' },
  ],
  pro: [
    { key: 'everythingInFree', inherited: true },
    { key: 'unlimited' },
    { key: 'cloudSync' },
    { key: 'sessionsSynced' },
    { key: 'autoBackups' },
    { key: 'prioritySupport' },
  ],
  proAi: [
    { key: 'everythingInPro', inherited: true },
    { key: 'aiGrouping' },
    { key: 'aiNames' },
    { key: 'aiDescribe' },
    { key: 'smartSessions' },
    { key: 'aiOrganize' },
    { key: 'tabPreview' },
    { key: 'aiCreditsMonthly', count: PRO_AI_MONTHLY_CREDITS },
    { key: 'chooseModel' },
  ],
}

/**
 * Pro AI's own-key option (`PRICING_TIERS` pro_ai `.byok.features`), in the same order. Same
 * parity test as {@link TIER_FEATURE_LINES}.
 */
export const PRO_AI_BYOK_FEATURE_LINES: readonly FeatureLine[] = [
  { key: 'everythingInPro', inherited: true },
  { key: 'aiGrouping' },
  { key: 'aiNames' },
  { key: 'aiDescribe' },
  { key: 'smartSessions' },
  { key: 'aiOrganize' },
  { key: 'tabPreview' },
  { key: 'ownApiKey' },
  { key: 'chooseModel' },
]

export interface TierFeature {
  text: string
  inherited: boolean
}

/**
 * A plan's feature lines in the active locale. `aiMode` picks Pro AI's option (`byok` is the
 * own-key list); it's ignored for the other plans.
 */
export function useTierFeatures(): (tier: TierKey, aiMode?: AiMode) => TierFeature[] {
  const t = useTranslations('pricing.features')
  return (tier, aiMode = 'managed') =>
    (tier === 'proAi' && aiMode === 'byok' ? PRO_AI_BYOK_FEATURE_LINES : TIER_FEATURE_LINES[tier]).map(({ key, count, inherited = false }) => ({
      // Lines without a number have no placeholder; passing `count` to them is harmless.
      text: t(key as 'upToGroups', { count: count ?? 0 }),
      inherited,
    }))
}

/** A plan's display name ("Free", "Pro", "Pro AI") in the active locale. */
export function useTierName(): (tier: TierKey) => string {
  const t = useTranslations('pricing.tierNames')
  return (tier) => t(tier)
}
