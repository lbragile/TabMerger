import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * `aiFeatures` is ANDed with the global `AI_ENABLED` kill switch regardless of tier
 * (`TIER_LIMITS[effectiveTier].aiFeatures && AI_ENABLED`), so a real pro_ai subscriber
 * must NOT see AI UI while the flag is off. This must hold in both the normal
 * subscription-lookup branch AND the DEMO_MODE marketing-recording branch — each is
 * a separate `vi.mock` factory, hence separate test files/blocks per flag+mode combo.
 */

const { mockMaybeSingle, mockEq, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn()
  const mockEq = vi.fn()
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  mockEq.mockReturnValue({ eq: mockEq, maybeSingle: mockMaybeSingle })
  mockSelect.mockReturnValue({ eq: mockEq, maybeSingle: mockMaybeSingle })
  mockFrom.mockReturnValue({ select: mockSelect })
  return { mockMaybeSingle, mockEq, mockSelect, mockFrom }
})

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {}, from: mockFrom } }))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false, session: null }),
}))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMaybeSingle.mockResolvedValue({
    data: { tier: 'pro_ai', status: 'active', cancel_at_period_end: false, current_period_end: null },
    error: null,
  })
  mockEq.mockReturnValue({ eq: mockEq, maybeSingle: mockMaybeSingle })
  mockSelect.mockReturnValue({ eq: mockEq, maybeSingle: mockMaybeSingle })
  mockFrom.mockReturnValue({ select: mockSelect })
})

describe('useEntitlements aiFeatures AND logic — normal (non-demo) branch', () => {
  it('a pro_ai subscriber sees aiFeatures=false when AI_ENABLED is false', async () => {
    vi.doMock('@/lib/aiFlag', () => ({ AI_ENABLED: false }))
    vi.resetModules()
    const { useEntitlements } = await import('@/hooks/useEntitlements')
    const { result } = renderHook(() => useEntitlements(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tier).toBe('pro_ai')
    expect(result.current.aiFeatures).toBe(false)
  })

  it('a pro_ai subscriber sees aiFeatures=true when AI_ENABLED is true', async () => {
    vi.doMock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))
    vi.resetModules()
    const { useEntitlements } = await import('@/hooks/useEntitlements')
    const { result } = renderHook(() => useEntitlements(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tier).toBe('pro_ai')
    expect(result.current.aiFeatures).toBe(true)
  })

  it('a free-tier user sees aiFeatures=false even when AI_ENABLED is true (no entitlement)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    vi.doMock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))
    vi.resetModules()
    const { useEntitlements } = await import('@/hooks/useEntitlements')
    const { result } = renderHook(() => useEntitlements(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tier).toBe('free')
    expect(result.current.aiFeatures).toBe(false)
  })
})
