import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HEARTBEAT_TIER_STORAGE_KEY } from '@tabmerger/shared'

/**
 * useEntitlements remembers the coarse plan in chrome.storage.local for the worker's heartbeat
 * (no network there): free / pro / pro_ai when signed in, signed_out otherwise, only once loaded.
 */

const { mockMaybeSingle, authState } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  authState: { user: { id: 'user-1' } as { id: string } | null, loading: false },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {},
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  },
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ ...authState, session: null }) }))

import { useEntitlements, _resetRememberedTierForTests } from '@/hooks/useEntitlements'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
}

const stored = async () => (await chrome.storage.local.get(HEARTBEAT_TIER_STORAGE_KEY))[HEARTBEAT_TIER_STORAGE_KEY]

beforeEach(() => {
  _resetRememberedTierForTests()
  authState.user = { id: 'user-1' }
  authState.loading = false
  mockMaybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
})

describe('useEntitlements — heartbeat tier cache', () => {
  it('stores the resolved paid tier once loaded', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { tier: 'pro', status: 'active', cancel_at_period_end: false, current_period_end: null, stripe_price_id: null },
      error: null,
    })
    const { result } = renderHook(() => useEntitlements(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(async () => expect(await stored()).toBe('pro'))
  })

  it('stores signed_out without a user', async () => {
    authState.user = null
    renderHook(() => useEntitlements(), { wrapper: wrapper() })
    await waitFor(async () => expect(await stored()).toBe('signed_out'))
  })

  it('writes nothing while auth is loading, and only on a change', async () => {
    authState.loading = true
    const set = vi.spyOn(chrome.storage.local, 'set')
    set.mockClear()
    const { rerender } = renderHook(() => useEntitlements(), { wrapper: wrapper() })
    expect(set).not.toHaveBeenCalledWith({ [HEARTBEAT_TIER_STORAGE_KEY]: expect.anything() })
    authState.loading = false
    authState.user = null
    rerender()
    rerender()
    await waitFor(async () => expect(await stored()).toBe('signed_out'))
    expect(set.mock.calls.filter((c) => HEARTBEAT_TIER_STORAGE_KEY in (c[0] as object))).toHaveLength(1)
  })
})
