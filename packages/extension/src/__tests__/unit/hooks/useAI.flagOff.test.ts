import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAutoGroup, useNameGroup, useSuggestSessions, useOrganizeTabs, useTabSummary } from '@/hooks/useAI'

const { mockUseAuth, mockUseEntitlements, mockUseAppSettings, mockUseAiUsage, mockHasEncryptionKey } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockUseAppSettings: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockHasEncryptionKey: vi.fn(),
}))

// Separate file (rather than a describe block) because `AI_ENABLED` is mocked via a
// module-level `vi.mock` factory that is static per test file — useAI.test.ts already
// forces it `true` for its mutation-logic suite, so the off-state gets its own file.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: false }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockUseAppSettings() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
vi.mock('@/lib/encryptionKey', () => ({ hasEncryptionKey: mockHasEncryptionKey }))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn()
  // Fully entitled + authenticated user — proves the flag alone blocks the call,
  // not a missing entitlement/session that would mask the flag check.
  mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
  mockUseEntitlements.mockReturnValue({ aiFeatures: true })
  mockUseAppSettings.mockReturnValue({
    data: {
      aiDailyThrottle: true,
      aiAutoGroupEnabled: true,
      aiNameGroupEnabled: true,
      aiSuggestSessionsEnabled: true,
      aiOrganizeEnabled: true,
      aiTabSummaryEnabled: true,
    },
  })
  mockUseAiUsage.mockReturnValue({ remaining: 100, used: 0, cap: 100, loading: false })
  mockHasEncryptionKey.mockResolvedValue(false)
})

describe('AI mutations when AI_ENABLED is false (coming-soon kill switch)', () => {
  it('useAutoGroup rejects with a coming-soon error and makes zero fetch calls', async () => {
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow(
      'AI features are coming soon'
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useNameGroup rejects with a coming-soon error and makes zero fetch calls', async () => {
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow(
      'AI features are coming soon'
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useSuggestSessions rejects with a coming-soon error and makes zero fetch calls', async () => {
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow(
      'AI features are coming soon'
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useOrganizeTabs rejects with a coming-soon error and makes zero fetch calls', async () => {
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync() })).rejects.toThrow(
      'AI features are coming soon'
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useTabSummary resolves with { summary: null } instead of throwing, and makes zero fetch calls', async () => {
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    let value: { summary: string | null } | undefined
    await act(async () => {
      value = await result.current.mutateAsync({ url: 'https://example.com', title: 'Example' })
    })
    expect(value).toEqual({ summary: null })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
