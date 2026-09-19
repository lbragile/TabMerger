import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useDndHandlers } from '@/hooks/useDndHandlers'
import { buildDndModel } from '@/hooks/useDndModel'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// ponytail: real IndexedDB (fake-indexeddb) — no vi.mock('@/lib/localDb'). Exercises the
// full unified-DnD commit path: applyMove → qc.setQueryData → saveGroupsState → reload.

function tab(title: string): Tab {
  return { id: 0, title, url: `https://example.com/${title}`, favIconUrl: '', pinned: false }
}
function win(tabs: Tab[], over: Partial<ExtWindow> = {}): ExtWindow {
  return { id: 0, tabs, incognito: false, focused: false, starred: false, ...over }
}
function group(id: string, name: string, windows: ExtWindow[], over: Partial<Group> = {}): Group {
  return {
    id,
    name,
    color: 'rgba(0,0,0,1)',
    updatedAt: 1,
    windows,
    permanent: false,
    pendingSync: false,
    ...over
  }
}

function makeWrapper(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(GROUPS_QUERY_KEY, state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

/** Drive the hook through a start→end drag with model ids resolved from `state`. */
async function drag(
  result: { current: ReturnType<typeof useDndHandlers> },
  activeId: string,
  overId: string,
  activeData?: Record<string, unknown>
) {
  await act(async () => {
    result.current.onDragStart({
      active: { id: activeId, data: { current: activeData } }
    } as unknown as DragStartEvent)
  })
  await act(async () => {
    await result.current.onDragEnd({
      active: { id: activeId, data: { current: activeData } },
      over: { id: overId, data: { current: undefined } }
    } as unknown as DragEndEvent)
  })
}

describe('unified DnD commit path — real IndexedDB round trips', () => {
  beforeEach(async () => {
    await clearDb()
  })

  it('cross-group tab move via a sidebar group-row drop persists: tab in target, gone from source, both updatedAt bumped', async () => {
    const nowOpen = group('now', 'Now Open', [], { permanent: true })
    const groupA = group('g-a', 'Group A', [win([tab('a1'), tab('a2')]), win([tab('a3')])])
    const groupB = group('g-b', 'Group B', [win([tab('b1')])])
    const state: GroupsState = { active: { id: 'now', index: 0 }, available: [nowOpen, groupA, groupB] }
    await saveGroupsState(state)

    const { result } = renderHook(() => useDndHandlers(), { wrapper: makeWrapper(state).wrapper })

    const model = buildDndModel(state)
    // drag a1 (group A, window 0, tab 0) onto Group B's sidebar row
    const a1 = model.windows[model.groups['g-a'].windowIds[0]].tabIds[0]
    await drag(result, a1, 'g-b')

    const reloaded = await getGroupsState()
    const rA = reloaded.available.find((g) => g.id === 'g-a')!
    const rB = reloaded.available.find((g) => g.id === 'g-b')!

    // gone from source
    expect(rA.windows.flatMap((w) => w.tabs.map((t) => t.title))).toEqual(['a2', 'a3'])
    // a NEW window at the end of the target (group-row drop rule), existing window untouched
    expect(rB.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['b1'], ['a1']])
    // both groups bumped past the seeded updatedAt:1
    expect(rA.updatedAt).toBeGreaterThan(1)
    expect(rB.updatedAt).toBeGreaterThan(1)
    expect(rA.pendingSync).toBe(true)
    expect(rB.pendingSync).toBe(true)
  })

  it('single cross-group window move via sidebar drop persists with starred-first order intact', async () => {
    const nowOpen = group('now', 'Now Open', [], { permanent: true })
    const groupA = group('g-a', 'Group A', [
      win([tab('a1')], { name: 'wa-starred', starred: true }),
      win([tab('a2')], { name: 'wa-plain' })
    ])
    const groupB = group('g-b', 'Group B', [win([tab('b1')], { name: 'wb-starred', starred: true })])
    const state: GroupsState = { active: { id: 'now', index: 0 }, available: [nowOpen, groupA, groupB] }
    await saveGroupsState(state)

    const { result } = renderHook(() => useDndHandlers(), { wrapper: makeWrapper(state).wrapper })

    const model = buildDndModel(state)
    // drag the UNSTARRED window (group A, window 1) onto Group B's row
    const waPlain = model.groups['g-a'].windowIds[1]
    await drag(result, waPlain, 'g-b')

    const reloaded = await getGroupsState()
    const rA = reloaded.available.find((g) => g.id === 'g-a')!
    const rB = reloaded.available.find((g) => g.id === 'g-b')!

    expect(rA.windows.map((w) => w.name)).toEqual(['wa-starred'])
    // target: its own starred window stays first, the moved unstarred one after
    expect(rB.windows.map((w) => w.name)).toEqual(['wb-starred', 'wa-plain'])
    expect(rB.windows[0].starred).toBe(true)
    expect(rB.windows[1].starred).toBeFalsy()
  })

  it('multi-tab batch move persists all selected tabs contiguously in the target as one operation', async () => {
    const nowOpen = group('now', 'Now Open', [], { permanent: true })
    const groupA = group('g-a', 'Group A', [win([tab('t1'), tab('t2'), tab('t3'), tab('t4')])])
    const groupB = group('g-b', 'Group B', [win([tab('x1'), tab('x2')])])
    const state: GroupsState = { active: { id: 'now', index: 0 }, available: [nowOpen, groupA, groupB] }
    await saveGroupsState(state)

    const { result } = renderHook(() => useDndHandlers(), { wrapper: makeWrapper(state).wrapper })

    const model = buildDndModel(state)
    const wA = model.groups['g-a'].windowIds[0]
    const t1 = model.windows[wA].tabIds[0]
    const t3 = model.windows[wA].tabIds[2]
    // Ctrl-select t1 + t3 (non-contiguous), anchor t1, drop onto Group B's row
    await drag(result, t1, 'g-b', { selectionIds: [t1, t3] })

    const reloaded = await getGroupsState()
    const rA = reloaded.available.find((g) => g.id === 'g-a')!
    const rB = reloaded.available.find((g) => g.id === 'g-b')!

    // source keeps only the unselected tabs
    expect(rA.windows[0].tabs.map((t) => t.title)).toEqual(['t2', 't4'])
    // both moved tabs land contiguously, source order kept, in ONE new window at the end
    expect(rB.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['x1', 'x2'], ['t1', 't3']])
  })

  it('a cross-group drop that EMPTIES its source window PERSISTS that window, now empty', async () => {
    const nowOpen = group('now', 'Now Open', [], { permanent: true })
    const groupA = group('g-a', 'Group A', [win([tab('only')]), win([tab('stay')])])
    const groupB = group('g-b', 'Group B', [win([tab('b1')])])
    const state: GroupsState = { active: { id: 'now', index: 0 }, available: [nowOpen, groupA, groupB] }
    await saveGroupsState(state)

    const { result } = renderHook(() => useDndHandlers(), { wrapper: makeWrapper(state).wrapper })
    const model = buildDndModel(state)
    await drag(result, model.windows[model.groups['g-a'].windowIds[0]].tabIds[0], 'g-b')

    const reloaded = await getGroupsState()
    // User rule (2026-09-18): an emptied window is KEPT — and that survives the round trip.
    expect(reloaded.available.find((g) => g.id === 'g-a')!.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([[], ['stay']])
    expect(reloaded.available.find((g) => g.id === 'g-b')!.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['b1'], ['only']])
  })

  it('multi-tab selection across TWO windows dropped on a THIRD window position persists ONE contiguous block in original order; the emptied source window survives the reload', async () => {
    const nowOpen = group('now', 'Now Open', [], { permanent: true })
    const groupA = group('g-a', 'Group A', [win([tab('t1'), tab('t2')]), win([tab('t3')])])
    const groupB = group('g-b', 'Group B', [win([tab('x1'), tab('x2')])])
    const state: GroupsState = { active: { id: 'now', index: 0 }, available: [nowOpen, groupA, groupB] }
    await saveGroupsState(state)

    const { result } = renderHook(() => useDndHandlers(), { wrapper: makeWrapper(state).wrapper })
    // selection t3 (click order first) + t1; primary t1; drop before x2
    await drag(result, 'g-a::w0::t0', 'g-b::w0::t1', { selectionIds: ['g-a::w1::t0', 'g-a::w0::t0'] })

    const reloaded = await getGroupsState()
    expect(reloaded.available.find((g) => g.id === 'g-b')!.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['x1', 't1', 't3', 'x2']])
    // w1 (t3) was emptied by the move and is KEPT.
    expect(reloaded.available.find((g) => g.id === 'g-a')!.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['t2'], []])
  })

  it('a multi-selection COPIED out of Now Open persists detached copies (id 0 + savedAt) and never writes the live ids', async () => {
    const nowOpen = group('now', 'Now Open', [
      win([{ ...tab('live1'), id: 11 }, { ...tab('live2'), id: 12 }], { id: 700 })
    ], { permanent: true })
    const groupB = group('g-b', 'Group B', [win([tab('x1')])])
    const state: GroupsState = { active: { id: 'now', index: 0 }, available: [nowOpen, groupB] }
    await saveGroupsState(state)

    const { result } = renderHook(() => useDndHandlers(), { wrapper: makeWrapper(state).wrapper })
    await drag(result, 'now::w0::t0', 'g-b', { selectionIds: ['now::w0::t0', 'now::w0::t1'] })

    const reloaded = await getGroupsState()
    const rB = reloaded.available.find((g) => g.id === 'g-b')!
    expect(rB.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['x1'], ['live1', 'live2']])
    for (const t of rB.windows[1].tabs) {
      expect(t.id).toBe(0)
      expect(typeof t.savedAt).toBe('number')
    }
    // Now Open itself untouched
    expect(reloaded.available.find((g) => g.id === 'now')!.windows[0].tabs.map((t) => t.id)).toEqual([11, 12])
  })

  it('a group reorder persists `groupsState.active` pointing at the dragged group\'s NEW index', async () => {
    const nowOpen = group('now', 'Now Open', [], { permanent: true })
    const state: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [nowOpen, group('g-a', 'A', [win([tab('a')])]), group('g-b', 'B', [win([tab('b')])]), group('g-c', 'C', [])]
    }
    await saveGroupsState(state)

    const { result } = renderHook(() => useDndHandlers(), { wrapper: makeWrapper(state).wrapper })
    // drag A onto C's row (index 3) → order now, B, C, A
    await drag(result, 'g-a', 'g-c', { type: 'group', index: 1 })

    const reloaded = await getGroupsState()
    expect(reloaded.available.map((g) => g.id)).toEqual(['now', 'g-b', 'g-c', 'g-a'])
    expect(reloaded.active).toEqual({ id: 'g-a', index: 3 })
  })
})
