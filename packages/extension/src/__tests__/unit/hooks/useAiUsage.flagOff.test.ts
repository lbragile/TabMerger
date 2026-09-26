import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { mockGetDevAiUsage, mockFrom } = vi.hoisted(() => ({
  mockGetDevAiUsage: vi.fn(),
  mockFrom: vi.fn()
}))

// Separate file from useAiUsage.test.ts because `AI_ENABLED` is a static per-file
// `vi.mock` factory — this file exercises the coming-soon-flag-off path specifically.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: false }))
vi.mock('@/mocks/devAiUsage', () => ({ getDevAiUsage: mockGetDevAiUsage }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false, session: null }) }))
// Fully entitled user — proves the global flag alone disables the query, not a missing entitlement.
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ aiFeatures: true }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAiUsage when AI_ENABLED is false (coming-soon kill switch)', () => {
  it('never runs the usage query — no dev counter or Supabase reads', async () => {
    const { useAiUsage } = await import('@/hooks/useAiUsage')
    const { result } = renderHook(() => useAiUsage(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockGetDevAiUsage).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    // Falls back to the default cap/0-used shape since the query never ran.
    expect(result.current.used).toBe(0)
    expect(result.current.cap).toBe(300)
  })
})
