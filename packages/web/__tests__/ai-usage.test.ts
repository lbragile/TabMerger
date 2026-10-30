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
 * Minimal Supabase stub: `subscriptions` and `ai_usage` resolve via .single() (`sub`, `usage`)
 * (`usage`), `ai_credit_purchases` is awaited directly like a real multi-row select and honours
 * `.is('revoked_at', null)` against each pack's `revoked_at`, and `rpc` is a spy.
 */
function makeSupabase(
  sub: unknown,
  purchases: { credits: number; revoked_at?: string | null }[] = [],
  rpc = vi.fn(),
  usage: Record<string, unknown> | null = null
) {
  const eq = vi.fn()
  const is = vi.fn()
  const from = vi.fn((table: string) => {
    let onlyUnrevoked = false
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (...args: unknown[]) => {
      eq(table, ...args)
      return b
    }
    b.is = (column: string, value: unknown) => {
      is(table, column, value)
      if (column === 'revoked_at' && value === null) onlyUnrevoked = true
      return b
    }
    b.single = async () => ({ data: table === 'ai_usage' ? usage : sub })
    b.then = (resolve: (v: { data: unknown }) => void) =>
      resolve({ data: purchases.filter((p) => !onlyUnrevoked || p.revoked_at == null) })
    return b
  })
  return { supabase: { from, rpc } as unknown as SupabaseClient, from, rpc, eq, is }
}

const MANAGED = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ai_monthly_credits: 2500 }

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
      monthlyCredits: 2500,
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
    expect(await getEffectiveCap(supabase, 'u1')).toBe(2500)
  })

  it('uses a discounted allowance as stored', async () => {
    const { supabase } = makeSupabase({ ...MANAGED, ai_monthly_credits: 1300 })
    expect(await getEffectiveCap(supabase, 'u1')).toBe(1300)
  })

  it("adds the sum of the month's purchased credit packs", async () => {
    const { supabase } = makeSupabase(MANAGED, [{ credits: 820 }, { credits: 9280 }])
    expect(await getEffectiveCap(supabase, 'u1')).toBe(2500 + 820 + 9280)
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

  it('ignores revoked packs (disputed or refunded), like ai_reserve_credits since 027', async () => {
    const { supabase, is } = makeSupabase(MANAGED, [
      { credits: 820, revoked_at: null },
      { credits: 9280, revoked_at: '2026-03-10T00:00:00Z' },
    ])
    expect(await getEffectiveCap(supabase, 'u1')).toBe(2500 + 820)
    expect(is).toHaveBeenCalledWith('ai_credit_purchases', 'revoked_at', null)
  })

  it('shows a past_due month frozen at allowance_spent, plus unrevoked packs', async () => {
    const pastDue = { ...MANAGED, status: 'past_due', ai_monthly_credits: 0 }
    const { supabase, eq } = makeSupabase(pastDue, [{ credits: 820 }], vi.fn(), { allowance_spent: 1700 })
    expect(await getEffectiveCap(supabase, 'u1', '2026-03')).toBe(1700 + 820)
    expect(eq).toHaveBeenCalledWith('ai_usage', 'month', '2026-03')
  })

  it.each(['past_due', 'trialing'])(
    'counts no allowance while %s: only allowance_spent and unrevoked packs',
    async (status) => {
      const sub = { ...MANAGED, status, ai_monthly_credits: 2500 }
      const purchases = [{ credits: 820 }, { credits: 9280, revoked_at: '2026-03-10T00:00:00Z' }]
      expect(await getEffectiveCap(makeSupabase(sub, purchases, vi.fn(), { allowance_spent: 1700 }).supabase, 'u1')).toBe(1700 + 820)
      expect(await getEffectiveCap(makeSupabase(sub, purchases).supabase, 'u1')).toBe(820)
    }
  )

  it('takes the larger of the allowance and allowance_spent', async () => {
    const small = { ...MANAGED, ai_monthly_credits: 1300 }
    expect(await getEffectiveCap(makeSupabase(small, [], vi.fn(), { allowance_spent: 2000 }).supabase, 'u1')).toBe(2000)
    expect(await getEffectiveCap(makeSupabase(MANAGED, [], vi.fn(), { allowance_spent: 2000 }).supabase, 'u1')).toBe(2500)
  })

  it.each([null, -5, 'x', Number.NaN])('treats an allowance_spent of %j as nothing', async (value) => {
    const pastDue = { ...MANAGED, status: 'past_due', ai_monthly_credits: 0 }
    expect(await getEffectiveCap(makeSupabase(pastDue, [], vi.fn(), { allowance_spent: value }).supabase, 'u1')).toBe(0)
  })

  describe('read failures (never shown as 0 credits)', () => {
    /**
     * Like makeSupabase, but `ai_usage` / `ai_credit_purchases` (and optionally `subscriptions`)
     * answer with the given errors.
     */
    function failing(usageError: unknown, purchasesError: unknown, subError: unknown = null) {
      const from = vi.fn((table: string) => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'is']) b[m] = () => b
        b.single = async () =>
          table === 'subscriptions'
            ? { data: subError ? null : MANAGED, error: subError }
            : { data: null, error: usageError }
        b.then = (resolve: (v: unknown) => void) => resolve({ data: [{ credits: 820 }], error: purchasesError })
        return b
      })
      return { from } as unknown as SupabaseClient
    }

    it('throws when the subscription read fails, instead of showing only the packs', async () => {
      await expect(getEffectiveCap(failing(null, null, { code: '57014' }), 'u1')).rejects.toThrow(
        'subscriptions read failed (57014)'
      )
      await expect(getEffectiveCap(failing(null, null, {}), 'u1')).rejects.toThrow('subscriptions read failed (unknown)')
    })

    it('treats "no subscription row" (PGRST116) as no allowance, not a failure', async () => {
      expect(await getEffectiveCap(failing(null, null, { code: 'PGRST116' }), 'u1')).toBe(820)
    })

    it('getAiSubscription still answers null on a failed read (the routes refuse it with 403)', async () => {
      expect(await getAiSubscription(failing(null, null, { code: '57014' }), 'u1')).toBeNull()
    })

    it('throws when the usage read fails', async () => {
      await expect(getEffectiveCap(failing({ code: '57014' }, null), 'u1')).rejects.toThrow('ai_usage read failed (57014)')
    })

    it('throws when the pack read fails', async () => {
      await expect(getEffectiveCap(failing(null, { code: '08006' }), 'u1')).rejects.toThrow('ai_credit_purchases read failed (08006)')
    })

    it('treats "no usage row this month" (PGRST116) as no allowance_spent, not a failure', async () => {
      expect(await getEffectiveCap(failing({ code: 'PGRST116' }, null), 'u1')).toBe(2500 + 820)
    })
  })
})

describe('reserveCredits', () => {
  it('calls ai_reserve_credits and reads the returned row', async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: true, remaining: 2590, cap: 2500 }], error: null }))
    const { supabase } = makeSupabase(null, [], rpc)
    expect(await reserveCredits(supabase, 'u1', '2026-03', 10)).toEqual({ allowed: true, remaining: 2590, cap: 2500 })
    expect(rpc).toHaveBeenCalledWith('ai_reserve_credits', { p_user: 'u1', p_month: '2026-03', p_amount: 10 })
  })

  it('passes a refusal through', async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: false, remaining: 4, cap: 2500 }], error: null }))
    const { supabase } = makeSupabase(null, [], rpc)
    expect(await reserveCredits(supabase, 'u1', '2026-03', 10)).toEqual({ allowed: false, remaining: 4, cap: 2500 })
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
