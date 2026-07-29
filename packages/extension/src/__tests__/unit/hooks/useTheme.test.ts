import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useTheme } from '@/hooks/useTheme'

const { mockGetSetting } = vi.hoisted(() => ({ mockGetSetting: vi.fn() }))

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

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
    renderHook(() => useTheme(), { wrapper })
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('applies light theme on mount (removes dark class)', async () => {
    document.documentElement.classList.add('dark')
    mockGetSetting.mockResolvedValue({ theme: 'light' })
    mockMatchMedia(false)
    renderHook(() => useTheme(), { wrapper })
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  })

  it('defaults to system theme when no setting is saved', async () => {
    mockGetSetting.mockResolvedValue({})
    mockMatchMedia(true)
    renderHook(() => useTheme(), { wrapper })
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('re-applies system theme when the OS color scheme changes and pref is "system"', async () => {
    mockGetSetting.mockResolvedValue({ theme: 'system' })
    const { fireChange } = mockMatchMedia(false)
    renderHook(() => useTheme(), { wrapper })
    await vi.waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    // Flip matchMedia to dark and fire the change listener
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    fireChange()
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('does NOT re-apply on OS change when pref is explicitly "light"', async () => {
    mockGetSetting.mockResolvedValue({ theme: 'light' })
    const { fireChange } = mockMatchMedia(false)
    renderHook(() => useTheme(), { wrapper })
    await vi.waitFor(() => expect(mockGetSetting).toHaveBeenCalled())
    fireChange()
    await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
  })

  it('cleans up the matchMedia listener on unmount', () => {
    mockGetSetting.mockResolvedValue({ theme: 'system' })
    const { mq } = mockMatchMedia(false)
    const { unmount } = renderHook(() => useTheme(), { wrapper })
    unmount()
    expect(mq.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('reflects a theme saved from elsewhere in the same session once the shared appSettings query is invalidated (regression: settings should update without reopening the popup)', async () => {
    mockGetSetting.mockResolvedValueOnce({ theme: 'light' }).mockResolvedValue({ theme: 'dark' })
    mockMatchMedia(false)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children),
    })
    void result
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['appSettings'] })
    })
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })
})
