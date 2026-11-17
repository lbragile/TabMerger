import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import type { RecentlyClosedDay } from '@/lib/recentlyClosedDays'
import { getSectionViewStatus, clearSectionViewStatus } from '@/lib/sectionViewStatus'

const h = vi.hoisted(() => ({
  reopen: vi.fn(),
  removeEntries: vi.fn(),
  removeDay: vi.fn(),
  clearAll: vi.fn(),
  undo: vi.fn(),
  save: vi.fn(),
  saveCaps: [] as unknown[],
  track: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/hooks/useRecentlyClosed', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/hooks/useRecentlyClosed')>()
  return {
    RECENTLY_CLOSED_UNDO_TOAST_MS: real.RECENTLY_CLOSED_UNDO_TOAST_MS,
    RecentlyClosedOpenError: real.RecentlyClosedOpenError,
    useReopenRecentlyClosed: () => ({ mutateAsync: h.reopen }),
    useRemoveRecentlyClosedEntry: () => ({ mutateAsync: h.removeEntries }),
    useRemoveRecentlyClosedDay: () => ({ mutateAsync: h.removeDay }),
    useClearRecentlyClosed: () => ({ mutateAsync: h.clearAll }),
    useUndoRecentlyClosed: () => ({ mutateAsync: h.undo }),
  }
})
vi.mock('@/hooks/useGroups', () => ({
  useSaveClosedToGroup: (caps: unknown) => {
    h.saveCaps.push(caps)
    return { mutateAsync: h.save }
  },
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: 5, maxTabs: 50 }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: h.track }))
vi.mock('@/lib/toast', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }))

import { RecentlyClosedOpenError, RECENTLY_CLOSED_UNDO_TOAST_MS } from '@/hooks/useRecentlyClosed'
import { useRecentlyClosedActions, useEntryName } from '@/hooks/useRecentlyClosedActions'
import { FreeLimitExceededError } from '@/lib/tierLimits'
import { ClosedSaveTargetGoneError } from '@/lib/recentlyClosedSave'

const tabEntry: RecentlyClosedEntry = { id: 't1', closedAt: 1, kind: 'tab', tabs: [{ url: 'https://github.com/pr/1', title: 'Pull request #1' }] }
const windowEntry: RecentlyClosedEntry = {
  id: 'w1',
  closedAt: 2,
  kind: 'window',
  tabs: [
    { url: 'https://figma.com/a', title: 'A' },
    { url: 'https://figma.com/b', title: 'B' },
    { url: 'https://figma.com/c', title: 'C' },
  ],
}
const day: RecentlyClosedDay = {
  key: '2030-01-02',
  kind: 'today',
  label: 'Today',
  color: 'rgba(239, 68, 68, 1)',
  start: 0,
  end: 1,
  entries: [tabEntry, windowEntry],
  tabCount: 1,
  windowCount: 1,
  allTabCount: 4,
}

/** The Undo action of the last success toast. */
function lastUndo(): () => void {
  const opts = h.toastSuccess.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } }
  return opts.action.onClick
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSectionViewStatus()
  h.reopen.mockResolvedValue({ kind: 'restore', entries: [tabEntry], openedTabIds: [9] })
  h.removeEntries.mockResolvedValue({ kind: 'unmark', ids: ['t1'] })
  h.removeDay.mockResolvedValue({ kind: 'unmark', ids: ['t1', 'w1'] })
  h.clearAll.mockResolvedValue({ kind: 'unmark', ids: ['t1', 'w1', 'x'] })
  h.undo.mockResolvedValue({ complete: true })
  h.save.mockResolvedValue({})
})

describe('useEntryName', () => {
  it('a tab is its title, else its address; a window says how many tabs', () => {
    const { result } = renderHook(() => useEntryName())
    expect(result.current(tabEntry)).toBe('Pull request #1')
    expect(result.current({ ...tabEntry, tabs: [{ url: 'https://example.com/x', title: '' }] })).toBe('example.com/x')
    expect(result.current(windowEntry)).toBe('Window · 3 tabs')
    expect(result.current(windowEntry, 1)).toBe('B')
  })
})

describe('useRecentlyClosedActions', () => {
  it('passes the Free caps to the save mutation', () => {
    renderHook(() => useRecentlyClosedActions())
    expect(h.saveCaps.at(-1)).toEqual({ maxGroups: 5, maxTabs: 50 })
  })

  it('reopen: opens focused, counts a tab, toasts and announces "Reopened …" with a 9 s Undo', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.reopen(tabEntry)
    })
    expect(ok).toBe(true)
    expect(h.reopen).toHaveBeenCalledWith({ entry: tabEntry, tabIndex: undefined, active: true })
    expect(h.track).toHaveBeenCalledWith('recently_closed_reopened', { kind: 'tab', from: 'list' })
    expect(h.toastSuccess).toHaveBeenCalledWith('Reopened Pull request #1', expect.objectContaining({ duration: RECENTLY_CLOSED_UNDO_TOAST_MS }))
    expect(getSectionViewStatus()).toBe('Reopened Pull request #1')
    // analytics never carry a URL, a title or a site
    expect(JSON.stringify(h.track.mock.calls)).not.toMatch(/github|Pull request/)
    await act(async () => lastUndo()())
    expect(h.undo).toHaveBeenCalledWith({ kind: 'restore', entries: [tabEntry], openedTabIds: [9] })
  })

  it('reopen in the background (Ctrl/Cmd or middle click) does not focus the tab', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      await result.current.reopen(tabEntry, { background: true })
    })
    expect(h.reopen).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
  })

  it('restoring a whole window counts a window and says how many tabs', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      await result.current.reopen(windowEntry)
    })
    expect(h.track).toHaveBeenCalledWith('recently_closed_reopened', { kind: 'window', from: 'list' })
    expect(h.toastSuccess).toHaveBeenCalledWith('Restored a window with 3 tabs', expect.anything())
  })

  it('one tab out of a window counts a tab (what actually opened)', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      await result.current.reopen(windowEntry, { tabIndex: 2 })
    })
    expect(h.track).toHaveBeenCalledWith('recently_closed_reopened', { kind: 'tab', from: 'list' })
    expect(h.toastSuccess).toHaveBeenCalledWith('Reopened C', expect.anything())
  })

  it('a page the browser refuses: an error toast, the entry stays, nothing counted', async () => {
    h.reopen.mockRejectedValue(new RecentlyClosedOpenError())
    const { result } = renderHook(() => useRecentlyClosedActions())
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.reopen(tabEntry)
    })
    expect(ok).toBe(false)
    expect(h.toastError).toHaveBeenCalledWith("Couldn't open this page. It stays in the list.")
    expect(h.track).not.toHaveBeenCalled()
    expect(h.toastSuccess).not.toHaveBeenCalled()
  })

  it('any other failure says the list could not be changed', async () => {
    h.removeEntries.mockRejectedValue(new Error('idb'))
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.remove(tabEntry)).toBe(false)
    })
    expect(h.toastError).toHaveBeenCalledWith("Couldn't change the list of closed tabs. Try again.")
  })

  it('remove: "Removed … from the list" with Undo; an Undo that came too late says so', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.remove(tabEntry)).toBe(true)
    })
    expect(h.removeEntries).toHaveBeenCalledWith({ ids: ['t1'] })
    expect(h.toastSuccess).toHaveBeenCalledWith('Removed Pull request #1 from the list', expect.anything())
    h.undo.mockResolvedValue({ complete: false })
    await act(async () => lastUndo()())
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Couldn't bring them back: they were already deleted."))
  })

  it('remove of an entry already gone does nothing', async () => {
    h.removeEntries.mockResolvedValue({ kind: 'unmark', ids: [] })
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.remove(tabEntry)).toBe(false)
    })
    expect(h.toastSuccess).not.toHaveBeenCalled()
  })

  it('removeDay and clearAll mark the entries and say how many', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      await result.current.removeDay(day)
    })
    expect(h.removeDay).toHaveBeenCalledWith({ day: '2030-01-02' })
    expect(h.toastSuccess).toHaveBeenLastCalledWith('Cleared 2 closed tabs and windows', expect.anything())
    await act(async () => {
      await result.current.clearAll()
    })
    expect(h.track).toHaveBeenCalledWith('recently_closed_cleared')
    expect(h.toastSuccess).toHaveBeenLastCalledWith('Cleared 3 closed tabs and windows', expect.anything())
  })

  it('removeDay / clearAll with nothing marked show nothing', async () => {
    h.removeDay.mockResolvedValue({ kind: 'unmark', ids: [] })
    h.clearAll.mockResolvedValue({ kind: 'unmark', ids: [] })
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.removeDay(day)).toBe(false)
      expect(await result.current.clearAll()).toBe(false)
    })
    expect(h.toastSuccess).not.toHaveBeenCalled()
  })

  it('reopenAll: one window with every tab of the day, then the day leaves; Undo closes the window and brings the day back', async () => {
    h.reopen.mockResolvedValue({ kind: 'restore', entries: [{ id: 'day-x' }], openedTabIds: [], openedWindowId: 77 })
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.reopenAll(day)).toBe(true)
    })
    const input = h.reopen.mock.calls[0][0] as { entry: RecentlyClosedEntry }
    expect(input.entry.kind).toBe('window')
    expect(input.entry.tabs.map((t) => t.url)).toEqual(['https://github.com/pr/1', 'https://figma.com/a', 'https://figma.com/b', 'https://figma.com/c'])
    expect(h.removeDay).toHaveBeenCalledWith({ day: '2030-01-02' })
    expect(h.track).toHaveBeenCalledWith('recently_closed_reopened', { kind: 'window', from: 'list' })
    expect(h.toastSuccess).toHaveBeenCalledWith('Reopened 4 tabs in a new window', expect.anything())
    await act(async () => lastUndo()())
    await vi.waitFor(() => expect(h.undo).toHaveBeenCalledTimes(2))
    // the combined entry is never stored back
    expect(h.undo.mock.calls[0][0]).toEqual({ kind: 'restore', entries: [], openedTabIds: [], openedWindowId: 77 })
    expect(h.undo.mock.calls[1][0]).toEqual({ kind: 'unmark', ids: ['t1', 'w1'] })
  })

  it('reopenAll of an empty day does nothing', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.reopenAll({ ...day, entries: [] })).toBe(false)
    })
    expect(h.reopen).not.toHaveBeenCalled()
  })

  it('a failing Undo says the list could not be changed', async () => {
    h.undo.mockRejectedValue(new Error('idb'))
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      await result.current.remove(tabEntry)
    })
    await act(async () => lastUndo()())
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Couldn't change the list of closed tabs. Try again."))
  })

  it('saveToGroup: saves through useGroups, counts the kind, says where; the entry stays', async () => {
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.saveToGroup([tabEntry], { groupId: 'g1' }, 'tab', 'Work')).toBe(true)
    })
    expect(h.save).toHaveBeenCalledWith({ entries: [tabEntry], target: { groupId: 'g1' } })
    expect(h.track).toHaveBeenCalledWith('recently_closed_saved', { kind: 'tab' })
    expect(h.toastSuccess).toHaveBeenCalledWith('Saved to Work', expect.anything())
    expect(getSectionViewStatus()).toBe('Saved to Work')
    expect(h.removeEntries).not.toHaveBeenCalled()
  })

  it('saveToGroup over the Free limit: the backstop already toasted, nothing more', async () => {
    h.save.mockRejectedValue(new FreeLimitExceededError('maxTabs'))
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.saveToGroup([tabEntry], { newGroupName: 'github.com' }, 'tab', 'github.com')).toBe(false)
    })
    expect(h.toastError).not.toHaveBeenCalled()
    expect(h.track).not.toHaveBeenCalled()
  })

  it('saveToGroup into a group that is gone by the time it writes: "That group no longer exists", no success, no analytics', async () => {
    h.save.mockRejectedValue(new ClosedSaveTargetGoneError())
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      expect(await result.current.saveToGroup([tabEntry], { groupId: 'g1' }, 'tab', 'Work')).toBe(false)
    })
    expect(h.toastError).toHaveBeenCalledWith('That group no longer exists. Nothing was saved.')
    expect(h.toastSuccess).not.toHaveBeenCalled()
    expect(h.track).not.toHaveBeenCalled()
    expect(getSectionViewStatus()).toBe('')
  })

  it('saveToGroup failing otherwise shows an error', async () => {
    h.save.mockRejectedValue(new Error('write failed'))
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      await result.current.saveToGroup([tabEntry], { groupId: 'g1' }, 'tab', 'Work')
    })
    expect(h.toastError).toHaveBeenCalled()
  })

  it('copyLink copies the URL, or says it could not', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { result } = renderHook(() => useRecentlyClosedActions())
    await act(async () => {
      await result.current.copyLink('https://github.com/pr/1')
    })
    expect(writeText).toHaveBeenCalledWith('https://github.com/pr/1')
    expect(h.toastSuccess).toHaveBeenCalledWith('Link copied', expect.anything())
    writeText.mockRejectedValue(new Error('denied'))
    await act(async () => {
      await result.current.copyLink('https://github.com/pr/1')
    })
    expect(h.toastError).toHaveBeenCalledWith("Couldn't copy the link.")
  })
})
