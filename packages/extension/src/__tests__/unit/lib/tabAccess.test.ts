import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPageMetaForTab } from '@/lib/tabAccess'

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getPageMetaForTab', () => {
  it('returns null when VITE_WEB_APP_URL is unset', async () => {
    // Unset explicitly. This used to rely on the variable being absent from the
    // ambient environment, so it failed on any machine whose .env.local sets it.
    vi.stubEnv('VITE_WEB_APP_URL', '')
    expect(await getPageMetaForTab('https://example.com')).toBeNull()
  })

  it('returns null for an empty url', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    expect(await getPageMetaForTab('')).toBeNull()
  })

  it('fetches from the og-preview API and maps the response', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ogImage: 'https://x.com/og.png', description: 'A page' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await getPageMetaForTab('https://example.com')).toEqual({
      ogImage: 'https://x.com/og.png',
      description: 'A page',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://tabmerger.app/api/og-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
  })

  it('sends og-preview as a CORS simple request: text/plain content type, unchanged JSON body', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const pageUrl = 'https://example.com/a path?q=ü&x=1#frag'
    await getPageMetaForTab(pageUrl)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    // Exactly one header, and it is CORS-safelisted, so the browser sends no OPTIONS preflight.
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=UTF-8' })
    expect(init.method).toBe('POST')
    // The body is still a plain JSON string with the same shape the route has always parsed.
    expect(typeof init.body).toBe('string')
    expect(JSON.parse(init.body as string)).toEqual({ url: pageUrl })
  })

  it('maps missing response fields to null', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    expect(await getPageMetaForTab('https://example.com')).toEqual({ ogImage: null, description: null })
  })

  it('returns null when the response is not ok', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await getPageMetaForTab('https://example.com')).toBeNull()
  })

  it('returns null instead of throwing when fetch rejects', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    expect(await getPageMetaForTab('https://example.com')).toBeNull()
  })
})
