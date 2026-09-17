/**
 * useDndHandlersMulti.test.tsx — multi-item drag in the commit hook.
 *
 *  - dragging a SELECTED item drags the whole selection (one undo entry)
 *  - after the drop the positional selection is REMAPPED to where the items landed,
 *    in the SAME synchronous commit as the cache write
 *  - dragging an UNSELECTED item clears the selection in the NEXT FRAME (never inside
 *    the dragstart dispatch, spec C4) and commits a single-item move
 *  - groups stay single-drag; a group reorder remaps selected groups by id
 *  - the sensor-agnostic registry is set at pickup and cleared on end / cancel
 *  - a contiguous selection released in its own slot commits nothing
 *  - chrome side effects: tabs.create active:false, multi tabs.move takes an id array
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers, runSideEffects, remapSelectionAfterDrop } from '@/hooks/useDndHandlers'
import { buildDndModel } from '@/hooks/useDndModel'
import { useUIStore, type SelectedItem } from '@/stores/uiStore'
import { saveGroupsState } from '@/lib/localDb'
import { getDndDragCount, getDndDragSelection } from '@/lib/dndMultiDrag'
import type { DndInsertion } from '@/lib/dndInsertion'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const save = saveGroupsState as unknown as ReturnType<typeof vi.fn>

const tab = (t: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title: t, url: `https://e.x/${t}`, ...over })
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
      group('now', [win([tab('live1', { id: 11 })], { id: 700 })], { permanent: true }),
      group('work', [win([tab('a1'), tab('a2'), tab('a3')]), win([tab('b1'), tab('b2')])]),
      group('play', [win([tab('p1'), tab('p2')])]),
      group('misc', [win([tab('m1')])])
    ]
  }
}

const T = (gi: number, wi: number, ti: number): SelectedItem => ({ type: 'tab', id: `tab-${gi}-${wi}-${ti}` })

function setup(state = seed()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result }
}
type Hook = ReturnType<typeof setup>['result']

const startEvt = (id: string, data?: Record<string, unknown>) =>
  ({ active: { id, data: { current: data } } }) as unknown as DragStartEvent
const endEvt = (id: string, overId: string, overData?: Record<string, unknown>, extra: Partial<DragEndEvent> = {}) =>
  ({ active: { id, data: { current: undefined } }, over: { id: overId, data: { current: overData } }, ...extra }) as unknown as DragEndEvent

const shape = (s: GroupsState | undefined) =>
  Object.fromEntries((s?.available ?? []).map((g) => [g.id, g.windows.map((w) => w.tabs.map((t) => t.title))]))

let frames: FrameRequestCallback[] = []
beforeEach(() => {
  vi.clearAllMocks()
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, selectionAnchor: null, activeGroupIndex: 1 })
})
afterEach(() => {
  vi.unstubAllGlobals()
})
const flushFrames = () =>
  act(() => {
    frames.splice(0).forEach((cb) => cb(0))
  })

function start(result: Hook, id: string, data?: Record<string, unknown>) {
  act(() => {
    result.current.onDragStart(startEvt(id, data))
  })
}

describe('multi-drag: the selection moves as one block and stays selected at its new position', () => {
  it('selection a1+b1+b2 dropped before p2: one contiguous block, ONE undo entry, and the selection is remapped IN THE SAME synchronous commit as the cache write', async () => {
    useUIStore.setState({ selectionMode: true, selectedItems: [T(1, 0, 0), T(1, 1, 0), T(1, 1, 1)] })
    const { qc, result } = setup()
    start(result, 'work::w1::t0')
    expect(result.current.active?.selectionIds).toEqual(['work::w0::t0', 'work::w1::t0', 'work::w1::t1'])

    let release!: () => void
    save.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.onDragEnd(endEvt('work::w1::t0', 'play::w0::t1', { type: 'tab' })) as Promise<void>
    })
    // before the IDB write resolves: cache AND selection already reflect the drop
    expect(shape(qc.getQueryData<GroupsState>(['groups']))).toMatchObject({ work: [['a2', 'a3']], play: [['p1', 'a1', 'b1', 'b2', 'p2']] })
    expect(useUIStore.getState().selectedItems).toEqual([T(2, 0, 1), T(2, 0, 2), T(2, 0, 3)])
    expect(useUIStore.getState().selectionMode).toBe(true)
    await act(async () => {
      release()
      await pending
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('a multi-drag dropped on the Now Open row opens ONE unfocused window and clears the selection (the items became real tabs)', async () => {
    const chromeStub = { windows: { create: vi.fn().mockResolvedValue({}) }, tabs: { create: vi.fn(), move: vi.fn(), remove: vi.fn() } }
    vi.stubGlobal('chrome', chromeStub)
    useUIStore.setState({ selectionMode: true, selectedItems: [T(1, 0, 0), T(1, 0, 1)] })
    const { result } = setup()
    start(result, 'work::w0::t0')
    await act(async () => {
      await result.current.onDragEnd(endEvt('work::w0::t0', 'now', { type: 'group' }))
    })
    expect(chromeStub.windows.create).toHaveBeenCalledWith({ url: ['https://e.x/a1', 'https://e.x/a2'], focused: false })
    expect(chromeStub.tabs.remove).not.toHaveBeenCalled()
    expect(useUIStore.getState().selectedItems).toEqual([])
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })

  it('dragging an UNSELECTED tab while a selection exists: selection untouched during dragstart, cleared in the NEXT frame; a single-item move commits', async () => {
    const selection = [T(1, 0, 0), T(1, 0, 1)]
    useUIStore.setState({ selectionMode: true, selectedItems: selection })
    const { qc, result } = setup()
    start(result, 'play::w0::t0')
    expect(result.current.active?.selectionIds).toBeUndefined()
    expect(getDndDragCount()).toBe(1)
    expect(useUIStore.getState().selectedItems).toEqual(selection) // C4: nothing synchronous
    flushFrames()
    expect(useUIStore.getState().selectedItems).toEqual([])

    await act(async () => {
      await result.current.onDragEnd(endEvt('play::w0::t0', 'misc', { type: 'group' }))
    })
    expect(shape(qc.getQueryData<GroupsState>(['groups']))).toMatchObject({ play: [['p2']], misc: [['m1'], ['p1']], work: [['a1', 'a2', 'a3'], ['b1', 'b2']] })
  })

  it('the pickup registry: set synchronously in onDragStart (ghost +N / collapse), cleared on cancel and on drop', async () => {
    useUIStore.setState({ selectedItems: [T(1, 0, 0), T(1, 1, 1), T(2, 0, 0)] })
    const { result } = setup()
    start(result, 'work::w0::t0')
    expect(getDndDragCount()).toBe(3)
    expect([...getDndDragSelection()!]).toEqual(['work::w0::t0', 'work::w1::t1', 'play::w0::t0'])
    act(() => {
      result.current.onDragCancel()
    })
    expect(getDndDragCount()).toBe(1)

    start(result, 'work::w0::t0')
    await act(async () => {
      await result.current.onDragEnd(endEvt('work::w0::t0', 'misc', { type: 'group' }))
    })
    expect(getDndDragSelection()).toBeNull()
  })

  it('onSourceCollapse: the other selected rows are NOT shifted by the initial gap (they collapse too)', () => {
    useUIStore.setState({ selectedItems: [T(1, 0, 0), T(1, 0, 2)] })
    const { result } = setup()
    const items = ['work::w0::t0', 'work::w0::t1', 'work::w0::t2']
    start(result, 'work::w0::t0', { type: 'tab', windowId: 'work::w0', sortable: { index: 0, items } })
    act(() => {
      result.current.onSourceCollapse(24)
    })
    expect([...result.current.gap!.shiftIds]).toEqual(['work::w0::t1'])
  })

  it('a CONTIGUOUS selection released in its own slot commits nothing (no write, no undo, no updatedAt bump)', async () => {
    useUIStore.setState({ selectedItems: [T(1, 0, 0), T(1, 0, 1)] })
    const { qc, result } = setup()
    const items = ['work::w0::t0', 'work::w0::t1', 'work::w0::t2']
    start(result, 'work::w0::t0', { type: 'tab', windowId: 'work::w0', sortable: { index: 0, items } })
    act(() => {
      result.current.onSourceCollapse(24)
    })
    const insertion: DndInsertion = {
      type: 'tab',
      containerKey: 'work::w0',
      index: 0,
      sameContainer: true,
      shiftIds: ['work::w0::t2'],
      commitOverId: 'work::w0::t2'
    }
    const before = qc.getQueryData<GroupsState>(['groups'])
    await act(async () => {
      await result.current.onDragEnd(
        endEvt('work::w0::t0', 'work::w0::t2', { type: 'tab' }, {
          collisions: [{ id: 'work::w0::t2', data: { tmInsertion: insertion } }]
        } as Partial<DragEndEvent>)
      )
    })
    expect(save).not.toHaveBeenCalled()
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(qc.getQueryData<GroupsState>(['groups'])).toBe(before)
  })
})

describe('groups stay single-drag', () => {
  it('a selected group is never promoted to a multi-drag; the reorder remaps the selected groups by id', async () => {
    useUIStore.setState({ selectionMode: true, selectedItems: [{ type: 'group', id: 'group-1' }, { type: 'group', id: 'group-3' }] })
    const { result } = setup()
    const data = { type: 'group', groupId: 'work', index: 1 }
    start(result, 'work', data)
    expect(result.current.active?.selectionIds).toBeUndefined()
    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'work', data: { current: data } },
        over: { id: 'misc', data: { current: { type: 'group', groupId: 'misc', index: 3 } } }
      } as unknown as DragEndEvent)
    })
    // now, play, misc, work
    expect(useUIStore.getState().selectedItems).toEqual([{ type: 'group', id: 'group-3' }, { type: 'group', id: 'group-2' }])
  })
})

describe('remapSelectionAfterDrop (pure branches)', () => {
  const s = seed()
  const m = buildDndModel(s)
  it('no selection / unselected primary / mixed group selection → null (leave it)', () => {
    expect(remapSelectionAfterDrop(m, { type: 'tab', id: 'work::w0::t0' }, [], s, undefined)).toBeNull()
    expect(remapSelectionAfterDrop(m, { type: 'tab', id: 'work::w0::t0' }, [T(1, 1, 0)], s, undefined)).toBeNull()
    expect(remapSelectionAfterDrop(m, { type: 'group', id: 'work' }, [T(1, 1, 0)], s, undefined)).toBeNull()
  })
  it('windows remap to landed window positions; nothing landed → []', () => {
    const sel: SelectedItem[] = [{ type: 'window', id: 'window-1-0' }]
    expect(
      remapSelectionAfterDrop(m, { type: 'window', id: 'work::w0' }, sel, s, { type: 'window', positions: [{ groupIndex: 2, windowIndex: 1 }] })
    ).toEqual([{ type: 'window', id: 'window-2-1' }])
    expect(remapSelectionAfterDrop(m, { type: 'window', id: 'work::w0' }, sel, s, undefined)).toEqual([])
  })
})

describe('runSideEffects', () => {
  it('tabs.create always opens in the BACKGROUND (active:false); tabs.move accepts a contiguous id array', async () => {
    const c = { windows: { create: vi.fn() }, tabs: { create: vi.fn().mockResolvedValue({}), move: vi.fn().mockResolvedValue({}) } }
    vi.stubGlobal('chrome', c)
    await runSideEffects([
      { type: 'tabs.create', windowId: 7, url: 'https://x', index: 2, active: false },
      { type: 'tabs.move', tabId: [3, 4], windowId: 7, index: 0 },
      { type: 'tabs.move', tabId: 5, windowId: 7, index: 1 }
    ])
    expect(c.tabs.create).toHaveBeenCalledWith({ windowId: 7, url: 'https://x', index: 2, active: false })
    expect(c.tabs.move).toHaveBeenNthCalledWith(1, [3, 4], { windowId: 7, index: 0 })
    expect(c.tabs.move).toHaveBeenNthCalledWith(2, 5, { windowId: 7, index: 1 })
  })

  it('a failing chrome call never throws out of the drop (best effort)', async () => {
    vi.stubGlobal('chrome', { tabs: { create: vi.fn().mockRejectedValue(new Error('gone')) } })
    await expect(runSideEffects([{ type: 'tabs.create', windowId: 1, url: 'u', active: false }])).resolves.toBeUndefined()
  })
})
