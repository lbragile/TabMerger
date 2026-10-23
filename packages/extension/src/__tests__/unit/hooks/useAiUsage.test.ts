import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PRO_AI_MONTHLY_CREDITS } from '@tabmerger/shared'

// ponytail: import.meta.env.DEV is true under Vitest, so useAiUsage always exercises
// its dev-counter branch here — mirrors the real dev-mode behavior this hook now has.

const { mockGetDevAiUsage, mockFrom, mockUseEntitlements } = vi.hoisted(() => ({
  mockGetDevAiUsage: vi.fn(),
  mockFrom: vi.fn(),
  mockUseEntitlements: vi.fn()
}))

// This suite tests the AI-enabled Supabase/dev-counter usage path itself, not the
// coming-soon flag, so force it on regardless of the real VITE_AI_ENABLED default.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true, AI_MANAGED_ENABLED: true, AI_BYOK_ENABLED: true }))
vi.mock('@/mocks/devAiUsage', () => ({ getDevAiUsage: mockGetDevAiUsage }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false, session: null }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }))

/**
 * Stubs `ai_usage` and `subscriptions` (terminal .maybeSingle) and `ai_credit_purchases`
 * (thenable multi-row).
 */
function stubSupabase(creditsUsed: number, purchases: { credits: number }[], monthlyCredits: unknown = 2000) {
  mockFrom.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = async () =>
      table === 'subscriptions'
        ? { data: { ai_monthly_credits: monthlyCredits }, error: null }
        : { data: { credits_used: creditsUsed }, error: null }
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
  mockUseEntitlements.mockReturnValue({ aiFeatures: true, aiMode: 'managed' })
})

describe('useAiUsage — dev mode', () => {
  it('reads the count from the dev-local counter instead of Supabase', async () => {
    mockGetDevAiUsage.mockResolvedValue(42)

    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.used).toBe(42)
    expect(result.current.remaining).toBe(PRO_AI_MONTHLY_CREDITS - 42)
    expect(result.current.cap).toBe(PRO_AI_MONTHLY_CREDITS)
    expect(result.current.known).toBe(true)
    expect(mockGetDevAiUsage).toHaveBeenCalled()
  })

  it('defaults to 0 used / full remaining when the dev counter is empty', async () => {
    mockGetDevAiUsage.mockResolvedValue(0)

    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))

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
    expect(mockGetDevAiUsage).not.toHaveBeenCalled()
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
    expect(mockGetDevAiUsage).not.toHaveBeenCalled()
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
