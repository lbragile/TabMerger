import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EXTENSION_MESSAGE, WEB_BRIDGE } from '@tabmerger/shared'

// Firefox-only content script bridge (src/entrypoints/web-bridge.content.ts) — relays
// window.postMessage <-> chrome.runtime.sendMessage for PING/SYNC_AUTH/SYNC_NOW, since
// Firefox doesn't support externally_connectable for web pages. See background.test.ts's
// "Firefox web-bridge internal onMessage listener" describe block for the background half.

type ContentScriptConfig = { matches: string[]; include?: string[]; main: () => void }
let captured: ContentScriptConfig | undefined
;(globalThis as unknown as { defineContentScript: (cfg: ContentScriptConfig) => ContentScriptConfig }).defineContentScript = (
  cfg
) => {
  captured = cfg
  return cfg
}

const postMessageSpy = vi.fn()

beforeEach(async () => {
  vi.resetModules()
  captured = undefined
  postMessageSpy.mockClear()
  vi.stubGlobal('location', { origin: 'http://localhost:3000', href: 'http://localhost:3000/dashboard' })
  window.postMessage = postMessageSpy as unknown as typeof window.postMessage
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: vi.fn(),
      getManifest: vi.fn().mockReturnValue({ version: '4.0.0' }),
    },
  }
  await import('@/entrypoints/web-bridge.content')
  captured!.main()
})

function dispatch(data: unknown, opts: Partial<{ source: unknown; origin: string }> = {}) {
  const event = new MessageEvent('message', {
    data,
    origin: opts.origin ?? 'http://localhost:3000',
  })
  Object.defineProperty(event, 'source', { value: 'source' in opts ? opts.source : window })
  window.dispatchEvent(event)
}

describe('web-bridge content script — manifest scoping', () => {
  it('is Firefox-only', () => {
    expect(captured!.include).toEqual(['firefox'])
  })

  it('matches only the configured web app origin', () => {
    expect(captured!.matches).toEqual(['http://localhost:3000/*'])
  })
})

describe('web-bridge content script — READY announcement', () => {
  it('announces once on load with the manifest version', () => {
    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: WEB_BRIDGE.EXTENSION_SOURCE, type: WEB_BRIDGE.READY, version: '4.0.0' },
      'http://localhost:3000'
    )
  })
})

describe('web-bridge content script — message filtering', () => {
  it('ignores events not sourced from this exact window', () => {
    dispatch({ source: WEB_BRIDGE.WEBSITE_SOURCE, requestId: '1', type: EXTENSION_MESSAGE.PING }, { source: {} })
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('ignores events from a different origin', () => {
    dispatch(
      { source: WEB_BRIDGE.WEBSITE_SOURCE, requestId: '1', type: EXTENSION_MESSAGE.PING },
      { origin: 'https://evil.example.com' }
    )
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('ignores payloads missing the tabmerger-web source tag', () => {
    dispatch({ requestId: '1', type: EXTENSION_MESSAGE.PING })
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('ignores unknown message types', () => {
    // Deliberately a literal, not a constant — proving a type outside the allowed set is
    // rejected, not just any of the three real ones.
    dispatch({ source: WEB_BRIDGE.WEBSITE_SOURCE, requestId: '1', type: 'DELETE_EVERYTHING' })
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('ignores null/undefined data', () => {
    dispatch(null)
    dispatch(undefined)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })
})

describe('web-bridge content script — valid forwarding + reply', () => {
  it('forwards a valid PING and replies to the same origin with the response', async () => {
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: EXTENSION_MESSAGE.PONG,
      version: '4.0.0',
    })
    dispatch({ source: WEB_BRIDGE.WEBSITE_SOURCE, requestId: 'req-1', type: EXTENSION_MESSAGE.PING })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: EXTENSION_MESSAGE.PING })
    await new Promise((r) => setTimeout(r, 0))
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        source: WEB_BRIDGE.EXTENSION_SOURCE,
        requestId: 'req-1',
        response: { type: EXTENSION_MESSAGE.PONG, version: '4.0.0' },
      },
      'http://localhost:3000'
    )
  })

  it('forwards SYNC_AUTH payload fields but never echoes them back in the reply', async () => {
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    dispatch({
      source: WEB_BRIDGE.WEBSITE_SOURCE,
      requestId: 'req-2',
      type: EXTENSION_MESSAGE.SYNC_AUTH,
      payload: { accessToken: 'secret-a', refreshToken: 'secret-b' },
    })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: EXTENSION_MESSAGE.SYNC_AUTH,
      accessToken: 'secret-a',
      refreshToken: 'secret-b',
    })
    await new Promise((r) => setTimeout(r, 0))
    const replyCall = postMessageSpy.mock.calls.find((c) => (c[0] as { requestId?: string }).requestId === 'req-2')
    expect(replyCall![0]).toEqual({ source: WEB_BRIDGE.EXTENSION_SOURCE, requestId: 'req-2', response: undefined })
    expect(JSON.stringify(replyCall)).not.toContain('secret-a')
    expect(JSON.stringify(replyCall)).not.toContain('secret-b')
  })

  it('forwards SYNC_NOW with no payload', async () => {
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    dispatch({ source: WEB_BRIDGE.WEBSITE_SOURCE, requestId: 'req-3', type: EXTENSION_MESSAGE.SYNC_NOW })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: EXTENSION_MESSAGE.SYNC_NOW })
  })

  it('replies with an error payload if sendMessage rejects, still scoped to this origin', async () => {
    ;(chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no receiving end'))
    dispatch({ source: WEB_BRIDGE.WEBSITE_SOURCE, requestId: 'req-4', type: EXTENSION_MESSAGE.PING })
    await new Promise((r) => setTimeout(r, 0))
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        source: WEB_BRIDGE.EXTENSION_SOURCE,
        requestId: 'req-4',
        response: { ok: false, reason: 'error', message: 'no receiving end' },
      },
      'http://localhost:3000'
    )
  })
})
