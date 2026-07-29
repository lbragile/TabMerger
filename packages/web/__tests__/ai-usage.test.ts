import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkAndIncrementAIUsage, AI_MONTHLY_CAP } from '@/lib/ai-usage'

const upsert = vi.fn(async () => ({ error: null }))

/** Minimal Supabase stub: `subscriptions` resolves via .single(), `ai_usage` via .maybeSingle(). */
function makeSupabase(sub: unknown, usage: unknown) {
  const from = vi.fn((table: string) => {
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
    expect(await checkAndIncrementAIUsage(supabase, 'u1')).toEqual({
      allowed: true,
      remaining: AI_MONTHLY_CAP - 1,
    })
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'u1', month: '2026-03', request_count: 1 },
      { onConflict: 'user_id,month' }
    )
  })

  it('increments an existing count for the current month', async () => {
    const { supabase } = makeSupabase({ tier: 'pro_ai', status: 'active' }, { request_count: 9 })
    expect(await checkAndIncrementAIUsage(supabase, 'u1')).toEqual({
      allowed: true,
      remaining: AI_MONTHLY_CAP - 10,
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ request_count: 10 }),
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
    expect(await checkAndIncrementAIUsage(supabase, 'u1')).toEqual({ allowed: false, remaining: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('denies once the monthly cap is reached and does not increment further', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { request_count: AI_MONTHLY_CAP }
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1')).toEqual({ allowed: false, remaining: 0 })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('allows the final request of the month, leaving zero remaining', async () => {
    const { supabase } = makeSupabase(
      { tier: 'pro_ai', status: 'active' },
      { request_count: AI_MONTHLY_CAP - 1 }
    )
    expect(await checkAndIncrementAIUsage(supabase, 'u1')).toEqual({ allowed: true, remaining: 0 })
  })

  it('buckets usage by UTC month', async () => {
    vi.setSystemTime(new Date('2026-12-31T23:59:59Z'))
    const { supabase } = makeSupabase({ tier: 'pro_ai', status: 'active' }, null)
    await checkAndIncrementAIUsage(supabase, 'u1')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ month: '2026-12' }),
      expect.anything()
    )
  })
})
