import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/lib/extensionId', () => ({
  EXTENSION_IDS: ['chrome-id', 'edge-id'],
}))

import {
  sendToExtension,
  sendToKnownExtension,
  getCachedExtensionId,
  onExtensionReady,
  _resetExtensionIdCache,
} from '@/lib/extensionMessaging'

function dispatchExtensionMessage(data: unknown, overrides: Partial<MessageEventInit> = {}) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: window.location.origin,
      data,
      ...overrides,
    })
  )
}

afterEach(() => {
  delete window.chrome
  _resetExtensionIdCache()
  vi.restoreAllMocks()
})

describe('sendToExtension', () => {
  it('returns null when chrome.runtime is undefined', async () => {
    await expect(sendToExtension({ type: 'PING' })).resolves.toBeNull()
  })

  it('resolves with the first ID that answers', async () => {
    const sendMessage = vi.fn((id, _msg, cb) => cb({ type: 'PONG' }))
    window.chrome = { runtime: { sendMessage } }

    const result = await sendToExtension({ type: 'PING' })

    expect(result).toEqual({ id: 'chrome-id', response: { type: 'PONG' } })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(getCachedExtensionId()).toBe('chrome-id')
  })

  it('falls through to the second ID when the first fails', async () => {
    const sendMessage = vi.fn((id, _msg, cb) => {
      if (id === 'chrome-id') {
        cb(undefined)
      } else {
        cb({ type: 'PONG' })
      }
    })
    window.chrome = { runtime: { sendMessage, lastError: undefined } }

    // Simulate lastError only for the first call
    let callCount = 0
    window.chrome.runtime!.sendMessage = vi.fn((id, _msg, cb) => {
      callCount++
      if (id === 'chrome-id') {
        window.chrome!.runtime!.lastError = { message: 'no receiver' }
        cb(undefined)
      } else {
        window.chrome!.runtime!.lastError = undefined
        cb({ type: 'PONG' })
      }
    })

    const result = await sendToExtension({ type: 'PING' })

    expect(result).toEqual({ id: 'edge-id', response: { type: 'PONG' } })
    expect(callCount).toBe(2)
  })

  it('returns null when no ID answers', async () => {
    window.chrome = {
      runtime: {
        sendMessage: vi.fn((_id, _msg, cb) => {
          window.chrome!.runtime!.lastError = { message: 'no receiver' }
          cb(undefined)
        }),
      },
    }

    const result = await sendToExtension({ type: 'PING' })
    expect(result).toBeNull()
  })

  it('resolves null and does not throw when sendMessage throws synchronously', async () => {
    window.chrome = {
      runtime: {
        sendMessage: vi.fn(() => {
          throw new Error('boom')
        }),
      },
    }

    await expect(sendToExtension({ type: 'PING' })).resolves.toBeNull()
  })

  it('reuses the cached responder on subsequent calls without re-probing every ID', async () => {
    const sendMessage = vi.fn((id, _msg, cb) => {
      if (id === 'chrome-id') cb({ type: 'PONG' })
    })
    window.chrome = { runtime: { sendMessage } }

    await sendToExtension({ type: 'PING' })
    expect(getCachedExtensionId()).toBe('chrome-id')

    sendMessage.mockClear()
    sendMessage.mockImplementation((id, _msg, cb) => cb({ type: 'PONG' }))
    const second = await sendToExtension({ type: 'SYNC_NOW' })

    expect(second).toEqual({ id: 'chrome-id', response: { type: 'PONG' } })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith('chrome-id', { type: 'SYNC_NOW' }, expect.any(Function))
  })

  it('clears the cache and re-probes if the cached responder stops answering', async () => {
    let chromeShouldAnswer = true
    const sendMessage = vi.fn((id, _msg, cb) => {
      if (id === 'chrome-id' && chromeShouldAnswer) {
        window.chrome!.runtime!.lastError = undefined
        cb({ type: 'PONG' })
      } else if (id === 'edge-id') {
        window.chrome!.runtime!.lastError = undefined
        cb({ type: 'PONG' })
      } else {
        window.chrome!.runtime!.lastError = { message: 'gone' }
        cb(undefined)
      }
    })
    window.chrome = { runtime: { sendMessage } }

    await sendToExtension({ type: 'PING' })
    expect(getCachedExtensionId()).toBe('chrome-id')

    chromeShouldAnswer = false
    const result = await sendToExtension({ type: 'PING' })

    expect(result).toEqual({ id: 'edge-id', response: { type: 'PONG' } })
    expect(getCachedExtensionId()).toBe('edge-id')
  })
})

describe('postMessage transport (Firefox fallback)', () => {
  it('falls back to postMessage and resolves when the relay replies with a matching requestId', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage')

    const resultPromise = sendToExtension({ type: 'PING' })

    await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalled())
    const [sent, targetOrigin] = postMessageSpy.mock.calls[0]
    expect(targetOrigin).toBe(window.location.origin)
    expect(targetOrigin).not.toBe('*')

    dispatchExtensionMessage({
      source: 'tabmerger-extension',
      requestId: (sent as { requestId: string }).requestId,
      response: { type: 'PONG' },
    })

    const result = await resultPromise
    expect(result).toEqual({ id: expect.any(String), response: { type: 'PONG' } })
    expect(getCachedExtensionId()).not.toBeNull()
  })

  it('ignores a reply with the wrong origin', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage')
    const resultPromise = sendToExtension({ type: 'PING' })

    await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalled())
    const [sent] = postMessageSpy.mock.calls[0]

    dispatchExtensionMessage(
      {
        source: 'tabmerger-extension',
        requestId: (sent as { requestId: string }).requestId,
        response: { type: 'PONG' },
      },
      { origin: 'https://evil.example' }
    )

    // The bogus reply must not resolve it — real timeout still applies, so just assert it
    // hasn't resolved yet with the spoofed response.
    const raced = await Promise.race([resultPromise.then(() => 'resolved'), Promise.resolve('pending')])
    expect(raced).toBe('pending')
  }, 3000)

  it('ignores a reply with the wrong source object', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage')
    const resultPromise = sendToExtension({ type: 'PING' })

    await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalled())
    const [sent] = postMessageSpy.mock.calls[0]

    // No `source: window` override — MessageEvent.source defaults to null, which must fail
    // the `event.source === window` check even though origin/data are otherwise valid.
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          source: 'tabmerger-extension',
          requestId: (sent as { requestId: string }).requestId,
          response: { type: 'PONG' },
        },
      })
    )

    const raced = await Promise.race([resultPromise.then(() => 'resolved'), Promise.resolve('pending')])
    expect(raced).toBe('pending')
  }, 3000)

  it('ignores a reply with a non-matching requestId', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage')
    const resultPromise = sendToExtension({ type: 'PING' })

    await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalled())

    dispatchExtensionMessage({
      source: 'tabmerger-extension',
      requestId: 'not-the-real-request-id',
      response: { type: 'PONG' },
    })

    const raced = await Promise.race([resultPromise.then(() => 'resolved'), Promise.resolve('pending')])
    expect(raced).toBe('pending')
  }, 3000)

  it('marks the extension detected via a READY announcement, without any pending request', () => {
    dispatchExtensionMessage({ source: 'tabmerger-extension', type: 'READY', version: '1.2.3' })
    expect(getCachedExtensionId()).not.toBeNull()
  })

  it('ignores READY in a browser with runtime messaging, so a spoofed READY cannot divert messages', () => {
    const sendMessage = vi.fn()
    window.chrome = { runtime: { sendMessage } }
    dispatchExtensionMessage({ source: 'tabmerger-extension', type: 'READY', version: '1.2.3' })
    expect(getCachedExtensionId()).toBeNull()
  })

  it('onExtensionReady fires immediately if READY already arrived', () => {
    dispatchExtensionMessage({ source: 'tabmerger-extension', type: 'READY', version: '1.2.3' })

    const callback = vi.fn()
    const unsubscribe = onExtensionReady(callback)
    expect(callback).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('onExtensionReady fires when READY arrives after subscribing', () => {
    const callback = vi.fn()
    const unsubscribe = onExtensionReady(callback)
    expect(callback).not.toHaveBeenCalled()

    dispatchExtensionMessage({ source: 'tabmerger-extension', type: 'READY', version: '1.2.3' })

    expect(callback).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('SYNC_AUTH is not sent over postMessage before the extension has shown itself', async () => {
    expect(getCachedExtensionId()).toBeNull()
    const result = await sendToKnownExtension({ type: 'SYNC_AUTH', accessToken: 'a', refreshToken: 'b' })
    expect(result).toBeNull()
  })

  it('SYNC_AUTH is sent over postMessage only after READY, and never with targetOrigin "*"', async () => {
    dispatchExtensionMessage({ source: 'tabmerger-extension', type: 'READY', version: '1.2.3' })
    expect(getCachedExtensionId()).not.toBeNull()

    const postMessageSpy = vi.spyOn(window, 'postMessage')
    const resultPromise = sendToKnownExtension({ type: 'SYNC_AUTH', accessToken: 'a', refreshToken: 'b' })

    await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalled())
    const [sent, targetOrigin] = postMessageSpy.mock.calls[0]
    expect(targetOrigin).toBe(window.location.origin)
    expect(targetOrigin).not.toBe('*')
    expect((sent as { type?: string }).type).toBe('SYNC_AUTH')

    dispatchExtensionMessage({
      source: 'tabmerger-extension',
      requestId: (sent as { requestId: string }).requestId,
      response: undefined,
    })

    await resultPromise
  })
})

describe('sendToKnownExtension', () => {
  it('returns null when there is no cached responder yet', async () => {
    window.chrome = { runtime: { sendMessage: vi.fn() } }
    await expect(sendToKnownExtension({ type: 'SYNC_AUTH' })).resolves.toBeNull()
  })

  it('sends only to the cached responder, never spraying every ID', async () => {
    const sendMessage = vi.fn((id, _msg, cb) => {
      if (id === 'chrome-id') cb({ type: 'PONG' })
    })
    window.chrome = { runtime: { sendMessage } }

    await sendToExtension({ type: 'PING' }) // establishes the cache
    sendMessage.mockClear()

    const result = await sendToKnownExtension({ type: 'SYNC_AUTH', accessToken: 'a', refreshToken: 'b' })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      'chrome-id',
      { type: 'SYNC_AUTH', accessToken: 'a', refreshToken: 'b' },
      expect.any(Function)
    )
    expect(result?.id).toBe('chrome-id')
  })
})
