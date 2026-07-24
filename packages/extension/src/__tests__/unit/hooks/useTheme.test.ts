import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTheme } from '@/hooks/useTheme'

const { mockGetSetting } = vi.hoisted(() => ({ mockGetSetting: vi.fn() }))

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))

function mockMatchMedia(matches: boolean) {
  const listeners: Array<() => void> = []
  const mq = {
    matches,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockReturnValue(mq)
  return { mq, fireChange: () => listeners.forEach((cb) => cb()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('useTheme', () => {
  it('applies the saved dark theme on mount', async () => {
    mockGetSetting.mockResolvedValue({ theme: 'dark' })
    mockMatchMedia(false)
    renderHook(() => useTheme())
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('applies light theme on mount (removes dark class)', async () => {
    document.documentElement.classList.add('dark')
    mockGetSetting.mockResolvedValue({ theme: 'light' })
    mockMatchMedia(false)
    renderHook(() => useTheme())
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  })

  it('defaults to system theme when no setting is saved', async () => {
    mockGetSetting.mockResolvedValue({})
    mockMatchMedia(true)
    renderHook(() => useTheme())
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('re-applies system theme when the OS color scheme changes and pref is "system"', async () => {
    mockGetSetting.mockResolvedValueOnce({ theme: 'system' }).mockResolvedValue({ theme: 'system' })
    const { fireChange } = mockMatchMedia(false)
    renderHook(() => useTheme())
    await vi.waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    // Flip matchMedia to dark and fire the change listener
    ;(window.matchMedia('(prefers-color-scheme: dark)') as unknown as { matches: boolean }).matches = true
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    fireChange()
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('does NOT re-apply on OS change when pref is explicitly "light"', async () => {
    mockGetSetting.mockResolvedValue({ theme: 'light' })
    const { fireChange } = mockMatchMedia(false)
    renderHook(() => useTheme())
    await vi.waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireChange()
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  })

  it('cleans up the matchMedia listener on unmount', () => {
    mockGetSetting.mockResolvedValue({ theme: 'system' })
    const { mq } = mockMatchMedia(false)
    const { unmount } = renderHook(() => useTheme())
    unmount()
    expect(mq.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
