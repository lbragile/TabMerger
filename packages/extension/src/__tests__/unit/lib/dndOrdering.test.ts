/**
 * dndOrdering.test.ts — spec §6.1 "Multi-item ordering", end to end through the two pure
 * layers a drop actually goes through:
 *
 *     computeInsertion (where the GAP is drawn)  →  applyMove (where the block LANDS)
 *
 * The regression this guards: `moveGroupsMulti` used to place the block correctly and then
 * re-partition the WHOLE sidebar starred-first, which (a) tore a mixed-zone selection in
 * two and (b) slid the block away from the gap the user was shown. It only failed "in some
 * cases" because `filter` is stable, so an all-unstarred selection dropped in the unstarred
 * zone came out right. The property test below enumerates the cases instead of guessing.
 *
 * The properties, for EVERY (starred layout × selection subset × gap position):
 *   1. GAP == COMMIT — the block lands exactly at the gap index `computeInsertion` returned.
 *   2. The block is CONTIGUOUS and in ORIGINAL list order (never selection/click order).
 *   3. Non-dragged items keep their relative order.
 *   4. Nothing lands above "Now Open".
 *   5. The gap is clamped into the block's own zone, so a normalisation sort can never
 *      need to move it afterwards.
 */
import { describe, it, expect } from 'vitest';
import { applyMove, canDrop, type DndRef } from '@/lib/dndMove';
import { computeInsertion, type InsertionCandidate } from '@/lib/dndInsertion';
import { buildDndModel } from '@/hooks/useDndModel';
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types';

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROW_H = 40;
const tab = (t: string): Tab => ({ id: 0, title: t, url: `https://e.x/${t}` });
const win = (name: string, starred = false): ExtWindow => ({
  id: 0,
  name,
  tabs: [tab(`${name}-t`)],
  incognito: false,
  focused: false,
  starred
});
const group = (id: string, over: Partial<Group> = {}): Group => ({
  id,
  name: id,
  color: 'rgba(0,0,0,1)',
  updatedAt: 1,
  windows: [win(`${id}-w`)],
  permanent: false,
  ...over
});

const GROUP_NAMES = ['a', 'b', 'c', 'd', 'e', 'f'];
const WINDOW_NAMES = ['w0', 'w1', 'w2', 'w3', 'w4'];

/** `[Now Open, …starredCount starred groups, …the rest unstarred]` — the zone-sorted sidebar. */
function sidebar(starredCount: number): GroupsState {
  const saved = GROUP_NAMES.map((id, i) => group(id, { starred: i < starredCount }));
  return {
    active: { id: 'now', index: 0 },
    available: [group('now', { permanent: true, windows: [] }), ...saved]
  };
}

/** One group whose window list is zone-sorted: `starredCount` starred windows first. */
function windowList(starredCount: number): GroupsState {
  return {
    active: { id: 'now', index: 0 },
    available: [
      group('now', { permanent: true, windows: [] }),
      group('g', { windows: WINDOW_NAMES.map((n, i) => win(n, i < starredCount)) })
    ]
  };
}

const ids = (s: GroupsState) => s.available.map((g) => g.id);
const winNames = (s: GroupsState, gi = 1) => s.available[gi].windows.map((w) => w.name!);

/** Every non-empty subset of `items`, as index arrays. */
function subsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) {
    out.push(items.filter((_x, i) => mask & (1 << i)));
  }
  return out;
}

const zone = (x: { starred?: boolean }) => (x.starred ? 0 : 1);

/**
 * Reference implementation of spec §6.1, deliberately written the "obvious" way:
 * remove every dragged item, then splice the block back in at `gapIndex` of what's left.
 * `rows` excludes any pinned head (Now Open) — the caller re-attaches it.
 */
function removeThenInsertAt<T>(rows: T[], isDragged: (x: T) => boolean, gapIndex: number): T[] {
  const block = rows.filter(isDragged);
  const rest = rows.filter((x) => !isDragged(x));
  return [...rest.slice(0, gapIndex), ...block, ...rest.slice(gapIndex)];
}

/** The zone-legal gap positions for a block of zone `blockZone` inside `rest`. */
function zoneBounds<T extends { starred?: boolean }>(rest: T[], blockZone: number): [number, number] {
  const above = rest.filter((x) => zone(x) < blockZone).length;
  const same = rest.filter((x) => zone(x) === blockZone).length;
  return [above, above + same];
}

/**
 * Drive `computeInsertion` with synthetic geometry: rows are `ROW_H` tall in render order,
 * and `probeY` is placed so the pointer-derived gap index is exactly `wantIndex` BEFORE
 * clamping. Returns the insertion the collision layer would have attached.
 */
function insertionFor(args: {
  type: 'group' | 'window';
  rows: Array<{ id: string; order: number; starred?: boolean }>;
  containerKey: string;
  activeId: string;
  selectionIds: string[];
  wantIndex: number;
}) {
  const { type, rows, containerKey, activeId, selectionIds, wantIndex } = args;
  const selection = new Set(selectionIds);
  const candidates: InsertionCandidate[] = rows.map((r) => ({
    id: r.id,
    type,
    containerKey,
    order: r.order,
    centerY: r.order * ROW_H + ROW_H / 2,
    zone: zone(r)
  }));
  // `others` — what the layout looks like with every dragged row collapsed out.
  const others = candidates.filter((c) => !selection.has(c.id)).sort((x, y) => x.order - y.order);
  const probeY = wantIndex === 0 ? -1e6 : others[wantIndex - 1].centerY + ROW_H / 2 + 0.5;
  const active = rows.find((r) => r.id === activeId)!;
  return computeInsertion({
    activeId,
    activeType: type,
    activeContainerKey: containerKey,
    activeOrder: active.order,
    targetKey: containerKey,
    candidates,
    probeY,
    gapHeight: ROW_H,
    selectionIds: selection,
    activeZone: zone(active)
  });
}

// ─── groups ──────────────────────────────────────────────────────────────────

describe('§6.1 multi-item ordering — sidebar groups (property sweep)', () => {
  it('lands the block exactly at the drawn gap, in original order, for every selection × gap × starred layout', () => {
    let cases = 0;
    for (let starredCount = 0; starredCount <= GROUP_NAMES.length; starredCount++) {
      const state = sidebar(starredCount);
      const model = buildDndModel(state);
      const saved = state.available.slice(1);

      for (const sel of subsets(saved)) {
        const selIds = sel.map((g) => g.id);
        const rest = saved.filter((g) => !selIds.includes(g.id));
        // A selection spanning both zones has no contiguous home — refused, not split.
        if (new Set(sel.map(zone)).size > 1) {
          expect(canDrop(model, { type: 'group', id: selIds[0], selectionIds: selIds }, { type: 'group', id: rest[0]?.id ?? 'now' })).toBe(false);
          continue;
        }
        if (rest.length === 0) continue;
        const [lo, hi] = zoneBounds(rest, zone(sel[0]));

        for (let gap = 0; gap <= rest.length; gap++) {
          // The anchor is ALWAYS the first selected row, whatever its position: selection
          // order must never leak into the result.
          const anchorId = selIds[0];
          const insertion = insertionFor({
            type: 'group',
            rows: saved.map((g, i) => ({ id: g.id, order: i + 1, starred: g.starred })),
            containerKey: 'groups',
            activeId: anchorId,
            selectionIds: selIds,
            wantIndex: gap
          })!;
          // Property 5: the gap itself is clamped into the block's zone.
          expect(insertion.index).toBe(Math.min(Math.max(gap, lo), hi));
          expect(insertion.commitOverId).not.toBeNull();
          expect(selIds).not.toContain(insertion.commitOverId);

          const over: DndRef = { type: 'group', id: insertion.commitOverId! };
          if (insertion.commitAfter !== undefined) over.after = insertion.commitAfter;
          const active: DndRef = { type: 'group', id: anchorId, selectionIds: selIds };
          expect(canDrop(model, active, over)).toBe(true);
          const res = applyMove(model, state, active, over);

          // Properties 1–4: identical to remove-then-insert at the GAP index.
          const expected = ['now', ...removeThenInsertAt(saved, (g) => selIds.includes(g.id), insertion.index).map((g) => g.id)];
          expect(ids(res.next)).toEqual(expected);
          expect(res.next.available[0].permanent).toBe(true);
          // The drag anchor stays the active group, wherever the block ended up.
          expect(res.next.available[res.next.active.index].id).toBe(anchorId);
          cases++;
        }
      }
    }
    // Guard against the sweep silently collapsing to nothing.
    expect(cases).toBeGreaterThan(900);
  });

  it('keeps starred groups ahead of unstarred ones in every swept outcome', () => {
    for (let starredCount = 1; starredCount < GROUP_NAMES.length; starredCount++) {
      const state = sidebar(starredCount);
      const model = buildDndModel(state);
      const saved = state.available.slice(1);
      for (const sel of subsets(saved)) {
        const selIds = sel.map((g) => g.id);
        if (new Set(sel.map(zone)).size > 1) continue;
        const rest = saved.filter((g) => !selIds.includes(g.id));
        if (rest.length === 0) continue;
        for (let gap = 0; gap <= rest.length; gap++) {
          const insertion = insertionFor({
            type: 'group',
            rows: saved.map((g, i) => ({ id: g.id, order: i + 1, starred: g.starred })),
            containerKey: 'groups',
            activeId: selIds[0],
            selectionIds: selIds,
            wantIndex: gap
          })!;
          const over: DndRef = { type: 'group', id: insertion.commitOverId! };
          if (insertion.commitAfter !== undefined) over.after = insertion.commitAfter;
          const res = applyMove(model, state, { type: 'group', id: selIds[0], selectionIds: selIds }, over);
          const after = res.next.available.slice(1);
          const lastStarred = after.reduce((acc, g, i) => (g.starred ? i : acc), -1);
          const firstPlain = after.findIndex((g) => !g.starred);
          if (lastStarred >= 0 && firstPlain >= 0) expect(lastStarred).toBeLessThan(firstPlain);
        }
      }
    }
  });
});

// ─── explicit group cases (readable failures for the shapes the report named) ──

describe('§6.1 multi-item ordering — sidebar groups (explicit cases)', () => {
  const state = sidebar(0); // now · a · b · c · d · e · f
  const model = buildDndModel(state);

  /** Drop the selection at gap index `gap` among the non-selected saved groups. */
  function drop(selIds: string[], gap: number) {
    const saved = state.available.slice(1);
    const insertion = insertionFor({
      type: 'group',
      rows: saved.map((g, i) => ({ id: g.id, order: i + 1, starred: g.starred })),
      containerKey: 'groups',
      activeId: selIds[0],
      selectionIds: selIds,
      wantIndex: gap
    })!;
    const over: DndRef = { type: 'group', id: insertion.commitOverId! };
    if (insertion.commitAfter !== undefined) over.after = insertion.commitAfter;
    const res = applyMove(model, state, { type: 'group', id: selIds[0], selectionIds: selIds }, over);
    return { insertion, order: ids(res.next) };
  }

  it('selection entirely ABOVE the gap', () => {
    // a,b out; rest = c d e f; gap 2 → between d and e
    expect(drop(['a', 'b'], 2).order).toEqual(['now', 'c', 'd', 'a', 'b', 'e', 'f']);
  });

  it('selection entirely BELOW the gap', () => {
    // e,f out; rest = a b c d; gap 1 → between a and b
    expect(drop(['e', 'f'], 1).order).toEqual(['now', 'a', 'e', 'f', 'b', 'c', 'd']);
  });

  it('selection STRADDLING the gap', () => {
    // b,e out; rest = a c d f; gap 2 → between c and d
    expect(drop(['b', 'e'], 2).order).toEqual(['now', 'a', 'c', 'b', 'e', 'd', 'f']);
  });

  it('NON-CONTIGUOUS selection gathers into one block in ORIGINAL order (not click order)', () => {
    expect(drop(['f', 'd', 'a'], 1).order).toEqual(['now', 'b', 'a', 'd', 'f', 'c', 'e']);
  });

  it('gap ADJACENT to the selection on either side is a no-op reorder', () => {
    expect(drop(['c', 'd'], 2).order).toEqual(['now', 'a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('dropped at the very TOP is clamped below Now Open and shifts the whole block down', () => {
    const { insertion, order } = drop(['c', 'e'], 0);
    expect(insertion.index).toBe(0);
    expect(order).toEqual(['now', 'c', 'e', 'a', 'b', 'd', 'f']);
  });

  it('dropped at the very BOTTOM lands after the last row (the case with no anchor below it)', () => {
    const { insertion, order } = drop(['a', 'c'], 4);
    expect(insertion.commitAfter).toBe(true);
    expect(insertion.commitOverId).toBe('f');
    expect(order).toEqual(['now', 'b', 'd', 'e', 'f', 'a', 'c']);
  });

  it('a block dropped into the OTHER zone parks on the zone boundary — gap and commit agree', () => {
    const zoned = sidebar(2); // now · a* · b* · c · d · e · f
    const zm = buildDndModel(zoned);
    const saved = zoned.available.slice(1);
    const selIds = ['e', 'f'];
    // aim at the very top of the sidebar, i.e. above the starred groups
    const insertion = insertionFor({
      type: 'group',
      rows: saved.map((g, i) => ({ id: g.id, order: i + 1, starred: g.starred })),
      containerKey: 'groups',
      activeId: 'e',
      selectionIds: selIds,
      wantIndex: 0
    })!;
    // rest = a* b* c d → the unstarred zone starts at 2
    expect(insertion.index).toBe(2);
    const over: DndRef = { type: 'group', id: insertion.commitOverId! };
    if (insertion.commitAfter !== undefined) over.after = insertion.commitAfter;
    const res = applyMove(zm, zoned, { type: 'group', id: 'e', selectionIds: selIds }, over);
    expect(ids(res.next)).toEqual(['now', 'a', 'b', 'e', 'f', 'c', 'd']);
  });

  it('refuses a selection that spans both zones instead of splitting it', () => {
    const zoned = sidebar(2); // a*, b* starred
    const zm = buildDndModel(zoned);
    expect(canDrop(zm, { type: 'group', id: 'a', selectionIds: ['a', 'c'] }, { type: 'group', id: 'e' })).toBe(false);
    // …and the engine refuses it too, not just the pre-check.
    const res = applyMove(zm, zoned, { type: 'group', id: 'a', selectionIds: ['a', 'c'] }, { type: 'group', id: 'e' });
    expect(res.next).toBe(zoned);
  });

  it('normalises a sidebar that was NOT already zone-sorted, without moving the dragged block off the gap', () => {
    const messy: GroupsState = {
      active: { id: 'now', index: 0 },
      available: [
        group('now', { permanent: true, windows: [] }),
        group('a'),
        group('b', { starred: true }),
        group('c'),
        group('d', { starred: true })
      ]
    };
    const mm = buildDndModel(messy);
    // move unstarred `c` to the top of its own zone: before `a`
    const res = applyMove(mm, messy, { type: 'group', id: 'c' }, { type: 'group', id: 'a', after: false });
    expect(ids(res.next)).toEqual(['now', 'b', 'd', 'c', 'a']);
  });
});

// ─── windows ─────────────────────────────────────────────────────────────────

describe('§6.1 multi-item ordering — windows (property sweep)', () => {
  it('lands a multi-window block exactly at the drawn gap for every selection × gap × starred layout', () => {
    let cases = 0;
    for (let starredCount = 0; starredCount <= WINDOW_NAMES.length; starredCount++) {
      const state = windowList(starredCount);
      const model = buildDndModel(state);
      const windows = state.available[1].windows;
      const rows = windows.map((w, i) => ({ id: `g::w${i}`, order: i, starred: w.starred }));

      for (const selRows of subsets(rows)) {
        const selIds = selRows.map((r) => r.id);
        const rest = windows.filter((_w, i) => !selIds.includes(`g::w${i}`));
        if (new Set(selRows.map(zone)).size > 1) {
          expect(
            canDrop(model, { type: 'window', id: selIds[0], selectionIds: selIds }, { type: 'window', id: `g::w${windows.findIndex((_w, i) => !selIds.includes(`g::w${i}`))}` })
          ).toBe(false);
          continue;
        }
        if (rest.length === 0) continue;
        const [lo, hi] = zoneBounds(rest, zone(selRows[0]));

        for (let gap = 0; gap <= rest.length; gap++) {
          const insertion = insertionFor({
            type: 'window',
            rows,
            containerKey: 'g',
            activeId: selIds[0],
            selectionIds: selIds,
            wantIndex: gap
          })!;
          expect(insertion.index).toBe(Math.min(Math.max(gap, lo), hi));

          // Past the last sibling the windows list appends via its GROUP ROW — there is a
          // container droppable for it, unlike the sidebar.
          const over: DndRef =
            insertion.commitOverId === 'g'
              ? { type: 'group', id: 'g' }
              : { type: 'window', id: insertion.commitOverId! };
          const active: DndRef = { type: 'window', id: selIds[0], selectionIds: selIds };
          const res = applyMove(model, state, active, over);
          const expected = removeThenInsertAt(
            windows,
            (w) => selIds.includes(`g::w${windows.indexOf(w)}`),
            insertion.index
          ).map((w) => w.name);
          expect(winNames(res.next)).toEqual(expected);
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(300);
  });

  it('a multi-window selection spanning the starred boundary is refused, not split', () => {
    const state = windowList(2); // w0*, w1* starred
    const model = buildDndModel(state);
    const sel = ['g::w1', 'g::w2'];
    expect(canDrop(model, { type: 'window', id: sel[0], selectionIds: sel }, { type: 'window', id: 'g::w4' })).toBe(false);
    const res = applyMove(model, state, { type: 'window', id: sel[0], selectionIds: sel }, { type: 'window', id: 'g::w4' });
    expect(res.next).toBe(state);
  });

  it('an unstarred window dragged into the starred zone parks on the boundary (single-item path)', () => {
    const state = windowList(2); // w0*, w1*, w2, w3, w4
    const model = buildDndModel(state);
    const rows = state.available[1].windows.map((w, i) => ({ id: `g::w${i}`, order: i, starred: w.starred }));
    const insertion = insertionFor({
      type: 'window',
      rows,
      containerKey: 'g',
      activeId: 'g::w4',
      selectionIds: ['g::w4'],
      wantIndex: 0
    })!;
    expect(insertion.index).toBe(2);
    const res = applyMove(model, state, { type: 'window', id: 'g::w4' }, { type: 'window', id: insertion.commitOverId! });
    expect(winNames(res.next)).toEqual(['w0', 'w1', 'w4', 'w2', 'w3']);
  });
});
