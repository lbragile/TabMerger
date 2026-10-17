import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WEB_APP_ACCESS_DISMISSED_KEY,
  closePopupView,
  dismissWebAppHostPatterns,
  getDismissedWebAppHostPatterns,
  getMissingWebAppHostPatterns,
  WEB_APP_ACCESS_PAGE_PATH,
  hostOfPattern,
  openWebAppHostAccessPage,
  requestWebAppHostAccess,
  webAppHostPatterns,
} from '@/lib/webAppHostAccess'

// Firefox MV3 doesn't grant a content-script site added by an update; this module finds the
// trusted bridge sites Firefox hasn't granted, asks for them, and remembers a dismissal.

const originalChrome = (globalThis as { chrome?: unknown }).chrome
let contains: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>
let store: Record<string, unknown>
let storageGet: ReturnType<typeof vi.fn>
let storageSet: ReturnType<typeof vi.fn>

beforeEach(() => {
  contains = vi.fn().mockResolvedValue(true)
  request = vi.fn().mockResolvedValue(true)
  store = {}
  storageGet = vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {}))
  storageSet = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items)
  })
  ;(globalThis as { chrome?: unknown }).chrome = {
    permissions: { contains, request },
    storage: { local: { get: storageGet, set: storageSet } },
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  ;(globalThis as { chrome?: unknown }).chrome = originalChrome
})

function firefoxBuild(primary: string, extras = '') {
  vi.stubEnv('FIREFOX', 'true')
  vi.stubEnv('VITE_WEB_APP_URL', primary)
  vi.stubEnv('VITE_EXTRA_WEB_APP_URLS', extras)
}

describe('webAppHostPatterns', () => {
  it('lists the primary and every extra on a Firefox build, primary first', () => {
    firefoxBuild('https://tabmerger.vercel.app', 'https://tabmerger.com')
    expect(webAppHostPatterns()).toEqual(['https://tabmerger.vercel.app/*', 'https://tabmerger.com/*'])
  })

  it('lists just the primary when there are no extras', () => {
    firefoxBuild('https://tabmerger.vercel.app')
    expect(webAppHostPatterns()).toEqual(['https://tabmerger.vercel.app/*'])
  })

  it('is empty on Chrome and Edge builds', () => {
    firefoxBuild('https://tabmerger.vercel.app', 'https://tabmerger.com')
    vi.stubEnv('FIREFOX', 'false')
    expect(webAppHostPatterns()).toEqual([])
  })

  it('fails closed (empty) on a value the parser rejects', () => {
    firefoxBuild('https://tabmerger.vercel.app', 'https://*.tabmerger.com')
    expect(webAppHostPatterns()).toEqual([])
  })

  it('is empty when no web app URL is set', () => {
    firefoxBuild('')
    expect(webAppHostPatterns()).toEqual([])
  })
})

describe('getMissingWebAppHostPatterns', () => {
  it('returns nothing when every site is granted, checking each one', async () => {
    firefoxBuild('https://tabmerger.vercel.app', 'https://tabmerger.com')
    await expect(getMissingWebAppHostPatterns()).resolves.toEqual([])
    expect(contains).toHaveBeenCalledWith({ origins: ['https://tabmerger.vercel.app/*'] })
    expect(contains).toHaveBeenCalledWith({ origins: ['https://tabmerger.com/*'] })
  })

  it('returns only the sites that are not granted', async () => {
    firefoxBuild('https://tabmerger.vercel.app', 'https://tabmerger.com')
    contains.mockImplementation(async ({ origins }: { origins: string[] }) => origins[0] !== 'https://tabmerger.com/*')
    await expect(getMissingWebAppHostPatterns()).resolves.toEqual(['https://tabmerger.com/*'])
  })

  it('never touches chrome.permissions on Chrome and Edge', async () => {
    firefoxBuild('https://tabmerger.vercel.app', 'https://tabmerger.com')
    vi.stubEnv('FIREFOX', 'false')
    await expect(getMissingWebAppHostPatterns()).resolves.toEqual([])
    expect(contains).not.toHaveBeenCalled()
  })

  it('reads an API error as nothing missing, so no prompt it cannot act on is shown', async () => {
    firefoxBuild('https://tabmerger.vercel.app', 'https://tabmerger.com')
    contains.mockRejectedValue(new Error('boom'))
    await expect(getMissingWebAppHostPatterns()).resolves.toEqual([])
  })
})

describe('requestWebAppHostAccess', () => {
  it('requests exactly the given patterns, synchronously, and resolves true on grant', async () => {
    const pending = requestWebAppHostAccess(['https://tabmerger.com/*'])
    // Called before anything was awaited: Firefox needs the request inside the user action.
    expect(request).toHaveBeenCalledWith({ origins: ['https://tabmerger.com/*'] })
    await expect(pending).resolves.toBe(true)
  })

  it('resolves false when the user refuses', async () => {
    request.mockResolvedValue(false)
    await expect(requestWebAppHostAccess(['https://tabmerger.com/*'])).resolves.toBe(false)
  })

  it('resolves false when the request rejects or throws', async () => {
    request.mockRejectedValue(new Error('not in a user action'))
    await expect(requestWebAppHostAccess(['https://tabmerger.com/*'])).resolves.toBe(false)
    request.mockImplementation(() => {
      throw new Error('sync throw')
    })
    await expect(requestWebAppHostAccess(['https://tabmerger.com/*'])).resolves.toBe(false)
  })

  it('does not call the API when there is nothing to ask for', async () => {
    await expect(requestWebAppHostAccess([])).resolves.toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('openWebAppHostAccessPage', () => {
  function withTabs(create: ReturnType<typeof vi.fn>) {
    Object.assign((globalThis as { chrome: Record<string, unknown> }).chrome, {
      runtime: { getURL: (path: string) => `moz-extension://test-id${path}` },
      tabs: { create },
    })
  }

  it('opens the built site-access page, active, with nothing in the URL, and never requests from here', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 })
    withTabs(create)
    await expect(openWebAppHostAccessPage()).resolves.toBe(true)
    expect(WEB_APP_ACCESS_PAGE_PATH).toBe('/site-access.html')
    expect(create).toHaveBeenCalledWith({ url: 'moz-extension://test-id/site-access.html', active: true })
    expect(request).not.toHaveBeenCalled()
  })

  it('resolves false when the tab cannot be opened', async () => {
    withTabs(vi.fn().mockRejectedValue(new Error('no')))
    await expect(openWebAppHostAccessPage()).resolves.toBe(false)
    withTabs(
      vi.fn(() => {
        throw new Error('sync throw')
      })
    )
    await expect(openWebAppHostAccessPage()).resolves.toBe(false)
  })
})

describe('closePopupView', () => {
  // Opening a tab leaves a Firefox popup open, so the banner closes it after opening the tab.
  let close: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    close = vi.spyOn(window, 'close').mockImplementation(() => {})
  })
  afterEach(() => {
    close.mockRestore()
  })
  const withViews = (getViews: unknown) =>
    Object.assign((globalThis as { chrome: Record<string, unknown> }).chrome, { extension: { getViews } })

  it('closes the page when it is the popup', () => {
    const getViews = vi.fn(() => [window])
    withViews(getViews)
    closePopupView()
    expect(getViews).toHaveBeenCalledWith({ type: 'popup' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('leaves popup.html alone when it is open as an ordinary tab', () => {
    withViews(vi.fn(() => []))
    closePopupView()
    expect(close).not.toHaveBeenCalled()
  })

  it('closes when the browser cannot list its views', () => {
    closePopupView()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('swallows an error from the browser', () => {
    withViews(
      vi.fn(() => {
        throw new Error('no views')
      })
    )
    expect(() => closePopupView()).not.toThrow()
    expect(close).not.toHaveBeenCalled()
  })
})

describe('dismissed patterns', () => {
  it('reads none when nothing is stored', async () => {
    await expect(getDismissedWebAppHostPatterns()).resolves.toEqual([])
  })

  it('stores a dismissal and merges a later one without duplicates', async () => {
    await dismissWebAppHostPatterns(['https://tabmerger.com/*'])
    await dismissWebAppHostPatterns(['https://tabmerger.com/*', 'https://other.example.com/*'])
    expect(store[WEB_APP_ACCESS_DISMISSED_KEY]).toEqual(['https://tabmerger.com/*', 'https://other.example.com/*'])
    await expect(getDismissedWebAppHostPatterns()).resolves.toEqual([
      'https://tabmerger.com/*',
      'https://other.example.com/*',
    ])
  })

  it('ignores a malformed stored value and non-string entries', async () => {
    store[WEB_APP_ACCESS_DISMISSED_KEY] = 'https://tabmerger.com/*'
    await expect(getDismissedWebAppHostPatterns()).resolves.toEqual([])
    store[WEB_APP_ACCESS_DISMISSED_KEY] = ['https://tabmerger.com/*', 42, null]
    await expect(getDismissedWebAppHostPatterns()).resolves.toEqual(['https://tabmerger.com/*'])
  })

  it('treats storage errors as nothing dismissed and never throws on save', async () => {
    storageGet.mockRejectedValue(new Error('no storage'))
    storageSet.mockRejectedValue(new Error('no storage'))
    await expect(getDismissedWebAppHostPatterns()).resolves.toEqual([])
    await expect(dismissWebAppHostPatterns(['https://tabmerger.com/*'])).resolves.toBeUndefined()
  })
})

describe('hostOfPattern', () => {
  it.each([
    ['https://tabmerger.com/*', 'tabmerger.com'],
    ['https://preview.tabmerger.com/*', 'preview.tabmerger.com'],
    ['http://localhost:3000/*', 'localhost:3000'],
    ['not a pattern', 'not a pattern'],
  ])('%s to %s', (pattern, host) => {
    expect(hostOfPattern(pattern)).toBe(host)
  })
})
