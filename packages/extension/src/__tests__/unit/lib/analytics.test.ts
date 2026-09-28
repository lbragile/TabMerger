import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hashUserId, trackEvent } from '@/lib/analytics'

describe('hashUserId', () => {
  it('returns a deterministic 64-char hex sha-256 digest', async () => {
    const hash = await hashUserId('user-123')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    const hash2 = await hashUserId('user-123')
    expect(hash2).toBe(hash)
  })

  it('produces different hashes for different inputs', async () => {
    const a = await hashUserId('user-a')
    const b = await hashUserId('user-b')
    expect(a).not.toBe(b)
  })
})

describe('trackEvent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
  })

  it('is a no-op (does not fetch) when VITE_WEB_APP_URL is unset', () => {
    trackEvent('test_event', { foo: 'bar' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('trackEvent — configured', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_WEB_APP_URL', 'http://localhost:3000')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
  })

  it('fetches an existing client id and posts the event to the /api/track proxy', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ ga_client_id: 'existing-id' }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    }
    const mod = await import('@/lib/analytics')
    mod.trackEvent('page_view', { page: 'popup' })
    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/track',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event: 'page_view', params: { page: 'popup' }, client_id: 'existing-id' }),
      })
    )
  })

  it('generates and stores a new client id when none exists', async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({}), set } },
    }
    const mod = await import('@/lib/analytics')
    mod.trackEvent('page_view')
    await new Promise((r) => setTimeout(r, 0))
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ ga_client_id: expect.any(String) }))
  })

  it('swallows fetch errors silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({ ga_client_id: 'x' }), set: vi.fn() } },
    }
    const mod = await import('@/lib/analytics')
    expect(() => mod.trackEvent('page_view')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })
})

describe('trackEvent / trackPostHogEvent — Firefox data-collection consent gating', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_WEB_APP_URL', 'http://localhost:3000')
    vi.stubEnv('VITE_POSTHOG_API_KEY', 'phc_test')
    vi.stubEnv('FIREFOX', 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not fetch (GA4 or PostHog) when technicalAndInteraction is not granted', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({ ga_client_id: 'x' }), set: vi.fn() } },
      permissions: { contains: vi.fn().mockResolvedValue(false), request: vi.fn() },
    }
    const mod = await import('@/lib/analytics')
    mod.trackEvent('page_view')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches (GA4 and PostHog) once technicalAndInteraction is granted', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({ ga_client_id: 'x' }), set: vi.fn() } },
      permissions: { contains: vi.fn().mockResolvedValue(true), request: vi.fn() },
    }
    const mod = await import('@/lib/analytics')
    mod.trackEvent('page_view')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/track', expect.anything())
    expect(fetch).toHaveBeenCalledWith('https://us.i.posthog.com/capture/', expect.anything())
  })

  it('trackPostHogEvent (called directly) also re-checks consent and no-ops when denied', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      storage: { local: { get: vi.fn().mockResolvedValue({ ga_client_id: 'x' }), set: vi.fn() } },
      permissions: { contains: vi.fn().mockResolvedValue(false), request: vi.fn() },
    }
    const mod = await import('@/lib/analytics')
    mod.trackPostHogEvent('direct_call')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).not.toHaveBeenCalled()
  })
})
