/**
 * Every mutating action is exactly ONE undo step, one Undo restores the exact prior saved state and
 * Redo re-applies it. Writes that change no saved data (a no-op, a Now Open-only write, a failed
 * write, an info recount, a reminder) leave no step. Runs the real mutation hooks, the real
 * uiStore and the real useUndoRedo against an in-memory groups store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const store = vi.hoisted(() => ({ state: null as unknown as GroupsState, rev: 1, failNext: false }))

vi.mock('@/lib/localDb', () => {
  const save = async (next: GroupsState, opts: { expectedRev?: number } = {}) => {
    if (store.failNext) {
      store.failNext = false
      throw new Error('QuotaExceeded')
    }
    if (opts.expectedRev !== undefined && opts.expectedRev !== store.rev) throw Object.assign(new Error('stale'), { name: 'StaleGroupsError' })
    store.rev += 1
    store.state = structuredClone({ ...next, rev: store.rev })
    return store.rev
  }
  return {
    getGroupsState: vi.fn(async () => structuredClone(store.state)),
    saveGroupsState: vi.fn(save),
    updateGroupsState: vi.fn(async (fn: (s: GroupsState) => GroupsState | null) => {
      const next = fn(structuredClone(store.state))
      if (!next) return structuredClone(store.state)
      await save(next)
      return structuredClone(store.state)
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue({})
  }
})
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/hooks/useUrlRules', () => ({ deleteRulesForGroupIds: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import * as G from '@/hooks/useGroups'
import { useBulkDelete, useBulkMoveToGroup, useBulkStar } from '@/hooks/useBulkActions'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { deleteRemoteGroups } from '@/lib/syncEngine'

const tab = (title: string, id = 0): Tab => ({ id, title, url: `https://example.com/${title}`, savedAt: 1 })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, starred: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({ id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows, ...over })

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    rev: 1,
    available: [
      group('now', [win([tab('live1', 41), tab('live2', 42)], { id: 7 })], { permanent: true }),
      group('work', [win([tab('a1'), tab('a2')]), win([tab('a3')])]),
      group('play', [win([tab('p1')])])
    ]
  }
}

/** What the user sees of the saved groups: names, notes, stars, archive flag and tab titles. */
const saved = (s: GroupsState) =>
  s.available
    .filter((g) => !g.permanent)
    .map((g) => ({ id: g.id, name: g.name, color: g.color, note: g.note, archived: !!g.archived, windows: g.windows.map((w) => ({ name: w.name, note: w.note, starred: !!w.starred, tabs: w.tabs.map((t) => [t.title, t.customTitle, t.note]) })) }))

let chromeStub: { tabs: Record<string, ReturnType<typeof vi.fn>>; windows: Record<string, ReturnType<typeof vi.fn>>; runtime: Record<string, ReturnType<typeof vi.fn>>; storage: unknown }

beforeEach(() => {
  vi.clearAllMocks()
  store.state = seed()
  store.rev = 1
  store.failNext = false
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
  chromeStub = {
    tabs: {
      create: vi.fn().mockResolvedValue({ id: 900 }),
      remove: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async (id: number) => ({ id, url: 'https://example.com/a1', windowId: 7, index: 0 })),
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined)
    },
    windows: { create: vi.fn().mockResolvedValue({ id: 5, tabs: [{ id: 901 }] }), get: vi.fn().mockResolvedValue({ id: 7 }), getCurrent: vi.fn().mockResolvedValue({ id: 7 }) },
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    storage: { local: { set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } }
  }
  vi.stubGlobal('chrome', chromeStub)
})

function setup<T>(useAction: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(G.GROUPS_QUERY_KEY, structuredClone(store.state))
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => ({ action: useAction(), history: useUndoRedo() }), { wrapper })
  return { qc, result }
}

const steps = () => useUIStore.getState().undoStack.length

type Run = (action: never) => Promise<unknown>
const cases: Array<[string, () => unknown, Run, (() => void)?]> = [
  ['add group', () => G.useAddGroup(), (a: ReturnType<typeof G.useAddGroup>) => a.mutateAsync({ name: 'New' })],
  ['delete group', () => G.useDeleteGroup(), (a: ReturnType<typeof G.useDeleteGroup>) => a.mutateAsync(2)],
  ['duplicate group', () => G.useDuplicateGroup(), (a: ReturnType<typeof G.useDuplicateGroup>) => a.mutateAsync(1)],
  ['rename group', () => G.useUpdateGroupName(), (a: ReturnType<typeof G.useUpdateGroupName>) => a.mutateAsync({ groupIndex: 1, name: 'Renamed' })],
  ['group colour', () => G.useUpdateGroupColor(), (a: ReturnType<typeof G.useUpdateGroupColor>) => a.mutateAsync({ groupIndex: 1, color: 'rgba(1,2,3,1)' })],
  ['group note', () => G.useUpdateGroupNote(), (a: ReturnType<typeof G.useUpdateGroupNote>) => a.mutateAsync({ groupIndex: 1, note: 'remember' })],
  ['reorder groups', () => G.useReorderGroups(), (a: ReturnType<typeof G.useReorderGroups>) => a.mutateAsync({ from: 2, to: 1 })],
  ['star group', () => G.useToggleGroupStar(), (a: ReturnType<typeof G.useToggleGroupStar>) => a.mutateAsync(2)],
  ['archive group', () => G.useArchiveGroup(), (a: ReturnType<typeof G.useArchiveGroup>) => a.mutateAsync(1)],
  ['add window', () => G.useAddWindow(), (a: ReturnType<typeof G.useAddWindow>) => a.mutateAsync({ groupIndex: 1 })],
  ['delete window', () => G.useDeleteWindow(), (a: ReturnType<typeof G.useDeleteWindow>) => a.mutateAsync({ groupIndex: 1, windowIndex: 1 })],
  ['remove all windows', () => G.useDeleteAllWindows(), (a: ReturnType<typeof G.useDeleteAllWindows>) => a.mutateAsync({ groupIndex: 1 })],
  ['rename window', () => G.useUpdateWindowName(), (a: ReturnType<typeof G.useUpdateWindowName>) => a.mutateAsync({ groupIndex: 1, windowIndex: 0, name: 'W' })],
  ['window note', () => G.useUpdateWindowNote(), (a: ReturnType<typeof G.useUpdateWindowNote>) => a.mutateAsync({ groupIndex: 1, windowIndex: 0, note: 'n' })],
  ['star window', () => G.useToggleWindowStarred(), (a: ReturnType<typeof G.useToggleWindowStarred>) => a.mutateAsync({ groupIndex: 1, windowIndex: 1 })],
  ['delete tab', () => G.useDeleteTab(), (a: ReturnType<typeof G.useDeleteTab>) => a.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 0 })],
  ['tab note', () => G.useUpdateTabNote(), (a: ReturnType<typeof G.useUpdateTabNote>) => a.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 1, note: 'n' })],
  ['rename tab', () => G.useRenameTab(), (a: ReturnType<typeof G.useRenameTab>) => a.mutateAsync({ groupId: 'work', windowIndex: 0, tabIndex: 0, title: 'Custom' })],
  ['unite windows', () => G.useUniteWindows(), (a: ReturnType<typeof G.useUniteWindows>) => a.mutateAsync(1)],
  ['split windows', () => G.useSplitWindows(), (a: ReturnType<typeof G.useSplitWindows>) => a.mutateAsync(1)],
  ['sort tabs', () => G.useSortTabs(), (a: ReturnType<typeof G.useSortTabs>) => a.mutateAsync({ groupIndex: 1, by: 'title' as const }), () => {
    store.state.available[1].windows[0].tabs.reverse() // unsorted, so the sort changes something
  }],
  ['replace with current', () => G.useReplaceWithCurrent(), (a: ReturnType<typeof G.useReplaceWithCurrent>) => a.mutateAsync(1)],
  ['merge with current', () => G.useMergeWithCurrent(), (a: ReturnType<typeof G.useMergeWithCurrent>) => a.mutateAsync(2)],
  ['move tab saved to saved', () => G.useMoveTab(), (a: ReturnType<typeof G.useMoveTab>) => a.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 2 })],
  ['copy live tab to a group', () => G.useMoveTab(), (a: ReturnType<typeof G.useMoveTab>) => a.mutateAsync({ fromGroupIndex: 0, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 2, copy: true })],
  ['move window', () => G.useMoveWindow(), (a: ReturnType<typeof G.useMoveWindow>) => a.mutateAsync({ fromGroupIndex: 1, windowIndex: 1, toGroupIndex: 2 })],
  ['dedupe a saved group', () => G.useDeduplicateGroup(), (a: ReturnType<typeof G.useDeduplicateGroup>) => a.mutateAsync({ groupIndex: 1, duplicates: [{ windowIndex: 1, tabIndex: 0, url: 'https://example.com/a3' }] })],
  ['remove stale tabs', () => G.useRemoveStaleTabs(), (a: ReturnType<typeof G.useRemoveStaleTabs>) => a.mutateAsync({ groupIndex: 1, staleThresholdMs: 1 })],
  ['import (append)', () => G.useImportGroups(), (a: ReturnType<typeof G.useImportGroups>) => a.mutateAsync([group('imp', [win([tab('i1')])])])],
  ['import / restore (replace)', () => G.useReplaceSavedGroups(), (a: ReturnType<typeof G.useReplaceSavedGroups>) => a.mutateAsync([group('imp', [win([tab('i1')])])])],
  ['quick save (shortcut)', () => G.useSaveShortcutTabs(), (a: ReturnType<typeof G.useSaveShortcutTabs>) => a.mutateAsync({ tabs: [tab('q1')], groupId: 'play' })],
  ['AI apply', () => G.useApplyAIGroups(), (a: ReturnType<typeof G.useApplyAIGroups>) => a.mutateAsync([{ name: 'AI', color: 'rgba(0,0,0,1)', tabIds: [41] }])]
]

describe('every useGroups mutation is exactly one undo step, and Undo/Redo round-trips it', () => {
  it.each(cases)('%s', async (_name, useAction, run, prepare) => {
    prepare?.()
    const before = saved(store.state)
    const { result } = setup(useAction)
    await act(async () => {
      await run(result.current.action as never)
    })
    const after = saved(store.state)
    expect(after).not.toEqual(before)
    expect(steps()).toBe(1)

    await act(async () => {
      await result.current.history.undo()
    })
    expect(saved(store.state)).toEqual(before)
    expect(steps()).toBe(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)

    await act(async () => {
      await result.current.history.redo()
    })
    // ids of re-created groups are kept by the restore, so the redo is the exact same state
    expect(saved(store.state)).toEqual(after)
    expect(steps()).toBe(1)
  })
})

describe('writes that change no saved data leave no undo step', () => {
  it('a rename to the same name (only re-stamped) is no step, and keeps the redo history', async () => {
    useUIStore.setState({ redoStack: [seed()] })
    const { result } = setup(() => G.useUpdateGroupName())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 1, name: 'work' })
    })
    expect(steps()).toBe(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('deleting a Now Open tab (closes a live tab, saved data untouched) is no step', async () => {
    const { result } = setup(() => G.useDeleteTab())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 0, windowIndex: 0, tabIndex: 0 })
    })
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith(41)
    expect(steps()).toBe(0)
  })

  it('a write that fails leaves no step behind', async () => {
    store.failNext = true
    const { result } = setup(() => G.useUpdateGroupName())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 1, name: 'X' }).catch(() => {})
    })
    expect(steps()).toBe(0)
  })

  it('an info recount and a reminder are not undo steps (their alarm could not be taken back)', async () => {
    const { result } = setup(() => ({ info: G.useUpdateGroupInfo(), remind: G.useSetTabReminder() }))
    await act(async () => {
      await result.current.action.info.mutateAsync({ groupIndex: 1, info: '3 tabs' })
      await result.current.action.remind.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 0, fireAt: Date.now() + 60_000 })
    })
    expect(steps()).toBe(0)
  })

  it('a group that vanished before the write is no step', async () => {
    const { qc, result } = setup(() => G.useUpdateGroupName())
    store.state = { ...store.state, available: store.state.available.filter((g) => g.id !== 'work') }
    void qc
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 1, name: 'X' })
    })
    expect(steps()).toBe(0)
  })
})

describe('moving a saved item INTO Now Open (menu): one step that also closes the opened tab', () => {
  it('Undo puts the saved tab back and closes exactly the tab the move opened (by id); Redo reopens it', async () => {
    const { result } = setup(() => G.useMoveTab())
    await act(async () => {
      await result.current.action.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 0 })
    })
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/a1', active: false })
    expect(steps()).toBe(1)
    await waitFor(() => expect(saved(store.state)[0].windows[0].tabs.map((t) => t[0])).toEqual(['a2']))

    await act(async () => {
      await result.current.history.undo()
    })
    expect(saved(store.state)[0].windows[0].tabs.map((t) => t[0])).toEqual(['a1', 'a2'])
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([900])

    chromeStub.tabs.get = vi.fn().mockRejectedValue(new Error('closed'))
    chromeStub.tabs.create.mockResolvedValue({ id: 950 })
    await act(async () => {
      await result.current.history.redo()
    })
    expect(saved(store.state)[0].windows[0].tabs.map((t) => t[0])).toEqual(['a2'])
    expect(chromeStub.tabs.create).toHaveBeenLastCalledWith({ windowId: 7, url: 'https://example.com/a1', index: 0, active: false, pinned: false })
  })

  it('a saved WINDOW moved into Now Open: Undo closes the tabs of the window the move opened', async () => {
    const { result } = setup(() => G.useMoveWindow())
    await act(async () => {
      await result.current.action.mutateAsync({ fromGroupIndex: 1, windowIndex: 1, toGroupIndex: 0 })
    })
    expect(steps()).toBe(1)
    chromeStub.tabs.get = vi.fn(async (id: number) => ({ id, url: 'https://example.com/a3', windowId: 5, index: 0 }))
    await act(async () => {
      await result.current.history.undo()
    })
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([901])
    expect(saved(store.state)[0].windows).toHaveLength(2)
  })
})

describe('bulk actions are one step each', () => {
  it('bulk delete of two tabs in two groups is ONE step; Undo restores both', async () => {
    const before = saved(store.state)
    const { result } = setup(() => useBulkDelete())
    await act(async () => {
      await result.current.action.mutateAsync([{ type: 'tab', id: 'tab-1-0-0' }, { type: 'tab', id: 'tab-2-0-0' }])
    })
    expect(steps()).toBe(1)
    await act(async () => {
      await result.current.history.undo()
    })
    expect(saved(store.state)).toEqual(before)
  })

  it('a bulk delete of Now Open tabs only is no step', async () => {
    const { result } = setup(() => useBulkDelete())
    await act(async () => {
      await result.current.action.mutateAsync([{ type: 'tab', id: 'tab-0-0-0' }])
    })
    expect(steps()).toBe(0)
  })

  it('bulk star and bulk move are one step each', async () => {
    const { result } = setup(() => ({ star: useBulkStar(), move: useBulkMoveToGroup() }))
    await act(async () => {
      await result.current.action.star.mutateAsync({ items: [{ type: 'window', id: 'window-1-0' }, { type: 'window', id: 'window-1-1' }], starred: true })
    })
    expect(steps()).toBe(1)
    await act(async () => {
      await result.current.action.move.mutateAsync({ items: [{ type: 'tab', id: 'tab-2-0-0' }], targetGroupIndex: 1 })
    })
    expect(steps()).toBe(2)
  })

  it('a bulk move INTO Now Open: one step that closes exactly the tabs it opened on Undo', async () => {
    chromeStub.tabs.get = vi.fn(async (id: number) => ({ id, url: 'https://example.com/p1', windowId: 7, index: 0 }))
    const { result } = setup(() => useBulkMoveToGroup())
    await act(async () => {
      await result.current.action.mutateAsync({ items: [{ type: 'tab', id: 'tab-2-0-0' }], targetGroupIndex: 0 })
    })
    expect(steps()).toBe(1)
    await new Promise((r) => setTimeout(r, 0)) // the opened tab's id arrives after the write
    await act(async () => {
      await result.current.history.undo()
    })
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([900])
    expect(saved(store.state).find((g) => g.id === 'play')?.windows[0].tabs.map((t) => t[0])).toEqual(['p1'])
  })
})

describe('auditor follow-ups', () => {
  it('N1: renaming a tab that is gone, or to the same title, writes nothing (no rev bump, no broadcast) and is no step', async () => {
    const { result } = setup(() => G.useRenameTab())
    const rev = store.rev
    await act(async () => {
      await result.current.action.mutateAsync({ groupId: 'work', windowIndex: 9, tabIndex: 0, title: 'X' })
      await result.current.action.mutateAsync({ groupId: 'gone', windowIndex: 0, tabIndex: 0, title: 'X' })
      await result.current.action.mutateAsync({ groupId: 'work', windowIndex: 0, tabIndex: 0, title: 'a1' }) // its own title
    })
    expect(store.rev).toBe(rev)
    expect(steps()).toBe(0)
  })

  it('N2: Undo of an add (and Redo of a delete) asks for the remote delete of the group it removes', async () => {
    const { result } = setup(() => G.useAddGroup())
    await act(async () => {
      await result.current.action.mutateAsync({ name: 'New' })
    })
    const added = store.state.available.find((g) => g.name === 'New')!.id
    vi.mocked(deleteRemoteGroups).mockClear()
    await act(async () => {
      await result.current.history.undo()
    })
    expect(deleteRemoteGroups).toHaveBeenCalledWith([added])
    vi.mocked(deleteRemoteGroups).mockClear()
    await act(async () => {
      await result.current.history.redo()
    })
    expect(deleteRemoteGroups).not.toHaveBeenCalled() // a redo of an add removes nothing
  })

  it('N3: a replace never asks for the remote delete of a tour practice group', async () => {
    store.state = { ...store.state, available: [...store.state.available, group('practice', [win([tab('x')])], { tourDemo: true })] }
    const { result } = setup(() => G.useReplaceSavedGroups())
    vi.mocked(deleteRemoteGroups).mockClear()
    await act(async () => {
      await result.current.action.mutateAsync([group('imp', [win([tab('i1')])])])
    })
    expect(deleteRemoteGroups).toHaveBeenCalledWith(['work', 'play'])
  })
})
