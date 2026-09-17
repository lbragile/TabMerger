/**
 * virtualGeometry.test.ts — the collision layer's analytic model of the live layout
 * during a collapsed-source native drag: dnd-kit's drag-start rects, minus the
 * collapsed source's height below it, plus the gap list's growth below that list.
 * No DOM re-measure → the gap's own layout can never feed back into collisions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ClientRect, UniqueIdentifier } from '@dnd-kit/core';
import { noteGapContainer, resetDndGeometry, virtualDroppableRects } from '@/components/dnd/DndProvider';
import type { DndDragSession } from '@/lib/dndHtml5Sensor';

const H = 24;
const PANEL = { left: 260, right: 780 };
const SIDEBAR = { left: 0, right: 240 };

function rect(top: number, bottom: number, x = PANEL): ClientRect {
  return { top, bottom, height: bottom - top, left: x.left, right: x.right, width: x.right - x.left };
}

// Work window 0: [A (source) 100..124, B 124..148] inside W0 80..160
// Work window 1: [D 195..219] inside W1 170..230; sidebar group row G 100..136
const defs: Array<[string, ClientRect, Record<string, unknown>]> = [
  ['work::w0', rect(80, 160), { type: 'window', groupId: 'work' }],
  ['work::w0::t0', rect(100, 124), { type: 'tab', windowId: 'work::w0' }],
  ['work::w0::t1', rect(124, 148), { type: 'tab', windowId: 'work::w0' }],
  ['work::w1', rect(170, 230), { type: 'window', groupId: 'work' }],
  ['work::w1::t0', rect(195, 219), { type: 'tab', windowId: 'work::w1' }],
  ['play', rect(100, 136, SIDEBAR), { type: 'group', index: 1 }]
];

function makeArgs(live = new Map<UniqueIdentifier, ClientRect>(defs.map(([id, r]) => [id, r]))) {
  return {
    active: { id: 'work::w0::t0', data: { current: defs[1][2] }, rect: { current: { initial: null, translated: null } } },
    collisionRect: rect(100, 100),
    droppableContainers: defs.map(([id, , data]) => ({ id, data: { current: data } })),
    droppableRects: live,
    pointerCoordinates: { x: 300, y: 110 }
  } as unknown as Parameters<typeof virtualDroppableRects>[0];
}

function session(over: Partial<DndDragSession> = {}): DndDragSession {
  return {
    seq: 1,
    height: H,
    sourceRect: { top: 100, bottom: 124, left: 280, right: 760 },
    collapsed: true,
    sourceConnected: () => true,
    ...over
  };
}

const span = (m: Map<UniqueIdentifier, ClientRect>, id: string) => [m.get(id)!.top, m.get(id)!.bottom];

beforeEach(() => resetDndGeometry());

describe('virtualDroppableRects', () => {
  it('no native drag → the live map, untouched (same reference)', () => {
    const args = makeArgs();
    expect(virtualDroppableRects(args, null)).toBe(args.droppableRects);
  });

  it('before the collapse → live map (and it snapshots it as the drag-start geometry)', () => {
    const args = makeArgs();
    expect(virtualDroppableRects(args, session({ collapsed: false }))).toBe(args.droppableRects);
  });

  it('gap at home: source is 0-height, its siblings close up, and NOTHING outside the home list moves (net size kept)', () => {
    const args = makeArgs();
    virtualDroppableRects(args, session({ collapsed: false })); // snapshot at drag start
    const v = virtualDroppableRects(args, session());
    expect(span(v, 'work::w0::t0')).toEqual([100, 100]);
    expect(span(v, 'work::w0::t1')).toEqual([100, 124]); // closed up into the source slot
    expect(span(v, 'work::w0')).toEqual([80, 160]); // home list: -h (collapse) +h (gap padding)
    expect(span(v, 'work::w1')).toEqual([170, 230]);
    expect(span(v, 'work::w1::t0')).toEqual([195, 219]);
    expect(span(v, 'play')).toEqual([100, 136]); // other column
  });

  it('gap moved to a foreign list: home list shrinks, everything below shifts up, the foreign list grows', () => {
    const args = makeArgs();
    virtualDroppableRects(args, session({ collapsed: false }));
    noteGapContainer('work::w1');
    const v = virtualDroppableRects(args, session());
    expect(span(v, 'work::w0')).toEqual([80, 136]);
    expect(span(v, 'work::w1')).toEqual([146, 230]); // moved up by h, grew by h
    expect(span(v, 'work::w1::t0')).toEqual([171, 195]);
    expect(span(v, 'play')).toEqual([100, 136]);
  });

  it('no gap anywhere (e.g. over a group row): every list closed', () => {
    const args = makeArgs();
    virtualDroppableRects(args, session({ collapsed: false }));
    noteGapContainer(null);
    const v = virtualDroppableRects(args, session());
    expect(span(v, 'work::w0')).toEqual([80, 136]);
    expect(span(v, 'work::w1')).toEqual([146, 206]);
  });

  it('uses the DRAG-START snapshot even if dnd-kit re-measured mid-drag (no double-counting the collapse)', () => {
    const args = makeArgs();
    virtualDroppableRects(args, session({ collapsed: false }));
    const remeasured = new Map(args.droppableRects);
    remeasured.set('work::w0::t1', rect(100, 124)); // already collapsed in the DOM
    const v = virtualDroppableRects({ ...args, droppableRects: remeasured }, session());
    expect(span(v, 'work::w0::t1')).toEqual([100, 124]);
  });

  it('a source that left the document (spring-open) no longer removes height; unmounted rects are dropped from the snapshot', () => {
    const args = makeArgs();
    virtualDroppableRects(args, session({ collapsed: false }));
    noteGapContainer(null);
    const live = new Map(args.droppableRects);
    live.delete('work::w0::t0');
    const v = virtualDroppableRects({ ...args, droppableRects: live }, session({ sourceConnected: () => false }));
    expect(v.has('work::w0::t0')).toBe(false);
    expect(span(v, 'work::w0::t1')).toEqual([124, 148]);
  });

  it('a new drag (new seq) re-snapshots', () => {
    const args = makeArgs();
    virtualDroppableRects(args, session({ collapsed: false }));
    noteGapContainer('work::w1');
    const moved = new Map(args.droppableRects);
    moved.set('work::w1', rect(300, 360));
    virtualDroppableRects({ ...args, droppableRects: moved }, session({ seq: 2, collapsed: false }));
    const v = virtualDroppableRects({ ...args, droppableRects: moved }, session({ seq: 2 }));
    expect(span(v, 'work::w1')).toEqual([300, 360]); // gap back at home for the new drag, from the new snapshot
  });
});
