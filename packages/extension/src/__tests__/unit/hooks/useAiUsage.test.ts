import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PRO_AI_MONTHLY_CREDITS } from '@tabmerger/shared'

const { mockFrom, mockUseEntitlements, mockUseAuth } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn()
}))

// This suite tests the AI-enabled Supabase usage path itself, not the
// coming-soon flag, so force it on regardless of the real VITE_AI_ENABLED default.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true, AI_MANAGED_ENABLED: true, AI_BYOK_ENABLED: true }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }))

interface StubOptions {
  /** The subscription row's fields other than `ai_monthly_credits` (an active managed Pro AI plan by default). */
  subscription?: Record<string, unknown> | null
  /** `ai_usage.allowance_spent` (absent by default: the allowance was never frozen). */
  allowanceSpent?: unknown
}

/** Every call made on the query builders, e.g. `['ai_credit_purchases', 'is', 'revoked_at', null]`. */
const calls: unknown[][] = []

/**
 * Stubs `ai_usage` and `subscriptions` (terminal .maybeSingle) and `ai_credit_purchases`
 * (thenable multi-row, whose `.is('revoked_at', null)` filter is recorded but not applied: the
 * rows passed are the ones the server would return).
 */
function stubSupabase(
  creditsUsed: number,
  purchases: { credits: number }[],
  monthlyCredits: unknown = 2000,
  { subscription = { tier: 'pro_ai', status: 'active', ai_mode: 'managed' }, allowanceSpent }: StubOptions = {}
) {
  mockFrom.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {}
    const record = (method: string) => (...args: unknown[]) => {
      calls.push([table, method, ...args])
      return b
    }
    b.select = record('select')
    b.eq = record('eq')
    b.is = record('is')
    b.maybeSingle = async () =>
      table === 'subscriptions'
        ? { data: subscription === null ? null : { ...subscription, ai_monthly_credits: monthlyCredits }, error: null }
        : {
            data: { credits_used: creditsUsed, ...(allowanceSpent === undefined ? {} : { allowance_spent: allowanceSpent }) },
            error: null
          }
    b.then = (resolve: (v: unknown) => void) => resolve({ data: purchases, error: null })
    return b
  })
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'managed' })
  mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, loading: false, session: null })
})

describe('useAiUsage — dev builds', () => {
  // import.meta.env.DEV is true under Vitest: dev builds read the same tables as any other build
  // (the web dev server's AI_MOCK replies charge real credits).
  it('reads the real ai_usage row and cap in a dev build', async () => {
    expect(import.meta.env.DEV).toBe(true)
    stubSupabase(42, [{ credits: 100 }])

    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.known).toBe(true))

    expect(result.current.used).toBe(42)
    expect(result.current.cap).toBe(2100)
    expect(result.current.remaining).toBe(2058)
    expect(mockFrom).toHaveBeenCalledWith('ai_usage')
  })

  it('reads nothing while signed out, even in a dev build', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, session: null })
    stubSupabase(42, [])

    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockFrom).not.toHaveBeenCalled()
    expect(result.current.known).toBe(false)
    expect(result.current.used).toBe(0)
    expect(result.current.remaining).toBe(PRO_AI_MONTHLY_CREDITS)
  })
})

describe('useAiUsage — real Supabase path', () => {
  afterEach(() => vi.unstubAllEnvs())

  async function renderReal() {
    vi.stubEnv('DEV', false)
    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    return result
  }

  it("uses the subscription's ai_monthly_credits as the cap when no packs were bought", async () => {
    stubSupabase(30, [])
    const result = await renderReal()

    expect(result.current.used).toBe(30)
    expect(result.current.cap).toBe(2000)
    expect(result.current.remaining).toBe(1970)
    expect(mockFrom).toHaveBeenCalledWith('subscriptions')
  })

  it('extends cap and remaining by the sum of purchased credit packs', async () => {
    stubSupabase(120, [{ credits: 50 }, { credits: 50 }])
    const result = await renderReal()

    expect(result.current.cap).toBe(2100)
    expect(result.current.remaining).toBe(1980)
    expect(mockFrom).toHaveBeenCalledWith('ai_credit_purchases')
  })
})

describe('useAiUsage — plan options and failures', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reads nothing for an own-key (BYOK) plan: there are no TabMerger credits', async () => {
    vi.stubEnv('DEV', false)
    mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'byok' })
    stubSupabase(0, [])
    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockFrom).not.toHaveBeenCalled()
    expect(result.current.known).toBe(false)
  })

  it('a missing or malformed ai_monthly_credits counts as 0, so only packs remain', async () => {
    vi.stubEnv('DEV', false)
    stubSupabase(10, [{ credits: 820 }], null)
    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.known).toBe(true))

    expect(result.current.cap).toBe(820)
    expect(result.current.remaining).toBe(810)
  })

  it('a failed read leaves the balance unknown instead of guessing a number', async () => {
    vi.stubEnv('DEV', false)
    mockFrom.mockImplementation(() => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = async () => ({ data: null, error: { message: 'offline' } })
      b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'offline' } })
      return b
    })
    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.known).toBe(false)
    // Display-only fallback while unknown
    expect(result.current.cap).toBe(PRO_AI_MONTHLY_CREDITS)
  })
})

describe("useAiUsage — the server's cap rule (migration 027, getEffectiveCap)", () => {
  afterEach(() => vi.unstubAllEnvs())

  async function renderKnown() {
    vi.stubEnv('DEV', false)
    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.known).toBe(true))
    return result.current
  }

  it('counts only unrevoked credit packs (filters revoked_at is null)', async () => {
    stubSupabase(0, [{ credits: 820 }])
    const usage = await renderKnown()

    expect(usage.cap).toBe(2820)
    expect(calls).toContainEqual(['ai_credit_purchases', 'is', 'revoked_at', null])
    expect(calls).toContainEqual(['ai_usage', 'select', 'credits_used, allowance_spent'])
  })

  it('a past_due plan keeps what its frozen allowance already paid for, plus its packs', async () => {
    // The server zeroes ai_monthly_credits on past_due and records allowance_spent
    stubSupabase(1500, [{ credits: 820 }], 0, {
      subscription: { tier: 'pro_ai', status: 'past_due', ai_mode: 'managed' },
      allowanceSpent: 1500
    })
    const usage = await renderKnown()

    expect(usage.cap).toBe(2320)
    expect(usage.remaining).toBe(820)
  })

  it.each(['past_due', 'trialing', 'canceled'])("a %s plan's allowance does not count, even when the column still holds one", async (status) => {
    stubSupabase(0, [{ credits: 100 }], 2500, { subscription: { tier: 'pro_ai', status, ai_mode: 'managed' } })
    const usage = await renderKnown()

    expect(usage.cap).toBe(100)
  })

  it('an active allowance above allowance_spent wins (the payment recovered)', async () => {
    stubSupabase(1500, [], 2500, { allowanceSpent: 1500 })
    const usage = await renderKnown()

    expect(usage.cap).toBe(2500)
    expect(usage.remaining).toBe(1000)
  })

  it('allowance_spent above the active allowance wins (greatest of the two)', async () => {
    stubSupabase(900, [{ credits: 50 }], 500, { allowanceSpent: 900 })
    const usage = await renderKnown()

    expect(usage.cap).toBe(950)
  })

  it('a non-Pro-AI tier has no allowance', async () => {
    stubSupabase(0, [{ credits: 10 }], 2500, { subscription: { tier: 'pro', status: 'active', ai_mode: 'managed' } })
    expect((await renderKnown()).cap).toBe(10)
  })

  it('an own-key ai_mode row has no allowance', async () => {
    stubSupabase(0, [], 2500, { subscription: { tier: 'pro_ai', status: 'active', ai_mode: 'byok' } })
    expect((await renderKnown()).cap).toBe(0)
  })

  it('an unset or unknown ai_mode reads as managed, like the server', async () => {
    stubSupabase(0, [], 2500, { subscription: { tier: 'pro_ai', status: 'active', ai_mode: null } })
    expect((await renderKnown()).cap).toBe(2500)
  })

  it('no subscription row, a malformed allowance_spent and malformed packs count as 0', async () => {
    stubSupabase(5, [{ credits: 100 }, { credits: 'x' as unknown as number }, { credits: -20 }], 2500, {
      subscription: null,
      allowanceSpent: 'lots'
    })
    const usage = await renderKnown()

    expect(usage.cap).toBe(100)
    expect(usage.remaining).toBe(95)
  })

  it('a fractional allowance or allowance_spent is rounded down', async () => {
    stubSupabase(0, [], 1000.9, { allowanceSpent: 1200.7 })
    expect((await renderKnown()).cap).toBe(1200)
  })
})
