/**
 * dndInsertion.test.ts — the pointer-driven insertion index used while a native
 * HTML5 drag has COLLAPSED its source row (the row no longer owns a slot, so
 * dnd-kit's "arrayMove against `over`" semantics are wrong).
 *
 * Contract pinned here: the gap the user sees (`shiftIds`) and the committed
 * position (`commitOverId`, fed to the existing `applyMove`) always agree, and a
 * pickup-and-release in place is a no-op.
 */
import { describe, it, expect } from 'vitest';
import {
  computeInsertion,
  containerKeyOf,
  dndListStyle,
  gapGrowthFor,
  gapTransformFor,
  orderOf,
  targetContainerKey,
  type InsertionCandidate
} from '@/lib/dndInsertion';

const H = 24;
/** Tab rows of window `w` in group `g`, collapsed-layout centers (0-height active excluded by caller). */
function tabs(w: string, entries: Array<[number, number]>): InsertionCandidate[] {
  return entries.map(([order, centerY]) => ({
    id: `${w}::t${order}`,
    type: 'tab',
    containerKey: w,
    order,
    centerY
  }));
}

describe('orderOf / containerKeyOf / targetContainerKey', () => {
  it('reads positional order from model ids (tab/window) and data.index (group)', () => {
    expect(orderOf('tab', 'work::w1::t3')).toBe(3);
    expect(orderOf('window', 'work::w2')).toBe(2);
    expect(orderOf('group', 'play', { index: 4 })).toBe(4);
    expect(Number.isNaN(orderOf('new-window', 'work::new-window'))).toBe(true);
  });

  it('resolves the container a row sorts within', () => {
    expect(containerKeyOf('tab', 'work::w1::t3', { windowId: 'work::w1' })).toBe('work::w1');
    expect(containerKeyOf('tab', 'work::w1::t3')).toBe('work::w1');
    expect(containerKeyOf('window', 'work::w2', { groupId: 'work' })).toBe('work');
    expect(containerKeyOf('group', 'play')).toBe('groups');
    expect(containerKeyOf('new-window', 'x')).toBeNull();
  });

  it('a tab over a WINDOW row inserts into that window; cross-type targets have no insertion', () => {
    expect(targetContainerKey('tab', { id: 'work::w1::t0', type: 'tab', data: { windowId: 'work::w1' } })).toBe('work::w1');
    expect(targetContainerKey('tab', { id: 'work::w1', type: 'window' })).toBe('work::w1');
    expect(targetContainerKey('tab', { id: 'play', type: 'group' })).toBeNull();
    expect(targetContainerKey('window', { id: 'work::w1', type: 'window', data: { groupId: 'work' } })).toBe('work');
    expect(targetContainerKey('window', { id: 'play', type: 'group' })).toBeNull();
    expect(targetContainerKey('group', { id: 'play', type: 'group' })).toBe('groups');
  });
});

describe('computeInsertion — same container (arrayMove semantics on commit)', () => {
  // Window w0: [A(0) active, B(1), C(2)]. Collapsed layout: B at 0..24 (center 12), C at 24..48 (36).
  const base = {
    activeId: 'w0::t0',
    activeType: 'tab',
    activeContainerKey: 'w0',
    activeOrder: 0,
    targetKey: 'w0',
    candidates: [...tabs('w0', [[0, 0], [1, 12], [2, 36]])],
    gapHeight: H
  };

  it('pickup point (dragged center where the row was) → gap at its own slot, commit is a NO-OP', () => {
    const r = computeInsertion({ ...base, probeY: 12 })!;
    expect(r.index).toBe(0);
    expect(r.sameContainer).toBe(true);
    expect(r.shiftIds).toEqual(['w0::t1', 'w0::t2']);
    expect(r.commitOverId).toBe('w0::t0'); // the active itself → caller skips the move
  });

  it('half-row dead zone: a small wiggle around the pickup point does not move the gap', () => {
    expect(computeInsertion({ ...base, probeY: 23 })!.index).toBe(0);
    expect(computeInsertion({ ...base, probeY: 25 })!.index).toBe(1);
  });

  it('moving DOWN past B → gap after B; commit targets the item originally at that position', () => {
    const r = computeInsertion({ ...base, probeY: 37 })!;
    expect(r.index).toBe(1);
    expect(r.shiftIds).toEqual(['w0::t2']);
    expect(r.commitOverId).toBe('w0::t1'); // arrayMove(0, 1) → [B, A, C]
  });

  it('past the last item → gap at the end, nothing shifts, commit targets the last original slot', () => {
    const r = computeInsertion({ ...base, probeY: 70 })!;
    expect(r.index).toBe(2);
    expect(r.shiftIds).toEqual([]);
    expect(r.commitOverId).toBe('w0::t2'); // arrayMove(0, 2) → [B, C, A]
  });

  it('moving UP: active C(2) carried to between A and B → commit targets B', () => {
    const r = computeInsertion({
      ...base,
      activeId: 'w0::t2',
      activeOrder: 2,
      candidates: tabs('w0', [[0, 12], [1, 36], [2, 48]]),
      probeY: 30
    })!;
    expect(r.index).toBe(1);
    expect(r.shiftIds).toEqual(['w0::t1']);
    expect(r.commitOverId).toBe('w0::t1'); // arrayMove(2, 1) → [A, C, B]
  });

  it('ignores candidates of other containers and other types', () => {
    const r = computeInsertion({
      ...base,
      candidates: [
        ...base.candidates,
        ...tabs('w1', [[0, 5]]),
        { id: 'work::w0', type: 'window', containerKey: 'work', order: 0, centerY: 1 }
      ],
      probeY: 70
    })!;
    expect(r.index).toBe(2);
  });
});

describe('computeInsertion — foreign tab list (insert-before semantics on commit)', () => {
  const foreign = {
    activeId: 'w0::t0',
    activeType: 'tab',
    activeContainerKey: 'w0',
    activeOrder: 0,
    targetKey: 'w1',
    candidates: tabs('w1', [[0, 100], [1, 124]]),
    gapHeight: H
  };

  it('above D → gap before D, D and E shift, commit inserts before D', () => {
    const r = computeInsertion({ ...foreign, probeY: 110 })!;
    expect(r.sameContainer).toBe(false);
    expect(r.index).toBe(0);
    expect(r.shiftIds).toEqual(['w1::t0', 'w1::t1']);
    expect(r.commitOverId).toBe('w1::t0');
  });

  it('below the last row → append via the WINDOW id', () => {
    const r = computeInsertion({ ...foreign, probeY: 200 })!;
    expect(r.index).toBe(2);
    expect(r.shiftIds).toEqual([]);
    expect(r.commitOverId).toBe('w1');
  });

  it('a window over a FOREIGN group\'s window list (after spring-open) commits BEFORE the window after the gap, or to the GROUP id (new last window) below the last one', () => {
    const args = {
      activeId: 'a::w0',
      activeType: 'window',
      activeContainerKey: 'a',
      activeOrder: 0,
      targetKey: 'b',
      candidates: [
        { id: 'b::w0', type: 'window', containerKey: 'b', order: 0, centerY: 50 },
        { id: 'b::w1', type: 'window', containerKey: 'b', order: 1, centerY: 250 }
      ],
      gapHeight: 100
    };
    const above = computeInsertion({ ...args, probeY: 10 })!;
    expect(above).toMatchObject({ sameContainer: false, index: 0, commitOverId: 'b::w0' });
    expect(above.shiftIds).toEqual(['b::w0', 'b::w1']);
    const between = computeInsertion({ ...args, probeY: 200 })!;
    expect(between).toMatchObject({ index: 1, commitOverId: 'b::w1' });
    const below = computeInsertion({ ...args, probeY: 400 })!;
    expect(below).toMatchObject({ index: 2, commitOverId: 'b' });
    expect(below.shiftIds).toEqual([]);
  });

  it('returns null for a non-insertable active type', () => {
    expect(
      computeInsertion({ ...foreign, activeType: 'new-window', probeY: 0 })
    ).toBeNull();
  });
});

describe('gapGrowthFor / dndListStyle', () => {
  const gap = { height: 24.4, shiftIds: new Set<string>(), containerKey: 'work::w1' };
  it('only the list holding the gap grows, by the rounded gap height', () => {
    expect(gapGrowthFor(gap, 'work::w1')).toBe(24);
    expect(gapGrowthFor(gap, 'work::w0')).toBe(0);
    expect(gapGrowthFor(null, 'work::w1')).toBe(0);
    expect(gapGrowthFor({ ...gap, containerKey: null }, 'work::w1')).toBe(0);
  });
  it('adds the growth on top of the list\'s own bottom padding and always animates padding', () => {
    expect(dndListStyle(24, '0.125rem')).toEqual({ paddingBottom: 'calc(0.125rem + 24px)', transition: 'padding-bottom 200ms ease' });
    expect(dndListStyle(0, '0.125rem')).toEqual({ transition: 'padding-bottom 200ms ease' });
  });
});

describe('gapTransformFor', () => {
  const gap = { height: 24.4, shiftIds: new Set(['x']), containerKey: 'w' };
  it('null when no collapsed-gap drag is live (callers keep the dnd-kit transform)', () => {
    expect(gapTransformFor(null, 'x')).toBeNull();
    expect(gapTransformFor(undefined, 'x')).toBeNull();
  });
  it('translates shifted rows down by the rounded gap height, leaves others untransformed', () => {
    expect(gapTransformFor(gap, 'x')).toBe('translate3d(0, 24px, 0)');
    expect(gapTransformFor(gap, 'y')).toBeUndefined();
  });
});
