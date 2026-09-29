import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'

const onAuthStateChangeMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: onAuthStateChangeMock,
    },
  }),
}))

import { useSyncExtensionAuth } from '@/lib/hooks/useSyncExtensionAuth'
import { _resetExtensionIdCache } from '@/lib/extensionMessaging'

const EXTENSION_ID_MOCK_SESSION = {
  access_token: 'access-token-123',
  refresh_token: 'refresh-token-456',
}

afterEach(() => {
  delete window.chrome
  onAuthStateChangeMock.mockReset()
  _resetExtensionIdCache()
  vi.restoreAllMocks()
})

describe('useSyncExtensionAuth', () => {
  it('forwards SYNC_AUTH with the session tokens when chrome.runtime is available', async () => {
    const sendMessage = vi.fn((_id, msg, callback) => {
      // Real background.ts replies PONG to PING and never calls sendResponse for SYNC_AUTH.
      callback(msg?.type === 'PING' ? { type: 'PONG' } : undefined)
    })
    window.chrome = { runtime: { sendMessage } }

    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    renderHook(() => useSyncExtensionAuth())
    capturedCallback?.('SIGNED_IN', EXTENSION_ID_MOCK_SESSION)

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.any(String),
        {
          type: 'SYNC_AUTH',
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-456',
        },
        expect.any(Function)
      )
    )
  })

  it('does not throw and does not call sendMessage when chrome is undefined', () => {
    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    expect(() => renderHook(() => useSyncExtensionAuth())).not.toThrow()
    expect(() => capturedCallback?.('SIGNED_IN', EXTENSION_ID_MOCK_SESSION)).not.toThrow()
  })

  it('does not call sendMessage when there is no session', async () => {
    const sendMessage = vi.fn()
    window.chrome = { runtime: { sendMessage } }

    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    renderHook(() => useSyncExtensionAuth())
    capturedCallback?.('SIGNED_OUT', null)

    await new Promise((r) => setTimeout(r, 0))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('never sends SYNC_AUTH to an ID that has not answered PING', async () => {
    // This ID answers PING with something other than PONG (e.g. an unrelated extension that
    // happens to share externally_connectable with this origin) — SYNC_AUTH must not follow.
    const sendMessage = vi.fn((_id, _msg, callback) => callback({ type: 'NOT_PONG' }))
    window.chrome = { runtime: { sendMessage } }

    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    renderHook(() => useSyncExtensionAuth())
    capturedCallback?.('SIGNED_IN', EXTENSION_ID_MOCK_SESSION)

    await new Promise((r) => setTimeout(r, 50))
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: 'SYNC_AUTH' }),
      expect.any(Function)
    )
  })
})
