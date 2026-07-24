import { describe, it, expect, vi, beforeEach } from 'vitest'

// WXT provides `defineContentScript` as a build-time global (unimport). Stub it here so the
// module can be imported directly and its `main()` invoked like the real content script would.
type ContentScriptConfig = { matches: string[]; runAt: string; main: () => void }
let capturedConfig: ContentScriptConfig | undefined
;(globalThis as unknown as { defineContentScript: (cfg: ContentScriptConfig) => ContentScriptConfig }).defineContentScript = (cfg) => {
  capturedConfig = cfg
  return cfg
}

beforeEach(() => {
  vi.resetModules()
  capturedConfig = undefined
  vi.stubEnv('VITE_WEB_APP_URL', '')
  localStorage.clear()
  document.head.innerHTML = ''
  document.title = ''
  globalThis.chrome = {
    runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn() },
  } as unknown as typeof chrome
})

async function loadAndRun() {
  await import('@/entrypoints/content')
  capturedConfig!.main()
  return capturedConfig!
}

describe('content script — config', () => {
  it('matches all URLs and runs at document_idle', async () => {
    const cfg = await loadAndRun()
    expect(cfg.matches).toEqual(['<all_urls>'])
    expect(cfg.runAt).toBe('document_idle')
  })
})

describe('content script — GET_PAGE_META message handler', () => {
  it('responds with page title, og:description, and url', async () => {
    document.title = 'My Page'
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'og:description')
    meta.setAttribute('content', 'A great page')
    document.head.appendChild(meta)

    await loadAndRun()
    const listener = (globalThis.chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const sendResponse = vi.fn()
    listener({ type: 'GET_PAGE_META' }, {}, sendResponse)

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Page',
      description: 'A great page',
    }))
  })

  it('falls back to the plain meta description when og:description is absent', async () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'description')
    meta.setAttribute('content', 'Plain desc')
    document.head.appendChild(meta)

    await loadAndRun()
    const listener = (globalThis.chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const sendResponse = vi.fn()
    listener({ type: 'GET_PAGE_META' }, {}, sendResponse)
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ description: 'Plain desc' }))
  })
})

describe('content script — web-app auth bridge', () => {
  it('forwards access/refresh tokens found in localStorage when on the web-app origin', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    Object.defineProperty(window, 'location', {
      value: new URL('https://tabmerger.app/dashboard'),
      writable: true,
      configurable: true,
    })
    localStorage.setItem('sb-session', JSON.stringify({ access_token: 'a', refresh_token: 'b' }))

    await loadAndRun()

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SYNC_AUTH',
      accessToken: 'a',
      refreshToken: 'b',
    })
  })

  it('does nothing when not on the web-app origin', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    Object.defineProperty(window, 'location', {
      value: new URL('https://other-site.com'),
      writable: true,
      configurable: true,
    })
    localStorage.setItem('sb-session', JSON.stringify({ access_token: 'a', refresh_token: 'b' }))

    await loadAndRun()

    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('skips non-JSON and irrelevant localStorage entries without throwing', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    Object.defineProperty(window, 'location', {
      value: new URL('https://tabmerger.app/dashboard'),
      writable: true,
      configurable: true,
    })
    localStorage.setItem('not-json', 'plain-string')
    localStorage.setItem('unrelated', JSON.stringify({ foo: 'bar' }))

    await loadAndRun()

    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('re-scans on a "storage" event and forwards tokens found afterwards', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.app')
    Object.defineProperty(window, 'location', {
      value: new URL('https://tabmerger.app/dashboard'),
      writable: true,
      configurable: true,
    })

    await loadAndRun()
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled()

    localStorage.setItem('sb-session', JSON.stringify({ access_token: 'a', refresh_token: 'b' }))
    window.dispatchEvent(new Event('storage'))

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SYNC_AUTH',
      accessToken: 'a',
      refreshToken: 'b',
    })
  })
})

describe('content script — SET_TAB_TITLE message handler', () => {
  it('sets document.title from the message payload', async () => {
    await loadAndRun()
    const listener = (globalThis.chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0]
    listener({ type: 'SET_TAB_TITLE', title: 'New Title' }, {}, vi.fn())
    expect(document.title).toBe('New Title')
  })
})
