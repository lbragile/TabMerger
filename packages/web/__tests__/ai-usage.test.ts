import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkAndIncrementAIUsage,
  getEffectiveCap,
  AI_MONTHLY_CAP,
  CREDIT_COSTS,
} from '@/lib/ai-usage'

const upsert = vi.fn(async () => ({ error: null }))

/**
 * Minimal Supabase stub: `subscriptions` resolves via .single(), `ai_usage` via
 * .maybeSingle(), and `ai_credit_purchases` is awaited directly (no terminal
 * method), like a real multi-row select — so it's made thenable.
 */
function makeSupabase(sub: unknown, usage: unknown, purchases: { credits: number }[] = []) {
  const from = vi.fn((table: string) => {
    if (table === 'ai_credit_purchases') {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: purchases })
      return b
    }
    const b: Record<string, unknown> = { upsert }
    b.select = () => b
    b.eq = () => b
    b.single = async () => ({ data: sub })
    b.maybeSingle = async () => ({ data: usage })
    void table
    return b
  })
  return { supabase: { from } as unknown as SupabaseClient, from }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-15T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('checkAndIncrementAIUsage', () => {
  it('allows an active pro_ai user with no prior usage and records the first request', async () => {
    const { supabase } = makeSupabase({ tier: 'pro_ai', status: 'active' }, null)
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: true,
      remaining: AI_MONTHLY_CAP - 1,
    })
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'u1', month: '2026-03', credits_used: 1 },
      { onConflict: 'user_id,month' }
    )
  })

  it('increments an existing count for the current month', async () => {
    const { supabase } = makeSupabase({ tier: 'pro_ai', status: 'active' }, { credits_used: 9 })
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: true,
      remaining: AI_MONTHLY_CAP - 10,
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ credits_used: 10 }),
      expect.anything()
    )
  })

  it.each([
    ['no subscription row', null],
    ['free tier', { tier: 'free', status: 'active' }],
    ['pro (non-AI) tier', { tier: 'pro', status: 'active' }],
    ['canceled pro_ai', { tier: 'pro_ai', status: 'canceled' }],
  ])('denies %s without touching ai_usage', async (_label, sub) => {
    const { supabase } = makeSupabase(sub, null)
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: false,
      remaining: 0,
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('denies once the monthly cap is reached and does not increment further', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: AI_MONTHLY_CAP }
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: false,
      remaining: 0,
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('allows the final request of the month, leaving zero remaining', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: AI_MONTHLY_CAP - 1 }
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: true,
      remaining: 0,
    })
  })

  it('denies a high-cost call that would push usage over the cap even though it is not yet at the cap', async () => {
    // 295 + 8 = 303 > 300 — a single expensive call must not be allowed just
    // because currentCount alone is under the cap (the old `>=` check would
    // have wrongly allowed this).
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: 295 }
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.groupTabs)).toEqual({
      allowed: false,
      remaining: 0,
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('allows a high-cost call that exactly fills the remaining cap', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: 292 }
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.groupTabs)).toEqual({
      allowed: true,
      remaining: 0,
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ credits_used: 300 }),
      expect.anything()
    )
  })

  it('buckets usage by UTC month', async () => {
    vi.setSystemTime(new Date('2026-12-31T23:59:59Z'))
    const { supabase } = makeSupabase({ tier: 'pro_ai', status: 'active' }, null)
    await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ month: '2026-12' }),
      expect.anything()
    )
  })
})

describe('checkAndIncrementAIUsage � purchased credits never replace the subscription check', () => {
  it.each([
    ['free', { tier: 'free', status: 'active' }],
    ['pro', { tier: 'pro', status: 'active' }],
    ['pro_ai but canceled', { tier: 'pro_ai', status: 'canceled' }],
    ['pro_ai but past_due', { tier: 'pro_ai', status: 'past_due' }],
    ['no subscription row', null],
  ])('denies a %s account that holds purchased credits, and records nothing', async (_label, sub) => {
    const { supabase, from } = makeSupabase(sub, null, [{ credits: 500 }])
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: false,
      remaining: 0,
    })
    expect(upsert).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalledWith('ai_credit_purchases')
  })
})

describe('getEffectiveCap', () => {
  it('returns the base cap when there are no purchases', async () => {
    const { supabase } = makeSupabase(null, null, [])
    expect(await getEffectiveCap(supabase, 'u1')).toBe(AI_MONTHLY_CAP)
  })

  it("adds the sum of the month's purchased credit packs", async () => {
    const { supabase } = makeSupabase(null, null, [{ credits: 50 }, { credits: 25 }])
    expect(await getEffectiveCap(supabase, 'u1')).toBe(AI_MONTHLY_CAP + 75)
  })

  it('queries ai_credit_purchases for the given month', async () => {
    const { supabase, from } = makeSupabase(null, null, [])
    await getEffectiveCap(supabase, 'u1', '2025-01')
    expect(from).toHaveBeenCalledWith('ai_credit_purchases')
  })
})

describe('checkAndIncrementAIUsage — purchased AI credit packs extend the monthly cap', () => {
  it('behaves exactly as today when the user has 0 purchased credits (cap stays at base)', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: AI_MONTHLY_CAP },
      []
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: false,
      remaining: 0,
    })
  })

  it('allows a request past the base cap when purchased credits cover it', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: AI_MONTHLY_CAP },
      [{ credits: 50 }]
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: true,
      remaining: AI_MONTHLY_CAP + 50 - (AI_MONTHLY_CAP + 1),
    })
  })

  it('sums multiple credit-pack purchases for the same month', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: AI_MONTHLY_CAP },
      [{ credits: 50 }, { credits: 50 }]
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: true,
      remaining: AI_MONTHLY_CAP + 100 - (AI_MONTHLY_CAP + 1),
    })
  })

  it('denies once credits_used exceeds base cap + purchased credits', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: AI_MONTHLY_CAP + 50 },
      [{ credits: 50 }]
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: false,
      remaining: 0,
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('remaining reflects the purchased-credit-extended cap, not just the base cap', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { credits_used: 0 },
      [{ credits: 50 }]
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1', CREDIT_COSTS.nameGroup)).toEqual({
      allowed: true,
      remaining: AI_MONTHLY_CAP + 50 - 1,
    })
  })
})
