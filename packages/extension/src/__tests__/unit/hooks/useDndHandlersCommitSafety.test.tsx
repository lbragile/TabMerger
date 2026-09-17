/**
 * useDndHandlersCommitSafety.test.tsx — the drop commit path fails SAFE
 * (sync-conflict-auditor follow-up #16–#19, 2026-09-14).
 *
 *  #16 the rollback's re-read never cancels an in-flight groups fetch (a real joined
 *      `fetchQuery`, like `useGroupsMutation`, must not reject with CancelledError)
 *  #19 a throw anywhere in the commit still clears the live-drag flag (global shortcuts
 *      keep working); a provider unmount mid-drag clears it; the flag is set LAST at pickup
 *  #18 the rollback only restores what is still ours: selection / active group only if
 *      the store still holds the drop's values and no drag is live; the undo entry only
 *      if it is still on top (and the wiped redo stack comes back); failure is announced
 *  #17 a partial multi-move says how many were removed elsewhere
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider, useQuery, isCancelledError } from '@tanstack/react-query'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers, DND_SAVE_FAILED_TEXT } from '@/hooks/useDndHandlers'
import { useKeyboardNav } from '@/hooks/useKeyboardNav'
import { useUIStore } from '@/stores/uiStore'
import { saveGroupsState } from '@/lib/localDb'
import { clearDndDragLive, getDndDragSelection, isDndDragLive } from '@/lib/dndMultiDrag'
import { buildDndModel } from '@/hooks/useDndModel'
import { applyMove } from '@/lib/dndMove'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const save = saveGroupsState as unknown as ReturnType<typeof vi.fn>

const tab = (title: string, over: Partial<Tab> = {}): Tab => ({ id: 0, title, url: `https://example.com/${title}`, ...over })
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
    group('work', [win([tab('a1'), tab('a2')]), win([tab('b1')])]),
    group('play', [win([tab('p1')])]),
    group('misc', [win([tab('m1')])])
  ]
})

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeClient(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

function setup(state = seed()) {
  const { qc, wrapper } = makeClient(state)
  const hook = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result: hook.result, unmount: hook.unmount }
}
type Hook = { current: ReturnType<typeof useDndHandlers> }

function start(result: Hook, id: string, data?: Record<string, unknown>) {
  act(() => {
    result.current.onDragStart({ active: { id, data: { current: data } }, activatorEvent: new MouseEvent('mousedown') } as unknown as DragStartEvent)
  })
}
const endEvent = (id: string, overId: string, overType: string, activeData?: Record<string, unknown>) =>
  ({ active: { id, data: { current: activeData } }, over: { id: overId, data: { current: { type: overType } } } }) as unknown as DragEndEvent

async function end(result: Hook, id: string, overId: string, overType: string, activeData?: Record<string, unknown>) {
  await act(async () => {
    await result.current.onDragEnd(endEvent(id, overId, overType, activeData))
  })
}

const liveRegionText = () => document.getElementById('tm-dnd-live-region')?.textContent ?? ''

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  save.mockResolvedValue(undefined)
  clearDndDragLive()
  document.body.innerHTML = ''
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], selectionMode: false, activeGroupIndex: 1 })
})
afterEach(() => {
  errSpy.mockRestore()
  vi.unstubAllGlobals()
})

describe('#16 the rollback re-read never cancels an in-flight groups fetch', () => {
  /** A mounted groups observer whose refetch-on-mount is held in flight, plus a mutation-style `fetchQuery` joined to it. */
  function joinedFetch() {
    const { qc, wrapper } = makeClient(seed())
    const inFlight = deferred<GroupsState>()
    const hook = renderHook(
      () => {
        useQuery({ queryKey: ['groups'], queryFn: () => inFlight.promise, staleTime: 0 })
        return useDndHandlers()
      },
      { wrapper }
    )
    // exactly what useGroupsMutation / useBulkActions do
    const outcome = qc
      .fetchQuery({ queryKey: ['groups'], queryFn: () => Promise.resolve(seed()) })
      .then(
        () => 'resolved',
        (e: unknown) => (isCancelledError(e) ? 'cancelled' : 'rejected')
      )
    return { qc, result: hook.result, inFlight, outcome }
  }

  it('control: a default invalidateQueries (cancelRefetch:true) DOES reject the joined mutation fetch', async () => {
    const { qc, inFlight, outcome } = joinedFetch()
    await act(async () => {
      void qc.invalidateQueries({ queryKey: ['groups'] })
    })
    inFlight.resolve(seed())
    expect(await outcome).toBe('cancelled')
  })

  it('a drop whose write fails does NOT reject a mutation joined to the in-flight fetch', async () => {
    const { result, inFlight, outcome } = joinedFetch()
    save.mockRejectedValueOnce(new Error('QuotaExceededError'))
    start(result, 'work::w0::t0')
    await end(result, 'work::w0::t0', 'play', 'group')
    inFlight.resolve(seed())
    expect(await outcome).toBe('resolved')
  })
})

describe('#19 a throw or unmount can never leave the live-drag flag stuck', () => {
  it('a throw inside the commit clears the flag and drag state, and arrow shortcuts work afterwards', async () => {
    const { wrapper } = makeClient(seed())
    const { result } = renderHook(
      () => {
        useKeyboardNav({ groupCount: 4 })
        return useDndHandlers()
      },
      { wrapper }
    )
    save.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    start(result, 'work::w0::t0', { selectionIds: ['work::w0::t0', 'work::w1::t0'] })
    expect(isDndDragLive()).toBe(true)
    // while live, the global shortcuts are ignored
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(useUIStore.getState().activeGroupIndex).toBe(1)

    await end(result, 'work::w0::t0', 'play', 'group')

    expect(isDndDragLive()).toBe(false)
    expect(getDndDragSelection()).toBeNull()
    expect(result.current.active).toBeNull()
    // the undo entry pushed before the throw is gone
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
  })

  it('the provider unmounting mid-drag clears the flag and the drag selection', () => {
    const { result, unmount } = setup()
    start(result, 'work::w0::t0', { selectionIds: ['work::w0::t0', 'work::w1::t0'] })
    expect(isDndDragLive()).toBe(true)
    unmount()
    expect(isDndDragLive()).toBe(false)
    expect(getDndDragSelection()).toBeNull()
  })

  it('the flag is set LAST at pickup: a pickup that throws leaves it unset', () => {
    const { result } = setup()
    const broken = {
      active: {
        id: 'work::w0::t0',
        get data(): never {
          throw new Error('bad active data')
        }
      },
      activatorEvent: new MouseEvent('mousedown')
    } as unknown as DragStartEvent
    expect(() => result.current.onDragStart(broken)).toThrow('bad active data')
    expect(isDndDragLive()).toBe(false)
  })

  it('applyMove tolerates a group with missing windows / tabs (cloneGroup guard, same as buildDndModel)', () => {
    const s: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [
        group('now', [], { permanent: true }),
        group('work', [win([tab('a1')]), { ...win([]), tabs: undefined as unknown as Tab[] }]),
        { ...group('bare', []), windows: undefined as unknown as ExtWindow[] }
      ]
    }
    const model = buildDndModel(s)
    const { next } = applyMove(model, s, { type: 'tab', id: 'work::w0::t0' }, { type: 'group', id: 'bare', index: 2 })
    expect(next.available[2].windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['a1']])
  })
})

describe('#18 a failed write only rolls back what is still ours', () => {
  const selection = [
    { type: 'tab' as const, id: 'tab-1-0-0' },
    { type: 'tab' as const, id: 'tab-1-0-1' }
  ]

  /** Start a drop whose write is held; returns the pending handler promise + the write's controls. */
  function heldDrop(result: Hook, id: string, overId: string, overType: string, activeData?: Record<string, unknown>) {
    const write = deferred()
    save.mockReturnValueOnce(write.promise)
    let pending!: Promise<void>
    act(() => {
      pending = result.current.onDragEnd(endEvent(id, overId, overType, activeData))
    })
    const fail = async () => {
      write.reject(new Error('AbortError'))
      await act(async () => {
        await pending
      })
    }
    return { fail }
  }

  it('control: untouched state → selection, active group and undo are all restored, and the failure is announced', async () => {
    useUIStore.setState({ selectionMode: true, selectedItems: selection })
    const { result } = setup()
    start(result, 'work::w0::t0')
    const drop = heldDrop(result, 'work::w0::t0', 'play', 'group')
    expect(useUIStore.getState().selectedItems).not.toEqual(selection)
    await drop.fail()
    expect(useUIStore.getState().selectedItems).toEqual(selection)
    expect(liveRegionText()).toBe(DND_SAVE_FAILED_TEXT)
  })

  it('the user changed the selection while the write was queued → their selection is NOT overwritten', async () => {
    useUIStore.setState({ selectionMode: true, selectedItems: selection })
    const { result } = setup()
    start(result, 'work::w0::t0')
    const drop = heldDrop(result, 'work::w0::t0', 'play', 'group')
    const mine = [{ type: 'tab' as const, id: 'tab-3-0-0' }]
    act(() => useUIStore.setState({ selectedItems: mine }))
    await drop.fail()
    expect(useUIStore.getState().selectedItems).toEqual(mine)
  })

  it('group reorder: restored when untouched; NOT when the user switched groups; NOT while a second drag is live', async () => {
    // untouched → the dragged group's old index comes back
    {
      const { result } = setup()
      start(result, 'work', { type: 'group' })
      const drop = heldDrop(result, 'work', 'misc', 'group', { type: 'group' })
      const moved = useUIStore.getState().activeGroupIndex
      expect(moved).toBe(3)
      await drop.fail()
      expect(useUIStore.getState().activeGroupIndex).toBe(1)
    }
    // the user picked another group meanwhile → left alone
    {
      useUIStore.setState({ activeGroupIndex: 1 })
      const { result } = setup()
      start(result, 'work', { type: 'group' })
      const drop = heldDrop(result, 'work', 'misc', 'group', { type: 'group' })
      act(() => useUIStore.getState().setActiveGroupIndex(2))
      await drop.fail()
      expect(useUIStore.getState().activeGroupIndex).toBe(2)
    }
    // a second drag is live during the rollback → no panel swap
    {
      useUIStore.setState({ activeGroupIndex: 1 })
      const { result } = setup()
      start(result, 'work', { type: 'group' })
      const drop = heldDrop(result, 'work', 'misc', 'group', { type: 'group' })
      start(result, 'play::w0::t0')
      expect(isDndDragLive()).toBe(true)
      await drop.fail()
      expect(useUIStore.getState().activeGroupIndex).toBe(3)
    }
  })

  it('the undo entry is removed and the redo stack the push wiped comes back', async () => {
    const redoSnap = seed()
    useUIStore.setState({ redoStack: [redoSnap] })
    const { result } = setup()
    start(result, 'work::w0::t0')
    const drop = heldDrop(result, 'work::w0::t0', 'play', 'group')
    expect(useUIStore.getState().undoStack).toHaveLength(1)
    expect(useUIStore.getState().redoStack).toHaveLength(0)
    await drop.fail()
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toEqual([redoSnap])
  })

  it('a NEWER undo entry on top is never popped', async () => {
    const { result } = setup()
    start(result, 'work::w0::t0')
    const drop = heldDrop(result, 'work::w0::t0', 'play', 'group')
    const newer = seed()
    act(() => useUIStore.getState().pushUndo(newer))
    await drop.fail()
    expect(useUIStore.getState().undoStack[0]).toBe(newer)
    expect(useUIStore.getState().undoStack).toHaveLength(2)
  })
})

describe('#17 a partial multi-move is announced as partial', () => {
  it('a selected tab deleted elsewhere mid-drag → "Moved 2 of 3 tabs … 1 was removed elsewhere."', async () => {
    const { qc, result } = setup()
    const sel = { selectionIds: ['work::w0::t0', 'work::w0::t1', 'work::w1::t0'] }
    start(result, 'work::w0::t0', sel)
    act(() => {
      const cur = qc.getQueryData<GroupsState>(['groups'])!
      qc.setQueryData(['groups'], {
        ...cur,
        available: cur.available.map((g) => (g.id === 'work' ? { ...g, updatedAt: 50, windows: [g.windows[0]] } : g))
      })
    })
    await end(result, 'work::w0::t0', 'play', 'group', sel)
    const text = result.current.announcements.onDragEnd!({ active: { id: 'work::w0::t0', data: { current: {} } }, over: null } as never)
    expect(text).toMatch(/^Moved 2 of 3 tabs to /)
    expect(text).toMatch(/1 was removed elsewhere\.$/)
  })

  it('a selected tab EDITED elsewhere mid-drag → the whole drop cancels (nothing written)', async () => {
    const { qc, result } = setup()
    const sel = { selectionIds: ['work::w0::t0', 'work::w1::t0'] }
    start(result, 'work::w0::t0', sel)
    act(() => {
      const cur = qc.getQueryData<GroupsState>(['groups'])!
      qc.setQueryData(['groups'], {
        ...cur,
        available: cur.available.map((g) =>
          g.id === 'work' ? { ...g, updatedAt: 50, windows: [g.windows[0], win([tab('b1', { customTitle: 'Renamed' })])] } : g
        )
      })
    })
    await end(result, 'work::w0::t0', 'play', 'group', sel)
    expect(save).not.toHaveBeenCalled()
  })
})
