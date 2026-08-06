import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useExtensionInstalled } from '@/lib/hooks/useExtensionInstalled'

const STORAGE_KEY = 'tm_extension_installed'

afterEach(() => {
  localStorage.clear()
  delete window.chrome
  vi.restoreAllMocks()
})

describe('useExtensionInstalled', () => {
  it('returns false when no signal has fired', () => {
    const { result } = renderHook(() => useExtensionInstalled())
    expect(result.current).toBe(false)
  })

  it('returns true immediately from localStorage if previously persisted', () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const { result } = renderHook(() => useExtensionInstalled())
    expect(result.current).toBe(true)
  })

  it('detects installation via chrome.runtime.sendMessage PONG response and persists it', async () => {
    window.chrome = {
      runtime: {
        sendMessage: (_id, _msg, callback) => callback({ type: 'PONG', version: '1.0.0' }),
      },
    }

    const { result } = renderHook(() => useExtensionInstalled())

    await waitFor(() => expect(result.current).toBe(true))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('stays false when sendMessage sets lastError (extension not installed/whitelisted)', async () => {
    window.chrome = {
      runtime: {
        sendMessage: (_id, _msg, callback) => callback(undefined),
        lastError: { message: 'Could not establish connection.' },
      },
    }

    const { result } = renderHook(() => useExtensionInstalled())

    await new Promise((r) => setTimeout(r, 0))
    expect(result.current).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('does not throw when chrome is undefined (regular browser page)', () => {
    expect(() => renderHook(() => useExtensionInstalled())).not.toThrow()
  })

  it('still detects installation via the postMessage fallback', async () => {
    const { result } = renderHook(() => useExtensionInstalled())

    // jsdom's window.postMessage is unreliably async in this test env — dispatch the
    // resulting MessageEvent directly, which is what the hook's listener actually reacts to.
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: 'tabmerger-extension', type: 'INSTALLED' },
      })
    )

    await waitFor(() => expect(result.current).toBe(true))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })
})
