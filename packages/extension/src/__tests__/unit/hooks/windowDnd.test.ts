/**
 * windowDnd.test.ts
 *
 * Direct mutationFn-level coverage for useWindowDndHandlers (the real hook,
 * not the DndContext-stubbed version exercised via WindowsPanel in
 * windowsDnd.test.tsx). Focused on the dnd_reorder analytics event and its
 * two variants (in-group reorder vs. cross-group move) plus the no-op guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent } from '@dnd-kit/core'
import { useWindowDndHandlers } from '@/hooks/useDnd'
import type { Group, GroupsState, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

import { saveGroupsState } from '@/lib/localDb'
import { trackEvent } from '@/lib/analytics'

function makeWin(id: number): ExtWindow {
  return { id, tabs: [], incognito: false, focused: false }
}

function makeGroup(id: string, windows: ExtWindow[], overrides: Partial<Group> = {}): Group {
  return { id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows, permanent: false, ...overrides }
}

function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}

function makeDragEnd(activeId: string, overId: string): DragEndEvent {
  return {
    active: { id: activeId, data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    over: { id: overId, data: { current: undefined }, rect: null, disabled: false },
    delta: { x: 0, y: 0 },
    activatorEvent: new MouseEvent('pointerdown'),
    collisions: [],
  } as unknown as DragEndEvent
}

function setup(state: GroupsState, groupIndex: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useWindowDndHandlers(groupIndex), { wrapper })
  return { qc, result }
}

beforeEach(() => { vi.clearAllMocks() })

describe('useWindowDndHandlers — dnd_reorder analytics', () => {
  it('tracks dnd_reorder kind=window on same-group reorder', async () => {
    const group = makeGroup('g1', [makeWin(1), makeWin(2)])
    const state = makeState([group])
    const { result } = setup(state, 0)

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('window-0-0', 'window-0-1'))
    })

    expect(saveGroupsState).toHaveBeenCalledOnce()
    expect(trackEvent).toHaveBeenCalledWith('dnd_reorder', { kind: 'window' })
  })

  it('tracks dnd_reorder kind=window_cross_group when dropped onto a different group', async () => {
    const g1 = makeGroup('g1', [makeWin(1)])
    const g2 = makeGroup('g2', [makeWin(2)])
    const state = makeState([g1, g2])
    const { result } = setup(state, 0)

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('window-0-0', 'group-1'))
    })

    expect(saveGroupsState).toHaveBeenCalledOnce()
    expect(trackEvent).toHaveBeenCalledWith('dnd_reorder', { kind: 'window_cross_group' })
  })

  it('does not track dnd_reorder when active === over (no-op)', async () => {
    const group = makeGroup('g1', [makeWin(1), makeWin(2)])
    const state = makeState([group])
    const { result } = setup(state, 0)

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('window-0-0', 'window-0-0'))
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('does not track dnd_reorder when there is no cached GroupsState', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useWindowDndHandlers(0), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('window-0-0', 'window-0-1'))
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
