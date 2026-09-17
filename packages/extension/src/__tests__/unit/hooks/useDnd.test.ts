/**
 * useDnd.test.ts  — RED PHASE (TDD)
 *
 * Two things this file pins down for the DnD rework:
 *
 *  A) `parseDndId` is DELETED from `@/hooks/useDnd`. The string-encoded id scheme
 *     ("tab-{id}-{wi}-{ti}", "window-{gi}-{wi}", "group-{gi}") is replaced by the
 *     typed model from `buildDndModel`. This test asserts the export is gone.
 *
 *  B) A normal (non-Now-Open) DnD move pushes EXACTLY ONE snapshot onto the
 *     uiStore undo stack (capped at 10). The rework routes commits through a single
 *     handler hook — CONTRACT ASSUMPTION: `useDndHandlers()` returning `{ onDragEnd }`,
 *     exported from `@/hooks/useDnd`. Coordinate the exact name with extension-dev;
 *     if it differs this fails with a missing-export error (acceptable RED reason).
 *
 * MUST fail now for "export missing / still exported", NOT a setup error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DragEndEvent } from '@dnd-kit/core'
import * as useDndModule from '@/hooks/useDnd'
import { useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Window as ExtWindow } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

function win(id: number): ExtWindow {
  return { id, tabs: [], incognito: false, focused: false }
}
function group(id: string, windows: ExtWindow[], over: Partial<Group> = {}): Group {
  return { id, name: id, color: 'rgba(0,0,0,1)', updatedAt: 0, windows, permanent: false, ...over }
}
function makeState(groups: Group[]): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ undoStack: [], redoStack: [] })
})

describe('A) parseDndId removal', () => {
  it('parseDndId is no longer exported from @/hooks/useDnd (string-id scheme replaced by buildDndModel)', () => {
    expect((useDndModule as Record<string, unknown>).parseDndId).toBeUndefined()
  })
})

describe('B) undo snapshot on a normal DnD move', () => {
  function setup(state: GroupsState) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['groups'], state)
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
    // CONTRACT: unified handler hook
    const useDndHandlers = (useDndModule as Record<string, unknown>).useDndHandlers as
      | (() => { onDragEnd: (e: DragEndEvent) => Promise<void> | void })
      | undefined
    if (typeof useDndHandlers !== 'function') {
      throw new Error('useDndHandlers export missing from @/hooks/useDnd (RED: rework not implemented)')
    }
    const { result } = renderHook(() => useDndHandlers(), { wrapper })
    return { qc, result }
  }

  it('31. a saved-group DnD move pushes exactly one snapshot onto the uiStore undo stack', async () => {
    const s = makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win(1), win(2)]),
    ])
    const { result } = setup(s)

    expect(useUIStore.getState().undoStack).toHaveLength(0)

    await act(async () => {
      // reorder the two windows of saved-a — a normal, undoable move
      await result.current.onDragEnd({
        active: { id: 'saved-a::w0' },
        over: { id: 'saved-a::w1' },
      } as unknown as DragEndEvent)
    })

    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('31b. the undo stack never exceeds 10 snapshots', async () => {
    const s = makeState([
      group('now-open', [], { permanent: true }),
      group('saved-a', [win(1), win(2)]),
    ])
    const { result } = setup(s)

    for (let i = 0; i < 14; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await result.current.onDragEnd({
          active: { id: 'saved-a::w0' },
          over: { id: 'saved-a::w1' },
        } as unknown as DragEndEvent)
      })
    }

    expect(useUIStore.getState().undoStack.length).toBeLessThanOrEqual(10)
  })
})
