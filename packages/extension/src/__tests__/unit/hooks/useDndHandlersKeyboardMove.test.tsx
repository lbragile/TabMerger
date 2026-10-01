/**
 * useDndHandlersKeyboardMove.test.tsx — the two entry points keyboard MOVE MODE uses on the
 * pointer's handler hook: `commitKeyboardMove` (the same `runGuarded` -> `commitResolved`
 * tail a pointer drop ends in) and `applyGap` (the insertion gap state `onDragMove` drives).
 * Persistence goes through the (mocked) `saveGroupsState`, so a keyboard move is checked to
 * land in IndexedDB exactly like a pointer drop of the same (active, over) pair.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers } from '@/hooks/useDndHandlers'
import { useUIStore } from '@/stores/uiStore'
import { clearDndDragLive } from '@/lib/dndMultiDrag'
import { makeGap } from '@/lib/dndInsertion'
import { saveGroupsState } from '@/lib/localDb'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const tab = (title: string): Tab => ({ id: 0, title, url: `https://example.com/${title}` })
const win = (tabs: Tab[]): ExtWindow => ({ id: 0, tabs, incognito: false, focused: false })
const group = (id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows,
  ...over
})
const seed = (): GroupsState => ({
  active: { id: 'now', index: 0 },
  available: [
    group('now', [], { permanent: true }),
    group('work', [win([tab('a1'), tab('a2'), tab('a3')])]),
    group('play', [win([tab('p1')])])
  ]
})
const titles = (s: GroupsState, id: string) => s.available.find((g) => g.id === id)!.windows.map((w) => w.tabs.map((t) => t.title))

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], seed())
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result }
}
const cached = (qc: QueryClient) => qc.getQueryData<GroupsState>(['groups'])!

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  clearDndDragLive()
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('commitKeyboardMove', () => {
  it('commits a tab reorder: the cache, IndexedDB and the undo stack all see it', async () => {
    const { qc, result } = setup()
    await act(async () => {
      await result.current.commitKeyboardMove({ type: 'tab', id: 'work::w0::t0' }, { type: 'tab', id: 'work::w0::t2', index: 2 })
    })
    expect(titles(cached(qc), 'work')).toEqual([['a2', 'a3', 'a1']])
    expect(vi.mocked(saveGroupsState)).toHaveBeenCalled()
    expect(titles(vi.mocked(saveGroupsState).mock.calls.at(-1)![0] as GroupsState, 'work')).toEqual([['a2', 'a3', 'a1']])
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('a move into another group (the group-list drop) lands at the target and leaves the source group without it', async () => {
    const { qc, result } = setup()
    await act(async () => {
      await result.current.commitKeyboardMove({ type: 'tab', id: 'work::w0::t1' }, { type: 'tab', id: 'play::w0::t0', index: 1 })
    })
    expect(titles(cached(qc), 'play')).toEqual([['p1', 'a2']])
    expect(titles(cached(qc), 'work')).toEqual([['a1', 'a3']])
  })

  it('a selection (selectionIds on the active ref) moves as one block', async () => {
    const { qc, result } = setup()
    await act(async () => {
      await result.current.commitKeyboardMove(
        { type: 'tab', id: 'work::w0::t1', selectionIds: ['work::w0::t0', 'work::w0::t1'] },
        // the slot after the last staying row, as `keyboardMove.buildTargets` addresses it (original index 3)
        { type: 'tab', id: 'work::w0::t2', index: 3 }
      )
    })
    expect(titles(cached(qc), 'work')).toEqual([['a3', 'a1', 'a2']])
  })

  it('"new group" creates a group holding the tab (same as dropping on the sidebar zone)', async () => {
    const { qc, result } = setup()
    await act(async () => {
      await result.current.commitKeyboardMove({ type: 'tab', id: 'work::w0::t0' }, { type: 'new-group', id: 'new-group' })
    })
    expect(cached(qc).available).toHaveLength(4)
    expect(titles(cached(qc), cached(qc).available[3].id)).toEqual([['a1']])
  })

  it('is identical to a pointer drop of the same (active, over): same resulting state', async () => {
    const kb = setup()
    await act(async () => {
      await kb.result.current.commitKeyboardMove({ type: 'tab', id: 'work::w0::t0' }, { type: 'tab', id: 'play::w0::t0', index: 0 })
    })
    const pt = setup()
    act(() => {
      pt.result.current.onDragStart({ active: { id: 'work::w0::t0', data: { current: { type: 'tab' } } }, activatorEvent: new MouseEvent('mousedown') } as unknown as DragStartEvent)
    })
    await act(async () => {
      await pt.result.current.onDragEnd({
        active: { id: 'work::w0::t0', data: { current: undefined } },
        over: { id: 'play::w0::t0', data: { current: { type: 'tab' } } }
      } as unknown as DragEndEvent)
    })
    expect(titles(cached(kb.qc), 'play')).toEqual(titles(cached(pt.qc), 'play'))
    expect(titles(cached(kb.qc), 'work')).toEqual(titles(cached(pt.qc), 'work'))
  })

  it('an invalid pair (a group onto itself) changes nothing and persists nothing', async () => {
    const { qc, result } = setup()
    const before = cached(qc)
    await act(async () => {
      await result.current.commitKeyboardMove({ type: 'group', id: 'work' }, { type: 'group', id: 'work', index: 1 })
    })
    expect(cached(qc)).toBe(before)
    expect(vi.mocked(saveGroupsState)).not.toHaveBeenCalled()
  })

  it('with no cached groups it bails without throwing', async () => {
    const { qc, result } = setup()
    qc.removeQueries({ queryKey: ['groups'] })
    await act(async () => {
      await result.current.commitKeyboardMove({ type: 'tab', id: 'work::w0::t0' }, { type: 'tab', id: 'work::w0::t2', index: 2 })
    })
    expect(vi.mocked(saveGroupsState)).not.toHaveBeenCalled()
  })
})

describe('applyGap', () => {
  it('publishes the gap the rows render, and null clears it', () => {
    const { result } = setup()
    expect(result.current.gap).toBeNull()
    const gap = makeGap(30, 'work::w0', ['work::w0::t1'])
    act(() => result.current.applyGap(gap))
    expect(result.current.gap).toEqual(gap)
    act(() => result.current.applyGap(null))
    expect(result.current.gap).toBeNull()
  })
})
