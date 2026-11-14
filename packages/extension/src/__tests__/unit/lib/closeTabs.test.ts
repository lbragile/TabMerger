import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTabs, closeWindows } from '@/lib/closeLiveTabs'
import { quietCloseTabKey, quietCloseWindowKey } from '@/lib/recentlyClosed'

let order: string[]

beforeEach(() => {
  order = []
  ;(globalThis as { chrome?: unknown }).chrome = {
    tabs: { remove: vi.fn(async () => void order.push('remove')) },
    windows: { remove: vi.fn(async () => void order.push('windows.remove')) },
    storage: { session: { set: vi.fn(async () => void order.push('mark')) } },
  }
})

describe('closeTabs', () => {
  it('record: false marks the ids quiet BEFORE closing (the worker must see the mark)', async () => {
    await closeTabs([4, 5, 4], { record: false })
    expect(order).toEqual(['mark', 'remove'])
    const marks = vi.mocked(chrome.storage.session.set).mock.calls[0][0] as Record<string, number>
    expect(Object.keys(marks)).toEqual([quietCloseTabKey(4), quietCloseTabKey(5)])
    expect(chrome.tabs.remove).toHaveBeenCalledWith([4, 5])
  })

  it('record: true closes without a mark, and keeps a single id a single id', async () => {
    await closeTabs(7, { record: true })
    expect(chrome.storage.session.set).not.toHaveBeenCalled()
    expect(chrome.tabs.remove).toHaveBeenCalledWith(7)
  })

  it('does nothing for no valid ids, and still closes when session storage is missing', async () => {
    await closeTabs([-1, Number.NaN], { record: false })
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    ;(chrome.storage as { session?: unknown }).session = undefined
    await closeTabs([3], { record: false })
    expect(chrome.tabs.remove).toHaveBeenCalledWith([3])
  })

  it('rejects like chrome.tabs.remove so callers keep their own catch', async () => {
    vi.mocked(chrome.tabs.remove).mockRejectedValueOnce(new Error('No tab with id'))
    await expect(closeTabs([1], { record: true })).rejects.toThrow('No tab with id')
  })
})

describe('closeWindows', () => {
  it('record: false marks each window quiet, then closes them', async () => {
    await closeWindows([2, 3], { record: false })
    expect(order).toEqual(['mark', 'windows.remove', 'windows.remove'])
    const marks = vi.mocked(chrome.storage.session.set).mock.calls[0][0] as Record<string, number>
    expect(Object.keys(marks)).toEqual([quietCloseWindowKey(2), quietCloseWindowKey(3)])
  })

  it('record: true closes without a mark', async () => {
    await closeWindows(9, { record: true })
    expect(chrome.storage.session.set).not.toHaveBeenCalled()
    expect(chrome.windows.remove).toHaveBeenCalledWith(9)
  })
})
