import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useDeleteAllWindows,
  useDeleteGroup,
  useDeleteTab,
  useDeleteWindow,
  useDeduplicateGroup,
  useDuplicateGroup,
  useMergeWithCurrent,
  useReplaceWithCurrent,
  GROUPS_QUERY_KEY,
} from '@/hooks/useGroups'
import { useBulkDelete, useBulkMoveToGroup } from '@/hooks/useBulkActions'
import { applyUrlRule } from '@/lib/urlRuleEngine'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// Real IndexedDB (fake-indexeddb), no vi.mock('@/lib/localDb'). Two rules, read back from the
// store itself: whatever is saved from Now Open is a detached copy (tab id 0, savedAt, no
// pinned flag; window id 0, unfocused, its star kept by these menu and button actions), and
// only Now Open items are closed in the browser.

function tab(id: number, url: string, extra: Partial<Tab> = {}): Tab {
  return { id, title: url, url, favIconUrl: '', pinned: false, ...extra }
}

function makeClient(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

/** Now Open with two live windows, one empty saved group and one saved group with content. */
async function seed(): Promise<GroupsState> {
  const nowOpen = createNowOpenGroup()
  const first: ExtWindow = {
    id: 901,
    tabs: [tab(11, 'https://a.example.com', { pinned: true }), tab(12, 'https://b.example.com')],
    incognito: false,
    focused: true,
    starred: true,
  }
  const second: ExtWindow = { id: 902, tabs: [tab(13, 'https://c.example.com')], incognito: false, focused: false }
  nowOpen.windows = [first, second]
  const target = createGroup('target', 'Target')
  target.windows = []
  const kept = createGroup('kept', 'Kept')
  kept.windows = [
    { id: 0, tabs: [tab(0, 'https://a.example.com', { savedAt: 5 }), tab(0, 'https://k.example.com', { savedAt: 5 })], incognito: false, focused: false },
    { id: 0, tabs: [tab(0, 'https://a.example.com', { savedAt: 5 })], incognito: false, focused: false },
  ]
  const state: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen, target, kept] }
  await saveGroupsState(state)
  return getGroupsState()
}

function savedGroups(state: GroupsState): Group[] {
  return state.available.filter((g) => !g.permanent)
}

function expectAllSavedDetached(state: GroupsState) {
  for (const group of savedGroups(state)) {
    for (const w of group.windows) {
      expect(w.focused).toBe(false)
      for (const t of w.tabs) {
        expect(t.id).toBe(0)
        expect(typeof t.savedAt).toBe('number')
        expect(t.pinned).toBeFalsy()
      }
    }
  }
}

function expectNowOpenLive(state: GroupsState) {
  const nowOpen = state.available.find((g) => g.permanent)!
  expect(nowOpen.windows.map((w) => w.id)).toEqual([901, 902])
  expect(nowOpen.windows.flatMap((w) => w.tabs.map((t) => t.id))).toEqual([11, 12, 13])
  expect(nowOpen.windows[0].tabs[0].pinned).toBe(true)
}

const removeMock = () => chrome.tabs.remove as unknown as ReturnType<typeof vi.fn>

beforeEach(async () => {
  await clearDb()
  removeMock().mockClear()
})

describe('saving from Now Open stores detached copies — real IndexedDB', () => {
  it('selection "Copy to group" with tabs', async () => {
    const { wrapper } = makeClient(await seed())
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })
    await result.current.mutateAsync({
      items: [{ type: 'tab', id: 'tab-0-0-0' }, { type: 'tab', id: 'tab-0-1-0' }],
      targetGroupIndex: 1,
    })

    const reloaded = await getGroupsState()
    expect(reloaded.available[1].windows.flatMap((w) => w.tabs.map((t) => t.url))).toEqual([
      'https://a.example.com',
      'https://c.example.com',
    ])
    expectAllSavedDetached(reloaded)
    expectNowOpenLive(reloaded)
  })

  it('selection "Copy to group" with windows', async () => {
    const { wrapper } = makeClient(await seed())
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })
    await result.current.mutateAsync({
      items: [{ type: 'window', id: 'window-0-0' }, { type: 'window', id: 'window-0-1' }],
      targetGroupIndex: 1,
    })

    const reloaded = await getGroupsState()
    // The starred Now Open window is stored starred, the unstarred one unstarred.
    expect(reloaded.available[1].windows.map((w) => [w.id, w.starred ?? false])).toEqual([[0, true], [0, false]])
    expect(reloaded.available[1].windows.map((w) => w.tabs.length)).toEqual([2, 1])
    expectAllSavedDetached(reloaded)
    expectNowOpenLive(reloaded)
  })

  it('"Replace with current" and "Merge with current"', async () => {
    const { wrapper } = makeClient(await seed())
    const { result: replace } = renderHook(() => useReplaceWithCurrent(), { wrapper })
    await replace.current.mutateAsync(1)
    const { result: merge } = renderHook(() => useMergeWithCurrent(), { wrapper })
    await merge.current.mutateAsync(2)

    const reloaded = await getGroupsState()
    expect(reloaded.available[1].windows.map((w) => w.tabs.length)).toEqual([2, 1])
    expect(reloaded.available[2].windows.map((w) => w.tabs.length)).toEqual([2, 1, 2, 1])
    // Each copy keeps its window's star; the windows the group already had stay unstarred.
    expect(reloaded.available[1].windows.map((w) => w.starred ?? false)).toEqual([true, false])
    expect(reloaded.available[2].windows.map((w) => w.starred ?? false)).toEqual([true, false, false, false])
    expect(savedGroups(reloaded).flatMap((g) => g.windows).every((w) => w.id === 0)).toBe(true)
    expectAllSavedDetached(reloaded)
    expectNowOpenLive(reloaded)
  })

  it('"Duplicate" on Now Open', async () => {
    const { wrapper } = makeClient(await seed())
    const { result } = renderHook(() => useDuplicateGroup(), { wrapper })
    await result.current.mutateAsync(0)

    const reloaded = await getGroupsState()
    expect(reloaded.available.filter((g) => g.permanent)).toHaveLength(1)
    const clone = reloaded.available[1]
    expect(clone.permanent).toBeFalsy()
    expect(clone.windows.map((w) => w.id)).toEqual([0, 0])
    expect(clone.windows.map((w) => w.starred ?? false)).toEqual([true, false])
    expect(clone.windows.flatMap((w) => w.tabs.map((t) => t.url))).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ])
    expectAllSavedDetached(reloaded)
    expectNowOpenLive(reloaded)
  })

  it('a URL rule match', async () => {
    await seed()
    await applyUrlRule(
      { id: 77, url: 'https://rule.example.com/', title: 'Rule', favIconUrl: '', pinned: true } as chrome.tabs.Tab,
      'target'
    )

    const reloaded = await getGroupsState()
    expect(reloaded.available[1].windows[0].tabs.map((t) => t.url)).toEqual(['https://rule.example.com/'])
    expectAllSavedDetached(reloaded)
    expectNowOpenLive(reloaded)
    expect(removeMock()).not.toHaveBeenCalled()
  })
})

describe('only Now Open items are closed in the browser — real IndexedDB', () => {
  /** A saved group next to Now Open with the same URLs open. The saved tabs' ids are arbitrary numbers: no delete reads them. */
  async function seedWithNumberedSavedTabs(): Promise<GroupsState> {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [
      { id: 901, tabs: [tab(11, 'https://a.example.com'), tab(12, 'https://b.example.com')], incognito: false, focused: true },
      { id: 902, tabs: [tab(13, 'https://c.example.com')], incognito: false, focused: false },
    ]
    const saved = createGroup('saved', 'Saved')
    saved.windows = [
      { id: 901, tabs: [tab(12, 'https://a.example.com', { savedAt: 5 }), tab(13, 'https://b.example.com', { savedAt: 5 })], incognito: false, focused: false },
      { id: 902, tabs: [tab(11, 'https://c.example.com', { savedAt: 5 })], incognito: false, focused: false },
    ]
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, saved] })
    return getGroupsState()
  }

  it('deleting a saved tab, window, every window or the group closes nothing', async () => {
    const { wrapper } = makeClient(await seedWithNumberedSavedTabs())
    const { result: deleteTab } = renderHook(() => useDeleteTab(), { wrapper })
    await deleteTab.current.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 0 })
    const { result: deleteWindow } = renderHook(() => useDeleteWindow(), { wrapper })
    await deleteWindow.current.mutateAsync({ groupIndex: 1, windowIndex: 1 })
    const { result: deleteAll } = renderHook(() => useDeleteAllWindows(), { wrapper })
    await deleteAll.current.mutateAsync({ groupIndex: 1 })
    const { result: deleteGroup } = renderHook(() => useDeleteGroup(), { wrapper })
    await deleteGroup.current.mutateAsync(1)

    expect(removeMock()).not.toHaveBeenCalled()
    const reloaded = await getGroupsState()
    expect(reloaded.available).toHaveLength(1)
    expect(reloaded.available[0].windows.flatMap((w) => w.tabs.map((t) => t.id))).toEqual([11, 12, 13])
  })

  it('selection delete of saved tabs, windows or groups closes nothing', async () => {
    for (const items of [
      [{ type: 'tab' as const, id: 'tab-1-0-0' }, { type: 'tab' as const, id: 'tab-1-1-0' }],
      [{ type: 'window' as const, id: 'window-1-0' }],
      [{ type: 'group' as const, id: 'group-1' }],
    ]) {
      await clearDb()
      const { wrapper } = makeClient(await seedWithNumberedSavedTabs())
      const { result } = renderHook(() => useBulkDelete(), { wrapper })
      await result.current.mutateAsync(items)
    }
    expect(removeMock()).not.toHaveBeenCalled()
  })

  it('deleting Now Open items closes exactly those browser tabs', async () => {
    const { wrapper } = makeClient(await seedWithNumberedSavedTabs())
    const { result: deleteTab } = renderHook(() => useDeleteTab(), { wrapper })
    await deleteTab.current.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 1 })
    expect(removeMock()).toHaveBeenLastCalledWith(12)

    const { result: bulkDelete } = renderHook(() => useBulkDelete(), { wrapper })
    await bulkDelete.current.mutateAsync([{ type: 'window', id: 'window-0-1' }])
    expect(removeMock()).toHaveBeenLastCalledWith([13])
    expect(removeMock()).toHaveBeenCalledTimes(2)
  })

  it('"Deduplicate tabs" on a saved group matches by position: one duplicate removed, the rest persisted', async () => {
    const state = await seed()
    const { wrapper } = makeClient(state)
    const { result } = renderHook(() => useDeduplicateGroup(), { wrapper })
    await result.current.mutateAsync({
      groupIndex: 2,
      duplicates: [{ windowIndex: 1, tabIndex: 0, url: 'https://a.example.com' }],
    })

    const reloaded = await getGroupsState()
    expect(reloaded.available[2].windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ['https://a.example.com', 'https://k.example.com'],
    ])
    expect(removeMock()).not.toHaveBeenCalled()
  })
})
