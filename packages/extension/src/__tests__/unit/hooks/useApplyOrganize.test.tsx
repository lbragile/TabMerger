/**
 * useApplyOrganize (the Organize review modal's "Apply selected"): every selected action in one
 * write and one undo step, against an in-memory groups store with the real uiStore and the real
 * useUndoRedo. Remote delete, URL-rule retarget and analytics are asserted through their mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { OrganizeAction } from '@tabmerger/shared'
import type { Group, GroupsState, Tab, UrlRule, Window as ExtWindow } from '@/lib/types'

const store = vi.hoisted(() => ({ state: null as unknown as GroupsState, rev: 1, rules: [] as unknown[], writes: 0 }))

vi.mock('@/lib/localDb', () => {
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => undefined)
    return run
  }
  const write = (next: GroupsState): GroupsState => {
    store.rev += 1
    store.writes += 1
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
    setSetting: vi.fn(async (key: string, value: unknown) => {
      if (key === 'urlRules') store.rules = value as unknown[]
    }),
    getSetting: vi.fn(async (key: string, fallback: unknown) => (key === 'urlRules' ? store.rules : fallback))
  }
})
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import { useApplyOrganize } from '@/hooks/useApplyOrganize'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { deleteRemoteGroups } from '@/lib/syncEngine'
import { trackEvent } from '@/lib/analytics'
import { setSetting } from '@/lib/localDb'
import { forgetHistoryCursor } from '@/lib/undoHistory'

const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}`, savedAt: 1 })
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, starred: false })
const group = (id: string, over: Partial<Group> = {}): Group => ({ id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 1, windows: [win([tab(id)])], ...over })
const rule = (id: string, groupId: string): UrlRule => ({ id, pattern: `${id}.com/*`, groupId, createdAt: 1 })

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    rev: 1,
    available: [group('now', { permanent: true }), group('a'), group('b'), group('c'), group('d')]
  }
}

const ids = () => store.state.available.map((g) => g.id)
const steps = () => useUIStore.getState().undoStack.length

beforeEach(() => {
  vi.clearAllMocks()
  store.state = seed()
  store.rev = 1
  store.writes = 0
  store.rules = [rule('r1', 'a'), rule('r2', 'c')]
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
  qc.setQueryData(GROUPS_QUERY_KEY, structuredClone(store.state))
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => ({ apply: useApplyOrganize(), history: useUndoRedo() }), { wrapper })
  return { result, qc }
}

const ALL: OrganizeAction[] = [
  { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
  { type: 'rename', groupId: 'b', newName: 'Work' },
  { type: 'delete', groupId: 'c' },
  { type: 'reorder', groupIds: ['d', 'b'] }
]

describe('useApplyOrganize', () => {
  it('applies every action in ONE write and ONE undo step; Undo brings it all back', async () => {
    const { result, qc } = setup()
    let out: { applied: number } | undefined
    await act(async () => {
      out = await result.current.apply.mutateAsync(ALL)
    })
    expect(out).toEqual({ applied: 4 })
    expect(store.writes).toBe(1)
    expect(steps()).toBe(1)
    expect(ids()).toEqual(['now', 'd', 'c', 'b'])
    expect(store.state.available.find((g) => g.id === 'b')).toMatchObject({ name: 'Work', pendingSync: true })
    expect(store.state.available.find((g) => g.id === 'c')).toMatchObject({ archived: true, pendingSync: true })
    // The cache shows the stored result straight away
    expect(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available.map((g) => g.id)).toEqual(['now', 'd', 'c', 'b'])

    await act(async () => {
      await result.current.history.undo()
    })
    expect(ids()).toEqual(['now', 'a', 'b', 'c', 'd'])
    expect(store.state.available.find((g) => g.id === 'c')?.archived).toBeFalsy()
    expect(store.state.available.find((g) => g.id === 'b')?.name).toBe('b')
  })

  it('hard-deletes merged-away groups remotely (never archived ones), retargets their URL rules and tracks it', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.apply.mutateAsync(ALL)
    })
    expect(deleteRemoteGroups).toHaveBeenCalledTimes(1)
    expect(deleteRemoteGroups).toHaveBeenCalledWith(['a'])
    await vi.waitFor(() => expect((store.rules as UrlRule[]).map((r) => r.groupId)).toEqual(['b', 'c']))
    expect(trackEvent).toHaveBeenCalledWith('ai_organize_applied', { count: 4 })
  })

  it('leaves the URL rules alone when nothing merged', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.apply.mutateAsync([{ type: 'delete', groupId: 'a' }])
    })
    expect(deleteRemoteGroups).not.toHaveBeenCalled()
    expect(setSetting).not.toHaveBeenCalledWith('urlRules', expect.anything())
  })

  it('writes nothing and records no step when no action applies (groups gone, Now Open)', async () => {
    const { result } = setup()
    let out: { applied: number } | undefined
    await act(async () => {
      out = await result.current.apply.mutateAsync([
        { type: 'delete', groupId: 'gone' },
        { type: 'delete', groupId: 'now' },
        { type: 'rename', groupId: 'now', newName: 'Mine' }
      ])
    })
    expect(out).toEqual({ applied: 0 })
    expect(store.writes).toBe(0)
    expect(steps()).toBe(0)
    expect(deleteRemoteGroups).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('re-checks ids on the fresh read: a group removed since the review is skipped', async () => {
    const { result } = setup()
    store.state = { ...store.state, available: store.state.available.filter((g) => g.id !== 'a') }
    let out: { applied: number } | undefined
    await act(async () => {
      out = await result.current.apply.mutateAsync([
        { type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' },
        { type: 'rename', groupId: 'c', newName: 'Kept' }
      ])
    })
    expect(out).toEqual({ applied: 1 })
    expect(ids()).toEqual(['now', 'b', 'c', 'd'])
    expect(deleteRemoteGroups).not.toHaveBeenCalled()
  })

  it('keeps the viewed group in view as indexes move', async () => {
    useUIStore.setState({ activeGroupIndex: 4 }) // d
    const { result } = setup()
    await act(async () => {
      await result.current.apply.mutateAsync([{ type: 'merge', sourceGroupId: 'a', targetGroupId: 'b' }])
    })
    expect(useUIStore.getState().activeGroupIndex).toBe(3)
  })

  it('moves a view on a merged-away group to the group it was merged into', async () => {
    useUIStore.setState({ activeGroupIndex: 1 }) // a
    const { result } = setup()
    await act(async () => {
      await result.current.apply.mutateAsync([{ type: 'merge', sourceGroupId: 'a', targetGroupId: 'c' }])
    })
    expect(ids()).toEqual(['now', 'b', 'c', 'd'])
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
  })

  it('moves a view on an archived group to the nearest group above it that stays', async () => {
    useUIStore.setState({ activeGroupIndex: 3 }) // c
    const { result } = setup()
    await act(async () => {
      await result.current.apply.mutateAsync([
        { type: 'delete', groupId: 'c' },
        { type: 'delete', groupId: 'b' }
      ])
    })
    expect(useUIStore.getState().activeGroupIndex).toBe(1) // a
  })

  it('falls back to Now Open when nothing above the archived viewed group stays', async () => {
    useUIStore.setState({ activeGroupIndex: 1 }) // a
    const { result } = setup()
    await act(async () => {
      await result.current.apply.mutateAsync([{ type: 'delete', groupId: 'a' }])
    })
    expect(useUIStore.getState().activeGroupIndex).toBe(0)
  })
})
