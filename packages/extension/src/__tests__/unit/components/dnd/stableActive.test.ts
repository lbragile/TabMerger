/**
 * stableActive.test.ts — after spring-open swaps the windows panel the dragged row unmounts
 * and dnd-kit degrades `active.data.current` to `{}`. `withStableActive` replays the data
 * captured while the row was mounted so the type-keyed collision logic (same-type filter,
 * insertion gap, virtual geometry) keeps working in the destination group.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Collision } from '@dnd-kit/core';
import { attachInsertion, resetStableActive, withStableActive } from '@/components/dnd/DndProvider';
import type { DndInsertion } from '@/lib/dndInsertion';

type Args = Parameters<typeof attachInsertion>[0];

const rect = (top: number, h: number) => ({ top, height: h, left: 0, width: 100, bottom: top + h, right: 100 });

function makeArgs(activeId: string, activeData: Record<string, unknown> | undefined): Args {
  const rows = [0, 1, 2].map((t) => ({
    id: `play::w0::t${t}`,
    data: { current: { type: 'tab', groupId: 'play', windowId: 'play::w0' } },
    top: t * 24
  }));
  return {
    active: {
      id: activeId,
      data: { current: activeData },
      rect: { current: { initial: rect(0, 24), translated: null } }
    },
    collisionRect: rect(30, 0),
    droppableContainers: rows.map((r) => ({ id: r.id, data: r.data })),
    droppableRects: new Map(rows.map((r) => [r.id, rect(r.top, 24)])),
    pointerCoordinates: { x: 0, y: 30 }
  } as unknown as Args;
}

const SOURCE = { type: 'tab', groupId: 'work', windowId: 'work::w0' };
const ins = (hits: Collision[]) => (hits[0]?.data as { tmInsertion?: DndInsertion } | undefined)?.tmInsertion;

describe('withStableActive', () => {
  beforeEach(() => resetStableActive());

  it('passes args through untouched while the source row is mounted', () => {
    const args = makeArgs('work::w0::t0', SOURCE);
    expect(withStableActive(args)).toBe(args);
  });

  it('replays the captured data once the source row has unmounted', () => {
    withStableActive(makeArgs('work::w0::t0', SOURCE));
    const gone = makeArgs('work::w0::t0', {});
    const fixed = withStableActive(gone);
    expect(fixed).not.toBe(gone);
    expect(fixed.active?.data.current).toEqual(SOURCE);
    expect(fixed.active?.id).toBe('work::w0::t0');
  });

  it('never replays data captured for a different active id', () => {
    withStableActive(makeArgs('work::w0::t0', SOURCE));
    const other = makeArgs('work::w0::t1', {});
    expect(withStableActive(other)).toBe(other);
  });

  it('forgets everything when there is no active item', () => {
    withStableActive(makeArgs('work::w0::t0', SOURCE));
    const none = { ...makeArgs('work::w0::t0', {}), active: null } as unknown as Args;
    expect(withStableActive(none)).toBe(none);
    const gone = makeArgs('work::w0::t0', {});
    expect(withStableActive(gone)).toBe(gone);
  });

  it('turns a typeless active into one attachInsertion can open a gap for', () => {
    const hits = [{ id: 'play::w0::t1' }] as Collision[];
    // Without the fix: the empty active data means no insertion, i.e. no gap in the destination group.
    expect(ins(attachInsertion(makeArgs('work::w0::t0', {}), hits))).toBeUndefined();

    withStableActive(makeArgs('work::w0::t0', SOURCE));
    const fixed = withStableActive(makeArgs('work::w0::t0', {}));
    const insertion = ins(attachInsertion(fixed, hits));
    expect(insertion).toMatchObject({ containerKey: 'play::w0', sameContainer: false });
    expect(insertion!.shiftIds.length).toBeGreaterThan(0);
  });
});
