/**
 * attachInsertion.test.ts — the collision wrapper that decorates the winning
 * collision with `data.tmInsertion` from dnd-kit's own (transform-agnostic)
 * droppable rects. Exercised with hand-built collision args (no DOM layout).
 */
import { describe, it, expect } from 'vitest';
import type { Collision } from '@dnd-kit/core';
import { attachInsertion } from '@/components/dnd/DndProvider';
import type { DndInsertion } from '@/lib/dndInsertion';

interface C {
  id: string;
  top: number;
  h: number;
  data: Record<string, unknown>;
}

function makeArgs(opts: { activeId: string; activeData: Record<string, unknown>; height: number; carriedTop: number; containers: C[] }) {
  const rect = (top: number, h: number) => ({ top, height: h, left: 0, width: 100, bottom: top + h, right: 100 });
  return {
    active: {
      id: opts.activeId,
      data: { current: opts.activeData },
      rect: { current: { initial: rect(0, opts.height), translated: null } }
    },
    collisionRect: rect(opts.carriedTop, 0),
    droppableContainers: opts.containers.map((c) => ({ id: c.id, data: { current: c.data } })),
    droppableRects: new Map(opts.containers.map((c) => [c.id, rect(c.top, c.h)])),
    pointerCoordinates: { x: 0, y: opts.carriedTop }
  } as unknown as Parameters<typeof attachInsertion>[0];
}

const ins = (hits: Collision[]) => (hits[0]?.data as { tmInsertion?: DndInsertion } | undefined)?.tmInsertion;

const tabRow = (w: number, t: number, top: number): C => ({
  id: `work::w${w}::t${t}`,
  top,
  h: t === -1 ? 0 : 24,
  data: { type: 'tab', groupId: 'work', windowId: `work::w${w}` }
});

describe('attachInsertion', () => {
  const w0 = [
    { ...tabRow(0, 0, 0), h: 0 }, // collapsed active
    tabRow(0, 1, 0),
    tabRow(0, 2, 24)
  ];

  it('tab over a sibling row → same-container insertion from the carried item center', () => {
    const args = makeArgs({
      activeId: 'work::w0::t0',
      activeData: w0[0].data,
      height: 24,
      carriedTop: 26, // center 38 → past B's midpoint (12 + 12)
      containers: w0
    });
    const hits = attachInsertion(args, [{ id: 'work::w0::t2' }]);
    expect(hits[0].id).toBe('work::w0::t2');
    expect(ins(hits)).toMatchObject({ containerKey: 'work::w0', index: 1, sameContainer: true, commitOverId: 'work::w0::t1' });
    expect(ins(hits)!.shiftIds).toEqual(['work::w0::t2']);
  });

  it('tab over another WINDOW row → foreign insertion; append commits to the window id', () => {
    const args = makeArgs({
      activeId: 'work::w0::t0',
      activeData: w0[0].data,
      height: 24,
      carriedTop: 400,
      containers: [
        ...w0,
        { id: 'work::w1', top: 60, h: 90, data: { type: 'window', groupId: 'work' } },
        tabRow(1, 0, 90),
        tabRow(1, 1, 114)
      ]
    });
    const hits = attachInsertion(args, [{ id: 'work::w1' }, { id: 'play' }]);
    expect(ins(hits)).toMatchObject({ containerKey: 'work::w1', index: 2, sameContainer: false, commitOverId: 'work::w1' });
    expect(hits[1]).toEqual({ id: 'play' }); // only the winner is decorated
  });

  it('group drags never count the permanent "Now Open" row (index 0) as a slot', () => {
    const args = makeArgs({
      activeId: 'play',
      activeData: { type: 'group', groupId: 'play', index: 2 },
      height: 36,
      carriedTop: -50,
      containers: [
        { id: 'now', top: 0, h: 36, data: { type: 'group', index: 0 } },
        { id: 'work', top: 36, h: 36, data: { type: 'group', index: 1 } },
        { id: 'play', top: 72, h: 0, data: { type: 'group', index: 2 } }
      ]
    });
    const r = ins(attachInsertion(args, [{ id: 'work' }]))!;
    expect(r.index).toBe(0);
    expect(r.shiftIds).toEqual(['work']);
    expect(r.commitOverId).toBe('work');
  });

  it('cross-type target (tab over a group row) → collisions returned untouched', () => {
    const args = makeArgs({
      activeId: 'work::w0::t0',
      activeData: w0[0].data,
      height: 24,
      carriedTop: 0,
      containers: [...w0, { id: 'play', top: 0, h: 36, data: { type: 'group', index: 2 } }]
    });
    const hits: Collision[] = [{ id: 'play' }];
    expect(attachInsertion(args, hits)).toBe(hits);
  });

  it('no hits / no active / malformed args → returns the input, never throws', () => {
    const empty: Collision[] = [];
    const args = makeArgs({ activeId: 'x', activeData: { type: 'tab' }, height: 24, carriedTop: 0, containers: [] });
    expect(attachInsertion(args, empty)).toBe(empty);
    const hits: Collision[] = [{ id: 'work::w0::t1' }];
    expect(attachInsertion({ ...args, active: null } as never, hits)).toBe(hits);
    expect(attachInsertion({ ...args, droppableContainers: null } as never, hits)).toBe(hits);
  });
});
