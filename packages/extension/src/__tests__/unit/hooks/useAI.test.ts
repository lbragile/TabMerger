import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AI_ERROR_CODES } from '@tabmerger/shared'
import { aiPost, useAutoGroup, useNameGroup, useSuggestSessions, useOrganizeTabs, useTabSummary } from '@/hooks/useAI'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { AiRequestError, QuotaExceededError, aiErrorMessage } from '@/lib/aiErrors'
import { t } from '@/lib/i18n'

const { mockUseAuth, mockUseEntitlements, mockTrackEvent, mockUseAppSettings, mockUseAiUsage, mockGetEncryptionKeyState } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockUseAppSettings: vi.fn(),
  mockUseAiUsage: vi.fn(),
  mockGetEncryptionKeyState: vi.fn(),
}))

// This suite exercises the AI-enabled behavior of these mutations directly (they're
// unit tests for the mutation logic itself, not for the coming-soon flag), so force
// the global kill switch on here regardless of the real VITE_AI_ENABLED default.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true, AI_MANAGED_ENABLED: true, AI_BYOK_ENABLED: true }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockUseAppSettings() }))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))
// ponytail: useOrganizeTabs checks getEncryptionKeyState() to decide whether to send plaintext
// groups in the request body; default false (unencrypted/legacy path) unless a test overrides it.
vi.mock('@/lib/encryptionKey', () => ({ getEncryptionKeyState: mockGetEncryptionKeyState }))

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
  mockUseAiUsage.mockReturnValue({ remaining: 100, used: 0, cap: 100, loading: false, known: true })
  mockGetEncryptionKeyState.mockResolvedValue('absent')
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
    // Tabs carry only the title and URL the route reads (see useAI.payload.test.ts)
    expect(body.groups).toEqual([
      { id: 'g1', name: 'Dev', tabs: [{ title: 'T', url: 'https://a.com' }] }
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
    await expect(act(async () => { await result.current.mutateAsync([]) })).rejects.toThrow('“Name groups and windows” is turned off')
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

describe('useOrganizeTabs — encryption status that could not be checked', () => {
  it('never sends the empty "server reads the rows itself" body: the rows may be ciphertext', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    mockGetEncryptionKeyState.mockResolvedValue('unknown')
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ runId: '1', token: 't' }) })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const saved = { id: 'g1', name: 'Work', windows: [{ tabs: [{ id: 0, title: 'T', url: 'https://example.com' }] }] }
    qc.setQueryData(GROUPS_QUERY_KEY, { active: { id: 'now', index: 0 }, available: [{ id: 'now', name: 'Now Open', permanent: true, windows: [] }, saved] })
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper })
    await act(async () => { await result.current.mutateAsync() })
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body.groups.map((g: { id: string }) => g.id)).toEqual(['now', 'g1'])
  })
})

describe('useOrganizeTabs — the reply is untrusted', () => {
  function renderWithGroups() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const group = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [], ...extra })
    qc.setQueryData(GROUPS_QUERY_KEY, {
      active: { id: 'now', index: 0 },
      available: [group('now', { permanent: true }), group('a'), group('b'), group('demo', { tourDemo: true })]
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
    return renderHook(() => useOrganizeTabs(), { wrapper }).result
  }

  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
  })

  it('returns only the well-formed actions on this device’s saved groups, names cleaned', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        actions: [
          { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
          { type: 'rename', groupId: 'b', newName: '  Deep\nWork ' },
          { type: 'delete', groupId: 'now' },
          { type: 'delete', groupId: 'demo' },
          { type: 'delete', groupId: 'unknown' },
          { type: 'wipe', groupId: 'a' },
          'garbage'
        ]
      })
    })
    const result = renderWithGroups()
    let reply: unknown
    await act(async () => {
      reply = await result.current.mutateAsync()
    })
    expect(reply).toEqual({
      actions: [
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
        { type: 'rename', groupId: 'b', newName: 'Deep Work' }
      ]
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('ai_feature_used', { feature_name: 'organize' })
  })

  it('returns no actions for a reply without an actions list (an older server)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ runId: '1', token: 't' }) })
    const result = renderWithGroups()
    let reply: unknown
    await act(async () => {
      reply = await result.current.mutateAsync()
    })
    expect(reply).toEqual({ actions: [] })
  })
})

describe('useOrganizeTabs', () => {
  it('posts only the model to /api/ai/organize (server derives user and groups from the token)', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ runId: '1', token: 't' }) })
    const { result } = renderHook(() => useOrganizeTabs(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync() })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/organize'),
      expect.objectContaining({ body: JSON.stringify({ model: 'auto' }) })
    )
  })
})

/** A failed response: `body` is sent as-is when it's a string, else as JSON; `headers` are its response headers. */
function failWith(status: number, body: unknown, headers: Record<string, string> = {}) {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    status,
    headers: new Headers(headers),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })
}

/** What aiPost rejects with for the response set up by {@link failWith}. */
function aiPostError(): Promise<unknown> {
  return aiPost('/api/ai/name-group', {}, 'tok').catch((e: unknown) => e)
}

// A 429 is "out of credits" (the "buy more credits" prompt) only when the server says so with
// ai_quota_exceeded. Any other 429, including one with no code at all (the hosting platform's
// firewall answering in plain text or HTML), is "too many requests".
describe('429 handling: out of credits vs too many requests', () => {
  it('429 ai_quota_exceeded is a QuotaExceededError', async () => {
    failWith(429, { error: AI_ERROR_CODES.quotaExceeded, needed: 4, remaining: 1 })
    const err = await aiPostError()
    expect(err).toBeInstanceOf(QuotaExceededError)
    expect(err).toMatchObject({ isQuotaExceeded: true, needed: 4, remaining: 1 })
  })

  it('429 rate_limited is a rate_limited AiRequestError, not out of credits', async () => {
    failWith(429, { error: AI_ERROR_CODES.rateLimited }, { 'Retry-After': '30' })
    const err = await aiPostError()
    expect(err).not.toBeInstanceOf(QuotaExceededError)
    expect(err).toBeInstanceOf(AiRequestError)
    expect(err).toMatchObject({ code: AI_ERROR_CODES.rateLimited, status: 429, retryAfterSeconds: 30 })
    expect((err as Error).message).toBe('Too many AI requests right now. Try again in 30 seconds.')
  })

  it.each([
    ['a plain-text body', 'Too Many Requests'],
    ['an HTML body', '<!DOCTYPE html><html><body><h1>429 Too Many Requests</h1></body></html>'],
    ['an empty body', ''],
    ['a JSON body with no code', { message: 'slow down' }],
  ])('a codeless 429 with %s is rate_limited, not out of credits, naming the Retry-After wait', async (_label, body) => {
    failWith(429, body, { 'Retry-After': '120' })
    const err = await aiPostError()
    expect(err).not.toBeInstanceOf(QuotaExceededError)
    expect(err).toBeInstanceOf(AiRequestError)
    expect(err).toMatchObject({ code: AI_ERROR_CODES.rateLimited, status: 429, retryAfterSeconds: 120 })
    expect((err as Error).message).toBe(aiErrorMessage(AI_ERROR_CODES.rateLimited, { retryAfterSeconds: 120 }))
    // The platform's raw reply (maybe a whole HTML page) never reaches the user.
    expect((err as Error).message).not.toContain('<')
  })

  it.each([
    ['no Retry-After header', {}],
    ['an unparseable Retry-After header', { 'Retry-After': 'soon' }],
    ['a zero Retry-After header', { 'Retry-After': '0' }],
  ])('a codeless 429 with %s is rate_limited without a wait', async (_label, headers) => {
    failWith(429, '<html><body>Too Many Requests</body></html>', headers)
    const err = await aiPostError()
    expect(err).not.toBeInstanceOf(QuotaExceededError)
    expect(err).toMatchObject({ code: AI_ERROR_CODES.rateLimited, status: 429, retryAfterSeconds: undefined })
    expect((err as Error).message).toBe(t('errors.ai.rateLimited'))
  })

  it('a codeless 429 on a response with no headers object is still rate_limited', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, text: async () => 'quota exceeded' })
    const err = await aiPostError()
    expect(err).not.toBeInstanceOf(QuotaExceededError)
    expect(err).toMatchObject({ code: AI_ERROR_CODES.rateLimited, retryAfterSeconds: undefined })
  })

  it('a codeless 500 keeps the raw status and text', async () => {
    failWith(500, 'boom')
    const err = await aiPostError()
    expect(err).toMatchObject({ code: null, status: 500, message: 'AI request failed: 500 boom' })
  })

  it('useAutoGroup flags isQuotaExceeded on a 429 ai_quota_exceeded', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    failWith(429, { error: AI_ERROR_CODES.quotaExceeded })
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    act(() => { result.current.mutateAsync([]).catch(() => {}) })
    // ponytail: react-query's mutation observer notifies subscribers on a
    // separate tick from the mutateAsync promise settling, so a single
    // act(async () => await mutateAsync(...)) can read stale (pre-error)
    // hook state — poll with waitFor instead.
    await waitFor(() => expect(result.current.isQuotaExceeded).toBe(true))
  })

  it('useAutoGroup does not flag isQuotaExceeded on a codeless (platform) 429', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    failWith(429, '<html><body>Too Many Requests</body></html>')
    const { result } = renderHook(() => useAutoGroup(), { wrapper: makeWrapper() })
    act(() => { result.current.mutateAsync([]).catch(() => {}) })
    await waitFor(() => expect(result.current.error).toBeInstanceOf(AiRequestError))
    expect(result.current.isQuotaExceeded).toBe(false)
  })

  it('useNameGroup rejects with an error tagged isQuotaExceeded on a 429 ai_quota_exceeded', async () => {
    mockUseAuth.mockReturnValue({ session: { access_token: 'tok' } })
    mockUseEntitlements.mockReturnValue({ aiFeatures: true })
    failWith(429, { error: AI_ERROR_CODES.quotaExceeded })
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
    mockUseAiUsage.mockReturnValue({ remaining: 0, used: 100, cap: 100, loading: false, known: true })
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
    mockUseAiUsage.mockReturnValue({ remaining: 5, used: 95, cap: 100, loading: false, known: true })
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
