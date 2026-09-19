/**
 * unifiedCollision.test.ts — the collision cascade behind the app-level drag layer.
 *
 * Regression coverage for the "DnD does nothing in the MV3 toolbar popup" bug:
 * the rework replaced the pre-rework `collisionDetection={closestCenter}` with a
 * `pointerWithin → rectIntersection` pair, both of which return `[]` when the live
 * pointer coordinate is over dead space (a row gap / the toolbar / just outside the
 * popup). In the fixed-size action popup a real-mouse drop lands there constantly,
 * so `over` resolved to nothing and the drop was silently dropped. The fix adds a
 * `closestCenter` tail that always resolves to the nearest droppable.
 *
 * These tests drive the REAL `unifiedCollision` and only mock the three dnd-kit
 * collision primitives so we control exactly what each stage returns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const pointerWithin = vi.fn()
const rectIntersection = vi.fn()
const closestCenter = vi.fn()

vi.mock('@dnd-kit/core', () => ({
  // DndProvider.tsx imports these names at module load; only the 3 collision fns matter here.
  DndContext: () => null,
  DragOverlay: () => null,
  pointerWithin: (...a: unknown[]) => pointerWithin(...a),
  rectIntersection: (...a: unknown[]) => rectIntersection(...a),
  closestCenter: (...a: unknown[]) => closestCenter(...a),
}))

// Keep the rest of the module graph cheap.
vi.mock('@/hooks/useDnd', () => ({ useDndSensors: () => [] }))
vi.mock('@/hooks/useDndHandlers', () => ({ useDndHandlers: () => ({}) }))

import { unifiedCollision } from '@/components/dnd/DndProvider'
import type { CollisionDetection } from '@dnd-kit/core'

const hit = (id: string) => ({ id, data: { droppableContainer: { id }, value: 0 } })

function args(overrides: Partial<Parameters<CollisionDetection>[0]> = {}): Parameters<CollisionDetection>[0] {
  return {
    active: { id: 'a', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    collisionRect: { top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 },
    droppableRects: new Map(),
    droppableContainers: [],
    pointerCoordinates: { x: 5, y: 5 },
    ...overrides,
  } as unknown as Parameters<CollisionDetection>[0]
}

beforeEach(() => {
  pointerWithin.mockReset()
  rectIntersection.mockReset()
  closestCenter.mockReset()
})

describe('unifiedCollision cascade', () => {
  it('uses pointerWithin when it has a hit (rectIntersection / closestCenter not consulted)', () => {
    pointerWithin.mockReturnValue([hit('w1')])
    rectIntersection.mockReturnValue([hit('w2')])
    closestCenter.mockReturnValue([hit('w3')])

    const out = unifiedCollision(args())
    expect(out.map((c) => c.id)).toEqual(['w1'])
    expect(rectIntersection).not.toHaveBeenCalled()
    expect(closestCenter).not.toHaveBeenCalled()
  })

  it('falls back to rectIntersection when pointerWithin is empty', () => {
    pointerWithin.mockReturnValue([])
    rectIntersection.mockReturnValue([hit('w2')])
    closestCenter.mockReturnValue([hit('w3')])

    const out = unifiedCollision(args())
    expect(out.map((c) => c.id)).toEqual(['w2'])
    expect(closestCenter).not.toHaveBeenCalled()
  })

  it('THE FIX: falls back to closestCenter when pointerWithin AND rectIntersection are both empty', () => {
    // This is the toolbar-popup scenario: pointer sample landed in dead space.
    pointerWithin.mockReturnValue([])
    rectIntersection.mockReturnValue([])
    closestCenter.mockReturnValue([hit('nearest')])

    const out = unifiedCollision(args())
    expect(out.map((c) => c.id)).toEqual(['nearest'])
    expect(closestCenter).toHaveBeenCalledTimes(1)
  })

  it('never throws when a stage returns undefined (mocked / degenerate env)', () => {
    pointerWithin.mockReturnValue(undefined)
    rectIntersection.mockReturnValue(undefined)
    closestCenter.mockReturnValue(undefined)

    expect(() => unifiedCollision(args())).not.toThrow()
    expect(unifiedCollision(args())).toEqual([])
  })

  it('window drag: closestCenter fallback is still filtered to same-type / group droppables', () => {
    pointerWithin.mockReturnValue([])
    rectIntersection.mockReturnValue([])
    closestCenter.mockReturnValue([hit('t1'), hit('w9'), hit('g2')])

    const out = unifiedCollision(
      args({
        active: { id: 'w0', data: { current: { type: 'window' } } } as never,
        droppableContainers: [
          { id: 't1', data: { current: { type: 'tab' } } },
          { id: 'w9', data: { current: { type: 'window' } } },
          { id: 'g2', data: { current: { type: 'group' } } },
        ] as never,
      })
    )
    expect(out.map((c) => c.id)).toEqual(['w9', 'g2'])
  })

  it('group drag: closestCenter fallback keeps only group droppables', () => {
    pointerWithin.mockReturnValue([])
    rectIntersection.mockReturnValue([])
    closestCenter.mockReturnValue([hit('t1'), hit('g1'), hit('g2')])

    const out = unifiedCollision(
      args({
        active: { id: 'g0', data: { current: { type: 'group' } } } as never,
        droppableContainers: [
          { id: 't1', data: { current: { type: 'tab' } } },
          { id: 'g1', data: { current: { type: 'group' } } },
          { id: 'g2', data: { current: { type: 'group' } } },
        ] as never,
      })
    )
    expect(out.map((c) => c.id)).toEqual(['g1', 'g2'])
  })

  it('tab drag: no type filter — closestCenter result passes through as-is', () => {
    pointerWithin.mockReturnValue([])
    rectIntersection.mockReturnValue([])
    closestCenter.mockReturnValue([hit('t5'), hit('w1')])

    const out = unifiedCollision(
      args({ active: { id: 't0', data: { current: { type: 'tab' } } } as never })
    )
    expect(out.map((c) => c.id)).toEqual(['t5', 'w1'])
  })

  it('group drag: the permanent "Now Open" row (index 0) is NEVER a target', () => {
    pointerWithin.mockReturnValue([hit('now'), hit('g1')])
    const dc = [
      { id: 'now', data: { current: { type: 'group', index: 0 } } },
      { id: 'g1', data: { current: { type: 'group', index: 1 } } },
      { id: 'g2', data: { current: { type: 'group', index: 2 } } },
    ] as never
    const out = unifiedCollision(
      args({ active: { id: 'g2', data: { current: { type: 'group' } } } as never, droppableContainers: dc })
    )
    expect(out.map((c) => c.id)).toEqual(['g1'])
  })

  it('group drag: when Now Open is the ONLY hit, result is empty (no fallback re-admits it)', () => {
    pointerWithin.mockReturnValue([hit('now')])
    rectIntersection.mockReturnValue([hit('now')])
    closestCenter.mockReturnValue([hit('now')])
    const dc = [{ id: 'now', data: { current: { type: 'group', index: 0 } } }] as never
    const out = unifiedCollision(
      args({ active: { id: 'g2', data: { current: { type: 'group' } } } as never, droppableContainers: dc })
    )
    expect(out).toEqual([])
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Spring-open cross-group WINDOW drop bug: after `setActiveGroupIndex` swaps
  // the windows panel to the sprung-open group, that group's window container
  // can be absent from a collision pass its own child tab rows already appear
  // in (see `learnings_dnd_spring_open_window_drop.md`). A bare tab hit must
  // never reach `onDragEnd` as the WINDOW drag's target — `canDrop` correctly
  // rejects window→tab, so "nothing commits". `sameTypeOnly` must redirect it
  // up to its own window container instead.
  // ───────────────────────────────────────────────────────────────────────────
  it('window drag: a lone TAB hit (no window/group hit at all) is redirected to its OWN window container', () => {
    pointerWithin.mockReturnValue([hit('g::w1::t0')])
    const windowContainer = { id: 'g::w1', data: { current: { type: 'window', groupId: 'g', starred: false } } }
    const out = unifiedCollision(
      args({
        active: { id: 'g::w0', data: { current: { type: 'window' } } } as never,
        droppableContainers: [
          { id: 'g::w1::t0', data: { current: { type: 'tab', groupId: 'g', windowId: 'g::w1' } } },
          windowContainer,
        ] as never,
      })
    )
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('g::w1')
    expect((out[0].data as { droppableContainer?: { id: string } } | undefined)?.droppableContainer?.id).toBe(
      'g::w1'
    )
  })

  it('window drag: a lone TAB hit whose window container is not (yet) registered falls through unchanged', () => {
    pointerWithin.mockReturnValue([hit('g::w1::t0')])
    const out = unifiedCollision(
      args({
        active: { id: 'g::w0', data: { current: { type: 'window' } } } as never,
        droppableContainers: [
          // the window container itself is missing from the registry
          { id: 'g::w1::t0', data: { current: { type: 'tab', groupId: 'g', windowId: 'g::w1' } } },
        ] as never,
      })
    )
    expect(out.map((c) => c.id)).toEqual(['g::w1::t0'])
  })

  it('window drag: an existing window/group hit is never touched by the tab-redirect fallback', () => {
    pointerWithin.mockReturnValue([hit('g::w1'), hit('g::w1::t0')])
    const out = unifiedCollision(
      args({
        active: { id: 'g::w0', data: { current: { type: 'window' } } } as never,
        droppableContainers: [
          { id: 'g::w1', data: { current: { type: 'window', groupId: 'g' } } },
          { id: 'g::w1::t0', data: { current: { type: 'tab', groupId: 'g', windowId: 'g::w1' } } },
        ] as never,
      })
    )
    expect(out.map((c) => c.id)).toEqual(['g::w1'])
  })
})
