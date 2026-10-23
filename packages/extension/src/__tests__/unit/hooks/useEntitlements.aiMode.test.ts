import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { resolveAiMode } from '@/lib/entitlementTier'

const { mockMaybeSingle, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn()
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  return { mockMaybeSingle, mockSelect, mockFrom }
})

// Separate file: AI_ENABLED is a static per-file mock, and ai_mode is only read while AI is on.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {}, from: mockFrom } }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false, session: null }) }))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  const chain = { eq: () => chain, maybeSingle: mockMaybeSingle }
  mockSelect.mockReturnValue(chain)
  mockFrom.mockReturnValue({ select: mockSelect })
})

async function render() {
  const { useEntitlements } = await import('@/hooks/useEntitlements')
  const { result } = renderHook(() => useEntitlements(), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current.loading).toBe(false))
  return result
}

describe('useEntitlements — aiMode', () => {
  it("reads ai_mode and exposes 'byok' for an own-key Pro AI subscription", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { tier: 'pro_ai', status: 'active', ai_mode: 'byok' }, error: null })
    const result = await render()
    await waitFor(() => expect(result.current.aiMode).toBe('byok'))
    expect(result.current.tier).toBe('pro_ai')
    expect(mockSelect.mock.calls[0][0]).toContain('ai_mode')
  })

  it("is 'managed' for a Pro AI row without a mode", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { tier: 'pro_ai', status: 'trialing' }, error: null })
    const result = await render()
    await waitFor(() => expect(result.current.tier).toBe('pro_ai'))
    expect(result.current.aiMode).toBe('managed')
  })

  it('is null on plans without AI, whatever the column says', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { tier: 'pro', status: 'active', ai_mode: 'byok' }, error: null })
    const result = await render()
    await waitFor(() => expect(result.current.tier).toBe('pro'))
    expect(result.current.aiMode).toBeNull()
  })

  it('reads the row again without ai_mode when that read fails, so a paying user never drops to free', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column subscriptions.ai_mode does not exist' } })
      .mockResolvedValueOnce({ data: { tier: 'pro_ai', status: 'active' }, error: null })
    const result = await render()
    await waitFor(() => expect(result.current.tier).toBe('pro_ai'))
    expect(result.current.aiMode).toBe('managed')
    expect(mockSelect).toHaveBeenCalledTimes(2)
    expect(mockSelect.mock.calls[1][0]).not.toContain('ai_mode')
  })
})

describe('resolveAiMode', () => {
  it.each([
    [{ tier: 'pro_ai', status: 'active', ai_mode: 'byok' }, 'byok'],
    [{ tier: 'pro_ai', status: 'past_due', ai_mode: 'managed' }, 'managed'],
    [{ tier: 'pro_ai', status: 'active', ai_mode: 'something-new' }, 'managed'],
    [{ tier: 'pro_ai', status: 'canceled', ai_mode: 'byok' }, null],
    [{ tier: 'pro', status: 'active', ai_mode: 'byok' }, null],
    [null, null],
  ])('%j -> %s', (row, expected) => {
    expect(resolveAiMode(row)).toBe(expected)
  })
})
