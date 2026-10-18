/**
 * Server side of `extension_uninstalled` (lib/uninstallTracking.ts): which query values survive,
 * when the analytics-consent flag stops the event, and what reaches GA4's Measurement Protocol.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ANALYTICS_EVENTS } from '@tabmerger/shared'
import { trackUninstall, uninstallEventParams } from '@/lib/uninstallTracking'
import { recordUninstall } from '@/app/[locale]/(marketing)/uninstalled/actions'

const fetchMock = vi.fn()

function sentPayload(): { client_id: string; events: { name: string; params: Record<string, unknown> }[] } {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string)
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GA_EXTENSION_MEASUREMENT_ID', 'G-EXT123')
  vi.stubEnv('GA_EXTENSION_API_SECRET', 'secret123')
  vi.stubEnv('VERCEL_ENV', 'production')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('uninstallEventParams', () => {
  it('keeps an allow-listed browser, a manifest version and a channel', () => {
    expect(uninstallEventParams({ version: '3.3.3', browser: 'chrome', channel: 'stable', analytics: '1' })).toEqual({
      environment: 'production',
      browser: 'chrome',
      extension_version: '3.3.3',
      channel: 'stable',
    })
  })

  it.each([
    ['an unknown browser', { browser: 'safari', analytics: '1' }],
    ['a script in the version', { version: '<script>alert(1)</script>', analytics: '1' }],
    ['an over-long version', { version: '1.2.3.4.5.6.7', analytics: '1' }],
    ['a pre-release suffix', { version: '3.3.3-beta.1', analytics: '1' }],
    ['an array value', { version: ['3.3.3'], browser: ['chrome'], analytics: '1' }],
    ['an unknown, very long channel', { channel: 'x'.repeat(500), analytics: '1' }],
  ])('drops %s instead of forwarding it', (_label, raw) => {
    expect(uninstallEventParams(raw)).toEqual({ environment: 'production' })
  })

  it('returns null when the install did not consent (a=0), on any browser', () => {
    expect(uninstallEventParams({ browser: 'firefox', analytics: '0' })).toBeNull()
    expect(uninstallEventParams({ browser: 'chrome', analytics: '0' })).toBeNull()
  })

  it('without a flag, counts Chrome and Edge only (Firefox needs consent; an unknown browser could be Firefox)', () => {
    expect(uninstallEventParams({ browser: 'chrome' })).not.toBeNull()
    expect(uninstallEventParams({ browser: 'edge' })).not.toBeNull()
    expect(uninstallEventParams({ browser: 'firefox' })).toBeNull()
    expect(uninstallEventParams({})).toBeNull()
  })

  it('only accepts the exact flag values 1 and 0', () => {
    expect(uninstallEventParams({ browser: 'firefox', analytics: 'true' })).toBeNull()
    expect(uninstallEventParams({ browser: 'firefox', analytics: ['1'] })).toBeNull()
  })

  it.each([null, undefined, 'a=1', 42, []])('treats the non-object %j as an empty query', (raw) => {
    expect(uninstallEventParams(raw)).toBeNull()
  })
})

describe('trackUninstall', () => {
  it('sends extension_uninstalled to the extension GA4 property with a random client id', async () => {
    expect(await trackUninstall({ version: '4.0.1', browser: 'firefox', channel: 'beta', analytics: '1' })).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://www.google-analytics.com/mp/collect?measurement_id=G-EXT123&api_secret=secret123')
    const payload = sentPayload()
    expect(payload.events).toEqual([
      {
        name: ANALYTICS_EVENTS.extensionUninstalled,
        params: { environment: 'production', browser: 'firefox', extension_version: '4.0.1', channel: 'beta' },
      },
    ])
    expect(payload.client_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('never calls GA when the consent flag is off', async () => {
    expect(await trackUninstall({ version: '4.0.1', browser: 'firefox', analytics: '0' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when the extension GA4 stream is not configured', async () => {
    vi.stubEnv('GA_EXTENSION_API_SECRET', '')
    expect(await trackUninstall({ browser: 'chrome', analytics: '1' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a GA outage', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(trackUninstall({ browser: 'chrome', analytics: '1' })).resolves.toBe(false)
  })
})

describe('recordUninstall (server action)', () => {
  it('records through the same checks and returns nothing to the caller', async () => {
    await expect(recordUninstall({ browser: 'edge', analytics: '1' })).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await recordUninstall({ browser: 'edge', analytics: '0' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
