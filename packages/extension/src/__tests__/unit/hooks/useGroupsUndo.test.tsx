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

// `hold`: while set, every queued write waits for it (an action "still saving")
const store = vi.hoisted(() => ({ state: null as unknown as GroupsState, rev: 1, failNext: false, hold: null as Promise<void> | null }))

vi.mock('@/lib/localDb', () => {
  // Like the real store: writes are applied one at a time in issue order, and `afterWrite` runs
  // inside the write's step, once it is stored
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(async () => {
      if (store.hold) await store.hold
      return task()
    })
    tail = run.catch(() => undefined)
    return run
  }
  const write = (next: GroupsState, expectedRev?: number): GroupsState => {
    if (store.failNext) {
      store.failNext = false
      throw new Error('QuotaExceeded')
    }
    if (expectedRev !== undefined && expectedRev !== store.rev) throw Object.assign(new Error('stale'), { name: 'StaleGroupsError' })
    store.rev += 1
    store.state = structuredClone({ ...next, rev: store.rev })
    return structuredClone(store.state)
  }
  type SaveOpts = { expectedRev?: number; afterWrite?: (stored: GroupsState) => void }
  type UpdateOpts = { afterWrite?: (stored: GroupsState, base: GroupsState) => void }
  return {
    getGroupsState: vi.fn(async () => enqueue(async () => structuredClone(store.state))),
    saveGroupsState: vi.fn((next: GroupsState, opts: SaveOpts = {}) =>
      enqueue(async () => {
        const stored = write(next, opts.expectedRev)
        opts.afterWrite?.(stored)
        return store.rev
      })
    ),
    updateGroupsState: vi.fn((fn: (s: GroupsState) => GroupsState | null, opts: UpdateOpts = {}) =>
      enqueue(async () => {
        const base = structuredClone(store.state)
        const next = fn(base)
        if (!next) return base
        const stored = write(next)
        opts.afterWrite?.(stored, base)
        return stored
      })
    ),
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
import { asOneHistoryStep, forgetHistoryCursor } from '@/lib/undoHistory'
import { updateGroupsState } from '@/lib/localDb'
import { toast } from '@/lib/toast'

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
  store.hold = null
  forgetHistoryCursor() // module state: a previous test's last write is not this test's cursor
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
  ['AI apply', () => G.useApplyAIGroups(), (a: ReturnType<typeof G.useApplyAIGroups>) => a.mutateAsync([{ name: 'AI', color: 'rgba(0,0,0,1)', tabIds: [41] }])],
  ['AI apply into a same-named saved group', () => G.useApplyAIGroups(), (a: ReturnType<typeof G.useApplyAIGroups>) => a.mutateAsync([{ name: ' WORK ', color: 'rgba(0,0,0,1)', tabIds: [41] }])],
  ['AI apply: a new group and an existing one at once', () => G.useApplyAIGroups(), (a: ReturnType<typeof G.useApplyAIGroups>) =>
    a.mutateAsync([{ name: 'AI', color: 'rgba(0,0,0,1)', tabIds: [41] }, { name: 'Play', color: 'rgba(0,0,0,1)', tabIds: [42] }])]
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

  it('a bulk star that flips nothing (already starred) is no step, writes nothing, and keeps the redo history', async () => {
    store.state.available[1].windows[0].starred = true
    useUIStore.setState({ redoStack: [seed()] })
    const revBefore = store.rev
    const { result } = setup(() => useBulkStar())
    await act(async () => {
      await result.current.action.mutateAsync({ items: [{ type: 'window', id: 'window-1-0' }], starred: true })
    })
    expect(steps()).toBe(0)
    expect(store.rev).toBe(revBefore)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('a bulk star of a Now Open window only is no step', async () => {
    useUIStore.setState({ redoStack: [seed()] })
    const { result } = setup(() => useBulkStar())
    await act(async () => {
      await result.current.action.mutateAsync({ items: [{ type: 'window', id: 'window-0-0' }], starred: true })
    })
    expect(store.state.available[0].windows[0].starred).toBe(true) // the write happened
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

/** A promise to hold the write queue with, and the function that lets it go. */
function gate() {
  let open!: () => void
  const held = new Promise<void>((resolve) => {
    open = resolve
  })
  return { held, open }
}

const conflictToasts = () => vi.mocked(toast.info).mock.calls.filter(([, o]) => (o as { id?: string } | undefined)?.id === 'undo-conflict')

describe('ordering (spec §4): Undo, Redo and actions apply one at a time, in click order', () => {
  it('G1: two quick Undo clicks undo two steps, with no "changed elsewhere" message', async () => {
    const before = saved(store.state)
    const { result } = setup(() => ({ rename: G.useUpdateGroupName(), color: G.useUpdateGroupColor() }))
    await act(async () => {
      await result.current.action.rename.mutateAsync({ groupIndex: 1, name: 'Renamed' })
      await result.current.action.color.mutateAsync({ groupIndex: 2, color: 'rgba(9,9,9,1)' })
    })
    expect(steps()).toBe(2)

    // the second click comes before the first one's write has landed
    await act(async () => {
      await Promise.all([result.current.history.undo(), result.current.history.undo()])
    })
    expect(saved(store.state)).toEqual(before)
    expect(steps()).toBe(0)
    expect(useUIStore.getState().redoStack).toHaveLength(2)
    expect(conflictToasts()).toHaveLength(0)
  })

  it('G1: Undo, Redo, Undo, Redo clicked quickly end where the last Redo puts it', async () => {
    const { result } = setup(() => G.useUpdateGroupName())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 1, name: 'Renamed' })
    })
    const after = saved(store.state)
    const { undo, redo } = result.current.history
    await act(async () => {
      await Promise.all([undo(), redo(), undo(), redo()])
    })
    expect(saved(store.state)).toEqual(after)
    expect(steps()).toBe(1)
    expect(useUIStore.getState().redoStack).toHaveLength(0)
    expect(conflictToasts()).toHaveLength(0)
  })

  it('G1: an extra Undo click with nothing left to undo does nothing', async () => {
    const { result } = setup(() => G.useUpdateGroupName())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 1, name: 'Renamed' })
    })
    const revBefore = store.rev
    await act(async () => {
      await Promise.all([result.current.history.undo(), result.current.history.undo()])
    })
    expect(store.rev).toBe(revBefore + 1) // only the first Undo wrote
    expect(conflictToasts()).toHaveLength(0)
  })

  it('G2: an Undo clicked while an action is still saving waits, then undoes THAT action, and its Redo survives', async () => {
    const { result } = setup(() => ({ rename: G.useUpdateGroupName(), color: G.useUpdateGroupColor() }))
    await act(async () => {
      await result.current.action.rename.mutateAsync({ groupIndex: 1, name: 'Renamed' })
    })
    const afterFirst = saved(store.state)

    const writes = gate()
    store.hold = writes.held
    let pending!: Promise<unknown>
    await act(async () => {
      pending = result.current.action.color.mutateAsync({ groupIndex: 2, color: 'rgba(9,9,9,1)' })
      // the action's write is issued (and held) before the Undo click
      await waitFor(() => expect(vi.mocked(updateGroupsState).mock.calls.length).toBe(2))
    })
    await act(async () => {
      const undone = result.current.history.undo()
      store.hold = null
      writes.open()
      await Promise.all([pending, undone])
    })
    // the colour change (the action in flight) is what was undone; the rename stays
    expect(saved(store.state)).toEqual(afterFirst)
    expect(steps()).toBe(1)
    // its Redo survived the action landing: the action's step was recorded before the Undo ran
    expect(useUIStore.getState().redoStack).toHaveLength(1)
    await act(async () => {
      await result.current.history.redo()
    })
    expect(saved(store.state).find((g) => g.id === 'play')?.color).toBe('rgba(9,9,9,1)')
    expect(conflictToasts()).toHaveLength(0)
  })

  it('G3: an Undo clicked before Chrome returned the opened tab still closes it (it waits for the id)', async () => {
    let giveId!: (tab: { id: number }) => void
    chromeStub.tabs.create = vi.fn(() => new Promise((resolve) => { giveId = resolve }))
    const { result } = setup(() => G.useMoveTab())
    await act(async () => {
      await result.current.action.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 0 })
    })
    expect(steps()).toBe(1)
    let undone!: Promise<void>
    await act(async () => {
      undone = result.current.history.undo()
      await new Promise((r) => setTimeout(r, 0))
    })
    // the saved data is already back; the tab waits for its id
    expect(saved(store.state)[0].windows[0].tabs.map((t) => t[0])).toEqual(['a1', 'a2'])
    expect(chromeStub.tabs.remove).not.toHaveBeenCalled()
    await act(async () => {
      giveId({ id: 900 })
      await undone
    })
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([900])
  })

  it('G3: the same for a bulk move into Now Open, and a Redo right after waits for the inverse', async () => {
    // Undo finds the opened tab still open; Redo finds it closed (by that Undo) and reopens it
    chromeStub.tabs.get = vi.fn().mockResolvedValueOnce({ id: 900, url: 'https://example.com/p1', windowId: 7, index: 0 }).mockRejectedValue(new Error('closed'))
    let giveId!: (tab: { id: number }) => void
    chromeStub.tabs.create = vi.fn(() => new Promise((resolve) => { giveId = resolve })).mockImplementationOnce(() => new Promise((resolve) => { giveId = resolve }))
    const { result } = setup(() => useBulkMoveToGroup())
    await act(async () => {
      await result.current.action.mutateAsync({ items: [{ type: 'tab', id: 'tab-2-0-0' }], targetGroupIndex: 0 })
    })
    await act(async () => {
      const undone = result.current.history.undo()
      const redone = result.current.history.redo()
      await new Promise((r) => setTimeout(r, 0))
      chromeStub.tabs.create.mockResolvedValue({ id: 950 }) // (the Redo's reopen)
      giveId({ id: 900 })
      await Promise.all([undone, redone])
    })
    // Undo closed the tab the move opened; the Redo clicked right after waited for that, then reopened it
    expect(chromeStub.tabs.remove).toHaveBeenCalledWith([900])
    expect(chromeStub.tabs.create).toHaveBeenCalledTimes(2)
    expect(chromeStub.tabs.create).toHaveBeenLastCalledWith(expect.objectContaining({ windowId: 7, url: 'https://example.com/p1', active: false }))
    expect(saved(store.state).find((g) => g.id === 'play')?.windows[0].tabs).toEqual([])
  })
})

describe('only a SAVED-data change can refuse an Undo (spec §3, G5)', () => {
  const nowOpenTabs = (s: GroupsState) => s.available[0].windows.flatMap((w) => w.tabs.map((t) => t.id))
  /** What useCurrentTabs does as the user browses: rewrites Now Open only. */
  const mirrorLiveTabs = (tabs: Tab[]) =>
    updateGroupsState((s) => ({ ...s, available: [{ ...s.available[0], windows: [win(tabs, { id: 7 })] }, ...s.available.slice(1)] }))

  it('a Now Open-only write between the action and the Undo does not refuse it, and the current Now Open is kept', async () => {
    const before = saved(store.state)
    const { result } = setup(() => G.useUpdateGroupName())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 1, name: 'Renamed' })
    })
    await act(async () => {
      await mirrorLiveTabs([tab('live3', 43)])
    })
    await act(async () => {
      await result.current.history.undo()
    })
    expect(conflictToasts()).toHaveLength(0)
    expect(saved(store.state)).toEqual(before)
    expect(nowOpenTabs(store.state)).toEqual([43])
  })

  it('a Now Open-only write queued between two quick Undos refuses neither', async () => {
    const before = saved(store.state)
    const { result } = setup(() => ({ rename: G.useUpdateGroupName(), note: G.useUpdateGroupNote() }))
    await act(async () => {
      await result.current.action.rename.mutateAsync({ groupIndex: 1, name: 'Renamed' })
      await result.current.action.note.mutateAsync({ groupIndex: 2, note: 'n' })
    })
    await act(async () => {
      const first = result.current.history.undo()
      const mirror = mirrorLiveTabs([tab('live9', 49)])
      const second = result.current.history.undo()
      await Promise.all([first, mirror, second])
    })
    expect(conflictToasts()).toHaveLength(0)
    expect(saved(store.state)).toEqual(before)
    expect(nowOpenTabs(store.state)).toEqual([49])
  })

  it('a saved-data change that did not go through the history refuses the Undo and keeps the step', async () => {
    const { result } = setup(() => G.useUpdateGroupName())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndex: 1, name: 'Renamed' })
    })
    // e.g. a sync pull applied another device's change, and its history clear has not arrived yet
    await act(async () => {
      await updateGroupsState((s) => ({ ...s, available: s.available.map((g) => (g.id === 'play' ? { ...g, name: 'Remote' } : g)) }))
    })
    await act(async () => {
      await result.current.history.undo()
    })
    expect(conflictToasts()).toHaveLength(1)
    expect(steps()).toBe(1)
    expect(saved(store.state).map((g) => g.name)).toEqual(['Renamed', 'Remote'])
  })

  it('the savedAt migration (a maintenance write of this popup) does not refuse the next Undo', async () => {
    const { result } = setup(() => ({ save: G.useSaveShortcutTabs(), groups: G.useGroups() }))
    await act(async () => {
      // tabs from a shortcut save carry no savedAt
      await result.current.action.save.mutateAsync({ tabs: [{ id: 0, title: 'q', url: 'https://example.com/q' }], groupId: 'play' })
    })
    expect(steps()).toBe(1)
    // the next read migrates them (a write of its own)
    await act(async () => {
      await result.current.action.groups.refetch()
    })
    expect(store.state.available.find((g) => g.id === 'play')?.windows.at(-1)?.tabs[0].savedAt).toBeTypeOf('number')
    await act(async () => {
      await result.current.history.undo()
    })
    expect(conflictToasts()).toHaveLength(0)
    expect(steps()).toBe(0)
  })
})

describe('multi-mutation actions are ONE step (G4)', () => {
  it('"Archive all" stale groups is one step; one Undo brings every group back', async () => {
    const { result } = setup(() => G.useArchiveGroups())
    await act(async () => {
      await result.current.action.mutateAsync(['work', 'play'])
    })
    expect(saved(store.state).map((g) => g.archived)).toEqual([true, true])
    expect(steps()).toBe(1)
    await act(async () => {
      await result.current.history.undo()
    })
    expect(saved(store.state).map((g) => g.archived)).toEqual([false, false])
  })

  it('"Archive all": the view leaves an archived group for the nearest one above it that stays', async () => {
    store.state = { ...store.state, available: [...store.state.available, group('keep', [win([tab('k')])])] }
    useUIStore.setState({ activeGroupIndex: 2 })
    const { result } = setup(() => G.useArchiveGroups())
    await act(async () => {
      await result.current.action.mutateAsync(['play'])
    })
    expect(useUIStore.getState().activeGroupIndex).toBe(1)
    useUIStore.setState({ activeGroupIndex: 3 })
    await act(async () => {
      await result.current.action.mutateAsync(['work', 'keep'])
    })
    expect(useUIStore.getState().activeGroupIndex).toBe(0)
  })

  it('"Archive all" of groups that are gone or archived already writes nothing and is no step', async () => {
    const { result } = setup(() => G.useArchiveGroups())
    const rev = store.rev
    await act(async () => {
      await result.current.action.mutateAsync(['gone'])
    })
    expect(store.rev).toBe(rev)
    expect(steps()).toBe(0)
  })

  it('"Remove all" stale tabs across several groups is one step', async () => {
    const before = saved(store.state)
    const { result } = setup(() => G.useRemoveStaleTabs())
    await act(async () => {
      await result.current.action.mutateAsync({ groupIndexes: [1, 2, 9], staleThresholdMs: 1 })
    })
    expect(saved(store.state).map((g) => g.windows.flatMap((w) => w.tabs))).toEqual([[], []])
    expect(steps()).toBe(1)
    await act(async () => {
      await result.current.history.undo()
    })
    expect(saved(store.state)).toEqual(before)
  })

  it('"Create new group" + the move into it (asOneHistoryStep) is one step; one Undo removes the group and puts the tab back', async () => {
    const before = saved(store.state)
    const { result } = setup(() => ({ add: G.useAddGroup(), move: G.useMoveTab() }))
    await act(async () => {
      await asOneHistoryStep(async () => {
        await result.current.action.add.mutateAsync({ name: 'Fresh' })
        await result.current.action.move.mutateAsync({ fromGroupIndex: 1, fromWindowIndex: 0, fromTabIndex: 0, toGroupIndex: 3 })
      })
    })
    expect(saved(store.state).find((g) => g.name === 'Fresh')?.windows[0].tabs.map((t) => t[0])).toEqual(['a1'])
    expect(steps()).toBe(1)
    await act(async () => {
      await result.current.history.undo()
    })
    expect(saved(store.state)).toEqual(before)
    await act(async () => {
      await result.current.history.redo()
    })
    expect(saved(store.state).find((g) => g.name === 'Fresh')?.windows[0].tabs.map((t) => t[0])).toEqual(['a1'])
  })

  it('a step made after asOneHistoryStep ended is a new step; a nested call joins the outer one', async () => {
    const { result } = setup(() => ({ add: G.useAddGroup(), rename: G.useUpdateGroupName() }))
    await act(async () => {
      await asOneHistoryStep(() => asOneHistoryStep(() => result.current.action.add.mutateAsync({ name: 'Fresh' })))
      await result.current.action.rename.mutateAsync({ groupIndex: 1, name: 'Renamed' })
    })
    expect(steps()).toBe(2)
  })

  it('cancelling the name of a group just added removes it AND its step: nothing is left to undo', async () => {
    const { result } = setup(() => ({ add: G.useAddGroup(), cancel: G.useDeleteGroup({ cancelsAdd: true }) }))
    await act(async () => {
      await result.current.action.add.mutateAsync({})
    })
    expect(steps()).toBe(1)
    await act(async () => {
      await result.current.action.cancel.mutateAsync(3)
    })
    expect(saved(store.state).map((g) => g.id)).toEqual(['work', 'play'])
    expect(steps()).toBe(0)
  })

  it('a cancelsAdd delete whose previous step is something else is an ordinary step', async () => {
    const { result } = setup(() => ({ rename: G.useUpdateGroupName(), cancel: G.useDeleteGroup({ cancelsAdd: true }) }))
    await act(async () => {
      await result.current.action.rename.mutateAsync({ groupIndex: 1, name: 'Renamed' })
      await result.current.action.cancel.mutateAsync(2)
    })
    expect(steps()).toBe(2)
    await act(async () => {
      await result.current.history.undo()
    })
    expect(saved(store.state).map((g) => g.id)).toEqual(['work', 'play'])
  })
})
