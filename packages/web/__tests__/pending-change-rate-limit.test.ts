/**
 * Reading a scheduled plan change costs a Stripe `subscriptions.retrieve`, and Stripe's read limit
 * is per account, so `getCurrentPlan({ withPendingChange: true })` (GET /api/plan?pendingChange=1)
 * counts each read per user in its own bucket. Over the limit the plan comes back with
 * `pendingChange: null`, never an error; guests and unentitled accounts return before the limiter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  subscription: null as Record<string, unknown> | null,
  profile: { stripe_customer_id: 'cus_1' } as Record<string, unknown> | null,
}))
const stripe = vi.hoisted(() => ({ getPendingPlanChange: vi.fn() }))
const limiter = vi.hoisted(() => ({ takeRateLimit: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.order = chain
      builder.limit = chain
      builder.eq = chain
      builder.maybeSingle = async () => ({ data: table === 'subscriptions' ? db.subscription : db.profile })
      return builder
    },
  }),
}))
vi.mock('@/lib/stripe', () => stripe)
vi.mock('@/lib/rateLimit', () => limiter)

import { getCurrentPlan, PENDING_CHANGE_RATE_LIMIT } from '@/lib/currentPlan'
import { GET } from '@/app/api/plan/route'

const PAID = {
  id: 'sub_1',
  tier: 'pro',
  status: 'active',
  stripe_price_id: null,
  ai_mode: null,
  current_period_end: '2026-11-26T12:00:00.000Z',
}

beforeEach(() => {
  db.user = { id: 'user-1' }
  db.subscription = PAID
  db.profile = { stripe_customer_id: 'cus_1' }
  stripe.getPendingPlanChange.mockReset()
  stripe.getPendingPlanChange.mockResolvedValue({ priceId: 'price_unknown', effectiveAt: 1_795_757_962 })
  limiter.takeRateLimit.mockReset()
  limiter.takeRateLimit.mockResolvedValue({ kind: 'allowed' })
})

describe('PENDING_CHANGE_RATE_LIMIT', () => {
  it('is its own fail-open bucket, separate from the billing routes', () => {
    expect(PENDING_CHANGE_RATE_LIMIT.name).toBe('plan_pending_change')
    expect(PENDING_CHANGE_RATE_LIMIT.name).not.toBe('billing')
    expect(PENDING_CHANGE_RATE_LIMIT.onError).toBe('allow')
    expect(PENDING_CHANGE_RATE_LIMIT.limits).toEqual([
      { windowSeconds: 60, max: 10 },
      { windowSeconds: 3600, max: 60 },
    ])
  })
})

describe('getCurrentPlan({ withPendingChange: true }) rate limit', () => {
  it('counts the read for the signed-in user before calling Stripe', async () => {
    const plan = await getCurrentPlan({ withPendingChange: true })
    expect(limiter.takeRateLimit).toHaveBeenCalledWith(PENDING_CHANGE_RATE_LIMIT, 'user-1')
    expect(stripe.getPendingPlanChange).toHaveBeenCalledTimes(1)
    expect(plan.pendingChange).toEqual({ plan: null, effectiveAt: new Date(1_795_757_962 * 1000).toISOString() })
  })

  it('over the limit: the plan without its scheduled change, and no Stripe call', async () => {
    limiter.takeRateLimit.mockResolvedValue({ kind: 'limited', retryAfterSeconds: 30 })
    const plan = await getCurrentPlan({ withPendingChange: true })
    expect(stripe.getPendingPlanChange).not.toHaveBeenCalled()
    expect(plan).toMatchObject({ signedIn: true, tier: 'pro', pendingChange: null })
  })

  it('never counts a guest, an unentitled account or a read without the scheduled change', async () => {
    db.user = null
    await getCurrentPlan({ withPendingChange: true })
    db.user = { id: 'user-1' }
    db.subscription = { ...PAID, status: 'canceled' }
    await getCurrentPlan({ withPendingChange: true })
    db.subscription = PAID
    await getCurrentPlan()
    expect(limiter.takeRateLimit).not.toHaveBeenCalled()
    expect(stripe.getPendingPlanChange).not.toHaveBeenCalled()
  })
})

describe('GET /api/plan?pendingChange=1 over the limit', () => {
  it('answers 200 with the plan and pendingChange null, still private and uncacheable', async () => {
    limiter.takeRateLimit.mockResolvedValue({ kind: 'limited', retryAfterSeconds: 30 })
    const res = await GET(new NextRequest('http://localhost/api/plan?pendingChange=1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toMatchObject({ signedIn: true, tier: 'pro', pendingChange: null })
    expect(stripe.getPendingPlanChange).not.toHaveBeenCalled()
  })
})
