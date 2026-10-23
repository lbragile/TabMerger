/**
 * Tests for lib/ai-usage.ts: the plan check, the displayed cap, and the thin wrappers over
 * the migration-022 credit RPCs. The database's own atomicity (two reservations can never
 * both pass on the same headroom) is a property of `ai_reserve_credits` and is covered by
 * the SQL tests; here the wrappers' arguments and result handling are checked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PRO_AI_MONTHLY_CREDITS } from '@tabmerger/shared'
import {
  AI_MONTHLY_CAP,
  currentMonth,
  getAiSubscription,
  getEffectiveCap,
  hasProAi,
  reserveCredits,
  settleCredits,
} from '@/lib/ai-usage'

/**
 * Minimal Supabase stub: `subscriptions` resolves via .single(), `ai_credit_purchases` is
 * awaited directly like a real multi-row select, and `rpc` is a spy.
 */
function makeSupabase(sub: unknown, purchases: { credits: number }[] = [], rpc = vi.fn()) {
  const eq = vi.fn()
  const from = vi.fn((table: string) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (...args: unknown[]) => {
      eq(table, ...args)
      return b
    }
    b.single = async () => ({ data: sub })
    b.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: purchases })
    return b
  })
  return { supabase: { from, rpc } as unknown as SupabaseClient, from, rpc, eq }
}

const MANAGED = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ai_monthly_credits: 2600 }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-15T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AI_MONTHLY_CAP (deprecated alias)', () => {
  it('equals the shared managed allowance', () => {
    expect(AI_MONTHLY_CAP).toBe(PRO_AI_MONTHLY_CREDITS)
  })
})

describe('currentMonth', () => {
  it('is the UTC month', () => {
    vi.setSystemTime(new Date('2026-03-31T23:30:00-05:00'))
    expect(currentMonth()).toBe('2026-04')
  })
})

describe('getAiSubscription / hasProAi', () => {
  it('reads tier, status, AI option and allowance', async () => {
    const { supabase } = makeSupabase(MANAGED)
    expect(await getAiSubscription(supabase, 'u1')).toEqual({
      tier: 'pro_ai',
      status: 'active',
      aiMode: 'managed',
      monthlyCredits: 2600,
    })
  })

  it('defaults a missing or unknown AI option to managed and a bad allowance to 0', async () => {
    const { supabase } = makeSupabase({ tier: 'pro_ai', status: 'active', ai_mode: 'other', ai_monthly_credits: -5 })
    expect(await getAiSubscription(supabase, 'u1')).toMatchObject({ aiMode: 'managed', monthlyCredits: 0 })
  })

  it('returns null without a row', async () => {
    const { supabase } = makeSupabase(null)
    expect(await getAiSubscription(supabase, 'u1')).toBeNull()
  })

  it.each([
    ['active', true],
    ['trialing', true],
    ['past_due', true],
    ['canceled', false],
    ['incomplete', false],
    ['unpaid', false],
  ])('pro_ai with status %s → %s', (status, expected) => {
    expect(hasProAi({ tier: 'pro_ai', status, aiMode: 'managed', monthlyCredits: 0 })).toBe(expected)
  })

  it.each(['free', 'pro'])('never entitles tier %s', (tier) => {
    expect(hasProAi({ tier, status: 'active', aiMode: 'managed', monthlyCredits: 0 })).toBe(false)
    expect(hasProAi(null)).toBe(false)
  })
})

describe('getEffectiveCap', () => {
  it("is the subscription's monthly allowance when no packs were bought", async () => {
    const { supabase } = makeSupabase(MANAGED)
    expect(await getEffectiveCap(supabase, 'u1')).toBe(2600)
  })

  it('uses a discounted allowance as stored', async () => {
    const { supabase } = makeSupabase({ ...MANAGED, ai_monthly_credits: 1300 })
    expect(await getEffectiveCap(supabase, 'u1')).toBe(1300)
  })

  it("adds the sum of the month's purchased credit packs", async () => {
    const { supabase } = makeSupabase(MANAGED, [{ credits: 820 }, { credits: 9280 }])
    expect(await getEffectiveCap(supabase, 'u1')).toBe(2600 + 820 + 9280)
  })

  it.each([
    ['a BYOK subscription', { ...MANAGED, ai_mode: 'byok' }],
    ['a canceled subscription', { ...MANAGED, status: 'canceled' }],
    ['a Pro subscription', { ...MANAGED, tier: 'pro' }],
    ['no subscription', null],
  ])('counts no monthly allowance for %s, only packs', async (_label, sub) => {
    const { supabase } = makeSupabase(sub, [{ credits: 820 }])
    expect(await getEffectiveCap(supabase, 'u1')).toBe(820)
  })

  it('queries ai_credit_purchases for the given month', async () => {
    const { supabase, eq } = makeSupabase(MANAGED)
    await getEffectiveCap(supabase, 'u1', '2025-01')
    expect(eq).toHaveBeenCalledWith('ai_credit_purchases', 'month', '2025-01')
  })
})

describe('reserveCredits', () => {
  it('calls ai_reserve_credits and reads the returned row', async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: true, remaining: 2590, cap: 2600 }], error: null }))
    const { supabase } = makeSupabase(null, [], rpc)
    expect(await reserveCredits(supabase, 'u1', '2026-03', 10)).toEqual({ allowed: true, remaining: 2590, cap: 2600 })
    expect(rpc).toHaveBeenCalledWith('ai_reserve_credits', { p_user: 'u1', p_month: '2026-03', p_amount: 10 })
  })

  it('passes a refusal through', async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: false, remaining: 4, cap: 2600 }], error: null }))
    const { supabase } = makeSupabase(null, [], rpc)
    expect(await reserveCredits(supabase, 'u1', '2026-03', 10)).toEqual({ allowed: false, remaining: 4, cap: 2600 })
  })

  it.each([
    ['a database error', { data: null, error: { message: 'down' } }],
    ['no row', { data: [], error: null }],
  ])('throws on %s, so the call is refused rather than run unmetered', async (_label, result) => {
    const { supabase } = makeSupabase(null, [], vi.fn(async () => result))
    await expect(reserveCredits(supabase, 'u1', '2026-03', 10)).rejects.toThrow()
  })
})

describe('settleCredits', () => {
  it('calls ai_settle_credits with the delta and returns the new usage', async () => {
    const rpc = vi.fn(async () => ({ data: 37, error: null }))
    const { supabase } = makeSupabase(null, [], rpc)
    expect(await settleCredits(supabase, 'u1', '2026-03', -8)).toBe(37)
    expect(rpc).toHaveBeenCalledWith('ai_settle_credits', { p_user: 'u1', p_month: '2026-03', p_delta: -8 })
  })

  it('returns null when there was no row to settle', async () => {
    const { supabase } = makeSupabase(null, [], vi.fn(async () => ({ data: null, error: null })))
    expect(await settleCredits(supabase, 'u1', '2026-03', -8)).toBeNull()
  })

  it('throws on a database error', async () => {
    const { supabase } = makeSupabase(null, [], vi.fn(async () => ({ data: null, error: { message: 'down' } })))
    await expect(settleCredits(supabase, 'u1', '2026-03', -8)).rejects.toThrow()
  })
})
