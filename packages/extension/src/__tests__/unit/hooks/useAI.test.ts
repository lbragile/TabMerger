import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAutoGroup, useNameGroup, useSuggestSessions, useOrganizeTabs, useTabSummary } from '@/hooks/useAI'

const { mockUseAuth, mockUseEntitlements, mockTrackEvent } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn()
})

describe('useAutoGroup', () => {
  it('throws when the user lacks the aiFeatures entitlement', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: false })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('Pro AI plan required')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('throws when there is no session token even with aiFeatures', async () => {
    mockUseAuth.mockReturnValue({ session: null })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('Not authenticated')
  })

  it('posts to /api/ai/group-tabs with a Bearer token and tracks the event on success', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok123' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ groups: [] }),
    })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync([]) })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/group-tabs'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok123' }) })
    )
    expect(mockTrackEvent).toHaveBeenCalledWith('ai_feature_used', { feature_name: 'group' })
    expect(mockTrackEvent).toHaveBeenCalledWith('ai_auto_group_used')
  })

  it('throws a descriptive error when the API responds with a non-ok status', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 500, text: async () => 'boom',
    })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('AI request failed: 500 boom')
  })
})

describe('useNameGroup', () => {
  it('gates on aiFeatures and posts to /api/ai/name-group', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ name: 'Work' }) })
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    const res = await act(async () => result.current.mutateAsync([]))
    expect(res).toEqual({ name: 'Work' })
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/ai/name-group'), expect.anything())
  })
})

describe('useSuggestSessions', () => {
  it('gates on aiFeatures and posts to /api/ai/suggest-sessions', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ suggestion: 'x' }) })
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync([]) })
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/ai/suggest-sessions'), expect.anything())
  })
})

describe('useOrganizeTabs', () => {
  it('posts an empty body to /api/ai/organize (server derives user from token)', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ runId: '1', token: 't' }) })
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync() })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/organize'),
      expect.objectContaining({ body: JSON.stringify({}) })
    )
  })
})

describe('useTabSummary', () => {
  it('returns { summary: null } without calling fetch when aiFeatures is false', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: false })
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    const res = await act(async () => result.current.mutateAsync({ url: 'https://a.com', title: 'A' }))
    expect(res).toEqual({ summary: null })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns { summary: null } without calling fetch when there is no session token', async () => {
    mockUseAuth.mockReturnValue({ session: null })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    const res = await act(async () => result.current.mutateAsync({ url: 'https://a.com', title: 'A' }))
    expect(res).toEqual({ summary: null })
  })

  it('posts to /api/ai/tab-summary when authenticated with aiFeatures', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ summary: 'a summary' }) })
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    const res = await act(async () => result.current.mutateAsync({ url: 'https://a.com', title: 'A' }))
    expect(res).toEqual({ summary: 'a summary' })
    expect(mockTrackEvent).toHaveBeenCalledWith('ai_summary_used')
  })

  it('does not track ai_summary_used when the API returns a null/empty summary', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ summary: null }) })
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    await act(async () => result.current.mutateAsync({ url: 'https://a.com', title: 'A' }))
    expect(mockTrackEvent).not.toHaveBeenCalledWith('ai_summary_used')
  })
})
