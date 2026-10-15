import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  readTourRecord: vi.fn(),
  isTourPracticeTabOpen: vi.fn(),
  openTourPracticeTab: vi.fn(),
  closeTourPracticeTab: vi.fn(),
  setTourTabSandbox: vi.fn(),
}))
vi.mock('@/lib/tour', () => ({ readTourRecord: m.readTourRecord }))
vi.mock('@/lib/tourPracticeTab', () => ({
  isTourPracticeTabOpen: m.isTourPracticeTabOpen,
  openTourPracticeTab: m.openTourPracticeTab,
  closeTourPracticeTab: m.closeTourPracticeTab,
}))
vi.mock('@/lib/tourSandbox', () => ({ setTourTabSandbox: m.setTourTabSandbox }))

import { useTourPracticeTab } from '@/hooks/useTourPracticeTab'

beforeEach(() => {
  vi.clearAllMocks()
  m.readTourRecord.mockResolvedValue(null)
  m.isTourPracticeTabOpen.mockResolvedValue(false)
  m.openTourPracticeTab.mockResolvedValue(42)
  m.closeTourPracticeTab.mockResolvedValue(undefined)
})

describe('useTourPracticeTab', () => {
  it('stays off and touches nothing while inactive', () => {
    const { result } = renderHook(() => useTourPracticeTab(false))
    expect(result.current).toEqual({ id: null, state: 'off' })
    expect(m.setTourTabSandbox).not.toHaveBeenCalled()
    expect(m.openTourPracticeTab).not.toHaveBeenCalled()
  })

  it('locks the sandbox, opens a tab and becomes ready', async () => {
    const { result } = renderHook(() => useTourPracticeTab(true))
    expect(m.setTourTabSandbox).toHaveBeenCalledWith({ tabId: null })
    await waitFor(() => expect(result.current).toEqual({ id: 42, state: 'ready' }))
    expect(m.setTourTabSandbox).toHaveBeenLastCalledWith({ tabId: 42 })
  })

  it('reuses the remembered tab when it is still open', async () => {
    m.readTourRecord.mockResolvedValue({ status: 'pending', practiceTabId: 7 })
    m.isTourPracticeTabOpen.mockResolvedValue(true)
    const { result } = renderHook(() => useTourPracticeTab(true))
    await waitFor(() => expect(result.current).toEqual({ id: 7, state: 'ready' }))
    expect(m.isTourPracticeTabOpen).toHaveBeenCalledWith(7)
    expect(m.openTourPracticeTab).not.toHaveBeenCalled()
  })

  it('opens a new tab when the remembered one is gone', async () => {
    m.readTourRecord.mockResolvedValue({ status: 'pending', practiceTabId: 7 })
    m.isTourPracticeTabOpen.mockResolvedValue(false)
    const { result } = renderHook(() => useTourPracticeTab(true))
    await waitFor(() => expect(result.current.id).toBe(42))
    expect(m.openTourPracticeTab).toHaveBeenCalled()
  })

  it('is failed when the browser refuses to open the tab', async () => {
    m.openTourPracticeTab.mockResolvedValue(null)
    const { result } = renderHook(() => useTourPracticeTab(true))
    await waitFor(() => expect(result.current).toEqual({ id: null, state: 'failed' }))
    expect(m.setTourTabSandbox).toHaveBeenLastCalledWith({ tabId: null })
  })

  it('closes the tab, drops the sandbox and goes off when active ends', async () => {
    const { result, rerender } = renderHook(({ on }) => useTourPracticeTab(on), { initialProps: { on: true } })
    await waitFor(() => expect(result.current.state).toBe('ready'))
    rerender({ on: false })
    expect(m.setTourTabSandbox).toHaveBeenLastCalledWith(null)
    expect(m.closeTourPracticeTab).toHaveBeenCalledWith(42)
    expect(result.current).toEqual({ id: null, state: 'off' })
  })

  it('closes a tab that finished opening after the step was already left', async () => {
    let resolveOpen: (id: number) => void = () => {}
    m.openTourPracticeTab.mockReturnValue(new Promise<number>((r) => (resolveOpen = r)))
    const { unmount } = renderHook(() => useTourPracticeTab(true))
    await waitFor(() => expect(m.openTourPracticeTab).toHaveBeenCalled())
    unmount()
    expect(m.closeTourPracticeTab).toHaveBeenCalledWith(null)
    await act(async () => resolveOpen(55))
    expect(m.closeTourPracticeTab).toHaveBeenCalledWith(55)
    expect(m.setTourTabSandbox).not.toHaveBeenCalledWith({ tabId: 55 })
  })
})
