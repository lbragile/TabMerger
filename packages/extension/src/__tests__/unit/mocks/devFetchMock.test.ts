/**
 * Regression test for the dev-mode AI mock: group-tabs must echo back real
 * submitted tab ids (not a hardcoded [1, 2]), or Auto-group silently matches
 * nothing against live Now Open tabs in dev mode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installDevFetchMock } from '@/mocks/devFetchMock'
import { getDevAiUsage } from '@/mocks/devAiUsage'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

const { mockInvalidateQueries } = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
}))

vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: mockInvalidateQueries },
}))

describe('installDevFetchMock — /api/ai/group-tabs', () => {
  let realFetch: typeof window.fetch
  let realFetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    realFetch = window.fetch
    // Spy BEFORE installDevFetchMock so the closure it captures for the real,
    // passthrough fetch (used for the dev-usage sync POST) is this spy — spying
    // after install would wrap window.fetch too late to observe those calls.
    realFetchSpy = vi.spyOn(window, 'fetch')
    const store: Record<string, unknown> = {}
    ;(globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.get = vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve({ [key]: store[key] }))
    ;(globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set = vi
      .fn()
      .mockImplementation((obj: Record<string, unknown>) => {
        Object.assign(store, obj)
        return Promise.resolve()
      })
    mockGetSession.mockReset().mockResolvedValue({ data: { session: null } })
    mockInvalidateQueries.mockReset()
    installDevFetchMock()
  })

  afterEach(() => {
    window.fetch = realFetch
    vi.unstubAllEnvs()
  })

  it('echoes back real tab ids from the request body instead of a hardcoded fixture', async () => {
    const res = await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [{ id: 42, url: 'https://a.com' }, { id: 43, url: 'https://b.com' }] }),
    })
    const data = await res.json()

    expect(data.groups[0].tabIds).toEqual([42, 43])
  })

  it('returns no groups when no tabs are submitted', async () => {
    const res = await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [] }),
    })
    const data = await res.json()

    expect(data.groups).toEqual([])
  })

  it('increments the dev AI usage counter when a fixture is served', async () => {
    await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [] }),
    })
    // fire-and-forget increment — flush microtasks
    await new Promise((r) => setTimeout(r, 0))
    expect(await getDevAiUsage()).toBe(1)
  })

  it('syncs the incremented count to /api/ai/dev-usage with the session bearer token', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-123', user: { id: 'u1' } } } })
    realFetchSpy.mockResolvedValue(new Response(null, { status: 200 }))

    await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [] }),
    })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const syncCall = realFetchSpy.mock.calls.find(([url]: [RequestInfo | URL, RequestInit?]) => String(url).includes('/api/ai/dev-usage'))
    expect(syncCall).toBeTruthy()
    const [, init] = syncCall!
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-123' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ count: 1 })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['aiUsage', 'u1'] })
  })

  it('does not delay the mocked response while the server sync is pending', async () => {
    mockGetSession.mockImplementation(() => new Promise(() => {})) // never resolves
    const start = Date.now()

    const res = await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [] }),
    })

    expect(Date.now() - start).toBeLessThan(50)
    expect(res.status).toBe(200)
  })

  it('fails silently when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })

    await window.fetch('https://example.com/api/ai/group-tabs', {
      method: 'POST',
      body: JSON.stringify({ tabs: [] }),
    })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(realFetchSpy.mock.calls.some(([url]: [RequestInfo | URL, RequestInit?]) => String(url).includes('/api/ai/dev-usage'))).toBe(false)
  })

  it('fails silently when the sync network call rejects', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } } })
    realFetchSpy.mockRejectedValue(new Error('network down'))

    await expect(
      window.fetch('https://example.com/api/ai/group-tabs', {
        method: 'POST',
        body: JSON.stringify({ tabs: [] }),
      })
    ).resolves.toBeInstanceOf(Response)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    // no throw, no unhandled rejection — test passing is the assertion
  })
})
