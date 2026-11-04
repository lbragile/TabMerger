/**
 * useMergeGroups (the AI banner's "Merge"): one write and one undo step against an in-memory
 * groups store, with the real uiStore and the real useUndoRedo. Remote delete, rule retarget and
 * analytics are asserted through their mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

const store = vi.hoisted(() => ({ state: null as unknown as GroupsState, rev: 1 }))

vi.mock('@/lib/localDb', () => {
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
  const write = (next: GroupsState): GroupsState => {
    store.rev += 1
    store.state = structuredClone({ ...next, rev: store.rev })
    return structuredClone(store.state)
  }
  type UpdateOpts = { afterWrite?: (stored: GroupsState, base: GroupsState) => void }
  return {
    getGroupsState: vi.fn(async () => enqueue(async () => structuredClone(store.state))),
    saveGroupsState: vi.fn((next: GroupsState) =>
      enqueue(async () => {
        write(next)
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
vi.mock('@/hooks/useUrlRules', () => ({
  deleteRulesForGroupIds: vi.fn().mockResolvedValue(undefined),
  retargetRulesToGroup: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import * as G from '@/hooks/useGroups'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { deleteRemoteGroups } from '@/lib/syncEngine'
import { trackEvent } from '@/lib/analytics'
import { retargetRulesToGroup } from '@/hooks/useUrlRules'
import { forgetHistoryCursor } from '@/lib/undoHistory'

const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}`, savedAt: 1 })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, starred: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({ id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows, ...over })

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    rev: 1,
    available: [
      group('now', [win([tab('live')])], { permanent: true }),
      group('a', [win([tab('a1'), tab('a2')], { name: 'A-win' })]),
      group('b', [win([tab('b1')], { name: 'B-win' })]),
      group('c', [win([tab('c1')], { name: 'C-win' }), win([tab('c2')], { name: 'C-win2' })]),
      group('old', [win([tab('o1')])], { archived: true })
    ]
  }
}

const ids = () => store.state.available.map((g) => g.id)
const steps = () => useUIStore.getState().undoStack.length

beforeEach(() => {
  vi.clearAllMocks()
  store.state = seed()
  store.rev = 1
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn().mockResolvedValue(undefined) },
    windows: { getCurrent: vi.fn().mockResolvedValue({ id: 7 }) },
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    storage: { local: { set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } }
  })
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(G.GROUPS_QUERY_KEY, structuredClone(store.state))
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => ({ merge: G.useMergeGroups(), history: useUndoRedo() }), { wrapper }).result
}

const merge = (result: ReturnType<typeof setup>, groupIds: string[]) =>
  act(async () => {
    await result.current.merge.mutateAsync(groupIds)
  })

describe('useMergeGroups', () => {
  it('folds the others into the first group: its name stays, windows follow its own in order', async () => {
    const result = setup()
    await merge(result, ['b', 'a', 'c'])
    expect(ids()).toEqual(['now', 'b', 'old'])
    const target = store.state.available[1]
    expect(target.name).toBe('b')
    expect(target.windows.map((w) => w.name)).toEqual(['B-win', 'A-win', 'C-win', 'C-win2'])
    expect(target.pendingSync).toBe(true)
    expect(target.updatedAt).toBeGreaterThan(1)
    expect(target.info).toBeDefined()
  })

  it('keeps starred windows ahead of unstarred ones', async () => {
    store.state.available[3] = group('c', [win([tab('c1')], { name: 'C-win' }), win([tab('c2')], { name: 'C-star', starred: true })])
    const result = setup()
    await merge(result, ['a', 'c'])
    expect(store.state.available[1].windows.map((w) => w.name)).toEqual(['C-star', 'A-win', 'C-win'])
  })

  it('is one write and one undo step; Undo brings every group back', async () => {
    const result = setup()
    await merge(result, ['a', 'b'])
    expect(steps()).toBe(1)
    await act(async () => {
      await result.current.history.undo()
    })
    expect(store.state.available.map((g) => [g.id, g.windows.length])).toEqual([
      ['now', 1],
      ['a', 1],
      ['b', 1],
      ['c', 2],
      ['old', 1]
    ])
  })

  it('tells Supabase to delete the merged-away groups, retargets their rules and tracks it', async () => {
    const result = setup()
    await merge(result, ['a', 'b', 'c'])
    expect(deleteRemoteGroups).toHaveBeenCalledWith(['b', 'c'])
    expect(retargetRulesToGroup).toHaveBeenCalledWith(['b', 'c'], 'a')
    expect(trackEvent).toHaveBeenCalledWith('groups_merged', { count: 3 })
  })

  it('skips Now Open, archived and missing groups and dedupes ids', async () => {
    const result = setup()
    await merge(result, ['now', 'a', 'a', 'gone', 'old', 'b'])
    expect(ids()).toEqual(['now', 'a', 'c', 'old'])
    expect(deleteRemoteGroups).toHaveBeenCalledWith(['b'])
    expect(trackEvent).toHaveBeenCalledWith('groups_merged', { count: 2 })
  })

  it.each([
    ['one id', ['a']],
    ['the same id twice', ['a', 'a']],
    ['one valid id among skipped ones', ['now', 'old', 'a', 'gone']],
    ['no ids', [] as string[]]
  ])('writes nothing and is no undo step for %s', async (_n, groupIds) => {
    const result = setup()
    const rev = store.rev
    await merge(result, groupIds)
    expect(store.rev).toBe(rev)
    expect(steps()).toBe(0)
    expect(deleteRemoteGroups).not.toHaveBeenCalled()
    expect(retargetRulesToGroup).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('moves a view on a merged-away group to the merged group', async () => {
    useUIStore.setState({ activeGroupIndex: 3 }) // c
    const result = setup()
    await merge(result, ['a', 'c'])
    expect(useUIStore.getState().activeGroupIndex).toBe(1)
  })

  it('keeps the same group in view when the indexes shift', async () => {
    useUIStore.setState({ activeGroupIndex: 3 }) // c
    const result = setup()
    await merge(result, ['a', 'b'])
    expect(ids()).toEqual(['now', 'a', 'c', 'old'])
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
  })

  it('leaves the view alone when it is on the merge target', async () => {
    const result = setup()
    await merge(result, ['a', 'b'])
    expect(useUIStore.getState().activeGroupIndex).toBe(1)
  })

  it('points the saved active group at the target when it was merged away', async () => {
    store.state.active = { id: 'c', index: 3 }
    const result = setup()
    await merge(result, ['a', 'c'])
    expect(store.state.active).toEqual({ id: 'a', index: 1 })
  })
})
