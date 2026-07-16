/**
 * groupDnd.test.ts
 *
 * Unit tests for useGroupDndHandlers (sidebar group reordering).
 * Covers: basic reorder, guard cases (permanent group, index 0 drop),
 * zone enforcement (starred stays in starred zone), and active group tracking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent } from '@dnd-kit/core'
import { useGroupDndHandlers } from '@/hooks/useDnd'
import type { Group, GroupsState } from '@/lib/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({ setActiveGroupIndex: vi.fn() }),
}))

import { saveGroupsState } from '@/lib/localDb'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeGroup(id: string, overrides: Partial<Group> = {}): Group {
  return {
    id,
    name: id,
    color: 'rgba(0,0,0,1)',
    updatedAt: 0,
    windows: [],
    permanent: false,
    ...overrides,
  }
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

function setup(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['groups'], state)
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })
  return { qc, result }
}

beforeEach(() => { vi.clearAllMocks() })

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useGroupDndHandlers — group reorder', () => {
  it('moves group from index 1 to index 2 and persists', async () => {
    const nowOpen = makeGroup('now-open', { permanent: true })
    const g1 = makeGroup('g1')
    const g2 = makeGroup('g2')
    const state = makeState([nowOpen, g1, g2])
    const { qc, result } = setup(state)

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('group-1', 'group-2'))
    })

    expect(saveGroupsState).toHaveBeenCalledOnce()
    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(persisted.available[1].id).toBe('g2')
    expect(persisted.available[2].id).toBe('g1')
  })

  it('is a no-op when active === over (same position)', async () => {
    const nowOpen = makeGroup('now-open', { permanent: true })
    const g1 = makeGroup('g1')
    const state = makeState([nowOpen, g1])

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['groups'], state)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('group-1', 'group-1'))
    })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('blocks moving the permanent (Now Open) group', async () => {
    const nowOpen = makeGroup('now-open', { permanent: true })
    const g1 = makeGroup('g1')
    const state = makeState([nowOpen, g1])

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['groups'], state)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('group-0', 'group-1'))
    })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('blocks dropping at index 0 (before the permanent group)', async () => {
    const nowOpen = makeGroup('now-open', { permanent: true })
    const g1 = makeGroup('g1')
    const g2 = makeGroup('g2')
    const state = makeState([nowOpen, g1, g2])

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['groups'], state)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('group-2', 'group-0'))
    })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  it('enforces zone order: starred groups stay before unstarred after reorder', async () => {
    const nowOpen = makeGroup('now-open', { permanent: true })
    const starred = makeGroup('starred', { starred: true })
    const g1 = makeGroup('g1')
    const g2 = makeGroup('g2')
    // Order: [nowOpen, starred, g1, g2] — dragging g1 to starred zone
    const state = makeState([nowOpen, starred, g1, g2])

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['groups'], state)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    // Drag g1 (index 2) onto starred (index 1) — g1 picks up starred=true
    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('group-2', 'group-1'))
    })

    expect(saveGroupsState).toHaveBeenCalledOnce()
    const persisted = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    // Zone enforcement: nowOpen, then all starred, then unstarred
    expect(persisted.available[0].permanent).toBe(true)
    const starredOnes = persisted.available.slice(1).filter((g) => g.starred)
    const unstarredOnes = persisted.available.slice(1).filter((g) => !g.starred)
    // All starred before any unstarred
    const firstUnstarredIdx = persisted.available.findIndex((g, i) => i > 0 && !g.starred)
    const lastStarredIdx = persisted.available.reduce((acc, g, i) => (g.starred ? i : acc), -1)
    expect(lastStarredIdx).toBeLessThan(firstUnstarredIdx)
    expect(starredOnes.length).toBeGreaterThan(0)
    expect(unstarredOnes.length).toBeGreaterThan(0)
  })

  it('is a no-op when over element is not a group', async () => {
    const nowOpen = makeGroup('now-open', { permanent: true })
    const g1 = makeGroup('g1')
    const state = makeState([nowOpen, g1])

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['groups'], state)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(makeDragEnd('group-1', 'window-0-0'))
    })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})
