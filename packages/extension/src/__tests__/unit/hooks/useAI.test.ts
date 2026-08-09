import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAutoGroup, useNameGroup, useSuggestSessions, useOrganizeTabs, useTabSummary } from '@/hooks/useAI'

const { mockUseAuth, mockUseEntitlements, mockTrackEvent, mockUseAppSettings, mockUseAiUsage, mockHasEncryptionKey } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockUseAppSettings: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockHasEncryptionKey: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockUseAppSettings() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
// ponytail: useOrganizeTabs checks hasEncryptionKey() to decide whether to send plaintext
// groups in the request body; default false (unencrypted/legacy path) unless a test overrides it.
vi.mock('@/lib/encryptionKey', () => ({ hasEncryptionKey: mockHasEncryptionKey }))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn()
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
  ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  mockUseAiUsage.mockReturnValue({ remaining: 100, used: 0, cap: 100, loading: false })
  mockHasEncryptionKey.mockResolvedValue(false)
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

  it('sends each group id so the response can carry actionable staleGroupIds', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'x', staleGroupIds: ['g1'], suggestion: 'x' })
    })
    const groups = [{
      id: 'g1',
      name: 'Dev',
      color: 'rgba(0,0,0,1)',
      updatedAt: 0,
      windows: [{ id: 1, incognito: false, focused: false, tabs: [{ id: 0, title: 'T', url: 'https://a.com' }] }]
    }]
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync(groups) })
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.groups).toEqual([
      { id: 'g1', name: 'Dev', tabs: [{ id: 0, title: 'T', url: 'https://a.com' }] }
    ])
  })

  it('is a background/automatic trigger, so it is throttled to once per day when aiDailyThrottle is on', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ 'ai_last_call_suggest-sessions': Math.floor(Date.now() / 86_400_000) })
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('Already used today')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('ignores the daily throttle when aiDailyThrottle is off', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiDailyThrottle: false } })
    ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ 'ai_last_call_suggest-sessions': Math.floor(Date.now() / 86_400_000) })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ suggestion: 'x' }) })
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync([]) })
    expect(globalThis.fetch).toHaveBeenCalled()
  })
})

describe('per-feature enable/disable toggles', () => {
  it('useAutoGroup short-circuits before the network call when aiAutoGroupEnabled is off', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: false } })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('Auto-group is turned off')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useNameGroup short-circuits when aiNameGroupEnabled is off', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiNameGroupEnabled: false } })
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('Name group is turned off')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useSuggestSessions short-circuits when aiSuggestSessionsEnabled is off', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiSuggestSessionsEnabled: false } })
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('Suggest sessions is turned off')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useOrganizeTabs short-circuits when aiOrganizeEnabled is off', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiOrganizeEnabled: false } })
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync() })).rejects.toThrow('Organize is turned off')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useTabSummary returns { summary: null } instead of throwing when aiTabSummaryEnabled is off', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiTabSummaryEnabled: false } })
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    const res = await act(async () => result.current.mutateAsync({ url: 'https://a.com', title: 'A' }))
    expect(res).toEqual({ summary: null })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('each toggle is independent — disabling one does not block the others', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: false, aiNameGroupEnabled: true } })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ name: 'x' }) })
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync([]) })
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('runs normally when all toggles are on (default)', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ groups: [] }) })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync([]) })
    expect(globalThis.fetch).toHaveBeenCalled()
  })
})

describe('manual AI mutations are never daily-throttled', () => {
  it('useAutoGroup runs again even when suggest-sessions style storage marks the day used', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ 'ai_last_call_auto-group': Math.floor(Date.now() / 86_400_000) })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ groups: [] }) })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync([]) })
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('useNameGroup and useOrganizeTabs are unaffected by aiDailyThrottle being on', async () => {
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
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ name: 'x', runId: '1', token: 't' }) })

    const nameHook = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await act(async () => { await nameHook.result.current.mutateAsync([]) })
    const organizeHook = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper() })
    await act(async () => { await organizeHook.result.current.mutateAsync() })

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
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

// NOT YET IMPLEMENTED: a 429 (quota exceeded) response should be distinguishable
// from a generic failure so the UI can show a "buy more AI calls" prompt instead
// of a generic error toast. These fail until aiPost/the hooks expose that.
describe('quota-exceeded (429) handling — not yet implemented', () => {
  it('useAutoGroup surfaces a distinct isQuotaExceeded flag instead of a generic error on 429', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 429, text: async () => 'quota exceeded',
    })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    act(() => { result.current.mutateAsync([]).catch(() => {}) })
    // ponytail: react-query's mutation observer notifies subscribers on a
    // separate tick from the mutateAsync promise settling, so a single
    // act(async () => await mutateAsync(...)) can read stale (pre-error)
    // hook state — poll with waitFor instead.
    await waitFor(() => expect(result.current.isQuotaExceeded).toBe(true))
  })

  it('a 429 error thrown by the shared fetch helper is tagged isQuotaExceeded, unlike a 500', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 429, text: async () => 'quota exceeded',
    })
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync([])
      } catch (e) {
        caught = e
      }
    })
    expect((caught as { isQuotaExceeded?: boolean } | undefined)?.isQuotaExceeded).toBe(true)
  })
})

describe('proactive client-side quota throttle (remaining <= 0)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockUseAiUsage.mockReturnValue({ remaining: 0, used: 100, cap: 100, loading: false })
  })

  it('useAutoGroup throws QuotaExceededError without calling fetch when remaining is 0', async () => {
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow()
    await waitFor(() => expect(result.current.isQuotaExceeded).toBe(true))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useNameGroup throws without calling fetch when remaining is 0', async () => {
    const { result } = renderHook(() => useNameGroup(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useSuggestSessions throws without calling fetch when remaining is 0', async () => {
    const { result } = renderHook(() => useSuggestSessions(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useOrganizeTabs throws without calling fetch when remaining is 0', async () => {
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync() })).rejects.toThrow()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('useTabSummary throws without calling fetch when remaining is 0', async () => {
    const { result } = renderHook(() => useTabSummary(), { wrapper: makeWrapper() })
    await expect(act(async () => { await result.current.mutateAsync({ url: 'https://a.com', title: 'A' }) })).rejects.toThrow()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('runs normally (calls fetch) when remaining is positive', async () => {
    mockUseAiUsage.mockReturnValue({ remaining: 5, used: 95, cap: 100, loading: false })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ groups: [] }) })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync([]) })
    expect(globalThis.fetch).toHaveBeenCalled()
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
