/**
 * useDndHandlersUnified.test.tsx — RED PHASE (TDD)
 *
 * Two NOT-yet-implemented behaviours of the unified commit hook
 * (`@/hooks/useDndHandlers`):
 *
 *   Item 6 — Hover-to-spring-open: while a window/tab drag is live and the pointer
 *            hovers a non-active, non-permanent group row for ~600ms, the handler
 *            must call `setActiveGroupIndex(groupIndex)` exactly once. `onDragOver`
 *            today only sets the reflow `overrideState` — it never opens a group.
 *
 *   Item 7 — Multi-item drag sourced from `uiStore.selectedItems`: those entries use
 *            LEGACY ids (`tab-{gi}-{wi}-{ti}` etc). If the dragged model id maps to a
 *            selected item, `active.selectionIds` must carry the full set of MODEL
 *            ids. `resolveActive` currently only copies `data.current.selectionIds`
 *            straight off the drag payload and ignores the store entirely.
 *
 * The hook exists — failures here are ASSERTIONS about missing behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragStartEvent, DragOverEvent } from '@dnd-kit/core'
import { useDndHandlers, runSideEffects } from '@/hooks/useDndHandlers'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

function tab(title: string): Tab {
  return { id: 0, title, url: `https://example.com/${title}` }
}
function win(tabs: Tab[]): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false }
}
function group(id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group {
  return { id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows, permanent: false, ...over }
}
function makeState(available: Group[]): GroupsState {
  return { active: { id: available[0].id, index: 0 }, available }
}

function setup(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useDndHandlers(), { wrapper })
  return { qc, result }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ undoStack: [], redoStack: [], selectedItems: [], activeGroupIndex: 0 })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item 6 — hover-to-spring-open
// ─────────────────────────────────────────────────────────────────────────────

describe('spring-open a hovered group row during a drag (item 6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function threeGroups() {
    return makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1')])]),
      group('saved-b', [win([tab('b1')])])
    ])
  }

  it('opens the hovered non-active group after ~600ms of a window drag — exactly once', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })
    const { result } = setup(threeGroups())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0' },
        over: { id: 'saved-b', data: { current: { type: 'group' } } }
      } as unknown as DragOverEvent)
    })

    // nothing before the dwell threshold
    act(() => {
      vi.advanceTimersByTime(599)
    })
    expect(setActiveGroupIndex).not.toHaveBeenCalled()

    // fires once after it
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(setActiveGroupIndex).toHaveBeenCalledTimes(1)
    expect(setActiveGroupIndex).toHaveBeenCalledWith(2) // saved-b render index
  })

  it('does NOT spring-open the permanent "Now Open" row', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })
    const { result } = setup(threeGroups())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0::t0' },
        over: { id: 'now-open', data: { current: { type: 'group' } } }
      } as unknown as DragOverEvent)
    })
    act(() => {
      vi.advanceTimersByTime(1200)
    })

    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })

  it('cancels the pending spring-open when the pointer leaves the row before 600ms', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })
    const { result } = setup(threeGroups())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0' },
        over: { id: 'saved-b', data: { current: { type: 'group' } } }
      } as unknown as DragOverEvent)
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // pointer leaves every droppable — onDragOver fires with no `over`
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0' },
        over: null
      } as unknown as DragOverEvent)
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })

  it('cancels the pending spring-open when the drag ends before 600ms', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })
    const { result } = setup(threeGroups())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0' },
        over: { id: 'saved-b', data: { current: { type: 'group' } } }
      } as unknown as DragOverEvent)
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    act(() => {
      result.current.onDragCancel()
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })

  it('re-arms for a SECOND hovered group row and fires with that row\'s index', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 0 })
    const { result } = setup(threeGroups())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0' } } as unknown as DragStartEvent)
    })
    // hover saved-a (index 1) first
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0' },
        over: { id: 'saved-a', data: { current: { type: 'group' } } }
      } as unknown as DragOverEvent)
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    // move to saved-b (index 2) before the first timer fires — re-arm
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0' },
        over: { id: 'saved-b', data: { current: { type: 'group' } } }
      } as unknown as DragOverEvent)
    })
    act(() => {
      vi.advanceTimersByTime(650)
    })
    expect(setActiveGroupIndex).toHaveBeenCalledTimes(1)
    expect(setActiveGroupIndex).toHaveBeenCalledWith(2)
  })

  it('does NOT arm the spring-open timer for a group-type drag', () => {
    const setActiveGroupIndex = vi.fn()
    // The dragged group is already active, so pickup activation (tested separately
    // below) schedules nothing and this isolates the spring-open timer.
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })
    const { result } = setup(threeGroups())

    act(() => {
      result.current.onDragStart({
        active: { id: 'saved-a', data: { current: { type: 'group' } } }
      } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a', data: { current: { type: 'group' } } },
        over: { id: 'saved-b', data: { current: { type: 'group' } } }
      } as unknown as DragOverEvent)
    })
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item 7 — multi-item drag sourced from uiStore.selectedItems (legacy ids)
// ─────────────────────────────────────────────────────────────────────────────

describe('multi-select drag promoted from uiStore.selectedItems (item 7)', () => {
  function savedGroupWithThreeTabs() {
    return makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('t1'), tab('t2'), tab('t3')])])
    ])
  }

  it('maps LEGACY selected ids to MODEL ids and attaches them to the active drag', () => {
    useUIStore.setState({
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-0' },
        { type: 'tab', id: 'tab-1-0-1' }
      ]
    })
    const { result } = setup(savedGroupWithThreeTabs())

    act(() => {
      // no selectionIds on the payload — must be sourced from the store
      result.current.onDragStart({ active: { id: 'saved-a::w0::t0' } } as unknown as DragStartEvent)
    })

    expect(result.current.active?.selectionIds).toEqual(['saved-a::w0::t0', 'saved-a::w0::t1'])
  })

  it('does not gate the promotion on selectionMode being on', () => {
    useUIStore.setState({
      selectionMode: false,
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-1' },
        { type: 'tab', id: 'tab-1-0-2' }
      ]
    })
    const { result } = setup(savedGroupWithThreeTabs())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0::t1' } } as unknown as DragStartEvent)
    })

    expect(result.current.active?.selectionIds).toEqual(['saved-a::w0::t1', 'saved-a::w0::t2'])
  })

  it('leaves selectionIds unset when the dragged row is not part of the store selection', () => {
    useUIStore.setState({
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-1' },
        { type: 'tab', id: 'tab-1-0-2' }
      ]
    })
    const { result } = setup(savedGroupWithThreeTabs())

    act(() => {
      // dragging t0 — NOT one of the selected rows → single-item drag
      result.current.onDragStart({ active: { id: 'saved-a::w0::t0' } } as unknown as DragStartEvent)
    })

    expect(result.current.active?.selectionIds).toBeUndefined()
  })

  it('does NOT promote when the store selection spans two item types', () => {
    useUIStore.setState({
      selectedItems: [
        { type: 'tab', id: 'tab-1-0-0' },
        { type: 'window', id: 'window-1-0' }
      ]
    })
    const { result } = setup(savedGroupWithThreeTabs())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0::t0' } } as unknown as DragStartEvent)
    })

    expect(result.current.active?.selectionIds).toBeUndefined()
  })

  it('onDragStart with no groups cache records a bare active item (no crash)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useDndHandlers(), { wrapper })

    act(() => {
      result.current.onDragStart({ active: { id: 'whatever::w0::t0' } } as unknown as DragStartEvent)
    })

    expect(result.current.active).toMatchObject({ id: 'whatever::w0::t0', type: 'tab', groupIndex: -1 })
  })

  it('onDragOver with no `over` target clears any reflow override', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 0 })
    const { result } = setup(savedGroupWithThreeTabs())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0::t0' },
        over: null
      } as unknown as DragOverEvent)
    })

    expect(result.current.overrideState).toBeNull()
  })

  it('is a no-op on drag end when the query cache has no groups state', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useDndHandlers(), { wrapper })
    const { saveGroupsState } = await import('@/lib/localDb')

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0::t0' },
        over: { id: 'saved-a::w0::t1' }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// `onDragOver` must NOT mutate the rendered tree mid-drag.
//
// The shipped sensor (`Html5DragSensor`) drives a NATIVE HTML5 drag. Re-rendering
// / reordering the dragged row's DOM subtree mid-drag makes Chrome abort the
// native drag (`dragend`, no `drop`). So `onDragOver` no longer produces a live
// `overrideState` reflow — it only tracks the last real `over` for the
// commit-on-drop path. These assert:
//   1. `overrideState` stays `null` through any sequence of `onDragOver`s.
//   2. a preview-only / non-model `over` id is ignored without throwing.
//   3. `onDragEnd` still commits by falling back to the last real `over`.
// ─────────────────────────────────────────────────────────────────────────────

describe('onDragOver does not reflow the tree mid-drag', () => {
  function twoWindowGroup() {
    return makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1'), tab('a2')]), win([tab('b1')])])
    ])
  }

  it('never produces a live `overrideState` preview, even over a real target', () => {
    const { result } = setup(twoWindowGroup())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w1::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w1::t0' },
        over: { id: 'saved-a::w0::t0', data: { current: { type: 'tab' } } }
      } as unknown as DragOverEvent)
    })
    expect(result.current.overrideState).toBeNull()

    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w1::t0' },
        over: { id: 'saved-a::w0', data: { current: { type: 'window' } } }
      } as unknown as DragOverEvent)
    })
    expect(result.current.overrideState).toBeNull()
  })

  it('ignores an `over` id absent from the pre-drag model without throwing', () => {
    const { result } = setup(twoWindowGroup())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w1::t0' } } as unknown as DragStartEvent)
    })
    expect(() => {
      act(() => {
        // `saved-a::w0::t2` doesn't exist in the pre-drag model (w0 has 2 tabs)
        result.current.onDragOver({
          active: { id: 'saved-a::w1::t0' },
          over: { id: 'saved-a::w0::t2', data: { current: { type: 'tab' } } }
        } as unknown as DragOverEvent)
      })
    }).not.toThrow()
    expect(result.current.overrideState).toBeNull()
  })

  it('onDragEnd commits via the last real `over` when the raw drop target is preview-only', async () => {
    const { result } = setup(twoWindowGroup())
    const { saveGroupsState } = await import('@/lib/localDb')

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w1::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w1::t0' },
        over: { id: 'saved-a::w0::t0', data: { current: { type: 'tab' } } }
      } as unknown as DragOverEvent)
    })

    let committed: GroupsState | undefined
    ;(saveGroupsState as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (s: GroupsState) => {
        committed = s
        return Promise.resolve()
      }
    )

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w1::t0' },
        over: { id: 'saved-a::w0::t9' } // preview-only → falls back to saved-a::w0::t0
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    expect(saveGroupsState).toHaveBeenCalledTimes(1)
    // b1 landed in window 0; window 1 was emptied by the move and is KEPT (user rule,
    // 2026-09-18) as an empty window card.
    const w0Titles = committed!.available[1].windows[0].tabs.map((t) => t.title)
    expect(w0Titles).toContain('b1')
    expect(committed!.available[1].windows).toHaveLength(2)
    expect(committed!.available[1].windows[1].tabs).toEqual([])
  })

  it('onDragEnd is a no-op when the drop target is preview-only and there is no real fallback', async () => {
    const { result } = setup(twoWindowGroup())
    const { saveGroupsState } = await import('@/lib/localDb')

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w1::t0' } } as unknown as DragStartEvent)
    })

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w1::t0' },
        over: { id: 'saved-a::w0::t9' }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// item 3 — the "new window" drop zone (id `${groupId}::new-window`).
// item 5 — the reordered state is written to the query cache SYNCHRONOUSLY on
//          drop (before the awaited IDB write) so it paints in the same frame.
// ─────────────────────────────────────────────────────────────────────────────
describe('new-window drop zone + synchronous commit', () => {
  function twoWinGroup() {
    return makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1'), tab('a2')]), win([tab('b1')])])
    ])
  }

  it('dropping a tab on `${groupId}::new-window` creates a new window and commits it to the cache immediately', async () => {
    const { qc, result } = setup(twoWinGroup())
    const { saveGroupsState } = await import('@/lib/localDb')

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0::t0' },
        over: { id: 'saved-a::new-window', data: { current: { type: 'new-window', groupId: 'saved-a', groupIndex: 1 } } }
      } as unknown as DragOverEvent)
    })

    let cacheAtCommit: GroupsState | undefined
    ;(saveGroupsState as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      // the write is ISSUED before the cache write (so no await can reopen the refetch
      // race), but by the time the async IDB write runs, the cache is ALREADY the new state
      Promise.resolve().then(() => {
        cacheAtCommit = qc.getQueryData<GroupsState>(['groups'])
      })
    )

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0::t0' },
        over: { id: 'saved-a::new-window', data: { current: { type: 'new-window', groupId: 'saved-a', groupIndex: 1 } } }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    const g = qc.getQueryData<GroupsState>(['groups'])!.available[1]
    expect(g.windows).toHaveLength(3)
    expect(g.windows[2].tabs.map((t) => t.title)).toEqual(['a1'])
    expect(g.windows[0].tabs.map((t) => t.title)).toEqual(['a2'])
    // synchronous-commit invariant (item 5): cache was new before the IDB write
    expect(cacheAtCommit?.available[1].windows).toHaveLength(3)
  })

  it('a throttled drop (e.over === null) still lands on the new-window zone via the last-over fallback', async () => {
    const { qc, result } = setup(twoWinGroup())

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragOver({
        active: { id: 'saved-a::w0::t0' },
        over: { id: 'saved-a::new-window', data: { current: { type: 'new-window', groupId: 'saved-a', groupIndex: 1 } } }
      } as unknown as DragOverEvent)
    })
    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0::t0' },
        over: null
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    expect(qc.getQueryData<GroupsState>(['groups'])!.available[1].windows).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task A — a picked-up GROUP becomes the active group (deferred past dragstart),
// and the active selection follows the group to its new index on commit.
// ─────────────────────────────────────────────────────────────────────────────
describe('group drag: the picked-up group becomes active and the selection follows its reorder', () => {
  let frames: FrameRequestCallback[] = []
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const flushFrames = () =>
    act(() => {
      frames.splice(0).forEach((cb) => cb(0))
    })

  function fourGroups() {
    return makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1')])]),
      group('saved-b', [win([tab('b1')])]),
      group('saved-c', [win([tab('c1')])])
    ])
  }
  const groupStart = (id: string, index: number) =>
    ({ active: { id, data: { current: { type: 'group', groupId: id, index } } } }) as unknown as DragStartEvent

  it('activates the dragged group in the NEXT FRAME — never synchronously inside the dragstart dispatch (spec C4)', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 3 })
    const { result } = setup(fourGroups())

    act(() => {
      result.current.onDragStart(groupStart('saved-a', 1))
    })
    // a synchronous store write here would re-render inside the dispatch → drag abort
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)

    flushFrames()
    expect(setActiveGroupIndex).toHaveBeenCalledTimes(1)
    expect(setActiveGroupIndex).toHaveBeenCalledWith(1)
  })

  it('does nothing in that frame if the drag already ended (cancel / instant drop)', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 3 })
    const { result } = setup(fourGroups())

    act(() => {
      result.current.onDragStart(groupStart('saved-a', 1))
    })
    act(() => {
      result.current.onDragCancel()
    })
    flushFrames()
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })

  it('schedules nothing for an already-active group, or for tab / window drags', () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })
    const { result } = setup(fourGroups())

    act(() => {
      result.current.onDragStart(groupStart('saved-a', 1)) // already active
    })
    act(() => {
      result.current.onDragCancel()
    })
    act(() => {
      result.current.onDragStart({ active: { id: 'saved-b::w0::t0' } } as unknown as DragStartEvent)
    })
    act(() => {
      result.current.onDragCancel()
    })
    act(() => {
      result.current.onDragStart({ active: { id: 'saved-c::w0' } } as unknown as DragStartEvent)
    })
    flushFrames()
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })

  it('on a committed reorder the active index follows the group to its NEW index — after the cache holds the new order, before the IDB write — and matches the persisted `active`', async () => {
    const { qc, result } = setup(fourGroups())
    const { saveGroupsState } = await import('@/lib/localDb')
    let orderWhenActivated: string[] | undefined
    const setActiveGroupIndex = vi.fn(() => {
      orderWhenActivated = qc.getQueryData<GroupsState>(['groups'])!.available.map((g) => g.id)
    })
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })

    act(() => {
      result.current.onDragStart(groupStart('saved-a', 1))
    })
    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a', data: { current: { type: 'group', groupId: 'saved-a', index: 1 } } },
        over: { id: 'saved-c', data: { current: { type: 'group', groupId: 'saved-c', index: 3 } } }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    expect(setActiveGroupIndex).toHaveBeenCalledTimes(1)
    expect(setActiveGroupIndex).toHaveBeenCalledWith(3)
    expect(orderWhenActivated).toEqual(['now-open', 'saved-b', 'saved-c', 'saved-a'])
    const persisted = (saveGroupsState as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(persisted.active).toEqual({ id: 'saved-a', index: 3 })
  })

  it('a group drop that commits nothing (onto the Now Open row) leaves the active index alone', async () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 2 })
    const { result } = setup(fourGroups())

    act(() => {
      result.current.onDragStart(groupStart('saved-b', 2))
    })
    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-b', data: { current: { type: 'group', index: 2 } } },
        over: { id: 'now-open', data: { current: { type: 'group', index: 0 } } }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })

  it('a tab / window move never touches the active index on commit', async () => {
    const setActiveGroupIndex = vi.fn()
    useUIStore.setState({ setActiveGroupIndex, activeGroupIndex: 1 })
    const { result } = setup(fourGroups())
    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0::t0' },
        over: { id: 'saved-b', data: { current: { type: 'group' } } }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })
    expect(setActiveGroupIndex).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task B — every chrome.windows.create from DnD is UNFOCUSED (a focused new window
// takes focus from the popup's anchor window and Chrome dismisses the popup).
// ─────────────────────────────────────────────────────────────────────────────
describe('DnD side effects: new real windows are always opened unfocused', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubChrome() {
    const chromeStub = {
      windows: { create: vi.fn().mockResolvedValue({}) },
      tabs: { create: vi.fn().mockResolvedValue({}), move: vi.fn().mockResolvedValue({}), remove: vi.fn() }
    }
    vi.stubGlobal('chrome', chromeStub)
    return chromeStub
  }

  it('runSideEffects passes focused:false on every windows.create (string and array urls)', async () => {
    const c = stubChrome()
    await runSideEffects([
      { type: 'windows.create', url: ['https://a.example', 'https://b.example'], focused: false },
      { type: 'windows.create', url: 'https://c.example', focused: false }
    ])
    expect(c.windows.create).toHaveBeenNthCalledWith(1, { url: ['https://a.example', 'https://b.example'], focused: false })
    expect(c.windows.create).toHaveBeenNthCalledWith(2, { url: 'https://c.example', focused: false })
    expect(c.tabs.remove).not.toHaveBeenCalled()
  })

  it('a saved TAB dropped on the Now Open ROW: the source loses it in the cache, then ONE unfocused real window opens', async () => {
    const c = stubChrome()
    const s = makeState([
      group('now-open', [{ id: 700, tabs: [{ id: 5, title: 'live', url: 'https://live' }], incognito: false, focused: true }], { permanent: true }),
      group('saved-a', [win([tab('a1'), tab('a2')])])
    ])
    const { qc, result } = setup(s)
    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0::t0' },
        over: { id: 'now-open', data: { current: { type: 'group', index: 0 } } }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })
    expect(qc.getQueryData<GroupsState>(['groups'])!.available[1].windows[0].tabs.map((t) => t.title)).toEqual(['a2'])
    expect(c.windows.create).toHaveBeenCalledTimes(1)
    expect(c.windows.create).toHaveBeenCalledWith({ url: 'https://example.com/a1', focused: false })
    expect(c.tabs.create).not.toHaveBeenCalled()
    expect(useUIStore.getState().undoStack).toHaveLength(0) // touches Now Open → not undoable
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Spring-open cross-group WINDOW drop bug (user-reported): picking up a window,
// dwelling on another group's sidebar row until spring-open swaps the windows
// panel, then dropping on one of the sprung-open group's WINDOW rows. The raw
// drop can resolve to a TAB nested inside that window rather than the window's
// own container (dnd-kit's own `over` state can lag the collision layer by a
// render right after the panel swap). `canDrop` correctly rejects window→tab,
// so without a fix the whole drop was silently discarded ("nothing commits").
// `onDragEnd` must redirect a window-active drag whose resolved target is a tab
// up to that tab's OWN window, regardless of what `over.data.current` claims.
// ─────────────────────────────────────────────────────────────────────────────
describe('a WINDOW drag whose resolved `over` is a TAB redirects to that tab\'s own window', () => {
  function twoGroupsTwoWindows() {
    return makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win([tab('a1'), tab('a2'), tab('a3')]), win([tab('x1')])]),
      group('saved-b', [win([tab('b1'), tab('b2')])])
    ])
  }

  it('commits the window into the tab\'s window instead of bailing "rejected"', async () => {
    const { qc, result } = setup(twoGroupsTwoWindows())
    const { saveGroupsState } = await import('@/lib/localDb')

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0', data: { current: { type: 'window' } } } } as unknown as DragStartEvent)
    })

    await act(async () => {
      // The raw `over` names a TAB inside saved-b's only window (`t0`), and — per the
      // bug's mechanism — its `data.current` is exactly what a real tab droppable
      // carries: `{type:'tab', windowId:'saved-b::w0'}`.
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0', data: { current: { type: 'window' } } },
        over: { id: 'saved-b::w0::t0', data: { current: { type: 'tab', groupId: 'saved-b', windowId: 'saved-b::w0' } } }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    expect(saveGroupsState).toHaveBeenCalledTimes(1) // committed, not bailed
    const next = qc.getQueryData<GroupsState>(['groups'])!
    const savedA = next.available.find((g) => g.id === 'saved-a')!
    const savedB = next.available.find((g) => g.id === 'saved-b')!
    // the dragged window (a1,a2,a3) left saved-a; saved-a's other window is untouched
    expect(savedA.windows).toHaveLength(1)
    expect(savedA.windows[0].tabs.map((t) => t.title)).toEqual(['x1'])
    // saved-b gained a second window holding the moved tabs, alongside its original one
    expect(savedB.windows).toHaveLength(2)
    const titles = savedB.windows.flatMap((w) => w.tabs.map((t) => t.title))
    expect(titles.sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2'])
    expect(useUIStore.getState().undoStack).toHaveLength(1) // a real, undoable move
  })

  it('a raw `over` id that is not in the pre-drag model at all still bails cleanly (no crash)', async () => {
    const { result } = setup(twoGroupsTwoWindows())
    const { saveGroupsState } = await import('@/lib/localDb')

    act(() => {
      result.current.onDragStart({ active: { id: 'saved-a::w0', data: { current: { type: 'window' } } } } as unknown as DragStartEvent)
    })

    await act(async () => {
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0', data: { current: { type: 'window' } } },
        // a tab id that isn't in the pre-drag model at all (saved-b's w0 only has t0/t1),
        // and there was no prior onDragOver to seed a fallback — nothing to redirect from.
        over: { id: 'saved-b::w0::t9', data: { current: { type: 'tab', groupId: 'saved-b', windowId: 'saved-b::w0' } } }
      } as unknown as import('@dnd-kit/core').DragEndEvent)
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})
