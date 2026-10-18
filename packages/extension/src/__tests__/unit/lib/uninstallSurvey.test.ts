import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UNINSTALL_SURVEY_PARAMS, UNINSTALL_SURVEY_PATH } from '@tabmerger/shared'
import { _resetUninstallSurveyForTests, registerUninstallSurvey } from '@/lib/uninstallSurvey'
import { _resetDataConsentForTests } from '@/lib/dataConsent'

/**
 * registerUninstallSurvey: which builds register the uninstall survey URL, what the URL holds,
 * and that a missing API, a throw or a rejection never escapes.
 */

const WEB_APP = 'https://example.test'
let setUninstallURL: ReturnType<typeof vi.fn>

function stubChrome(runtime: Record<string, unknown>) {
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '3.1.2' }), ...runtime } })
}

function registeredUrl(): URL {
  expect(setUninstallURL).toHaveBeenCalledTimes(1)
  return new URL(setUninstallURL.mock.calls[0][0] as string)
}

beforeEach(() => {
  setUninstallURL = vi.fn().mockResolvedValue(undefined)
  stubChrome({ setUninstallURL })
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_WEB_APP_URL', WEB_APP)
  vi.stubEnv('VITE_DEMO_BUILD', '')
  vi.stubEnv('BROWSER', 'chrome')
  vi.stubEnv('FIREFOX', 'false')
  _resetUninstallSurveyForTests()
  _resetDataConsentForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('registerUninstallSurvey', () => {
  it('registers the survey URL with version, browser and the stable channel', () => {
    registerUninstallSurvey()
    const url = registeredUrl()
    expect(url.origin + url.pathname).toBe(`${WEB_APP}${UNINSTALL_SURVEY_PATH}`)
    expect(url.searchParams.get(UNINSTALL_SURVEY_PARAMS.version)).toBe('3.1.2')
    expect(url.searchParams.get(UNINSTALL_SURVEY_PARAMS.browser)).toBe('chrome')
    expect(url.searchParams.get(UNINSTALL_SURVEY_PARAMS.channel)).toBe('stable')
  })

  it('sends the beta channel and the browser of a beta Firefox build, with the manifest version as is', () => {
    vi.stubEnv('MODE', 'beta')
    vi.stubEnv('BROWSER', 'firefox')
    stubChrome({ setUninstallURL, getManifest: () => ({ version: '4.1.0.6' }) })
    registerUninstallSurvey()
    const url = registeredUrl()
    expect(url.searchParams.get(UNINSTALL_SURVEY_PARAMS.version)).toBe('4.1.0.6')
    expect(url.searchParams.get(UNINSTALL_SURVEY_PARAMS.browser)).toBe('firefox')
    expect(url.searchParams.get(UNINSTALL_SURVEY_PARAMS.channel)).toBe('beta')
  })

  it('leaves out a browser it does not know', () => {
    vi.stubEnv('BROWSER', 'opera')
    registerUninstallSurvey()
    expect(registeredUrl().searchParams.has(UNINSTALL_SURVEY_PARAMS.browser)).toBe(false)
  })

  it('carries only the version, browser, channel and analytics-flag parameters (no identifier of any kind)', () => {
    registerUninstallSurvey()
    const keys = [...registeredUrl().searchParams.keys()].sort()
    expect(keys).toEqual(Object.values(UNINSTALL_SURVEY_PARAMS).sort())
  })

  it('does nothing without a web app URL', () => {
    vi.stubEnv('VITE_WEB_APP_URL', '')
    registerUninstallSurvey()
    expect(setUninstallURL).not.toHaveBeenCalled()
  })

  it('registers in a development build too, against its own web app URL and the stable channel', () => {
    vi.stubEnv('MODE', 'development')
    vi.stubEnv('VITE_WEB_APP_URL', 'http://localhost:3000')
    registerUninstallSurvey()
    const url = registeredUrl()
    expect(url.origin + url.pathname).toBe(`http://localhost:3000${UNINSTALL_SURVEY_PATH}`)
    expect(url.searchParams.get(UNINSTALL_SURVEY_PARAMS.channel)).toBe('stable')
  })

  it('does nothing in the demo build', () => {
    vi.stubEnv('MODE', 'demo')
    vi.stubEnv('VITE_DEMO_BUILD', 'true')
    registerUninstallSurvey()
    expect(setUninstallURL).not.toHaveBeenCalled()
  })

  it('does nothing when the browser has no setUninstallURL', () => {
    stubChrome({})
    expect(() => registerUninstallSurvey()).not.toThrow()
  })

  it('swallows a synchronous throw', () => {
    setUninstallURL.mockImplementation(() => { throw new Error('bad url') })
    expect(() => registerUninstallSurvey()).not.toThrow()
  })

  it('swallows a rejected promise', async () => {
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    setUninstallURL.mockRejectedValue(new Error('too long'))
    registerUninstallSurvey()
    await new Promise((r) => setTimeout(r, 0))
    process.off('unhandledRejection', onUnhandled)
    expect(setUninstallURL).toHaveBeenCalledTimes(1)
    expect(onUnhandled).not.toHaveBeenCalled()
  })

  it('works with a callback-style API that returns nothing', () => {
    setUninstallURL.mockReturnValue(undefined)
    expect(() => registerUninstallSurvey()).not.toThrow()
    expect(setUninstallURL).toHaveBeenCalledTimes(1)
  })

  it('marks a Chrome or Edge build as allowing analytics (no opt-in exists there)', () => {
    registerUninstallSurvey()
    expect(registeredUrl().searchParams.get(UNINSTALL_SURVEY_PARAMS.analytics)).toBe('1')
  })
})

describe('registerUninstallSurvey on Firefox (analytics consent flag)', () => {
  type Listener = (perms: { data_collection?: string[] }) => void
  let contains: ReturnType<typeof vi.fn>
  let onAdded: Listener[]
  let onRemoved: Listener[]

  function stubFirefox(granted: boolean | Error) {
    vi.stubEnv('FIREFOX', 'true')
    vi.stubEnv('BROWSER', 'firefox')
    onAdded = []
    onRemoved = []
    contains = granted instanceof Error ? vi.fn().mockRejectedValue(granted) : vi.fn().mockResolvedValue(granted)
    vi.stubGlobal('chrome', {
      runtime: { getManifest: () => ({ version: '3.1.2' }), setUninstallURL },
      permissions: {
        contains,
        onAdded: { addListener: (cb: Listener) => onAdded.push(cb) },
        onRemoved: { addListener: (cb: Listener) => onRemoved.push(cb) },
      },
    })
  }

  async function flush() {
    await new Promise((r) => setTimeout(r, 0))
  }

  function lastFlag(): string | null {
    const calls = setUninstallURL.mock.calls
    return new URL(calls[calls.length - 1][0] as string).searchParams.get(UNINSTALL_SURVEY_PARAMS.analytics)
  }

  it('sends a=1 when technicalAndInteraction is granted', async () => {
    stubFirefox(true)
    registerUninstallSurvey()
    await flush()
    expect(contains).toHaveBeenCalledWith({ data_collection: ['technicalAndInteraction'] })
    expect(lastFlag()).toBe('1')
  })

  it('sends a=0 when it is not granted, or the check fails', async () => {
    stubFirefox(false)
    registerUninstallSurvey()
    await flush()
    expect(lastFlag()).toBe('0')

    _resetUninstallSurveyForTests()
    _resetDataConsentForTests()
    stubFirefox(new Error('no permissions API'))
    registerUninstallSurvey()
    await flush()
    expect(lastFlag()).toBe('0')
  })

  it('re-registers with the new flag when the consent is granted or revoked later', async () => {
    stubFirefox(false)
    registerUninstallSurvey()
    await flush()
    expect(lastFlag()).toBe('0')

    contains.mockResolvedValue(true)
    onAdded.forEach((cb) => cb({ data_collection: ['technicalAndInteraction'] }))
    await flush()
    expect(lastFlag()).toBe('1')

    contains.mockResolvedValue(false)
    onRemoved.forEach((cb) => cb({ data_collection: ['technicalAndInteraction'] }))
    await flush()
    expect(lastFlag()).toBe('0')
  })

  it('attaches the consent listeners only once across worker-start calls', async () => {
    stubFirefox(true)
    registerUninstallSurvey()
    registerUninstallSurvey()
    await flush()
    // dataConsent.ts adds its own pair once; this module adds one more pair once.
    expect(onAdded).toHaveLength(2)
    expect(onRemoved).toHaveLength(2)
  })
})
