/**
 * multiDragGeometry.test.ts — the collision layer during a MULTI-item native drag.
 *
 *  - virtual geometry: every other collapsed selected row removes its own height below
 *    itself (on top of the source's), and is removed from the droppable map entirely so
 *    no collision algorithm (incl. the closestCenter fallback) can pick it as `over`
 *  - insertion: selected rows are never slots the gap sits between, and the commit
 *    target is "before the first non-selected row after the gap" (or the list to append)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ClientRect, Collision, UniqueIdentifier } from '@dnd-kit/core'
import { attachInsertion, resetDndGeometry, virtualDroppableRects } from '@/components/dnd/DndProvider'
import { clearDndDragSelection, setDndDragSelection } from '@/lib/dndMultiDrag'
import type { DndDragSession } from '@/lib/dndHtml5Sensor'
import type { DndInsertion } from '@/lib/dndInsertion'

const PANEL = { left: 260, right: 780 }
const rect = (top: number, bottom: number): ClientRect => ({ top, bottom, height: bottom - top, ...PANEL, width: PANEL.right - PANEL.left })

// W0 80..160: A (source) 100..124, B 124..148 · W1 170..230: D 195..219 (selected, collapsed)
const defs: Array<[string, ClientRect, Record<string, unknown>]> = [
  ['work::w0', rect(80, 160), { type: 'window', groupId: 'work' }],
  ['work::w0::t0', rect(100, 124), { type: 'tab', windowId: 'work::w0' }],
  ['work::w0::t1', rect(124, 148), { type: 'tab', windowId: 'work::w0' }],
  ['work::w1', rect(170, 230), { type: 'window', groupId: 'work' }],
  ['work::w1::t0', rect(195, 219), { type: 'tab', windowId: 'work::w1' }]
]

function geoArgs() {
  return {
    active: { id: 'work::w0::t0', data: { current: defs[1][2] }, rect: { current: { initial: null, translated: null } } },
    collisionRect: rect(100, 100),
    droppableContainers: defs.map(([id, , data]) => ({ id, data: { current: data } })),
    droppableRects: new Map<UniqueIdentifier, ClientRect>(defs.map(([id, r]) => [id, r])),
    pointerCoordinates: { x: 300, y: 110 }
  } as unknown as Parameters<typeof virtualDroppableRects>[0]
}

function session(connected = true): DndDragSession {
  return {
    seq: 7,
    height: 24,
    sourceRect: { top: 100, bottom: 124, left: 280, right: 760 },
    collapsed: true,
    sourceConnected: () => true,
    extras: [{ id: 'work::w1::t0', rect: { top: 195, bottom: 219, left: 280, right: 760 }, height: 24, connected: () => connected }]
  }
}

const span = (m: Map<UniqueIdentifier, ClientRect>, id: string) => [m.get(id)!.top, m.get(id)!.bottom]

beforeEach(() => resetDndGeometry())
afterEach(() => clearDndDragSelection())

describe('virtualDroppableRects — multi-drag', () => {
  it('a collapsed selected row leaves the droppable map; its window shrinks by its height; the gap at home keeps everything else put', () => {
    const out = virtualDroppableRects(geoArgs(), session())
    expect(out.has('work::w1::t0')).toBe(false)
    expect(span(out, 'work::w0::t0')).toEqual([100, 100]) // source: 0-height
    expect(span(out, 'work::w0::t1')).toEqual([100, 124]) // closes up over the source
    expect(span(out, 'work::w0')).toEqual([80, 160]) // −source +gap
    expect(span(out, 'work::w1')).toEqual([170, 206]) // net 0 from source/gap, −24 for D
  })

  it('an extra row that left the document (panel swapped) no longer counts', () => {
    const out = virtualDroppableRects(geoArgs(), session(false))
    expect(out.has('work::w1::t0')).toBe(true)
    expect(span(out, 'work::w1')).toEqual([170, 230])
  })
})

describe('attachInsertion — multi-drag', () => {
  const tabC = (w: number, t: number, top: number, h = 24) => ({
    id: `work::w${w}::t${t}`,
    rect: { top, height: h, left: 0, width: 100, bottom: top + h, right: 100 },
    data: { type: 'tab', groupId: 'work', windowId: `work::w${w}` }
  })
  function insArgs(carriedTop: number, cs: ReturnType<typeof tabC>[]) {
    return {
      active: { id: 'work::w0::t0', data: { current: cs[0].data }, rect: { current: { initial: { height: 24 }, translated: null } } },
      collisionRect: { top: carriedTop, height: 0, left: 0, width: 100, bottom: carriedTop, right: 100 },
      droppableContainers: cs.map((c) => ({ id: c.id, data: { current: c.data } })),
      droppableRects: new Map(cs.map((c) => [c.id, c.rect])),
      pointerCoordinates: { x: 0, y: carriedTop }
    } as unknown as Parameters<typeof attachInsertion>[0]
  }
  const ins = (hits: Collision[]) => (hits[0]?.data as { tmInsertion?: DndInsertion } | undefined)?.tmInsertion

  // w0: A (active, collapsed) · B · C (selected, collapsed) · E
  const w0 = [tabC(0, 0, 0, 0), tabC(0, 1, 0), tabC(0, 2, 24, 0), tabC(0, 3, 24)]

  it('selected rows are not slots: the gap sits between the non-selected rows and commits BEFORE the next non-selected row', () => {
    setDndDragSelection('work::w0::t0', ['work::w0::t0', 'work::w0::t2'])
    // carried centre 24+12=36 is past B (12+12) but not past E (36+12)
    const hits = attachInsertion(insArgs(24, w0), [{ id: 'work::w0::t3' }])
    expect(ins(hits)).toMatchObject({ index: 1, commitOverId: 'work::w0::t3', shiftIds: ['work::w0::t3'] })
  })

  it('past the last non-selected row → append via the list (window) id', () => {
    setDndDragSelection('work::w0::t0', ['work::w0::t0', 'work::w0::t2'])
    const hits = attachInsertion(insArgs(90, w0), [{ id: 'work::w0::t3' }])
    expect(ins(hits)).toMatchObject({ index: 2, commitOverId: 'work::w0', shiftIds: [] })
  })

  it('without a selection the same geometry uses single-drag arrayMove semantics', () => {
    const hits = attachInsertion(insArgs(24, w0), [{ id: 'work::w0::t3' }])
    expect(ins(hits)!.commitOverId).not.toBe('work::w0::t3')
  })
})
