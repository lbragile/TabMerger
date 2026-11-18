import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RECENTLY_CLOSED_CLEAR_DELAY_MS, RECENTLY_CLOSED_MESSAGE } from '@tabmerger/shared'

const h = vi.hoisted(() => ({
  getEntries: vi.fn(),
  deleteEntries: vi.fn(),
  putEntries: vi.fn(),
  mark: vi.fn(),
  unmark: vi.fn(),
  notify: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  closeTabs: vi.fn(),
  closeWindows: vi.fn(),
  setRemember: vi.fn(),
}))

// the plan the popup shows (useEntitlements) and the confirmed-Free prune, separate from `h` (all mocks)
const plan = vi.hoisted(() => ({ tier: 'pro' as string, loading: false, trim: vi.fn() }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: plan.tier, loading: plan.loading }) }))
vi.mock('@/lib/recentlyClosedPlan', () => ({ trimRecentlyClosedIfFree: plan.trim }))

vi.mock('@/lib/recentlyClosedDb', () => ({
  getRecentlyClosedEntries: h.getEntries,
  deleteRecentlyClosedEntries: h.deleteEntries,
  putRecentlyClosedEntries: h.putEntries,
  markRecentlyClosedCleared: h.mark,
  unmarkRecentlyClosedCleared: h.unmark,
  notifyRecentlyClosedChanged: h.notify,
  setRememberClosedTabs: h.setRemember,
}))
vi.mock('@/lib/localDb', () => ({ getSetting: h.getSetting, setSetting: h.setSetting }))
vi.mock('@/lib/closeLiveTabs', () => ({ closeTabs: h.closeTabs, closeWindows: h.closeWindows }))

import {
  RECENTLY_CLOSED_QUERY_KEY,
  RECENTLY_CLOSED_UNDO_TOAST_MS,
  RecentlyClosedOpenError,
  useClearRecentlyClosed,
  useRecentlyClosed,
  useReopenRecentlyClosed,
  useRemoveRecentlyClosedDay,
  useRemoveRecentlyClosedEntry,
  useRecentlyClosedPlan,
  useSetRememberClosedTabs,
  useTrimRecentlyClosedForPlan,
  useUndoRecentlyClosed,
} from '@/hooks/useRecentlyClosed'
import { APP_SETTINGS_QUERY_KEY } from '@/hooks/useAppSettings'
import { localDayKey } from '@/lib/recentlyClosedDays'
import { APP_SETTINGS_KEY } from '@/lib/syncSettingKeys'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'

const NOW = Date.now()
const tabEntry = (id: string, url = `https://${id}.test/`, closedAt = NOW - 1000): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'tab',
  tabs: [{ url, title: id }],
})
const windowEntry = (id: string, tabs: RecentlyClosedEntry['tabs'], closedAt = NOW - 2000): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'window',
  tabs,
})

let qc: QueryClient
let listeners: Array<(m: unknown) => void>
let removeListener: ReturnType<typeof vi.fn>
let tabsCreate: ReturnType<typeof vi.fn>
let windowsCreate: ReturnType<typeof vi.fn>
let tabsUpdate: ReturnType<typeof vi.fn>
let tabsGroup: ReturnType<typeof vi.fn>
let tabGroupsUpdate: ReturnType<typeof vi.fn>
let sendMessage: ReturnType<typeof vi.fn>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  listeners = []
  removeListener = vi.fn()
  tabsCreate = vi.fn(async () => ({ id: 77 }))
  windowsCreate = vi.fn(async () => ({ id: 500, tabs: [{ id: 11 }, { id: 12 }, { id: 13 }] }))
  tabsUpdate = vi.fn(async () => ({}))
  tabsGroup = vi.fn(async () => 9)
  tabGroupsUpdate = vi.fn(async () => ({}))
  sendMessage = vi.fn()
  for (const m of Object.values(h)) m.mockReset()
  plan.tier = 'pro'
  plan.loading = false
  plan.trim.mockReset().mockResolvedValue(0)
  h.getEntries.mockResolvedValue([])
  h.deleteEntries.mockResolvedValue(undefined)
  h.putEntries.mockResolvedValue(undefined)
  h.mark.mockResolvedValue([])
  h.unmark.mockResolvedValue(0)
  h.getSetting.mockImplementation(async (_k: string, d: unknown) => d)
  h.setSetting.mockResolvedValue(undefined)
  h.closeTabs.mockResolvedValue(undefined)
  h.closeWindows.mockResolvedValue(undefined)
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage,
      onMessage: { addListener: (l: (m: unknown) => void) => listeners.push(l), removeListener },
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 3 })), create: windowsCreate },
    tabs: { create: tabsCreate, update: tabsUpdate, group: tabsGroup },
    tabGroups: { update: tabGroupsUpdate },
  }
})

describe('useRecentlyClosed', () => {
  it('reads the entries newest first and groups them into days', async () => {
    h.getEntries.mockResolvedValue([tabEntry('a'), windowEntry('w', [{ url: 'https://x.test', title: 'x' }, { url: 'https://y.test', title: 'y' }])])
    const { result } = renderHook(() => useRecentlyClosed(), { wrapper })
    expect(result.current.entries).toEqual([])
    expect(result.current.days).toEqual([])
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
    expect(result.current.days.length).toBeGreaterThan(0)
    expect(result.current.days[0].key).toBe(localDayKey(NOW - 1000))
  })

  it('refetches when the worker broadcasts RECENTLY_CLOSED_CHANGED, ignores other messages, and unsubscribes on unmount', async () => {
    const { result, unmount } = renderHook(() => useRecentlyClosed(), { wrapper })
    await waitFor(() => expect(h.getEntries).toHaveBeenCalledTimes(1))
    expect(listeners).toHaveLength(1)
    h.getEntries.mockResolvedValue([tabEntry('fresh')])
    act(() => listeners[0]({ type: 'SOMETHING_ELSE' }))
    act(() => listeners[0](null))
    expect(h.getEntries).toHaveBeenCalledTimes(1)
    act(() => listeners[0]({ type: RECENTLY_CLOSED_MESSAGE.CHANGED }))
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(['fresh']))
    unmount()
    expect(removeListener).toHaveBeenCalledWith(listeners[0])
  })

  it('does not subscribe when chrome.runtime.onMessage is missing', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {}
    const { result } = renderHook(() => useRecentlyClosed(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(listeners).toHaveLength(0)
  })
})

/** Local noon `back` days before today (a day boundary never splits the fixtures). */
const daysAgo = (back: number, hour = 12) => {
  const d = new Date(NOW)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, hour).getTime()
}

describe('useRecentlyClosed: what the plan lists', () => {
  const threeDays = () => [tabEntry('today', 'https://t.test/', daysAgo(0, 1)), tabEntry('yest', 'https://y.test/', daysAgo(1)), tabEntry('old', 'https://o.test/', daysAgo(4))]

  it('Free lists only its newest 2 days that have closes: entries, days and their count agree', async () => {
    plan.tier = 'free'
    h.getEntries.mockResolvedValue(threeDays())
    const { result } = renderHook(() => useRecentlyClosed(), { wrapper })
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
    expect(result.current.plan).toBe('free')
    expect(result.current.entries.map((e) => e.id)).toEqual(['today', 'yest'])
    expect(result.current.days.map((d) => d.key)).toEqual([localDayKey(daysAgo(0)), localDayKey(daysAgo(1))])
  })

  it('Free with no close today: the 2 newest days with closes, not the last 2 calendar days', async () => {
    plan.tier = 'free'
    h.getEntries.mockResolvedValue([tabEntry('a', 'https://a.test/', daysAgo(3)), tabEntry('b', 'https://b.test/', daysAgo(6)), tabEntry('c', 'https://c.test/', daysAgo(9))])
    const { result } = renderHook(() => useRecentlyClosed(), { wrapper })
    await waitFor(() => expect(result.current.days).toHaveLength(2))
    expect(result.current.entries.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('Pro, and Free while the plan is still loading, list every stored day', async () => {
    h.getEntries.mockResolvedValue(threeDays())
    const { result, rerender } = renderHook(() => useRecentlyClosed(), { wrapper })
    await waitFor(() => expect(result.current.days).toHaveLength(3))
    expect(result.current.plan).toBe('pro')
    plan.tier = 'free'
    plan.loading = true
    rerender()
    expect(result.current.plan).toBe('unknown')
    expect(result.current.days).toHaveLength(3)
    plan.loading = false
    rerender()
    expect(result.current.plan).toBe('free')
    expect(result.current.days).toHaveLength(2)
  })

  it('useRecentlyClosedPlan: Pro AI is pro', () => {
    plan.tier = 'pro_ai'
    expect(renderHook(() => useRecentlyClosedPlan()).result.current).toBe('pro')
  })
})

describe('useTrimRecentlyClosedForPlan', () => {
  it('prunes once when the popup shows Free, refreshing the list when something went', async () => {
    plan.tier = 'free'
    plan.trim.mockResolvedValue(2)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { rerender } = renderHook(() => useTrimRecentlyClosedForPlan(), { wrapper })
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: RECENTLY_CLOSED_QUERY_KEY }))
    rerender()
    rerender()
    expect(plan.trim).toHaveBeenCalledTimes(1)
  })

  it('never while the plan loads or on Pro; runs once the plan turns out Free', async () => {
    plan.tier = 'free'
    plan.loading = true
    const { rerender } = renderHook(() => useTrimRecentlyClosedForPlan(), { wrapper })
    plan.tier = 'pro'
    plan.loading = false
    rerender()
    expect(plan.trim).not.toHaveBeenCalled()
    plan.tier = 'free'
    rerender()
    await waitFor(() => expect(plan.trim).toHaveBeenCalledTimes(1))
  })

  it('nothing deleted: no refresh; a failed prune only warns', async () => {
    plan.tier = 'free'
    const spy = vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useTrimRecentlyClosedForPlan(), { wrapper })
    await waitFor(() => expect(plan.trim).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(spy).not.toHaveBeenCalled()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    plan.trim.mockRejectedValueOnce(new Error('idb'))
    renderHook(() => useTrimRecentlyClosedForPlan(), { wrapper })
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[TabMerger] recently closed trim failed:', expect.any(Error)))
    warn.mockRestore()
  })
})

describe('useReopenRecentlyClosed', () => {
  const run = async (input: Parameters<ReturnType<typeof useReopenRecentlyClosed>['mutateAsync']>[0]) => {
    const { result } = renderHook(() => useReopenRecentlyClosed(), { wrapper })
    return result.current.mutateAsync(input)
  }

  it('reopens a tab entry in the popup window, activates it, deletes the entry and resolves a restore undo', async () => {
    const entry = tabEntry('t1', 'https://one.test/')
    const undo = await run({ entry })
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://one.test/', active: true, windowId: 3 })
    expect(h.deleteEntries).toHaveBeenCalledWith(['t1'])
    expect(h.notify).toHaveBeenCalled()
    expect(undo).toEqual({ kind: 'restore', entries: [entry], openedTabIds: [77] })
  })

  it('honours windowId, active:false and a pinned tab; falls back to no windowId when the popup window is unknown', async () => {
    const pinned: RecentlyClosedEntry = { id: 'p', closedAt: NOW, kind: 'tab', tabs: [{ url: 'https://p.test/', title: 'p', pinned: true }] }
    await run({ entry: pinned, windowId: 9, active: false })
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: 'https://p.test/', active: false, windowId: 9, pinned: true })
    ;(chrome.windows.getCurrent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no window'))
    await run({ entry: tabEntry('q') })
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: 'https://q.test/', active: true })
  })

  it('a popup window id of -1 is treated as unknown', async () => {
    ;(chrome.windows.getCurrent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: -1 })
    await run({ entry: tabEntry('z') })
    expect(tabsCreate).toHaveBeenLastCalledWith({ url: 'https://z.test/', active: true })
  })

  it('restores a whole window with its pinned tabs re-pinned and tab groups rebuilt for consecutive tabs', async () => {
    const entry = windowEntry('w1', [
      { url: 'https://a.test/', title: 'a', pinned: true },
      { url: 'https://b.test/', title: 'b', tabGroup: { title: 'Work', color: 'blue' } },
      { url: 'https://c.test/', title: 'c', tabGroup: { title: 'Work', color: 'blue' } },
    ])
    const undo = await run({ entry })
    expect(windowsCreate).toHaveBeenCalledWith({ url: ['https://a.test/', 'https://b.test/', 'https://c.test/'], focused: true })
    expect(tabsUpdate).toHaveBeenCalledTimes(1)
    expect(tabsUpdate).toHaveBeenCalledWith(11, { pinned: true })
    // b and c are one group
    expect(tabsGroup).toHaveBeenCalledTimes(1)
    expect(tabsGroup).toHaveBeenCalledWith({ tabIds: [12, 13], createProperties: { windowId: 500 } })
    expect(tabGroupsUpdate).toHaveBeenCalledWith(9, { title: 'Work', color: 'blue' })
    expect(h.deleteEntries).toHaveBeenCalledWith(['w1'])
    expect(undo).toEqual({ kind: 'restore', entries: [entry], openedTabIds: [], openedWindowId: 500 })
  })

  it('tabs with different group titles or colours form separate groups; a pinned tab never joins one', async () => {
    windowsCreate.mockResolvedValue({ id: 8, tabs: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] })
    const entry = windowEntry('w2', [
      { url: 'https://a.test/', title: 'a', tabGroup: { title: 'A', color: 'red' } },
      { url: 'https://b.test/', title: 'b', tabGroup: { title: 'A', color: 'green' } },
      { url: 'https://c.test/', title: 'c', pinned: true, tabGroup: { title: 'A', color: 'green' } },
      { url: 'https://d.test/', title: 'd', tabGroup: { title: 'B', color: 'green' } },
    ])
    await run({ entry })
    expect(tabsGroup.mock.calls.map((c) => c[0].tabIds)).toEqual([[1], [2], [4]])
  })

  it('a grouping failure is cosmetic: the window is still restored and the entry removed', async () => {
    tabsGroup.mockRejectedValue(new Error('no groups'))
    tabsUpdate.mockRejectedValue(new Error('gone'))
    const entry = windowEntry('w3', [
      { url: 'https://a.test/', title: 'a', pinned: true },
      { url: 'https://b.test/', title: 'b', tabGroup: { title: 'G', color: 'red' } },
    ])
    await expect(run({ entry })).resolves.toMatchObject({ openedWindowId: 500 })
    expect(h.deleteEntries).toHaveBeenCalledWith(['w3'])
  })

  it('skips regrouping when the browser has no tab group API (Firefox without it)', async () => {
    ;(chrome as unknown as { tabGroups?: unknown }).tabGroups = undefined
    const entry = windowEntry('w4', [
      { url: 'https://a.test/', title: 'a', tabGroup: { title: 'G', color: 'red' } },
      { url: 'https://b.test/', title: 'b' },
    ])
    await run({ entry })
    expect(tabsGroup).not.toHaveBeenCalled()
    expect(h.deleteEntries).toHaveBeenCalledWith(['w4'])
  })

  it('reopens one tab out of a window entry; the rest stays as the same window entry', async () => {
    const entry = windowEntry('w5', [
      { url: 'https://a.test/', title: 'a' },
      { url: 'https://b.test/', title: 'b' },
      { url: 'https://c.test/', title: 'c' },
    ])
    const undo = await run({ entry, tabIndex: 1 })
    expect(tabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://b.test/' }))
    expect(windowsCreate).not.toHaveBeenCalled()
    expect(h.deleteEntries).not.toHaveBeenCalled()
    expect(h.putEntries).toHaveBeenCalledWith([{ ...entry, kind: 'window', tabs: [entry.tabs[0], entry.tabs[2]] }])
    expect(undo).toEqual({ kind: 'restore', entries: [entry], openedTabIds: [77] })
  })

  it('a window entry left with a single tab becomes a tab entry', async () => {
    const entry = windowEntry('w6', [
      { url: 'https://a.test/', title: 'a' },
      { url: 'https://b.test/', title: 'b' },
    ])
    await run({ entry, tabIndex: 0 })
    expect(h.putEntries).toHaveBeenCalledWith([{ ...entry, kind: 'tab', tabs: [entry.tabs[1]] }])
  })

  it('rejects with RecentlyClosedOpenError and KEEPS the entry when the browser refuses a tab', async () => {
    tabsCreate.mockRejectedValue(new Error('Cannot open'))
    await expect(run({ entry: tabEntry('t2') })).rejects.toBeInstanceOf(RecentlyClosedOpenError)
    expect(h.deleteEntries).not.toHaveBeenCalled()
    expect(h.putEntries).not.toHaveBeenCalled()
  })

  it('rejects for a javascript: URL without calling the browser', async () => {
    const bad: RecentlyClosedEntry = { id: 'bad', closedAt: NOW, kind: 'tab', tabs: [{ url: 'javascript:alert(1)', title: 'x' }] }
    await expect(run({ entry: bad })).rejects.toThrow(RecentlyClosedOpenError)
    expect(tabsCreate).not.toHaveBeenCalled()
  })

  it('rejects and keeps a window entry when the window cannot be created, has no id, or has no openable tab', async () => {
    const entry = windowEntry('w7', [
      { url: 'https://a.test/', title: 'a' },
      { url: 'https://b.test/', title: 'b' },
    ])
    windowsCreate.mockRejectedValueOnce(new Error('blocked'))
    await expect(run({ entry })).rejects.toBeInstanceOf(RecentlyClosedOpenError)
    windowsCreate.mockResolvedValueOnce(undefined)
    await expect(run({ entry })).rejects.toBeInstanceOf(RecentlyClosedOpenError)
    const unopenable = windowEntry('w8', [
      { url: 'javascript:1', title: 'a' },
      { url: 'javascript:2', title: 'b' },
    ])
    windowsCreate.mockClear()
    await expect(run({ entry: unopenable })).rejects.toBeInstanceOf(RecentlyClosedOpenError)
    expect(windowsCreate).not.toHaveBeenCalled()
    expect(h.deleteEntries).not.toHaveBeenCalled()
  })

  it('opens only the openable tabs of a window and still resolves openedTabIds [] when no tab id comes back', async () => {
    tabsCreate.mockResolvedValue(undefined)
    const mixed = windowEntry('w9', [
      { url: 'javascript:1', title: 'a' },
      { url: 'https://ok.test/', title: 'ok' },
    ])
    windowsCreate.mockResolvedValue({ id: 4 })
    await run({ entry: mixed })
    expect(windowsCreate).toHaveBeenCalledWith({ url: ['https://ok.test/'], focused: true })
    await expect(run({ entry: tabEntry('nid') })).resolves.toMatchObject({ openedTabIds: [] })
  })
})

describe('removing and clearing', () => {
  it('useRemoveRecentlyClosedEntry marks the ids, refreshes and tells the worker to purge later', async () => {
    h.mark.mockResolvedValue(['a', 'b'])
    const { result } = renderHook(() => useRemoveRecentlyClosedEntry(), { wrapper })
    const undo = await result.current.mutateAsync({ ids: ['a', 'b'] })
    expect(h.mark).toHaveBeenCalledWith(['a', 'b'], expect.any(Number), {})
    expect(undo).toEqual({ kind: 'unmark', ids: ['a', 'b'] })
    expect(h.notify).toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith({ type: RECENTLY_CLOSED_MESSAGE.CLEARED }, expect.any(Function))
  })

  it('removing nothing does not touch the database or notify', async () => {
    const { result } = renderHook(() => useRemoveRecentlyClosedEntry(), { wrapper })
    const undo = await result.current.mutateAsync({ ids: [] })
    expect(undo).toEqual({ kind: 'unmark', ids: [] })
    expect(h.mark).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('a mark that matched nothing does not notify the worker', async () => {
    h.mark.mockResolvedValue([])
    const { result } = renderHook(() => useRemoveRecentlyClosedEntry(), { wrapper })
    await result.current.mutateAsync({ ids: ['gone'] })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('useRemoveRecentlyClosedDay marks only the entries of that local day', async () => {
    const today = tabEntry('today', 'https://t.test', NOW)
    const old = tabEntry('old', 'https://o.test', NOW - 3 * 86_400_000)
    h.getEntries.mockResolvedValue([today, old])
    h.mark.mockResolvedValue(['old'])
    const { result } = renderHook(() => useRemoveRecentlyClosedDay(), { wrapper })
    const undo = await result.current.mutateAsync({ day: localDayKey(old.closedAt) })
    expect(h.mark).toHaveBeenCalledWith(['old'], expect.any(Number), {})
    expect(undo).toEqual({ kind: 'unmark', ids: ['old'] })
  })

  it('removing a day with no entries marks nothing', async () => {
    h.getEntries.mockResolvedValue([tabEntry('today')])
    const { result } = renderHook(() => useRemoveRecentlyClosedDay(), { wrapper })
    const undo = await result.current.mutateAsync({ day: '1999-01-01' })
    expect(h.mark).not.toHaveBeenCalled()
    expect(undo.ids).toEqual([])
  })

  it('useClearRecentlyClosed marks everything', async () => {
    h.mark.mockResolvedValue(['a', 'b', 'c'])
    const { result } = renderHook(() => useClearRecentlyClosed(), { wrapper })
    const undo = await result.current.mutateAsync()
    expect(h.mark).toHaveBeenCalledWith('all', expect.any(Number), {})
    expect(undo.ids).toHaveLength(3)
  })

  it('survives a worker that cannot be reached (sendMessage throws) and a context without sendMessage', async () => {
    h.mark.mockResolvedValue(['a'])
    sendMessage.mockImplementation(() => {
      throw new Error('context invalidated')
    })
    const { result } = renderHook(() => useClearRecentlyClosed(), { wrapper })
    await expect(result.current.mutateAsync()).resolves.toMatchObject({ ids: ['a'] })
    ;(chrome.runtime as { sendMessage?: unknown }).sendMessage = undefined
    await expect(result.current.mutateAsync()).resolves.toMatchObject({ ids: ['a'] })
  })

  it('the undo toast is short (9 s) and the worker delete delay is far longer (a paused toast)', () => {
    expect(RECENTLY_CLOSED_UNDO_TOAST_MS).toBe(9000)
    expect(RECENTLY_CLOSED_CLEAR_DELAY_MS).toBeGreaterThanOrEqual(6 * RECENTLY_CLOSED_UNDO_TOAST_MS)
  })
})

describe('useSetRememberClosedTabs', () => {
  it('turning it on writes the switch in its own store, mirrors it into the settings cache and resolves null', async () => {
    qc.setQueryData(APP_SETTINGS_QUERY_KEY, { theme: 'dark', rememberClosedTabs: false })
    const { result } = renderHook(() => useSetRememberClosedTabs(), { wrapper })
    await expect(result.current.mutateAsync(true)).resolves.toBeNull()
    expect(h.setRemember).toHaveBeenCalledWith(true)
    expect(h.setSetting).not.toHaveBeenCalled()
    expect(qc.getQueryData(APP_SETTINGS_QUERY_KEY)).toEqual({ theme: 'dark', rememberClosedTabs: true })
    expect(h.mark).not.toHaveBeenCalled()
  })

  it('turning it off switches it off AND clears the list in ONE write, resolving an undo that turns it back on', async () => {
    qc.setQueryData(APP_SETTINGS_QUERY_KEY, { theme: 'dark', rememberClosedTabs: true })
    h.mark.mockResolvedValue(['a', 'b'])
    const { result } = renderHook(() => useSetRememberClosedTabs(), { wrapper })
    const undo = await result.current.mutateAsync(false)
    expect(h.mark).toHaveBeenCalledWith('all', expect.any(Number), { turnOff: true })
    expect(h.setRemember).not.toHaveBeenCalled()
    expect(h.setSetting).not.toHaveBeenCalled()
    expect(qc.getQueryData(APP_SETTINGS_QUERY_KEY)).toEqual({ theme: 'dark', rememberClosedTabs: false })
    expect(undo).toEqual({ kind: 'unmark', ids: ['a', 'b'], turnBackOn: true })
  })
})

describe('useUndoRecentlyClosed', () => {
  const undoWith = async (token: Parameters<ReturnType<typeof useUndoRecentlyClosed>['mutateAsync']>[0]) => {
    const { result } = renderHook(() => useUndoRecentlyClosed(), { wrapper })
    return result.current.mutateAsync(token)
  }

  it('unmark: takes the cleared mark off, refreshes and reports a complete undo', async () => {
    h.unmark.mockResolvedValue(1)
    await expect(undoWith({ kind: 'unmark', ids: ['a'] })).resolves.toEqual({ complete: true })
    expect(h.unmark).toHaveBeenCalledWith(['a'])
    expect(h.setRemember).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalled()
  })

  it('an undo that comes after the delete reports it is incomplete', async () => {
    h.unmark.mockResolvedValue(1)
    await expect(undoWith({ kind: 'unmark', ids: ['a', 'b'] })).resolves.toEqual({ complete: false })
  })

  it('unmark with turnBackOn: switches Remember closed tabs back on first, even when the list is gone', async () => {
    qc.setQueryData(APP_SETTINGS_QUERY_KEY, { rememberClosedTabs: false })
    h.unmark.mockResolvedValue(0)
    await expect(undoWith({ kind: 'unmark', ids: ['a'], turnBackOn: true })).resolves.toEqual({ complete: false })
    expect(h.setRemember).toHaveBeenCalledWith(true)
    expect(qc.getQueryData(APP_SETTINGS_QUERY_KEY)).toEqual({ rememberClosedTabs: true })
    expect(h.unmark).toHaveBeenCalledWith(['a'])
  })

  it('undo of a reopened tab puts the entry back and closes the opened tab QUIETLY (record: false)', async () => {
    const entry = tabEntry('t')
    await undoWith({ kind: 'restore', entries: [entry], openedTabIds: [77] })
    expect(h.putEntries).toHaveBeenCalledWith([entry])
    expect(h.closeTabs).toHaveBeenCalledWith([77], { record: false })
    expect(h.closeWindows).not.toHaveBeenCalled()
  })

  it('undo of a restored window closes the opened window QUIETLY (record: false)', async () => {
    const entry = windowEntry('w', [
      { url: 'https://a.test/', title: 'a' },
      { url: 'https://b.test/', title: 'b' },
    ])
    await undoWith({ kind: 'restore', entries: [entry], openedTabIds: [], openedWindowId: 500 })
    expect(h.putEntries).toHaveBeenCalledWith([entry])
    expect(h.closeWindows).toHaveBeenCalledWith(500, { record: false })
    expect(h.closeTabs).not.toHaveBeenCalled()
  })

  it('a tab or window that is already gone does not fail the undo', async () => {
    h.closeTabs.mockRejectedValue(new Error('No tab'))
    h.closeWindows.mockRejectedValue(new Error('No window'))
    await expect(undoWith({ kind: 'restore', entries: [tabEntry('t')], openedTabIds: [1], openedWindowId: 2 })).resolves.toEqual({ complete: true })
    expect(h.notify).toHaveBeenCalled()
  })

  it('exposes the query key used for refreshing', () => {
    expect(RECENTLY_CLOSED_QUERY_KEY).toEqual(['recentlyClosed'])
  })
})
