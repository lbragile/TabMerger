import { renderHook } from '@testing-library/react'
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

const EXTENSION_ID_MOCK_SESSION = {
  access_token: 'access-token-123',
  refresh_token: 'refresh-token-456',
}

afterEach(() => {
  delete window.chrome
  onAuthStateChangeMock.mockReset()
  vi.restoreAllMocks()
})

describe('useSyncExtensionAuth', () => {
  it('forwards SYNC_AUTH with the session tokens when chrome.runtime is available', () => {
    const sendMessage = vi.fn((_id, _msg, callback) => callback())
    window.chrome = { runtime: { sendMessage } }

    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    renderHook(() => useSyncExtensionAuth())
    capturedCallback?.('SIGNED_IN', EXTENSION_ID_MOCK_SESSION)

    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      {
        type: 'SYNC_AUTH',
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
      },
      expect.any(Function)
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

  it('does not call sendMessage when there is no session', () => {
    const sendMessage = vi.fn()
    window.chrome = { runtime: { sendMessage } }

    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    renderHook(() => useSyncExtensionAuth())
    capturedCallback?.('SIGNED_OUT', null)

    expect(sendMessage).not.toHaveBeenCalled()
  })
})
