/**
 * Every place TabMerger closes a browser tab or window states whether "Recently closed" should
 * remember it (`record`). This file pins the agreed value per call site, through the REAL
 * `closeTabs`/`closeWindows`: `record: false` writes a quiet-close mark to `chrome.storage.session`
 * BEFORE the close, `record: true` writes none.
 *   false: drag-out of Now Open, duplicate cleanup, incognito toggle, the blank tab of a new window,
 *          the tour's practice tab, the demo reset, undo of a reopen.
 *   true:  bulk delete (tabs and windows), delete window / all windows / tab, restoring a session
 *          over the open windows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { quietCloseTabKey, quietCloseWindowKey } from '@/lib/recentlyClosed'
import { GROUPS_QUERY_KEY, useDeduplicateGroup, useDeleteAllWindows, useDeleteTab, useDeleteWindow, useToggleWindowIncognito } from '@/hooks/useGroups'
import { useBulkDelete } from '@/hooks/useBulkActions'
import { useOpenWindow } from '@/hooks/useOpenWindow'
import { useRestoreSession } from '@/hooks/useSessions'
import { useUndoRecentlyClosed } from '@/hooks/useRecentlyClosed'
import { closeLiveTabsSafely } from '@/lib/closeLiveTabs'
import { closeTourPracticeTab } from '@/lib/tourPracticeTab'
import { enterDemoMode } from '@/lib/demo'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { GroupsState, Session, Tab, Window as ExtWindow } from '@/lib/types'

const h = vi.hoisted(() => ({ getGroupsState: vi.fn() }))

vi.mock('@/lib/localDb', async () =>
  (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
    saveGroupsState: vi.fn().mockResolvedValue(undefined),
    getGroupsState: h.getGroupsState,
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(false),
    putRecentlyClosedEntries: vi.fn(),
  })
)
vi.mock('@/lib/recentlyClosedDb', () => ({
  putRecentlyClosedEntries: vi.fn().mockResolvedValue(undefined),
  notifyRecentlyClosedChanged: vi.fn(),
  getRecentlyClosedEntries: vi.fn().mockResolvedValue([]),
  deleteRecentlyClosedEntries: vi.fn(),
  markRecentlyClosedCleared: vi.fn(),
  unmarkRecentlyClosedCleared: vi.fn(),
}))
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined), canUploadOnFirefox: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/hooks/useUrlRules', () => ({ deleteRulesForGroupIds: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() }, from: vi.fn() } }))
vi.mock('@/lib/encryptionKey', () => ({ getEncryptionKeyState: vi.fn().mockResolvedValue('absent'), getDataKey: vi.fn() }))
vi.mock('@/lib/chromeGroups', () => ({ openTabInChromeGroup: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/deferredTabClose', () => ({ closeTabsWhenPopupCloses: vi.fn() }))

let sessionSet: ReturnType<typeof vi.fn>
let tabsRemove: ReturnType<typeof vi.fn>
let windowsRemove: ReturnType<typeof vi.fn>
let order: string[]

const tab = (id: number, url: string): Tab => ({ id, url, title: url, favIconUrl: '', pinned: false })
const win = (id: number, tabs: Tab[], incognito = false): ExtWindow => ({ id, tabs, incognito, focused: false }) as ExtWindow

function setup(state: GroupsState) {
  h.getGroupsState.mockResolvedValue(state)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, state)
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return { wrapper }
}

function nowOpenState(): GroupsState {
  const nowOpen = createNowOpenGroup()
  nowOpen.windows = [win(5, [tab(11, 'https://a.com'), tab(12, 'https://b.com')]), win(6, [tab(13, 'https://c.com')])]
  return { active: { id: nowOpen.id, index: 0 }, available: [nowOpen] }
}

/** Keys written to the quiet-close marks (empty: the close is recorded). */
const marks = () => sessionSet.mock.calls.flatMap((c) => Object.keys(c[0] as Record<string, number>))

beforeEach(() => {
  vi.clearAllMocks()
  order = []
  sessionSet = vi.fn(async () => void order.push('mark'))
  tabsRemove = vi.fn(async () => void order.push('tabs.remove'))
  windowsRemove = vi.fn(async () => void order.push('windows.remove'))
  ;(globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      remove: tabsRemove,
      create: vi.fn().mockResolvedValue({ id: 1 }),
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
    },
    windows: {
      remove: windowsRemove,
      create: vi.fn().mockResolvedValue({ id: 100, tabs: [{ id: 900 }] }),
      update: vi.fn().mockResolvedValue({}),
      getAll: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      getCurrent: vi.fn().mockResolvedValue({ id: 5 }),
    },
    storage: { session: { set: sessionSet, get: vi.fn().mockResolvedValue({}), remove: vi.fn() }, local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } },
    extension: { isAllowedIncognitoAccess: vi.fn().mockResolvedValue(true) },
    runtime: { getURL: (p: string) => `chrome-extension://abc/${p}`, sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  }
})

describe('record: true (the user closed it, nothing was saved)', () => {
  it('useDeleteWindow on a Now Open window', async () => {
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useDeleteWindow(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 }) })
    expect(tabsRemove).toHaveBeenCalledWith([11, 12])
    expect(marks()).toEqual([])
  })

  it('useDeleteAllWindows on Now Open', async () => {
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useDeleteAllWindows(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0 }) })
    expect(tabsRemove).toHaveBeenCalledWith([11, 12, 13])
    expect(marks()).toEqual([])
  })

  it('useDeleteTab on a Now Open tab', async () => {
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useDeleteTab(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 1 }) })
    expect(tabsRemove).toHaveBeenCalledWith(12)
    expect(marks()).toEqual([])
  })

  it('bulk delete of selected Now Open tabs', async () => {
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useBulkDelete(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync([
        { type: 'tab' as const, id: 'tab-0-0-0' },
        { type: 'tab' as const, id: 'tab-0-1-0' },
      ])
    })
    expect(tabsRemove).toHaveBeenCalledTimes(1)
    expect([...(tabsRemove.mock.calls[0][0] as number[])].sort()).toEqual([11, 13])
    expect(marks()).toEqual([])
  })

  it('bulk delete of selected Now Open windows', async () => {
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useBulkDelete(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync([{ type: 'window' as const, id: 'window-0-0' }])
    })
    expect(tabsRemove).toHaveBeenCalledWith([11, 12])
    expect(marks()).toEqual([])
  })

  it('restoring a session over the open windows', async () => {
    const session: Session = {
      id: 's1',
      name: 'S',
      createdAt: Date.now(),
      groups: [{ id: 'g', name: 'G', color: 'rgba(0,0,0,1)', updatedAt: 1, permanent: false, windows: [win(1, [tab(1, 'https://a.com')])] }],
    } as unknown as Session
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useRestoreSession(), { wrapper })
    await act(async () => { await result.current.mutateAsync(session) })
    expect(windowsRemove).toHaveBeenCalledTimes(2)
    expect(marks()).toEqual([])
  })

  it('a saved (non-Now-Open) window closes nothing at all', async () => {
    const saved = createGroup('s', 'S')
    saved.windows = [win(0, [tab(0, 'https://a.com')])]
    const { wrapper } = setup({ active: { id: saved.id, index: 0 }, available: [saved] })
    const { result } = renderHook(() => useBulkDelete(), { wrapper })
    await act(async () => { await result.current.mutateAsync([{ type: 'window' as const, id: 'window-0-0' }]) })
    expect(tabsRemove).not.toHaveBeenCalled()
  })
})

describe('record: false (its content is safe elsewhere)', () => {
  it('duplicate cleanup in Now Open marks the closed tabs quiet BEFORE closing them', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win(5, [tab(1, 'https://a.com'), tab(2, 'https://a.com')])]
    const { wrapper } = setup({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen] })
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, duplicates: [{ windowIndex: 0, tabIndex: 1, url: 'https://a.com' }] })
    })
    expect(marks()).toEqual([quietCloseTabKey(2)])
    expect(order).toEqual(['mark', 'tabs.remove'])
  })

  it('toggling incognito on a Now Open window reopens it and closes the old window quietly', async () => {
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useToggleWindowIncognito(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 }) })
    expect(windowsRemove).toHaveBeenCalledWith(5)
    expect(marks()).toEqual([quietCloseWindowKey(5)])
    expect(order[0]).toBe('mark')
  })

  it('the blank tab of a window opened by useOpenWindow is closed quietly', async () => {
    const group = createGroup('s', 'S')
    const w = win(0, [tab(0, 'https://a.com')])
    ;(chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(chrome.windows.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const { wrapper } = setup({ active: { id: group.id, index: 0 }, available: [group] })
    const { result } = renderHook(() => useOpenWindow(), { wrapper })
    await act(async () => { await result.current(w as ExtWindow) })
    expect(tabsRemove).toHaveBeenCalledWith(900)
    expect(marks()).toEqual([quietCloseTabKey(900)])
  })

  it('the tour practice tab is closed quietly (only while it still shows the practice page)', async () => {
    ;(chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42, url: 'chrome-extension://abc/tour-practice.html' })
    await closeTourPracticeTab(42)
    expect(tabsRemove).toHaveBeenCalledWith(42)
    expect(marks()).toEqual([quietCloseTabKey(42)])
    // another page behind that id: nothing is closed
    tabsRemove.mockClear()
    ;(chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42, url: 'https://user.test/' })
    await closeTourPracticeTab(42)
    expect(tabsRemove).not.toHaveBeenCalled()
  })

  it('the demo reset closes the other windows quietly', async () => {
    ;(chrome.windows.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 3 })
    ;(chrome.windows.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    await enterDemoMode()
    expect(windowsRemove.mock.calls.map((c) => c[0])).toEqual([1, 2])
    expect(marks()).toEqual([quietCloseWindowKey(1), quietCloseWindowKey(2)])
  })

  it('a drag-out of Now Open (closeLiveTabsSafely) closes the tabs quietly', async () => {
    // the popup's own window is 5 and its active tab (21) is deferred to the worker; 22 closes now
    ;(chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 21, windowId: 5 }])
    await closeLiveTabsSafely([21, 22])
    const { closeTabsWhenPopupCloses } = await import('@/lib/deferredTabClose')
    expect(closeTabsWhenPopupCloses).toHaveBeenCalledWith([21])
    expect(tabsRemove).toHaveBeenCalledWith([22])
    expect(marks()).toEqual([quietCloseTabKey(22)])
  })

  it('undo of a reopen closes what it opened quietly (tab and window)', async () => {
    const entry = { id: 'e', closedAt: Date.now(), kind: 'tab' as const, tabs: [{ url: 'https://a.test/', title: 'a' }] }
    const { wrapper } = setup(nowOpenState())
    const { result } = renderHook(() => useUndoRecentlyClosed(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ kind: 'restore', entries: [entry], openedTabIds: [31], openedWindowId: 32 })
    })
    expect(marks().sort()).toEqual([quietCloseTabKey(31), quietCloseWindowKey(32)].sort())
  })
})
