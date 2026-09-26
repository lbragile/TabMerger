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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://tabmerger.app/api/og-preview?url=https%3A%2F%2Fexample.com'
    )
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
