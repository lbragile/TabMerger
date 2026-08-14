import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ponytail: import.meta.env.DEV is true under Vitest, so useAiUsage always exercises
// its dev-counter branch here — mirrors the real dev-mode behavior this hook now has.

const { mockGetDevAiUsage, mockFrom } = vi.hoisted(() => ({
  mockGetDevAiUsage: vi.fn(),
  mockFrom: vi.fn()
}))

vi.mock('@/mocks/devAiUsage', () => ({ getDevAiUsage: mockGetDevAiUsage }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false, session: null }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ aiFeatures: true }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }))

/** Stubs `ai_usage` (terminal .maybeSingle) and `ai_credit_purchases` (thenable multi-row). */
function stubSupabase(requestCount: number, purchases: { credits: number }[]) {
  mockFrom.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = async () => ({ data: { credits_used: requestCount }, error: null })
    b.then = (resolve: (v: unknown) => void) => resolve({ data: purchases, error: null })
    void table
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
})

describe('useAiUsage — dev mode', () => {
  it('reads the count from the dev-local counter instead of Supabase', async () => {
    mockGetDevAiUsage.mockResolvedValue(42)

    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.used).toBe(42)
    expect(result.current.remaining).toBe(258)
    expect(result.current.cap).toBe(300)
    expect(mockGetDevAiUsage).toHaveBeenCalled()
  })

  it('defaults to 0 used / full remaining when the dev counter is empty', async () => {
    mockGetDevAiUsage.mockResolvedValue(0)

    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.used).toBe(0)
    expect(result.current.remaining).toBe(300)
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

  it('uses the base cap when the user has purchased no credits', async () => {
    stubSupabase(30, [])
    const result = await renderReal()

    expect(result.current.used).toBe(30)
    expect(result.current.cap).toBe(300)
    expect(result.current.remaining).toBe(270)
    expect(mockGetDevAiUsage).not.toHaveBeenCalled()
  })

  it('extends cap and remaining by the sum of purchased credit packs', async () => {
    stubSupabase(120, [{ credits: 50 }, { credits: 50 }])
    const result = await renderReal()

    expect(result.current.cap).toBe(400)
    expect(result.current.remaining).toBe(280)
    expect(mockFrom).toHaveBeenCalledWith('ai_credit_purchases')
  })
})
