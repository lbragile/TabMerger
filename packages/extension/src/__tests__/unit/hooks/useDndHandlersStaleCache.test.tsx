/**
 * useDndHandlersStaleCache.test.tsx — the drop commits against the CURRENT groups
 * cache, not the drag-start snapshot (sync-conflict-auditor finding A2).
 *
 * A realtime update, a poll sync or a Now Open refresh can land while a drag is in
 * progress. Committing `applyMove(snapshot)` would overwrite those updates in the
 * cache and IDB, bump `updatedAt`/`pendingSync` on the stale copies (so last-write-
 * wins pushes them everywhere) and resurrect a group that was deleted mid-drag.
 *
 * Contract:
 *  - untouched groups come from the current cache, verbatim
 *  - the dragged item(s) and the drop target are re-resolved in the current state;
 *    if the source (or target) no longer exists the drop is a clean no-op
 *  - the undo snapshot is the current state
 *  - the IDB write is issued synchronously BEFORE the cache write (no await can
 *    reopen the refetch race between them)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers } from '@/hooks/useDndHandlers'
import { useUIStore } from '@/stores/uiStore'
import { saveGroupsState } from '@/lib/localDb'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const save = saveGroupsState as unknown as ReturnType<typeof vi.fn>

const tab = (title: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title, url: `https://example.com/${title}`, ...over })
const win = (tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false, ...over })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  permanent: false,
  ...over
})

function seed(): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', [win([tab('live', { id: 11 })], { id: 700 })], { permanent: true }),
      group('work', [win([tab('a1'), tab('a2')]), win([tab('b1')])]),
      group('play', [win([tab('p1')])]),
      group('misc', [win([tab('m1')])])
    ]
  }
}

/** Replace group `id` in `s` (new objects for the replaced group only). */
function withGroup(s: GroupsState, id: string, fn: (g: Group) => Group | null): GroupsState {
  const available = s.available.map((g) => (g.id === id ? fn(g) : g)).filter((g): g is Group => g !== null)
  return { ...s, available }
}

const shape = (s: GroupsState | undefined) =>
  Object.fromEntries((s?.available ?? []).map((g) => [g.id, g.windows.map((w) => w.tabs.map((t) => t.title))]))

function setup(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result }
}

type Hook = ReturnType<typeof setup>['result']

function start(result: Hook, id: string, data?: Record<string, unknown>) {
  act(() => {
    result.current.onDragStart({ active: { id, data: { current: data } } } as unknown as DragStartEvent)
  })
}

async function end(result: Hook, id: string, overId: string, activeData?: Record<string, unknown>, overData?: Record<string, unknown>) {
  await act(async () => {
    await result.current.onDragEnd({
      active: { id, data: { current: activeData } },
      over: { id: overId, data: { current: overData } }
    } as unknown as DragEndEvent)
  })
}

const cache = (qc: QueryClient) => qc.getQueryData<GroupsState>(['groups'])
const persisted = () => save.mock.calls[save.mock.calls.length - 1]?.[0] as GroupsState | undefined

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
})

describe('drop commits against the CURRENT cache (updates that landed mid-drag)', () => {
  it('an unrelated remote update that lands mid-drag survives the drop (not overwritten, not re-bumped)', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    act(() => {
      qc.setQueryData(['groups'], withGroup(cache(qc)!, 'misc', (g) => ({ ...g, name: 'misc-remote', updatedAt: 999 })))
    })
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    for (const s of [cache(qc)!, persisted()!]) {
      const misc = s.available.find((g) => g.id === 'misc')!
      expect(misc.name).toBe('misc-remote')
      expect(misc.updatedAt).toBe(999)
      expect(misc.pendingSync).toBeUndefined()
      expect(shape(s)).toMatchObject({ work: [['a2'], ['b1']], play: [['p1'], ['a1']] })
    }
  })

  it('a group deleted mid-drag (remote delete) is NOT resurrected by the drop', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    act(() => {
      qc.setQueryData(['groups'], withGroup(cache(qc)!, 'misc', () => null))
    })
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    expect(cache(qc)!.available.map((g) => g.id)).toEqual(['now', 'work', 'play'])
    expect(persisted()!.available.map((g) => g.id)).toEqual(['now', 'work', 'play'])
  })

  it('a Now Open refresh mid-drag (new live objects) keeps the refreshed Now Open and still commits the saved move', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    const refreshed = win([tab('live', { id: 11 }), tab('live2', { id: 12 })], { id: 700 })
    act(() => {
      qc.setQueryData(['groups'], withGroup(cache(qc)!, 'now', (g) => ({ ...g, windows: [refreshed] })))
    })
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    expect(shape(cache(qc))).toMatchObject({ now: [['live', 'live2']], work: [['a2'], ['b1']], play: [['p1'], ['a1']] })
  })

  it('a tab inserted ABOVE the dragged tab mid-drag: the drop still moves the tab the user picked up', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    act(() => {
      qc.setQueryData(
        ['groups'],
        withGroup(cache(qc)!, 'work', (g) => ({ ...g, updatedAt: 50, windows: [win([tab('new0'), tab('a1'), tab('a2')]), g.windows[1]] }))
      )
    })
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    expect(shape(cache(qc))).toMatchObject({ work: [['new0', 'a2'], ['b1']], play: [['p1'], ['a1']] })
  })

  it('the positional drop target moved mid-drag: the tab still lands BEFORE the same target tab', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    act(() => {
      qc.setQueryData(['groups'], withGroup(cache(qc)!, 'play', (g) => ({ ...g, updatedAt: 50, windows: [win([tab('p0'), tab('p1')])] })))
    })
    // snapshot id play::w0::t0 is p1
    await end(result, 'work::w0::t0', 'play::w0::t0', undefined, { type: 'tab' })

    expect(shape(cache(qc))).toMatchObject({ play: [['p0', 'a1', 'p1']] })
  })

  it('the dragged tab was removed mid-drag: clean no-op — nothing persisted, cache untouched, no undo, drag state cleared', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    const current = withGroup(cache(qc)!, 'work', (g) => ({ ...g, updatedAt: 50, windows: [win([tab('a2')]), g.windows[1]] }))
    act(() => {
      qc.setQueryData(['groups'], current)
    })
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    expect(save).not.toHaveBeenCalled()
    // (value equality: TanStack structural sharing returns a fresh top-level object)
    expect(cache(qc)).toEqual(current)
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(result.current.active).toBeNull()
  })

  it('the drop target group was deleted mid-drag: clean no-op', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    const current = withGroup(cache(qc)!, 'play', () => null)
    act(() => {
      qc.setQueryData(['groups'], current)
    })
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    expect(save).not.toHaveBeenCalled()
    expect(cache(qc)).toEqual(current)
  })

  it('multi-selection: a selected tab removed mid-drag is dropped from the block; the rest still moves', async () => {
    const { qc, result } = setup(seed())
    const sel = { selectionIds: ['work::w0::t0', 'work::w1::t0'] }
    start(result, 'work::w0::t0', sel)
    act(() => {
      qc.setQueryData(['groups'], withGroup(cache(qc)!, 'work', (g) => ({ ...g, updatedAt: 50, windows: [g.windows[0]] })))
    })
    await end(result, 'work::w0::t0', 'play', sel, { type: 'group' })

    expect(shape(cache(qc))).toMatchObject({ work: [['a2']], play: [['p1'], ['a1']] })
  })

  it('multi-selection: the PRIMARY (dragged) tab removed mid-drag → clean no-op', async () => {
    const { qc, result } = setup(seed())
    const sel = { selectionIds: ['work::w0::t0', 'work::w1::t0'] }
    start(result, 'work::w0::t0', sel)
    act(() => {
      qc.setQueryData(['groups'], withGroup(cache(qc)!, 'work', (g) => ({ ...g, updatedAt: 50, windows: [win([tab('a2')]), g.windows[1]] })))
    })
    await end(result, 'work::w0::t0', 'play', sel, { type: 'group' })

    expect(save).not.toHaveBeenCalled()
  })

  it('the undo snapshot is the CURRENT (post-update) state, so undo cannot roll back the remote update', async () => {
    const { qc, result } = setup(seed())
    start(result, 'work::w0::t0')
    const current = withGroup(cache(qc)!, 'misc', (g) => ({ ...g, name: 'misc-remote', updatedAt: 999 }))
    act(() => {
      qc.setQueryData(['groups'], current)
    })
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    expect(useUIStore.getState().undoStack).toEqual([current])
  })
})

describe('a FAILED drop write rolls the UI back to what IDB holds', () => {
  it('persist rejects → the groups query is invalidated (re-read from IDB) and NO chrome side effects run', async () => {
    const create = vi.fn().mockResolvedValue({})
    vi.stubGlobal('chrome', { windows: { create }, tabs: { create: vi.fn(), move: vi.fn() } })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // control: the same move (saved tab → Now Open row) with a successful write DOES open a window
      const ok = setup(seed())
      start(ok.result, 'work::w0::t0')
      await end(ok.result, 'work::w0::t0', 'now', undefined, { type: 'group' })
      expect(create).toHaveBeenCalledTimes(1)
      create.mockClear()

      const { qc, result } = setup(seed())
      const invalidate = vi.spyOn(qc, 'invalidateQueries')
      save.mockRejectedValueOnce(new Error('QuotaExceededError'))
      start(result, 'work::w0::t0')
      await end(result, 'work::w0::t0', 'now', undefined, { type: 'group' })

      // cancelRefetch:false — the default (true) would reject mutations joined to an in-flight fetch (#16)
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups'] }, { cancelRefetch: false })
      expect(create).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('persist rejects → the positional selection remapped to the landing spot is put back', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const selection = [
      { type: 'tab' as const, id: 'tab-1-0-0' },
      { type: 'tab' as const, id: 'tab-1-0-1' }
    ]
    useUIStore.setState({ selectionMode: true, selectedItems: selection })
    try {
      const { result } = setup(seed())
      save.mockRejectedValueOnce(new Error('AbortError'))
      start(result, 'work::w0::t0')
      await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })
      expect(useUIStore.getState().selectedItems).toEqual(selection)
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe('commit ordering: the IDB write is issued before the cache write', () => {
  it('saveGroupsState(next) is called while the cache still holds the pre-drop state, and the cache holds `next` before the write resolves', async () => {
    const { qc, result } = setup(seed())
    const before = cache(qc)
    let cacheAtIssue: GroupsState | undefined
    let cacheBeforeWriteResolved: GroupsState | undefined
    save.mockImplementationOnce(() => {
      cacheAtIssue = cache(qc)
      return Promise.resolve().then(() => {
        cacheBeforeWriteResolved = cache(qc)
      })
    })
    start(result, 'work::w0::t0')
    await end(result, 'work::w0::t0', 'play', undefined, { type: 'group' })

    expect(cacheAtIssue).toBe(before)
    expect(cacheBeforeWriteResolved).toEqual(persisted())
    expect(shape(cacheBeforeWriteResolved)).toMatchObject({ play: [['p1'], ['a1']] })
  })
})
