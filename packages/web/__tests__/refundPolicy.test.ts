/**
 * The refund policy (docs/PAYMENTS.md, "Refund policy"): all purchases are non-refundable; a change
 * that extends or raises a plan is charged now, prorated (the unused old time netted against the
 * new charge, never more than it); anything that lowers or shortens it waits for the end of the
 * paid period with no refund or credit, TabMerger's AI → own key included; cancelling never
 * refunds; AI credit packs are never refunded.
 *
 * classifyPlanChange says what a change is; whether Stripe's confirm page or our server defers it
 * is planChangeTiming's decision (planChangeTiming.test.ts).
 *
 * Covers the classification every plan switch goes through (classifyPlanChange in lib/tiers.ts)
 * and a scan of the server code for any call that could hand money back: there must be none, so a
 * cancellation (done only in the Billing Portal, at period end) or a credit pack can't be refunded
 * by our code. How each kind is applied is tested in stripeIntervalSwitch.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { TIERS, classifyPlanChange, type PlanPrice } from '@/lib/tiers'

type Point = Pick<PlanPrice, 'tierKey' | 'interval' | 'aiMode'>
const pro = (interval: Point['interval']): Point => ({ tierKey: 'pro', interval, aiMode: null })
const managed = (interval: Point['interval']): Point => ({ tierKey: 'proAi', interval, aiMode: 'managed' })
const byok = (interval: Point['interval']): Point => ({ tierKey: 'proAi', interval, aiMode: 'byok' })

describe('classifyPlanChange', () => {
  it.each<[string, Point, Point]>([
    ['Pro monthly → yearly', pro('monthly'), pro('yearly')],
    ['Pro → Pro AI (managed)', pro('monthly'), managed('monthly')],
    ['Pro → Pro AI (own key)', pro('yearly'), byok('yearly')],
    ['Pro monthly → Pro AI yearly', pro('monthly'), managed('yearly')],
    ['own key → managed', byok('monthly'), managed('monthly')],
    ['own key monthly → managed yearly', byok('monthly'), managed('yearly')],
    ['own key monthly → yearly', byok('monthly'), byok('yearly')],
  ])('%s is an upgrade: applied now, prorated', (_label, from, to) => {
    expect(classifyPlanChange(from, to)).toBe('upgrade')
  })

  it.each<[string, Point, Point]>([
    ['Pro yearly → monthly', pro('yearly'), pro('monthly')],
    ['managed yearly → monthly', managed('yearly'), managed('monthly')],
    ['own key yearly → monthly', byok('yearly'), byok('monthly')],
  ])('%s only shortens the interval', (_label, from, to) => {
    expect(classifyPlanChange(from, to)).toBe('shorter_interval')
  })

  it.each<[string, Point, Point]>([
    ['Pro AI → Pro', managed('monthly'), pro('monthly')],
    ['Pro AI yearly → Pro yearly', managed('yearly'), pro('yearly')],
    ['Pro AI monthly → Pro yearly (a longer interval does not make a lower plan an upgrade)', managed('monthly'), pro('yearly')],
    ['own-key Pro AI → Pro', byok('monthly'), pro('monthly')],
    ['managed → own key', managed('monthly'), byok('monthly')],
    ['managed monthly → own key yearly', managed('monthly'), byok('yearly')],
    ['own key yearly → managed monthly (shorter, with another change)', byok('yearly'), managed('monthly')],
    ['Pro yearly → Pro AI monthly (shorter, with another change)', pro('yearly'), managed('monthly')],
  ])('%s is a downgrade: end of the paid period, no proration', (_label, from, to) => {
    expect(classifyPlanChange(from, to)).toBe('downgrade')
  })

  it('a price this environment does not know fails closed (nothing charged or credited now)', () => {
    expect(classifyPlanChange(null, pro('yearly'))).toBe('downgrade')
    expect(classifyPlanChange(pro('monthly'), null)).toBe('downgrade')
  })
})

describe('an upgrade never nets to a credit at our list prices', () => {
  // Applied at once with always_invoice, an upgrade charges the new price (prorated on the same
  // interval, in full with a new anchor on monthly → yearly) and nets the unused old time against it.
  // The unused time is worth at most the old period's price, so the invoice stays positive as long
  // as the new period's price is above the old one. The webhook's plan-change alarm treats any
  // negative plan-change invoice as a refund-policy violation (lib/planChangeAlarm.ts).
  const amount = (p: Point): number => {
    const prices = p.tierKey === 'pro' ? TIERS.pro : p.aiMode === 'byok' ? TIERS.proAi.byok : TIERS.proAi
    return p.interval === 'yearly' ? prices.yearlyPrice : prices.monthlyPrice
  }
  const plans: Point[] = (['monthly', 'yearly'] as const).flatMap((i) => [pro(i), managed(i), byok(i)])
  const upgrades = plans.flatMap((from) =>
    plans.filter((to) => to !== from && classifyPlanChange(from, to) === 'upgrade').map((to) => [from, to] as const)
  )

  it('has upgrades to check', () => {
    expect(upgrades.length).toBeGreaterThan(0)
  })

  it.each(upgrades)('%o → %o costs more per period than the period it replaces', (from, to) => {
    expect(amount(to)).toBeGreaterThan(amount(from))
  })
})

/** Every server source file of the web app: routes, lib and scripts, never tests. */
function serverSources(): { path: string; text: string }[] {
  const root = join(__dirname, '..')
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
        out.push({ path: relative(root, full).split(sep).join('/'), text: readFileSync(full, 'utf8') })
      }
    }
  }
  for (const dir of ['app', 'lib', 'scripts']) walk(join(root, dir))
  return out
}

describe('no server code hands money back', () => {
  const sources = serverSources()

  it('finds the server sources (the scan is not vacuous)', () => {
    const paths = sources.map((s) => s.path)
    expect(paths).toContain('lib/stripe.ts')
    expect(paths).toContain('app/api/webhooks/stripe/route.ts')
    expect(paths).toContain('lib/ai-usage.ts')
  })

  it.each([
    ['a refund', /\.refunds\./],
    ['a credit note', /creditNotes/],
    ['a customer balance adjustment', /createBalanceTransaction|balanceTransactions/],
    ['a cancellation', /subscriptions\.(cancel|del)\(|subscriptionSchedules\.cancel\(/],
    ['an immediate prorated cancellation', /invoice_now|prorate\s*:/],
    ['prorations that create a credit', /create_prorations/],
  ])('nothing issues %s', (_label, pattern) => {
    expect(sources.filter((s) => pattern.test(s.text)).map((s) => s.path)).toEqual([])
  })

  it('only the upgrade path in lib/stripe.ts charges a proration (always_invoice)', () => {
    const charging = /proration_behavior:\s*['"]always_invoice['"]/
    expect(sources.filter((s) => charging.test(s.text)).map((s) => s.path)).toEqual(['lib/stripe.ts'])
  })
})
