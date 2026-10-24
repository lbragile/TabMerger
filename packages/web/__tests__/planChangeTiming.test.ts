/**
 * planChangeTiming() is the one rule for when a plan change happens: createPlanSwitchSession()
 * (lib/stripe.ts) acts on it and the plan-change confirmation (usePlanChange) describes it before
 * posting, so the dialog promises exactly what the server does. Every pair of the six prices we
 * sell is checked against the refund policy, written out independently here.
 */
import { describe, expect, it } from 'vitest'
import type { AiMode } from '@tabmerger/shared'
import { planChangeTiming, type PlanChangeTiming, type PlanPoint } from '@/lib/planChangeTiming'

const PLANS: PlanPoint[] = [
  { tierKey: 'pro', interval: 'monthly', aiMode: null },
  { tierKey: 'pro', interval: 'yearly', aiMode: null },
  { tierKey: 'proAi', interval: 'monthly', aiMode: 'managed' },
  { tierKey: 'proAi', interval: 'yearly', aiMode: 'managed' },
  { tierKey: 'proAi', interval: 'monthly', aiMode: 'byok' },
  { tierKey: 'proAi', interval: 'yearly', aiMode: 'byok' },
]

const label = (p: PlanPoint) => `${p.tierKey}${p.aiMode ? `/${p.aiMode}` : ''}/${p.interval}`

/** The refund policy (docs/PAYMENTS.md), stated plainly. */
function expected(from: PlanPoint, to: PlanPoint): PlanChangeTiming {
  const fewerFeatures =
    (from.tierKey === 'proAi' && to.tierKey === 'pro') ||
    (from.tierKey === 'proAi' && to.tierKey === 'proAi' && from.aiMode === 'managed' && to.aiMode === ('byok' as AiMode))
  const shorter = from.interval === 'yearly' && to.interval === 'monthly'
  const samePlanOtherwise = from.tierKey === to.tierKey && from.aiMode === to.aiMode
  // Something gets cheaper: the server schedules it for the end of the paid period, no refund.
  if (fewerFeatures || (shorter && !samePlanOtherwise)) return 'end_of_period'
  // Only the interval gets shorter on the same plan and option (one product): the portal defers it.
  if (shorter) return 'portal_end_of_period'
  // An upgrade, own-key prices included: confirmed on Stripe's own page and charged, prorated.
  return 'portal'
}

const PAIRS = PLANS.flatMap((from) => PLANS.map((to) => [label(from), label(to), from, to] as const))

describe('planChangeTiming', () => {
  it('covers all 36 pairs of the prices we sell', () => {
    expect(PAIRS).toHaveLength(36)
  })

  it.each(PAIRS)('%s → %s follows the refund policy', (_from, _to, from, to) => {
    expect(planChangeTiming(from, to)).toBe(expected(from, to))
  })

  it('never answers an immediate change made by our server: upgrades always go through Stripe', () => {
    const timings = new Set(PAIRS.map(([, , from, to]) => planChangeTiming(from, to)))
    expect([...timings].sort()).toEqual(['end_of_period', 'portal', 'portal_end_of_period'])
  })

  it('treats an unknown price on either side as a downgrade, never an immediate charge', () => {
    expect(planChangeTiming(null, PLANS[2])).toBe('end_of_period')
    expect(planChangeTiming(PLANS[2], null)).toBe('end_of_period')
  })
})
