/**
 * planChangeTiming() is the one rule for when a plan change happens: createPlanSwitchSession()
 * (lib/stripe.ts) acts on it and the plan-change confirmation (usePlanChange) describes it before
 * posting, so the dialog promises exactly what the server does. Every pair of the six prices we
 * sell is checked against the refund policy, written out independently here.
 */
import { describe, expect, it } from 'vitest'
import type { AiMode } from '@tabmerger/shared'
import { planChangeTiming, type PlanChangeTiming, type PlanPoint } from '@/lib/planChangeTiming'
import { PLAN_PRICES, type PlanPrice } from '@/lib/tiers'

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
  // Shorter together with another change: the portal applied one of these at once with a credit
  // (Pro yearly → Pro AI monthly, -$35.00), so the server schedules them itself.
  if (shorter && !samePlanOtherwise) return 'end_of_period'
  // Fewer features with the interval kept or longer, or only the interval shortening: Stripe's
  // confirm page defers it to the period end (verified in test mode, 2026-10-26).
  if (fewerFeatures || shorter) return 'portal_end_of_period'
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

  it.each(['monthly', 'yearly'] as const)('defers TabMerger → own key (%s) on the portal, and charges the way back now', (interval) => {
    const managed: PlanPoint = { tierKey: 'proAi', interval, aiMode: 'managed' }
    const byok: PlanPoint = { tierKey: 'proAi', interval, aiMode: 'byok' }
    expect(planChangeTiming(managed, byok)).toBe('portal_end_of_period')
    expect(planChangeTiming(byok, managed)).toBe('portal')
  })

  it('sends the cross-product downgrades verified as deferred to the portal (test mode, 2026-10-26)', () => {
    expect(planChangeTiming(PLANS[2], PLANS[0])).toBe('portal_end_of_period') // Pro AI M → Pro M
    expect(planChangeTiming(PLANS[2], PLANS[4])).toBe('portal_end_of_period') // managed M → own key M
    expect(planChangeTiming(PLANS[4], PLANS[0])).toBe('portal_end_of_period') // own key M → Pro M
    expect(planChangeTiming(PLANS[3], PLANS[1])).toBe('portal_end_of_period') // Pro AI Y → Pro Y
    expect(planChangeTiming(PLANS[3], PLANS[5])).toBe('portal_end_of_period') // managed Y → own key Y
    expect(planChangeTiming(PLANS[5], PLANS[1])).toBe('portal_end_of_period') // own key Y → Pro Y
    expect(planChangeTiming(PLANS[2], PLANS[1])).toBe('portal_end_of_period') // Pro AI M → Pro Y
    expect(planChangeTiming(PLANS[2], PLANS[5])).toBe('portal_end_of_period') // managed M → own key Y
    expect(planChangeTiming(PLANS[4], PLANS[1])).toBe('portal_end_of_period') // own key M → Pro Y
  })

  it('keeps Pro yearly → Pro AI monthly on the server schedule: the portal applied it at once with a -$35 credit', () => {
    expect(planChangeTiming(PLANS[1], PLANS[2])).toBe('end_of_period')
  })

  it('keeps every shorter interval combined with another change on the server schedule', () => {
    expect(planChangeTiming(PLANS[1], PLANS[4])).toBe('end_of_period') // Pro Y → own key M
    expect(planChangeTiming(PLANS[3], PLANS[0])).toBe('end_of_period') // Pro AI Y → Pro M
    expect(planChangeTiming(PLANS[3], PLANS[4])).toBe('end_of_period') // managed Y → own key M
    expect(planChangeTiming(PLANS[5], PLANS[0])).toBe('end_of_period') // own key Y → Pro M
    expect(planChangeTiming(PLANS[5], PLANS[2])).toBe('end_of_period') // own key Y → managed M
  })

  it('treats an unknown price on either side as a downgrade, never an immediate charge', () => {
    expect(planChangeTiming(null, PLANS[2])).toBe('end_of_period')
    expect(planChangeTiming(PLANS[2], null)).toBe('end_of_period')
  })
})

/**
 * The portal decides on its own whether to defer a change, from the configuration's conditions
 * (lib/stripe.ts): `shortening_interval` within one product (documented), and
 * `decreasing_item_amount`, which across products behaved in test mode as a per-month comparison
 * (undocumented). So the timing above only holds while our list prices agree with it: every
 * cross-product change sent to the portal to be deferred must lower the per-month amount, and
 * every cross-product upgrade must raise it, or the portal would apply a downgrade at once (with a
 * credit) or hold back an upgrade. A price change that breaks this fails here.
 */
describe('list prices agree with what the portal defers (PLAN_PRICES)', () => {
  const perMonth = (p: PlanPrice) => (p.interval === 'yearly' ? p.amount / 12 : p.amount)
  const sameProduct = (a: PlanPrice, b: PlanPrice) => a.tierKey === b.tierKey && a.aiMode === b.aiMode
  const name = (p: PlanPrice) => `${label(p)} ($${p.amount})`
  const pairs = PLAN_PRICES.flatMap((from) =>
    PLAN_PRICES.filter((to) => to !== from).map((to) => [name(from), name(to), from, to] as const)
  )
  const deferred = pairs.filter(([, , from, to]) => planChangeTiming(from, to) === 'portal_end_of_period')
  const crossDeferred = deferred.filter(([, , from, to]) => !sameProduct(from, to))
  const sameDeferred = deferred.filter(([, , from, to]) => sameProduct(from, to))
  const crossUpgrades = pairs.filter(([, , from, to]) => !sameProduct(from, to) && planChangeTiming(from, to) === 'portal')

  it('has all six prices and pairs of each kind to check', () => {
    expect(PLAN_PRICES).toHaveLength(6)
    expect(crossDeferred.length).toBeGreaterThan(0)
    expect(sameDeferred.length).toBeGreaterThan(0)
    expect(crossUpgrades.length).toBeGreaterThan(0)
  })

  it.each(crossDeferred)('portal_end_of_period %s → %s costs less per month', (_f, _t, from, to) => {
    expect(perMonth(to)).toBeLessThan(perMonth(from))
  })

  // Within one product the portal defers on the shorter interval itself; per month a monthly
  // price costs more than the yearly one, so this case can't rest on decreasing_item_amount.
  it.each(sameDeferred)('portal_end_of_period %s → %s only shortens the interval', (_f, _t, from, to) => {
    expect([from.interval, to.interval]).toEqual(['yearly', 'monthly'])
  })

  it.each(crossUpgrades)('portal upgrade %s → %s costs more per month', (_f, _t, from, to) => {
    expect(perMonth(to)).toBeGreaterThan(perMonth(from))
  })
})
