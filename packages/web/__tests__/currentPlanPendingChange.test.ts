/**
 * getCurrentPlan({ withPendingChange }) in lib/currentPlan.ts: the pricing page's read of a plan
 * change already scheduled for the period end. It reuses getPendingPlanChange() (the account
 * page's source) with the user's own customer and subscription, maps the target price to a plan,
 * and treats no billing account or a failed read as "none". Off by default, so the home page's
 * teaser makes no Stripe call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const END = 1_795_757_962 // 2026-11-26

const db = vi.hoisted(() => ({
  subscription: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  tables: [] as string[],
  eqs: [] as [string, string, unknown][],
}))
const stripeMock = vi.hoisted(() => ({ getPendingPlanChange: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      db.tables.push(table)
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.order = chain
      builder.limit = chain
      builder.eq = (column: string, value: unknown) => {
        db.eqs.push([table, column, value])
        return builder
      }
      builder.maybeSingle = async () => ({ data: table === 'subscriptions' ? db.subscription : db.profile })
      return builder
    },
  }),
}))
vi.mock('@/lib/stripe', () => stripeMock)

import { getCurrentPlan } from '@/lib/currentPlan'

const PAID = {
  id: 'sub_1',
  tier: 'pro_ai',
  status: 'active',
  stripe_price_id: 'price_ai_m',
  ai_mode: 'managed',
  current_period_end: new Date(END * 1000).toISOString(),
}

beforeEach(() => {
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID', 'price_byok_y')
  db.subscription = PAID
  db.profile = { stripe_customer_id: 'cus_1' }
  db.tables = []
  db.eqs = []
  stripeMock.getPendingPlanChange.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('getCurrentPlan({ withPendingChange: true })', () => {
  it('maps the scheduled price to its plan and the date to ISO, reading the own customer and subscription', async () => {
    stripeMock.getPendingPlanChange.mockResolvedValue({ priceId: 'price_pro_m', effectiveAt: END })
    const plan = await getCurrentPlan({ withPendingChange: true })

    expect(plan.pendingChange).toEqual({
      plan: { tierKey: 'pro', interval: 'monthly', aiMode: null },
      effectiveAt: new Date(END * 1000).toISOString(),
    })
    expect(stripeMock.getPendingPlanChange).toHaveBeenCalledWith({ customerId: 'cus_1', subscriptionId: 'sub_1' })
    // The customer id comes from the signed-in user's own profile row.
    expect(db.eqs).toContainEqual(['profiles', 'id', 'user-1'])
    // The rest of the plan is unchanged.
    expect(plan).toMatchObject({ signedIn: true, tier: 'pro_ai', interval: 'monthly', aiMode: 'managed' })
  })

  it('maps a Pro AI option change too', async () => {
    stripeMock.getPendingPlanChange.mockResolvedValue({ priceId: 'price_byok_y', effectiveAt: END })
    expect((await getCurrentPlan({ withPendingChange: true })).pendingChange?.plan).toEqual({
      tierKey: 'proAi',
      interval: 'yearly',
      aiMode: 'byok',
    })
  })

  it('keeps a change to a price this deployment does not sell, with no plan', async () => {
    stripeMock.getPendingPlanChange.mockResolvedValue({ priceId: 'price_legacy', effectiveAt: END })
    expect((await getCurrentPlan({ withPendingChange: true })).pendingChange).toEqual({
      plan: null,
      effectiveAt: new Date(END * 1000).toISOString(),
    })
  })

  it('is null when nothing is scheduled', async () => {
    stripeMock.getPendingPlanChange.mockResolvedValue(null)
    expect((await getCurrentPlan({ withPendingChange: true })).pendingChange).toBeNull()
  })

  it('is null, with no Stripe call, without a billing account', async () => {
    db.profile = { stripe_customer_id: null }
    expect((await getCurrentPlan({ withPendingChange: true })).pendingChange).toBeNull()
    expect(stripeMock.getPendingPlanChange).not.toHaveBeenCalled()
  })

  it('is null, with no Stripe call, for a row without a subscription id', async () => {
    db.subscription = { ...PAID, id: null }
    expect((await getCurrentPlan({ withPendingChange: true })).pendingChange).toBeNull()
    expect(stripeMock.getPendingPlanChange).not.toHaveBeenCalled()
  })

  it('treats a failed Stripe read as none instead of failing the page', async () => {
    stripeMock.getPendingPlanChange.mockRejectedValue(new Error('Stripe is down'))
    const plan = await getCurrentPlan({ withPendingChange: true })
    expect(plan.pendingChange).toBeNull()
    expect(plan.tier).toBe('pro_ai')
  })

  it('reads nothing for a plan that is not entitled', async () => {
    db.subscription = { ...PAID, status: 'canceled' }
    const plan = await getCurrentPlan({ withPendingChange: true })
    expect(plan).toEqual({ signedIn: true, tier: 'free', periodEnd: null })
    expect(stripeMock.getPendingPlanChange).not.toHaveBeenCalled()
  })
})

describe('getCurrentPlan() by default', () => {
  it('makes no Stripe call and leaves pendingChange out (the home page teaser)', async () => {
    const plan = await getCurrentPlan()
    expect(plan.pendingChange).toBeUndefined()
    expect(stripeMock.getPendingPlanChange).not.toHaveBeenCalled()
    expect(db.tables).not.toContain('profiles')
  })
})
