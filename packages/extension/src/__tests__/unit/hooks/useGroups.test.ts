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
} from '@/hooks/useGroups'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import type { GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
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
    expect(saved.available[1].id).toBe('imported')
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

  it('closes live browser tabs whose URLs are open in Now Open, and hard-deletes remotely', async () => {
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

    expect(chrome.tabs.remove).toHaveBeenCalledWith([1])
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
})

describe('useDeleteTab', () => {
  it('removes the tab and closes the live browser tab when its URL is open in Now Open', async () => {
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

    expect(chrome.tabs.remove).toHaveBeenCalledWith(101)
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
  it('removes tabs matching the given duplicate ids', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://a.com')])]
    const state = makeState([group])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ groupIndex: 0, duplicateIds: [2] }) })
    expect(lastSaved().available[0].windows[0].tabs).toHaveLength(1)
    expect(lastSaved().available[0].windows[0].tabs[0].id).toBe(1)
  })

  it('closes live browser tabs for duplicates found in the permanent Now Open group', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://a.com')])]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, duplicateIds: [2] })
    })

    expect(chrome.tabs.remove).toHaveBeenCalledWith([2])
  })

  it('does not call chrome.tabs.remove for a non-permanent group even with duplicate ids', async () => {
    const group = createGroup('a', 'A')
    group.windows = [win([tab(1, 'https://a.com'), tab(2, 'https://a.com')])]
    const state = makeState([group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, duplicateIds: [2] })
    })

    expect(chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('returns early (no-op) when the target group does not exist', async () => {
    const state = makeState([createGroup('a', 'A')])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 5, duplicateIds: [2] })
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
