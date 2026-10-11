/**
 * Direct mutationFn-level coverage for `useGroups.ts` hooks.
 * Each hook gets at least one test calling its `mutationFn` via `mutateAsync`,
 * verifying the persisted `GroupsState` passed to `saveGroupsState` (and, where
 * relevant, chrome tab/window side effects and remote sync calls).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useAddGroup,
  useDuplicateGroup,
  useUpdateGroupColor,
  useUpdateGroupName,
  useUpdateGroupInfo,
  useUpdateGroupNote,
  useReorderGroups,
  useAddWindow,
  useDeleteWindow,
  useDeleteAllWindows,
  useUpdateWindowName,
  useUpdateWindowNote,
  useToggleWindowStarred,
  useUpdateTabNote,
  useReplaceWithCurrent,
  useMergeWithCurrent,
  useUniteWindows,
  useSplitWindows,
  useSortTabs,
  useMoveWindow,
  useSetGroupsState,
  useDeduplicateGroup,
  useRemoveStaleTabs,
  useArchiveGroup,
  useRestoreGroup,
  useImportGroups,
  useSetTabReminder,
  useClearTabReminder,
  useDeleteTab,
  useToggleWindowIncognito,
  useDeleteGroup,
  useToggleGroupStar,
  useMoveTab,
  useGroups,
  useApplyAIGroups,
  GROUPS_QUERY_KEY,
  closableTabIds,
} from '@/hooks/useGroups'
import { createGroup, createNowOpenGroup, formatGroupCounts } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import type { GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', async () => (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  // uiStore's setActiveGroupIndex fire-and-forget-persists via this — needed since
  // useArchiveGroup now calls setActiveGroupIndex directly on the real (unmocked) uiStore.
  setSetting: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/hooks/useUrlRules', () => ({ deleteRulesForGroupIds: vi.fn().mockResolvedValue(undefined) }))

import { saveGroupsState, getGroupsState } from '@/lib/localDb'
import { deleteRemoteGroups } from '@/lib/syncEngine'
import { deleteRulesForGroupIds } from '@/hooks/useUrlRules'
import { trackEvent } from '@/lib/analytics'

globalThis.chrome = {
  tabs: {
    remove: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  windows: { create: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
  storage: { local: { set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } },
  runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
} as unknown as typeof chrome

function tab(id: number, url: string, title = 'Tab'): Tab {
  return { id, url, title, favIconUrl: '', pinned: false }
}
function win(tabs: Tab[]): ExtWindow {
  return { id: Date.now() + Math.random(), tabs, incognito: false, focused: false }
}
function makeState(groups: GroupsState['available'], activeIndex = 0): GroupsState {
  return { active: { id: groups[activeIndex].id, index: activeIndex }, available: groups }
}
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(saveGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

function lastSaved(): GroupsState {
  const calls = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1][0] as GroupsState
}

describe('useAddGroup', () => {
  it('appends a new group to available', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAddGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'New Group' })
    })

    expect(lastSaved().available).toHaveLength(2)
    expect(lastSaved().available[1].name).toBe('New Group')
    expect(trackEvent).toHaveBeenCalledWith('group_created')
  })
})

describe('useDuplicateGroup', () => {
  it('inserts a clone immediately after the source group', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const state = makeState([nowOpen, a])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDuplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(1)
    })

    const saved = lastSaved()
    expect(saved.available).toHaveLength(3)
    expect(saved.available[2].id).not.toBe('a')
    expect(saved.available[2].permanent).toBe(false)
  })

  it('duplicating Now Open saves detached copies of its windows; Now Open keeps its live items', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [{ ...tab(11, 'https://a.com'), pinned: true }, tab(12, 'https://b.com')], incognito: false, focused: true, starred: true },
    ]
    const state = makeState([nowOpen])
    const nowOpenBefore = structuredClone(nowOpen)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDuplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(0)
    })

    const saved = lastSaved()
    expect(saved.available[0]).toEqual(nowOpenBefore)
    const clone = saved.available[1]
    expect(clone.permanent).toBe(false)
    expect(clone.id).not.toBe(nowOpen.id)
    expect(clone.pendingSync).toBe(true)
    expect(clone.windows).toHaveLength(1)
    // The copy is detached (id 0, unfocused) and keeps the window's star.
    expect(clone.windows[0]).toMatchObject({ id: 0, focused: false, starred: true })
    expect(clone.windows[0].tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(clone.windows[0].tabs.every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
  })

  it('duplicating Now Open keeps each window\'s star: a starred window is stored starred, an unstarred one unstarred, starred first', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [tab(11, 'https://a.com')], incognito: false, focused: true, starred: true, name: 'star' },
      { id: 502, tabs: [tab(12, 'https://b.com')], incognito: false, focused: false, name: 'plain' },
    ]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDuplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(0)
    })

    const clone = lastSaved().available[1]
    expect(clone.windows.map((w) => [w.name, w.starred])).toEqual([['star', true], ['plain', false]])
    expect(clone.windows.every((w) => w.id === 0 && w.focused === false)).toBe(true)
    expect(clone.windows.flatMap((w) => w.tabs).every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
  })

  it('duplicating a saved group copies its windows as they are (savedAt and star kept) without aliasing them', async () => {
    const a = createGroup('a', 'A')
    a.windows = [{ ...win([{ ...tab(0, 'https://a.com'), savedAt: 77 }]), starred: true }]
    const state = makeState([createNowOpenGroup(), a])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDuplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(1)
    })

    const clone = lastSaved().available[2]
    expect(clone.windows[0].starred).toBe(true)
    expect(clone.windows[0].tabs[0].savedAt).toBe(77)
    expect(clone.windows[0]).not.toBe(a.windows[0])
    expect(clone.windows[0].tabs[0]).not.toBe(a.windows[0].tabs[0])
  })
})

describe('useAddGroup / useDuplicateGroup — Free-tier caps backstop', () => {
  it('useAddGroup: ungated by default (no caps passed) — matches pre-existing behavior', async () => {
    const nowOpen = createNowOpenGroup()
    const many = Array.from({ length: 20 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...many])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useAddGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'One more' })
    })
    expect(lastSaved().available).toHaveLength(22)
  })

  it('useAddGroup: blocks growth past maxGroups and writes nothing', async () => {
    const nowOpen = createNowOpenGroup()
    const existing = Array.from({ length: 5 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...existing])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useAddGroup({ maxGroups: 5, maxTabs: 50 }), { wrapper })

    await expect(result.current.mutateAsync({ name: 'Over the cap' })).rejects.toThrow()
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('useAddGroup: Pro caps (Infinity) always pass', async () => {
    const nowOpen = createNowOpenGroup()
    const existing = Array.from({ length: 50 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...existing])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useAddGroup({ maxGroups: Infinity, maxTabs: Infinity }), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'Still fine' })
    })
    expect(lastSaved().available).toHaveLength(52)
  })

  it('useDuplicateGroup: ungated by default (no caps passed)', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const state = makeState([nowOpen, a])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDuplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(1)
    })
    expect(lastSaved().available).toHaveLength(3)
  })

  it('useDuplicateGroup: blocks growth past maxGroups (counting the duplicated group) and writes nothing', async () => {
    const nowOpen = createNowOpenGroup()
    const existing = Array.from({ length: 5 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...existing])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDuplicateGroup({ maxGroups: 5, maxTabs: 50 }), { wrapper })

    await expect(result.current.mutateAsync(1)).rejects.toThrow()
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('useDuplicateGroup: blocks past maxTabs even when under maxGroups (duplicated tabs count too)', async () => {
    const nowOpen = createNowOpenGroup()
    const bigGroup = createGroup('big', 'Big')
    bigGroup.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://b.com')])]
    const state = makeState([nowOpen, bigGroup])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDuplicateGroup({ maxGroups: 10, maxTabs: 3 }), { wrapper })

    // current tabs = 2, duplicating adds 2 more = 4 > maxTabs:3
    await expect(result.current.mutateAsync(1)).rejects.toThrow()
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('useDuplicateGroup: Pro caps (Infinity) always pass', async () => {
    const nowOpen = createNowOpenGroup()
    const existing = Array.from({ length: 50 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...existing])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDuplicateGroup({ maxGroups: Infinity, maxTabs: Infinity }), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(1)
    })
    expect(lastSaved().available).toHaveLength(52)
  })
})

describe('useUpdateGroupColor / useUpdateGroupName / useUpdateGroupInfo / useUpdateGroupNote', () => {
  it('updates color', async () => {
    const state = makeState([createGroup('a', 'A')])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateGroupColor(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, color: 'rgba(1,2,3,1)' }) })
    expect(lastSaved().available[0].color).toBe('rgba(1,2,3,1)')
  })

  it('updates name', async () => {
    const state = makeState([createGroup('a', 'A')])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateGroupName(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, name: 'Renamed' }) })
    expect(lastSaved().available[0].name).toBe('Renamed')
    expect(trackEvent).toHaveBeenCalledWith('group_renamed')
  })

  it('updates info without pushing undo', async () => {
    const state = makeState([createGroup('a', 'A')])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateGroupInfo(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, info: '3 tabs' }) })
    expect(lastSaved().available[0].info).toBe('3 tabs')
    // info updates must still mark pendingSync so the change reaches Supabase (sync bug regression)
    expect(lastSaved().available[0].pendingSync).toBe(true)
  })

  it('does not set pendingSync when updating info on the permanent Now Open group', async () => {
    const nowOpen = { ...createGroup('now-open', 'Now Open'), permanent: true, pendingSync: false }
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateGroupInfo(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, info: '3 tabs' }) })
    expect(lastSaved().available[0].pendingSync).toBeFalsy()
  })

  it('updates note', async () => {
    const state = makeState([createGroup('a', 'A')])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateGroupNote(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, note: 'remember this' }) })
    expect(lastSaved().available[0].note).toBe('remember this')
  })
})

describe('useReorderGroups', () => {
  it('moves a group from one index to another', async () => {
    const a = createGroup('a', 'A')
    const b = createGroup('b', 'B')
    const c = createGroup('c', 'C')
    const state = makeState([a, b, c])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useReorderGroups(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ from: 0, to: 2 }) })
    expect(lastSaved().available.map((g) => g.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('useAddWindow / useDeleteWindow / useDeleteAllWindows', () => {
  it('adds an empty window to the group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAddWindow(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0 }) })
    expect(lastSaved().available[0].windows).toHaveLength(2)
  })

  it('deletes a window from a saved group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteWindow(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 }) })
    expect(lastSaved().available[0].windows).toHaveLength(1)
  })

  it('clears all windows from a group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteAllWindows(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0 }) })
    expect(lastSaved().available[0].windows).toHaveLength(0)
  })

  /**
   * Only Now Open holds live browser tabs. Deleting a window (or every window) closes its
   * tabs when the group is Now Open, and closes nothing when the group is a saved one.
   */
  function nowOpenAndSaved() {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://a.com'), tab(12, 'https://b.com')]), win([tab(13, 'https://c.com')])]
    const saved = createGroup('a', 'A')
    saved.windows = [win([tab(11, 'https://a.com'), tab(12, 'https://b.com')]), win([tab(13, 'https://c.com')])]
    const state = makeState([nowOpen, saved])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    return { wrapper }
  }

  it('useDeleteWindow: a Now Open window closes its browser tabs', async () => {
    const { wrapper } = nowOpenAndSaved()
    const { result } = renderHook(() => useDeleteWindow(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 }) })
    expect(chrome.tabs.remove).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.remove).toHaveBeenCalledWith([11, 12])
  })

  it('useDeleteWindow: a saved window closes no browser tab', async () => {
    const { wrapper } = nowOpenAndSaved()
    const { result } = renderHook(() => useDeleteWindow(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 1, windowIndex: 0 }) })
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(lastSaved().available[1].windows).toHaveLength(1)
  })

  it('useDeleteAllWindows: Now Open closes every browser tab', async () => {
    const { wrapper } = nowOpenAndSaved()
    const { result } = renderHook(() => useDeleteAllWindows(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0 }) })
    expect(chrome.tabs.remove).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.remove).toHaveBeenCalledWith([11, 12, 13])
  })

  it('useDeleteAllWindows: a saved group closes no browser tab', async () => {
    const { wrapper } = nowOpenAndSaved()
    const { result } = renderHook(() => useDeleteAllWindows(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 1 }) })
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(lastSaved().available[1].windows).toHaveLength(0)
  })

  it('closableTabIds: only a permanent group yields ids, and never the detached id 0', () => {
    const nowOpen = createNowOpenGroup()
    const saved = createGroup('a', 'A')
    const tabs = [tab(11, 'https://a.com'), tab(0, 'https://b.com'), tab(13, 'https://c.com')]
    expect(closableTabIds(nowOpen, tabs)).toEqual([11, 13])
    expect(closableTabIds(saved, tabs)).toEqual([])
    expect(closableTabIds(undefined, tabs)).toEqual([])
  })

  it('closableTabIds: skips negative and missing ids and yields nothing for an empty tab list', () => {
    const nowOpen = createNowOpenGroup()
    const odd = [tab(-1, 'https://a.com'), { ...tab(5, 'https://b.com'), id: undefined } as unknown as Tab, tab(7, 'https://c.com')]
    expect(closableTabIds(nowOpen, odd)).toEqual([7])
    expect(closableTabIds(nowOpen, [])).toEqual([])
  })
})

describe('useUpdateWindowName / useUpdateWindowNote / useToggleWindowStarred', () => {
  it('renames a window', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateWindowName(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, name: 'Renamed Window' }) })
    expect(lastSaved().available[0].windows[0].name).toBe('Renamed Window')
  })

  it('sets a window note', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateWindowNote(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, note: 'hi' }) })
    expect(lastSaved().available[0].windows[0].note).toBe('hi')
  })

  it('toggles starred and re-sorts starred windows first', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useToggleWindowStarred(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 1 }) })
    expect(lastSaved().available[0].windows[0].starred).toBe(true)
  })
})

describe('useUpdateTabNote', () => {
  it('sets a note on a specific tab without pushing undo', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateTabNote(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0, note: 'note' }) })
    expect(lastSaved().available[0].windows[0].tabs[0].note).toBe('note')
  })
})

describe('useReplaceWithCurrent / useMergeWithCurrent', () => {
  it('replaces a saved group windows with a snapshot of Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(1, 'https://live.com')])]
    const group = createGroup('a', 'A')
    group.windows = [win([tab(2, 'https://old.com')])]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useReplaceWithCurrent(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) })
    expect(lastSaved().available[1].windows[0].tabs[0].url).toBe('https://live.com')
  })

  it('prepends Now Open windows while keeping existing ones', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(1, 'https://live.com')])]
    const group = createGroup('a', 'A')
    group.windows = [win([tab(2, 'https://old.com')])]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useMergeWithCurrent(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) })
    expect(lastSaved().available[1].windows).toHaveLength(2)
    expect(lastSaved().available[1].windows[0].tabs[0].url).toBe('https://live.com')
  })

  /** The Now Open snapshot is stored as detached saved copies; Now Open keeps its live items. */
  function liveNowOpenAndSaved() {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [{ ...tab(11, 'https://a.com'), pinned: true }, tab(12, 'https://b.com')], incognito: false, focused: true, starred: true, name: 'live' },
      { id: 502, tabs: [tab(13, 'https://c.com')], incognito: true, focused: false },
    ]
    const group = createGroup('a', 'A')
    group.windows = [{ ...win([{ ...tab(0, 'https://old.com'), savedAt: 5 }]), name: 'old' }]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    return { nowOpen, group, nowOpenBefore: structuredClone(nowOpen), wrapper: makeWrapper().wrapper }
  }
  function expectDetached(windows: ExtWindow[]) {
    expect(windows.every((w) => w.id === 0 && w.focused === false)).toBe(true)
    expect(windows.flatMap((w) => w.tabs).every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
  }

  it('useReplaceWithCurrent stores detached copies of the Now Open windows and leaves Now Open as it is', async () => {
    const { nowOpenBefore, wrapper } = liveNowOpenAndSaved()
    const { result } = renderHook(() => useReplaceWithCurrent(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) })

    const saved = lastSaved()
    expect(saved.available[0]).toEqual(nowOpenBefore)
    const windows = saved.available[1].windows
    expect(windows.map((w) => w.tabs.map((t) => t.url))).toEqual([['https://a.com', 'https://b.com'], ['https://c.com']])
    expectDetached(windows)
    // Each copy keeps its window's star: the starred window is stored starred, the other unstarred.
    expect(windows.map((w) => w.starred)).toEqual([true, false])
    expect(windows.map((w) => w.incognito)).toEqual([false, true])
    expect(windows[0].name).toBe('live')
    expect(saved.available[1].pendingSync).toBe(true)
    expect(saved.available[1].info).toBe(formatGroupCounts(2, 3))
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('useMergeWithCurrent prepends detached copies of the Now Open windows and keeps the saved windows untouched', async () => {
    const { nowOpenBefore, wrapper } = liveNowOpenAndSaved()
    const { result } = renderHook(() => useMergeWithCurrent(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) })

    const saved = lastSaved()
    expect(saved.available[0]).toEqual(nowOpenBefore)
    const windows = saved.available[1].windows
    expect(windows.map((w) => w.name)).toEqual(['live', undefined, 'old'])
    expectDetached(windows.slice(0, 2))
    // Each copy keeps its window's star: the starred window is stored starred, the other unstarred.
    expect(windows.slice(0, 2).map((w) => w.starred)).toEqual([true, false])
    // The windows the group already had are not rewritten.
    expect(windows[2].tabs[0].savedAt).toBe(5)
    expect(saved.available[1].info).toBe(formatGroupCounts(3, 4))
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('useMergeWithCurrent keeps starred windows first: starred copies, the group\'s starred windows, unstarred copies, the group\'s unstarred windows', async () => {
    const { group, wrapper } = liveNowOpenAndSaved()
    group.windows = [
      { ...win([{ ...tab(0, 'https://s.com'), savedAt: 5 }]), starred: true, name: 'old star' },
      { ...win([{ ...tab(0, 'https://old.com'), savedAt: 5 }]), name: 'old' },
    ]
    const { result } = renderHook(() => useMergeWithCurrent(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) })

    const windows = lastSaved().available[1].windows
    expect(windows.map((w) => [w.name, w.starred ?? false])).toEqual([
      ['live', true],
      ['old star', true],
      [undefined, false],
      ['old', false],
    ])
  })

  it('useReplaceWithCurrent stores starred copies first', async () => {
    const { nowOpen, wrapper } = liveNowOpenAndSaved()
    nowOpen.windows = [...nowOpen.windows].reverse()
    const { result } = renderHook(() => useReplaceWithCurrent(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) })

    const windows = lastSaved().available[1].windows
    expect(windows.map((w) => [w.name, w.starred])).toEqual([['live', true], [undefined, false]])
    expectDetached(windows)
  })
})

describe('useUniteWindows / useSplitWindows', () => {
  it('merges all windows into one', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUniteWindows(), { wrapper })
    await act(async () => { await result.current.mutateAsync(0) })
    const saved = lastSaved().available[0]
    expect(saved.windows).toHaveLength(1)
    expect(saved.windows[0].tabs).toHaveLength(2)
  })

  it('splits one window into one-tab windows', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSplitWindows(), { wrapper })
    await act(async () => { await result.current.mutateAsync(0) })
    expect(lastSaved().available[0].windows).toHaveLength(2)
  })
})

describe('useSortTabs', () => {
  it('sorts tabs within every window by title', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://b.com', 'Banana'), tab(2, 'https://a.com', 'Apple')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSortTabs(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, by: 'title' }) })
    expect(lastSaved().available[0].windows[0].tabs.map((t) => t.title)).toEqual(['Apple', 'Banana'])
  })

  // Regression guard for the two group-level call sites (windows-toolbar ⋯ and
  // GroupContextMenu): omitting `windowIndex` must keep sorting EVERY window in the
  // group, exactly as before `windowIndex` was added.
  it('without windowIndex, sorts every window in the group (group-level call sites unchanged)', async () => {
    const group = createGroup('a', 'A')
    group.windows = [
      win([tab(1, 'https://b.com', 'Banana'), tab(2, 'https://a.com', 'Apple')]),
      win([tab(3, 'https://z.com', 'Zebra'), tab(4, 'https://m.com', 'Mango')]),
    ]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSortTabs(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, by: 'title' }) })
    const windows = lastSaved().available[0].windows
    expect(windows[0].tabs.map((t) => t.title)).toEqual(['Apple', 'Banana'])
    expect(windows[1].tabs.map((t) => t.title)).toEqual(['Mango', 'Zebra'])
  })

  // The per-window ⋯ menu (Window.tsx) passes windowIndex — only that window may change.
  it('with windowIndex, sorts only that window and leaves sibling windows byte-identical', async () => {
    const group = createGroup('a', 'A')
    const untouchedWindow = win([tab(3, 'https://z.com', 'Zebra'), tab(4, 'https://m.com', 'Mango')])
    group.windows = [
      win([tab(1, 'https://b.com', 'Banana'), tab(2, 'https://a.com', 'Apple')]),
      untouchedWindow,
    ]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSortTabs(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, by: 'title' }) })
    const windows = lastSaved().available[0].windows
    expect(windows[0].tabs.map((t) => t.title)).toEqual(['Apple', 'Banana'])
    // Sibling window (index 1) is untouched — same reference, not just equal content.
    expect(windows[1]).toBe(untouchedWindow)
  })

  it('with windowIndex, sorts by URL scoped to that window only', async () => {
    const group = createGroup('a', 'A')
    group.windows = [
      win([tab(1, 'https://b.com', 'B'), tab(2, 'https://a.com', 'A')]),
      win([tab(3, 'https://z.com', 'Z'), tab(4, 'https://m.com', 'M')]),
    ]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSortTabs(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 1, by: 'url' }) })
    const windows = lastSaved().available[0].windows
    // Window 0 (not targeted) keeps its original order.
    expect(windows[0].tabs.map((t) => t.title)).toEqual(['B', 'A'])
    // Window 1 (targeted) is sorted by URL.
    expect(windows[1].tabs.map((t) => t.url)).toEqual(['https://m.com', 'https://z.com'])
  })

  it('preserves updatedAt/pendingSync stamping identically regardless of windowIndex', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://b.com', 'Banana'), tab(2, 'https://a.com', 'Apple')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSortTabs(), { wrapper })
    const before = Date.now()
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, by: 'title' }) })
    const saved = lastSaved().available[0]
    expect(saved.pendingSync).toBe(true)
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('useSetGroupsState', () => {
  it('writes the given state directly, bypassing the standard mutation pattern', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetGroupsState(), { wrapper })
    const state = makeState([createGroup('a', 'A')])
    await act(async () => { await result.current(state) })
    expect(saveGroupsState).toHaveBeenCalledWith(state)
  })

  it('with expectedRev: a stale write is refused, reports false and refetches instead of throwing', async () => {
    const { qc, wrapper } = makeWrapper()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    ;(saveGroupsState as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error('stale'), { name: 'StaleGroupsError' }))
    const { result } = renderHook(() => useSetGroupsState(), { wrapper })
    let applied: boolean | undefined
    await act(async () => { applied = await result.current(makeState([createGroup('a', 'A')]), { expectedRev: 3 }) })
    expect(saveGroupsState).toHaveBeenCalledWith(expect.anything(), { expectedRev: 3 })
    expect(applied).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false })
  })

  it('puts the new rev on the cached state after a successful write', async () => {
    const { qc, wrapper } = makeWrapper()
    ;(saveGroupsState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(9)
    const { result } = renderHook(() => useSetGroupsState(), { wrapper })
    await act(async () => { await result.current(makeState([createGroup('a', 'A')]), { expectedRev: 8 }) })
    expect(qc.getQueryData<{ rev?: number }>(GROUPS_QUERY_KEY)?.rev).toBe(9)
  })
})

describe('useRemoveStaleTabs', () => {
  it('removes tabs older than the threshold', async () => {
    const group = createGroup('a', 'A')
    const staleTab = { ...tab(1, 'https://old.com'), savedAt: Date.now() - 1_000_000 }
    const freshTab = { ...tab(2, 'https://new.com'), savedAt: Date.now() }
    group.windows = [win([staleTab, freshTab])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRemoveStaleTabs(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, staleThresholdMs: 500_000 }) })
    expect(lastSaved().available[0].windows[0].tabs.map((t) => t.id)).toEqual([2])
  })
})

describe('useArchiveGroup / useRestoreGroup', () => {
  beforeEach(() => {
    useUIStore.setState({ activeGroupIndex: 0 })
  })

  it('archives a non-permanent group', async () => {
    const state = makeState([createGroup('a', 'A')])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useArchiveGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync(0) })
    expect(lastSaved().available[0].archived).toBe(true)
  })

  it('refuses to archive the permanent Now Open group', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useArchiveGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync(0) })
    expect(lastSaved().available[0].archived).toBeUndefined()
  })

  it('restores an archived group', async () => {
    const group = createGroup('a', 'A')
    group.archived = true
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRestoreGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync(0) })
    expect(lastSaved().available[0].archived).toBe(false)
  })

  it('moves activeGroupIndex to the group above (sidebar order), when the archived group was active', async () => {
    // available (raw array order): [Now Open, A (unstarred), B (starred)] — but the
    // SIDEBAR's visible order is [Now Open, B (starred), A (unstarred)] since starred
    // groups float above unstarred ones. So "above A" in the sidebar is B (realIndex 2),
    // NOT Now Open — proving the rule uses display order, not raw array order.
    const nowOpen = createNowOpenGroup()
    const groupA = { ...createGroup('a', 'A'), starred: false }
    const groupB = { ...createGroup('b', 'B'), starred: true }
    const state = makeState([nowOpen, groupA, groupB])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper, qc } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    useUIStore.setState({ activeGroupIndex: 1 }) // viewing group A
    const { result } = renderHook(() => useArchiveGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) }) // archive A (realIndex 1)
    expect(useUIStore.getState().activeGroupIndex).toBe(2) // B, not Now Open
  })

  it('falls back to Now Open when the archived group was the topmost saved group', async () => {
    const nowOpen = createNowOpenGroup()
    const groupA = createGroup('a', 'A')
    const state = makeState([nowOpen, groupA])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper, qc } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    useUIStore.setState({ activeGroupIndex: 1 })
    const { result } = renderHook(() => useArchiveGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) })
    expect(useUIStore.getState().activeGroupIndex).toBe(0)
  })

  it('leaves activeGroupIndex untouched when a DIFFERENT group is archived', async () => {
    const nowOpen = createNowOpenGroup()
    const groupA = createGroup('a', 'A')
    const groupB = createGroup('b', 'B')
    const state = makeState([nowOpen, groupA, groupB])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper, qc } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    useUIStore.setState({ activeGroupIndex: 2 }) // viewing group B
    const { result } = renderHook(() => useArchiveGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync(1) }) // archive A, not B
    expect(useUIStore.getState().activeGroupIndex).toBe(2) // unchanged
  })

  it('does not touch activeGroupIndex when refusing to archive the permanent group', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper, qc } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    useUIStore.setState({ activeGroupIndex: 0 })
    const { result } = renderHook(() => useArchiveGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync(0) })
    expect(useUIStore.getState().activeGroupIndex).toBe(0)
  })
})

describe('useImportGroups', () => {
  it('appends imported groups after the existing ones, preserving Now Open at index 0', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useImportGroups(), { wrapper })
    const imported = createGroup('imported', 'Imported')
    await act(async () => { await result.current.mutateAsync([imported]) })
    const saved = lastSaved()
    expect(saved.available).toHaveLength(2)
    expect(saved.available[0].permanent).toBe(true)
    // an imported group is a NEW group: fresh id, pending, and none of the source's sync bookkeeping
    expect(saved.available[1].id).not.toBe('imported')
    expect(saved.available[1].name).toBe('Imported')
    expect(saved.available[1].pendingSync).toBe(true)
  })

  it('strips the server base and position flag from imported groups (a backup repeats ids/stamps of existing rows)', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useImportGroups(), { wrapper })
    const imported = { ...createGroup('imported', 'Imported'), remoteUpdatedAt: '2030-01-01T00:00:00Z', positionDirty: true }
    await act(async () => { await result.current.mutateAsync([imported]) })
    const g = lastSaved().available[1]
    expect(g.remoteUpdatedAt).toBeUndefined()
    expect(g.positionDirty).toBeUndefined()
  })
})

describe('useSetTabReminder', () => {
  it('sets a reminder on the tab and registers the alarm via chrome.runtime.sendMessage', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetTabReminder(), { wrapper })

    const fireAt = Date.now() + 60_000
    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0, fireAt, note: 'Check this' })
    })

    expect(lastSaved().available[0].windows[0].tabs[0].reminder).toEqual({ fireAt, note: 'Check this' })
    expect(chrome.storage.local.set).toHaveBeenCalled()
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CREATE_ALARM' })
    )
  })

  it('omits the note when none is given', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetTabReminder(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0, fireAt: Date.now() + 60_000 })
    })

    expect(lastSaved().available[0].windows[0].tabs[0].reminder?.note).toBeUndefined()
  })
})

describe('useClearTabReminder', () => {
  it('removes the reminder field and best-effort clears the alarm', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([{ ...tab(1, 'https://a.com'), reminder: { fireAt: Date.now(), note: 'x' } }])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useClearTabReminder(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0 })
    })

    expect(lastSaved().available[0].windows[0].tabs[0].reminder).toBeUndefined()
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLEAR_ALARM' })
    )
    expect(chrome.storage.local.remove).toHaveBeenCalled()
  })
})

describe('useToggleWindowIncognito', () => {
  it('flips the incognito flag on the target window', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useToggleWindowIncognito(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 })
    })

    expect(lastSaved().available[0].windows[0].incognito).toBe(true)
  })
})

describe('useDeleteGroup', () => {
  it('refuses to delete the permanent Now Open group', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => { await result.current.mutateAsync(0) })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(deleteRemoteGroups).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalledWith('group_deleted')
  })

  it('closes no browser tab (a saved group holds detached copies), and hard-deletes remotely', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(1, 'https://a.com')])]
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://b.com')])]
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => { await result.current.mutateAsync(1) })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(deleteRemoteGroups).toHaveBeenCalledWith(['a'])
    expect(lastSaved().available).toHaveLength(1)
    expect(trackEvent).toHaveBeenCalledWith('group_deleted')
    expect(deleteRulesForGroupIds).toHaveBeenCalledWith(['a'])
  })

  /**
   * #20 (third sync audit) — the groups key is special: `useGroupsMutation` /
   * `getGroupsState` JOIN an in-flight groups fetch, and TanStack's default
   * `cancelRefetch: true` CANCELS it, rejecting every joined promise. A concurrent user
   * action (another mutation, a drop commit) would then be silently lost.
   */
  it('invalidates the groups key with cancelRefetch:false, so joined fetches are not rejected', async () => {
    const nowOpen = createNowOpenGroup()
    const group = createGroup('a', 'A')
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => { await result.current.mutateAsync(1) })

    expect(spy).toHaveBeenCalledWith({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false })
    spy.mockRestore()
  })

  it('does not call chrome.tabs.remove when no tabs are live in Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const group = createGroup('a', 'A')
    group.windows = [win([tab(2, 'https://b.com')])]
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => { await result.current.mutateAsync(1) })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('recalculates active index when the deleted group is before or at the active index', async () => {
    const a = createGroup('a', 'A')
    const b = createGroup('b', 'B')
    const c = createGroup('c', 'C')
    const state: GroupsState = { active: { id: 'c', index: 2 }, available: [a, b, c] }
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => { await result.current.mutateAsync(0) })

    const saved = lastSaved()
    expect(saved.active.index).toBe(1)
    expect(saved.active.id).toBe('c')
  })

  it('falls back to id "" when available list becomes empty', async () => {
    const group = createGroup('a', 'A')
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => { await result.current.mutateAsync(0) })

    const saved = lastSaved()
    expect(saved.available).toHaveLength(0)
    expect(saved.active.id).toBe('')
  })
})

describe('useToggleGroupStar', () => {
  it('moves a newly-starred group into the starred zone (after Now Open, before unstarred)', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const b = createGroup('b', 'B')
    const state: GroupsState = { active: { id: 'b', index: 2 }, available: [nowOpen, a, b] }
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useToggleGroupStar(), { wrapper })

    await act(async () => { await result.current.mutateAsync(2) })

    const saved = lastSaved()
    expect(saved.available.map((g) => g.id)).toEqual([nowOpen.id, 'b', 'a'])
    expect(saved.active.index).toBe(1)
  })

  it('falls back to prior active index when the active group id is not found', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const state: GroupsState = { active: { id: 'missing', index: 1 }, available: [nowOpen, a] }
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useToggleGroupStar(), { wrapper })

    await act(async () => { await result.current.mutateAsync(1) })

    expect(lastSaved().active.index).toBe(1)
  })
})

describe('useMoveTab', () => {
  it('moves a saved tab to Now Open: opens the URL and removes it from the source window, which STAYS even when emptied', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'https://a.com')]), win([tab(0, 'https://b.com')])]
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 0 })
    })

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.com', active: false })
    // User rule (2026-09-18): an emptied window is KEPT — it renders as an empty window
    // card and stays a drop target. `dndMove` behaves the same way.
    expect(lastSaved().available[1].windows).toHaveLength(2)
    expect(lastSaved().available[1].windows[0].tabs).toEqual([])
    expect(lastSaved().available[1].windows[1].tabs[0].url).toBe('https://b.com')
  })

  it('does not open a restricted URL when moving to Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'chrome://settings')])]
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 0 })
    })

    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('copy=true from Now Open to Now Open: opens URL and returns without a saved-state mutation', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(5, 'https://a.com')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 0, copy: true })
    })

    expect(chrome.tabs.create).toHaveBeenCalled()
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('KEEPS the source window when it becomes empty and >1 window remains (Now Open destination)', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'https://only.com')]), win([tab(0, 'https://b.com')])]
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 0 })
    })

    expect(lastSaved().available[1].windows).toHaveLength(2)
    expect(lastSaved().available[1].windows[0].tabs).toEqual([])
  })

  it('fetches ogImage via sendMessage for a live (id>0) tab moved between saved groups', async () => {
    ;(chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ogImage: 'https://og.com/img.png' })
    const nowOpen = createNowOpenGroup()
    const from = createGroup('from', 'From')
    from.windows = [win([tab(7, 'https://a.com')])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([nowOpen, from, to], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 2 })
    })

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'GET_PAGE_META' })
    expect(lastSaved().available[2].windows[0].tabs[0].ogImage).toBe('https://og.com/img.png')
  })

  it('falls back to undefined ogImage when sendMessage rejects (content script unavailable)', async () => {
    ;(chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no receiver'))
    const nowOpen = createNowOpenGroup()
    const from = createGroup('from', 'From')
    from.windows = [win([tab(7, 'https://a.com')])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([nowOpen, from, to], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 2 })
    })

    expect(lastSaved().available[2].windows[0].tabs[0].ogImage).toBeUndefined()
  })

  it('copy=true from Now Open to a saved group: the target gets a detached copy and the live tab stays in Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([{ ...tab(11, 'https://a.com'), pinned: true }])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([nowOpen, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 1, copy: true })
    })

    const saved = lastSaved()
    expect(saved.available[0].windows[0].tabs[0]).toMatchObject({ id: 11, pinned: true })
    const copy = saved.available[1].windows[0].tabs[0]
    expect(copy).toMatchObject({ id: 0, url: 'https://a.com', savedAt: expect.any(Number) })
    expect(copy).not.toHaveProperty('pinned')
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('copy=true between saved groups: keeps id 0 and preserves the source tab', async () => {
    const from = createGroup('from', 'From')
    from.windows = [win([tab(0, 'https://a.com')])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([from, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 1, copy: true })
    })

    const saved = lastSaved()
    expect(saved.available[0].windows[0].tabs).toHaveLength(1)
    expect(saved.available[1].windows[0].tabs[0].id).toBe(0)
  })

  it('preserves an existing savedAt when moving between saved groups (not stamping a new one)', async () => {
    const from = createGroup('from', 'From')
    const original = { ...tab(0, 'https://a.com'), savedAt: 123 }
    from.windows = [win([original])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([from, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 1 })
    })

    expect(lastSaved().available[1].windows[0].tabs[0].savedAt).toBe(123)
  })

  it('triggers tab_saved analytics onSuccess only when destination is not permanent', async () => {
    const from = createGroup('from', 'From')
    from.windows = [win([tab(0, 'https://a.com')])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([from, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 1 })
    })
    expect(lastSaved().available[1].windows[0].tabs).toHaveLength(1)
    expect(trackEvent).toHaveBeenCalledWith('tabs_saved', { count: 1 })
  })

  it('does not fire tabs_saved analytics when the destination is the permanent Now Open group', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const from = createGroup('from', 'From')
    from.windows = [win([tab(0, 'https://a.com')])]
    const state = makeState([nowOpen, from], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 0 })
    })
    expect(trackEvent).not.toHaveBeenCalledWith('tabs_saved', expect.anything())
  })

  it('KEEPS the source window between two saved groups when it becomes empty', async () => {
    const from = createGroup('from', 'From')
    from.windows = [win([tab(1, 'https://only.com')]), win([tab(2, 'https://b.com')])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([from, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 1 })
    })

    const saved = lastSaved()
    expect(saved.available[0].windows).toHaveLength(2)
    expect(saved.available[0].windows[0].tabs).toEqual([])
    expect(saved.available[0].windows[1].tabs[0].url).toBe('https://b.com')
  })
})

describe('useMoveWindow', () => {
  it('moves a window between two saved groups', async () => {
    const from = createGroup('from', 'From')
    from.windows = [win([tab(1, 'https://a.com')])]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([from, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 }) })
    const saved = lastSaved()
    expect(saved.available[0].windows).toHaveLength(0)
    expect(saved.available[1].windows).toHaveLength(1)
  })

  it('moves a window to Now Open: opens URLs, removes it from a non-permanent source', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'https://a.com'), tab(0, 'https://b.com')])]
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, windowIndex: 0, toGroupIndex: 0 })
    })

    expect(chrome.windows.create).toHaveBeenCalledWith({ url: ['https://a.com', 'https://b.com'], focused: false })
    expect(lastSaved().available[1].windows).toHaveLength(0)
  })

  it('skips chrome.windows.create when all urls are restricted (empty urls list)', async () => {
    const nowOpen = createNowOpenGroup()
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'chrome://settings')])]
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, windowIndex: 0, toGroupIndex: 0 })
    })

    expect(chrome.windows.create).not.toHaveBeenCalled()
  })

  it('when both source and destination are Now Open, opens the window but does not mutate saved state', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 0 })
    })

    expect(chrome.windows.create).toHaveBeenCalled()
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('skips chrome.windows.create when the source window does not exist, but still runs the source-cleanup mutation', async () => {
    const nowOpen = createNowOpenGroup()
    const group = createGroup('a', 'A')
    group.windows = []
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, windowIndex: 0, toGroupIndex: 0 })
    })

    expect(chrome.windows.create).not.toHaveBeenCalled()
    expect(saveGroupsState).toHaveBeenCalled()
  })

  it('moves a window between two saved (non-Now-Open) groups, sorted by starred', async () => {
    const from = createGroup('from', 'From')
    from.windows = [win([tab(1, 'https://a.com')])]
    const to = createGroup('to', 'To')
    to.windows = [{ ...win([tab(2, 'https://b.com')]), starred: true }]
    const state = makeState([from, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })
    })

    const saved = lastSaved()
    expect(saved.available[0].windows).toHaveLength(0)
    expect(saved.available[1].windows).toHaveLength(2)
  })

  it('COPIES a Now Open window into a saved group: Now Open is untouched and the target gets a detached saved copy', async () => {
    const nowOpen = createNowOpenGroup()
    const live: ExtWindow = { id: 501, tabs: [tab(11, 'https://a.com'), { ...tab(12, 'https://b.com'), pinned: true }], incognito: false, focused: true, starred: true }
    nowOpen.windows = [live, { id: 502, tabs: [tab(13, 'https://c.com')], incognito: false, focused: false }]
    const to = createGroup('to', 'To')
    to.windows = [{ ...win([tab(0, 'https://z.com')]), starred: true }]
    to.updatedAt = 1
    const state = makeState([nowOpen, to])
    const nowOpenBefore = structuredClone(nowOpen)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })
    })

    const saved = lastSaved()
    // Now Open: same windows, same order, not marked for sync; nothing closed or opened.
    expect(saved.available[0]).toEqual(nowOpenBefore)
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(chrome.windows.remove).not.toHaveBeenCalled()
    expect(chrome.windows.create).not.toHaveBeenCalled()

    // Target: the copy lands after the starred window, with no live ids and unfocused; it keeps its star.
    const target = saved.available[1]
    expect(target.windows).toHaveLength(2)
    const copy = target.windows[1]
    expect(copy.id).toBe(0)
    expect(copy.focused).toBe(false)
    expect(copy.starred).toBe(true)
    expect(copy.tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://b.com'])
    expect(copy.tabs.every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
    expect(target.pendingSync).toBe(true)
    expect(target.updatedAt).toBeGreaterThan(1)
    expect(target.info).toBe(formatGroupCounts(2, 3))
    // Undoable like any other saved-group edit: the snapshot is the state before the copy.
    expect(useUIStore.getState().undoStack[0].available[1].windows).toHaveLength(1)
  })

  it('copying from a Now Open window index that does not exist leaves the state unchanged and touches no browser window', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [{ id: 501, tabs: [tab(11, 'https://a.com')], incognito: false, focused: false }]
    nowOpen.updatedAt = 5
    const to = createGroup('to', 'To')
    to.windows = [win([tab(0, 'https://z.com')])]
    to.updatedAt = 7
    const state = makeState([nowOpen, to])
    const before = structuredClone(state)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 5, toGroupIndex: 1 })
    })

    // Whatever is (re)written is identical to what was there: no phantom window, no bumped group.
    expect(qc.getQueryData(GROUPS_QUERY_KEY)).toEqual(before)
    for (const call of (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toEqual(before)
    }
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(chrome.windows.remove).not.toHaveBeenCalled()
    expect(chrome.windows.create).not.toHaveBeenCalled()
  })

  it('a starred, focused Now Open window lands STARRED and UNfocused: after the target\'s starred window, before its unstarred one', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [{ ...tab(11, 'https://a.com'), pinned: true }], incognito: false, focused: true, starred: true, name: 'live' },
    ]
    const to = createGroup('to', 'To')
    to.windows = [
      { ...win([tab(0, 'https://plain.com')]), name: 'plain' },
      { ...win([tab(0, 'https://star.com')]), starred: true, name: 'star' },
    ]
    const state = makeState([nowOpen, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })
    })

    const target = lastSaved().available[1]
    expect(target.windows.map((w) => w.name)).toEqual(['star', 'live', 'plain'])
    const copy = target.windows[1]
    expect(copy.starred).toBe(true)
    expect(copy.focused).toBe(false)
    expect(copy.id).toBe(0)
    expect(copy.tabs.every((t) => t.id === 0 && typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
    // The live window itself is still starred and focused.
    expect(lastSaved().available[0].windows[0]).toMatchObject({ id: 501, starred: true, focused: true })
  })

  it('an unstarred Now Open window lands unstarred, after every window the target already has', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [tab(11, 'https://a.com')], incognito: false, focused: true, name: 'live' },
    ]
    const to = createGroup('to', 'To')
    to.windows = [
      { ...win([tab(0, 'https://star.com')]), starred: true, name: 'star' },
      { ...win([tab(0, 'https://plain.com')]), name: 'plain' },
    ]
    const state = makeState([nowOpen, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })
    })

    const target = lastSaved().available[1]
    expect(target.windows.map((w) => w.name)).toEqual(['star', 'plain', 'live'])
    expect(target.windows[2]).toMatchObject({ id: 0, focused: false, starred: false })
  })

  it('Now Open copy: only the target gets updatedAt/pendingSync/info; Now Open keeps its object, updatedAt and pendingSync', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 501, tabs: [tab(11, 'https://a.com'), tab(12, 'https://b.com')], incognito: false, focused: false },
    ]
    nowOpen.updatedAt = 42
    nowOpen.pendingSync = false
    const to = createGroup('to', 'To')
    to.windows = []
    to.updatedAt = 1
    to.pendingSync = false
    to.info = 'stale'
    const state = makeState([nowOpen, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })
    })

    const saved = lastSaved()
    expect(saved.available[0]).toBe(nowOpen)
    expect(saved.available[0].updatedAt).toBe(42)
    expect(saved.available[0].pendingSync).toBe(false)
    expect(saved.available[1].updatedAt).toBeGreaterThan(1)
    expect(saved.available[1].pendingSync).toBe(true)
    expect(saved.available[1].info).toBe(formatGroupCounts(1, 2))
    expect(saved.available[1]).not.toBe(to)
  })

  it('a copy does not alias the live window: mutating the saved copy cannot change the Now Open window', async () => {
    const nowOpen = createNowOpenGroup()
    const live: ExtWindow = { id: 501, tabs: [tab(11, 'https://a.com')], incognito: false, focused: false }
    nowOpen.windows = [live]
    const to = createGroup('to', 'To')
    to.windows = []
    const state = makeState([nowOpen, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 0, windowIndex: 0, toGroupIndex: 1 })
    })

    const copy = lastSaved().available[1].windows[0]
    expect(copy).not.toBe(live)
    expect(copy.tabs[0]).not.toBe(live.tabs[0])
    expect(live.tabs[0].id).toBe(11)
  })

  it('saved-to-saved move still REMOVES the window from the source and bumps both groups (regression guard for the Now Open copy branch)', async () => {
    const from = createGroup('from', 'From')
    from.windows = [
      { ...win([tab(0, 'https://a.com')]), name: 'keep' },
      { ...win([tab(0, 'https://b.com')]), name: 'moved', starred: true },
    ]
    from.updatedAt = 1
    const to = createGroup('to', 'To')
    to.windows = []
    to.updatedAt = 1
    const state = makeState([createNowOpenGroup(), from, to])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, windowIndex: 1, toGroupIndex: 2 })
    })

    const saved = lastSaved()
    expect(saved.available[1].windows.map((w) => w.name)).toEqual(['keep'])
    expect(saved.available[2].windows.map((w) => w.name)).toEqual(['moved'])
    // A saved window moves as-is: it keeps its starred flag.
    expect(saved.available[2].windows[0].starred).toBe(true)
    for (const i of [1, 2]) {
      expect(saved.available[i].updatedAt).toBeGreaterThan(1)
      expect(saved.available[i].pendingSync).toBe(true)
    }
    expect(saved.available[1].info).toBe(formatGroupCounts(1, 1))
    expect(saved.available[2].info).toBe(formatGroupCounts(1, 1))
    expect(chrome.windows.create).not.toHaveBeenCalled()
  })

  it('saved-to-Now-Open still opens the URLs and removes the window from the source, bumping the source only', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    nowOpen.updatedAt = 9
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'https://a.com')]), win([tab(0, 'https://b.com')])]
    group.updatedAt = 1
    const state = makeState([nowOpen, group], 1)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveWindow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ fromGroupIndex: 1, windowIndex: 0, toGroupIndex: 0 })
    })

    expect(chrome.windows.create).toHaveBeenCalledWith({ url: ['https://a.com'], focused: false })
    const saved = lastSaved()
    expect(saved.available[1].windows.map((w) => w.tabs[0].url)).toEqual(['https://b.com'])
    expect(saved.available[1].updatedAt).toBeGreaterThan(1)
    expect(saved.available[1].pendingSync).toBe(true)
    expect(saved.available[0].updatedAt).toBe(9)
  })
})

describe('useDeleteTab', () => {
  it('a Now Open tab is removed and closed in the browser', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(101, 'https://a.com'), tab(102, 'https://b.com')])]
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'https://a.com')])]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0 })
    })

    expect(chrome.tabs.remove).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.remove).toHaveBeenCalledWith(101)
    expect(lastSaved().available[0].windows[0].tabs.map((t) => t.id)).toEqual([102])
  })

  it('a saved tab is removed without closing any browser tab, even when its URL is open in Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(101, 'https://a.com')])]
    const group = createGroup('a', 'A')
    group.windows = [win([tab(101, 'https://a.com'), tab(102, 'https://b.com')])]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 0 })
    })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(lastSaved().available[1].windows[0].tabs).toHaveLength(1)
  })

  it('does not close a browser tab when the URL is not live in Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const group = createGroup('a', 'A')
    group.windows = [win([tab(103, 'https://not-open.com')])]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 0 })
    })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('KEEPS the emptied window even when the group has >1 window (deleting its last tab is not deleting the window)', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://only.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0 })
    })

    expect(lastSaved().available[0].windows).toHaveLength(2)
    expect(lastSaved().available[0].windows[0].tabs).toEqual([])
    expect(lastSaved().available[0].windows[1].tabs[0].url).toBe('https://b.com')
  })

  it('keeps the emptied window when it is the only window in the group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://only.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0 })
    })

    expect(lastSaved().available[0].windows).toHaveLength(1)
    expect(lastSaved().available[0].windows[0].tabs).toHaveLength(0)
  })
})

describe('useDeduplicateGroup', () => {
  /** A duplicate reference as the confirm modal sends it: position in the group + listed URL. */
  const dup = (windowIndex: number, tabIndex: number, url: string) => ({ windowIndex, tabIndex, url })

  it('removes the tab at the given position from a saved group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://a.com')])]
    const state = makeState([group])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, duplicates: [dup(0, 1, 'https://a.com')] }) })
    expect(lastSaved().available[0].windows[0].tabs).toHaveLength(1)
    expect(lastSaved().available[0].windows[0].tabs[0].id).toBe(1)
  })

  it('a saved group of detached tabs (all id 0) loses only its duplicate tab; the other tabs and windows stay', async () => {
    const group = createGroup('a', 'A')
    group.windows = [
      win([tab(0, 'https://a.com'), tab(0, 'https://b.com')]),
      win([tab(0, 'https://c.com'), tab(0, 'https://a.com')]),
    ]
    const state = makeState([createNowOpenGroup(), group])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    // The one duplicate is the second https://a.com (window 1, tab 1).
    await act(async () => { await result.current.mutateAsync({ groupIndex: 1, duplicates: [dup(1, 1, 'https://a.com')] }) })

    expect(lastSaved().available[1].windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ['https://a.com', 'https://b.com'],
      ['https://c.com'],
    ])
    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(lastSaved().available[1].pendingSync).toBe(true)
    expect(lastSaved().available[1].info).toBe(formatGroupCounts(2, 3))
  })

  it('removes several duplicates across windows by position and drops a window left without tabs', async () => {
    const group = createGroup('a', 'A')
    group.windows = [
      win([tab(0, 'https://a.com'), tab(0, 'https://a.com'), tab(0, 'https://b.com')]),
      win([tab(0, 'https://b.com')]),
      win([tab(0, 'https://c.com')]),
    ]
    const state = makeState([createNowOpenGroup(), group])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        groupIndex: 1,
        duplicates: [dup(0, 1, 'https://a.com'), dup(1, 0, 'https://b.com')],
      })
    })

    expect(lastSaved().available[1].windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ['https://a.com', 'https://b.com'],
      ['https://c.com'],
    ])
  })

  it('leaves a tab alone when the tab at the listed position does not have the listed URL', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(0, 'https://a.com'), tab(0, 'https://other.com')])]
    const state = makeState([createNowOpenGroup(), group])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        groupIndex: 1,
        duplicates: [dup(0, 1, 'https://a.com'), dup(4, 0, 'https://a.com')],
      })
    })

    expect(lastSaved().available[1].windows[0].tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://other.com'])
  })

  it('closes live browser tabs for duplicates found in the permanent Now Open group', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://a.com')]), win([tab(3, 'https://a.com')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        groupIndex: 0,
        duplicates: [dup(0, 1, 'https://a.com'), dup(1, 0, 'https://a.com')],
      })
    })

    expect(chrome.tabs.remove).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.remove).toHaveBeenCalledWith([2, 3])
    expect(lastSaved().available[0].windows.map((w) => w.tabs.map((t) => t.id))).toEqual([[1]])
    // Now Open edits are not synced.
    expect(lastSaved().available[0].pendingSync).toBe(false)
  })

  it('Now Open: a listed position whose tab has another URL is neither closed nor removed', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(1, 'https://a.com'), tab(7, 'https://new.com'), tab(2, 'https://a.com')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, duplicates: [dup(0, 1, 'https://a.com')] })
    })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
    expect(lastSaved().available[0].windows[0].tabs.map((t) => t.id)).toEqual([1, 7, 2])
  })

  it('does not call chrome.tabs.remove for a non-permanent group', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, duplicates: [dup(0, 1, 'https://a.com')] })
    })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('returns early (no-op) when the target group does not exist', async () => {
    const state = makeState([createGroup('a', 'A')])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 5, duplicates: [dup(0, 1, 'https://a.com')] })
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})

describe('useGroups — savedAt migration', () => {
  it('stamps missing savedAt on tabs in non-permanent groups and persists the migrated state', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([{ ...tab(1, 'https://a.com'), savedAt: undefined } as Tab])]
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([{ ...tab(2, 'https://live.com'), savedAt: undefined } as Tab])]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGroups(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Permanent group tabs are skipped by the migration (g.permanent → return early)
    expect(result.current.data?.available[0].windows[0].tabs[0].savedAt).toBeUndefined()
    // Non-permanent group tab gets stamped and persisted
    expect(result.current.data?.available[1].windows[0].tabs[0].savedAt).toBeDefined()
    expect(saveGroupsState).toHaveBeenCalled()
  })

  it('does not call saveGroupsState when all tabs already have savedAt (not dirty)', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([{ ...tab(1, 'https://a.com'), savedAt: Date.now() } as Tab])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGroups(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})

describe('useApplyAIGroups', () => {
  it('creates a new saved group per suggestion, moving matching Now Open tabs by real tab id', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://work.com', 'Work'), tab(12, 'https://fun.com', 'Fun')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useApplyAIGroups(), { wrapper })

    let outcome: { appliedGroups: number; appliedTabs: number } | undefined
    await act(async () => {
      outcome = await result.current.mutateAsync([
        { name: 'Work', color: 'rgba(1,1,1,1)', tabIds: [11] },
        { name: 'Fun', color: 'rgba(2,2,2,1)', tabIds: [12] },
      ])
    })

    expect(outcome).toEqual({ appliedGroups: 2, appliedTabs: 2 })
    const saved = lastSaved()
    expect(saved.available).toHaveLength(3)
    expect(saved.available[1].name).toBe('Work')
    expect(saved.available[1].windows[0].tabs[0]).toMatchObject({ id: 0, url: 'https://work.com' })
    expect(saved.available[2].name).toBe('Fun')
    expect(saved.available[2].windows[0].tabs[0]).toMatchObject({ id: 0, url: 'https://fun.com' })
    expect(saved.available[0].windows).toHaveLength(1)
    expect(saved.available[0].windows[0].tabs).toHaveLength(0)
    // The grouped tabs are detached saved copies: stamped savedAt, no pinned flag.
    const grouped = [saved.available[1], saved.available[2]].flatMap((g) => g.windows.flatMap((w) => w.tabs))
    expect(grouped.every((t) => typeof t.savedAt === 'number' && !('pinned' in t))).toBe(true)
  })

  it('skips a suggestion whose tabIds do not match any live Now Open tab, writing nothing and reporting zero applied', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://work.com', 'Work')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useApplyAIGroups(), { wrapper })

    let outcome: { appliedGroups: number; appliedTabs: number } | undefined
    await act(async () => {
      outcome = await result.current.mutateAsync([{ name: 'Ghost', color: 'rgba(1,1,1,1)', tabIds: [999] }])
    })

    expect(outcome).toEqual({ appliedGroups: 0, appliedTabs: 0 })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('leaves Now Open with an empty window rather than zero windows when every tab is grouped away', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://work.com', 'Work')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useApplyAIGroups(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ name: 'Work', color: 'rgba(1,1,1,1)', tabIds: [11] }])
    })

    const saved = lastSaved()
    expect(saved.available[0].windows).toHaveLength(1)
    expect(saved.available[0].windows[0].tabs).toHaveLength(0)
  })
})

describe('useApplyAIGroups — Free-tier caps backstop', () => {
  it('ungated by default (no caps passed) — matches pre-existing behavior', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://work.com', 'Work')])]
    const existing = Array.from({ length: 20 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...existing])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useApplyAIGroups(), { wrapper })

    let outcome: { appliedGroups: number; appliedTabs: number } | undefined
    await act(async () => {
      outcome = await result.current.mutateAsync([{ name: 'Work', color: 'rgba(1,1,1,1)', tabIds: [11] }])
    })
    expect(outcome).toEqual({ appliedGroups: 1, appliedTabs: 1 })
  })

  it('blocks growth past maxGroups and writes nothing', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://work.com', 'Work')])]
    const existing = Array.from({ length: 5 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...existing])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useApplyAIGroups({ maxGroups: 5, maxTabs: 50 }), { wrapper })

    await expect(
      result.current.mutateAsync([{ name: 'Work', color: 'rgba(1,1,1,1)', tabIds: [11] }])
    ).rejects.toThrow()
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('blocks past maxTabs even when under maxGroups', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://work.com', 'Work'), tab(12, 'https://fun.com', 'Fun')])]
    const existing = createGroup('a', 'A')
    existing.windows = [win(Array.from({ length: 48 }, (_, i) => tab(100 + i, `https://x${i}.com`)))]
    const state = makeState([nowOpen, existing])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useApplyAIGroups({ maxGroups: 10, maxTabs: 49 }), { wrapper })

    // current saved tabs = 48, applying both suggestions adds 2 more = 50 > maxTabs:49
    await expect(
      result.current.mutateAsync([
        { name: 'Work', color: 'rgba(1,1,1,1)', tabIds: [11] },
        { name: 'Fun', color: 'rgba(2,2,2,1)', tabIds: [12] },
      ])
    ).rejects.toThrow()
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('Pro caps (Infinity) always pass', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(11, 'https://work.com', 'Work')])]
    const existing = Array.from({ length: 50 }, (_, i) => createGroup(`g${i}`, `G${i}`))
    const state = makeState([nowOpen, ...existing])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useApplyAIGroups({ maxGroups: Infinity, maxTabs: Infinity }), { wrapper })

    let outcome: { appliedGroups: number; appliedTabs: number } | undefined
    await act(async () => {
      outcome = await result.current.mutateAsync([{ name: 'Work', color: 'rgba(1,1,1,1)', tabIds: [11] }])
    })
    expect(outcome).toEqual({ appliedGroups: 1, appliedTabs: 1 })
  })
})
