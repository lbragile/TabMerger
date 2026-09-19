/**
 * Pointer-driven insertion index for the COLLAPSED-source drag model.
 *
 * While a native HTML5 drag is live, `Html5DragSensor` collapses the dragged row
 * to zero height (see `collapseSource`), so the list closes up and the dragged
 * item no longer owns a slot. dnd-kit's `verticalListSortingStrategy` +
 * "commit against `over`" both assume the active item KEEPS its slot (arrayMove
 * semantics keyed off the hovered item), which is wrong once it's collapsed — e.g.
 * picking up and releasing in place would move the item down one.
 *
 * This module instead computes, from the pointer's Y against the (transform-
 * agnostic, collapsed-layout) rects of the OTHER items in the hovered container:
 *   - `index`     — where the item will be inserted among the others
 *   - `shiftIds`  — the others at/after `index`; the UI translates them down by
 *                   the dragged item's height, opening the gap at the pointer
 *   - `commitOverId` (+ `commitAfter`) — the target id that makes the existing
 *                   `applyMove` land the item EXACTLY in that gap. Groups and every
 *                   multi-item block are anchored by IDENTITY ("before the sibling after
 *                   the gap", or "after the last one"); a single same-container tab/window
 *                   keeps dnd-kit's arrayMove target (the item at original position
 *                   `index`); a foreign tab list appends via the window itself.
 * so the gap the user sees and the committed position can never disagree.
 *
 * Group and window lists are also ZONED — starred rows are pinned above unstarred ones —
 * so `index` is clamped into the dragged item's own zone (`activeZone`). Without that the
 * gap could be drawn somewhere the commit is not allowed to honour, which is exactly how
 * a multi-group drop used to land one slot away from where it was shown (spec §6.1).
 *
 * Pure — no DOM, no dnd-kit imports (vitest mocks of `@dnd-kit/core` are partial).
 */

export type InsertableType = 'tab' | 'window' | 'group';

export interface InsertionCandidate {
  id: string;
  type: string;
  /** container this item sorts within: tab → its window id, window → its group id, group → 'groups' */
  containerKey: string;
  /** original position within its container */
  order: number;
  /** vertical center of its measured (transform-agnostic) rect */
  centerY: number;
  /**
   * Zone this item is pinned to — 0 starred, 1 unstarred (`zoneRank` in `@/lib/dndMove`).
   * Groups and windows only; omitted (or omitted on the active) means "unzoned", which
   * disables clamping entirely.
   */
  zone?: number;
}

export interface DndInsertion {
  type: InsertableType;
  containerKey: string;
  index: number;
  sameContainer: boolean;
  shiftIds: string[];
  /** `null` = no valid commit target for this insertion (caller falls back to `over`). */
  commitOverId: string | null;
  /**
   * Identity-anchored ordering (spec §6.1): the block lands immediately AFTER
   * `commitOverId` rather than before it. Only ever set for GROUP drags, where the gap can
   * sit past the last sibling and the sidebar list has no container droppable to append
   * to (a window list appends via its group row instead). The handler copies it onto the
   * over ref as `DndRef.after`, which is what stops `dndMove` from guessing a direction.
   */
  commitAfter?: boolean;
}

/**
 * Live gap state rendered by the sortable rows while the source is collapsed:
 * every id in `shiftIds` is translated down by `height`.
 */
export interface DndGap {
  height: number;
  shiftIds: ReadonlySet<string>;
  /**
   * The list currently holding the gap (a window id for tabs, a group id for
   * windows, `'groups'` for the sidebar), or null when the pointer is over no list.
   * That list grows by `height` (bottom padding) so the gap never overflows it; the
   * collapsed source takes `height` away from the home list, so while the gap is at
   * home the home list keeps its size.
   */
  containerKey: string | null;
}

/** Extra bottom padding (px) for the list keyed `key` under `gap`. */
export function gapGrowthFor(gap: DndGap | null | undefined, key: string): number {
  return gap && gap.containerKey === key ? Math.round(gap.height) : 0;
}

/**
 * Inline style for a sortable LIST container: its normal bottom padding (`basePad`,
 * a CSS length matching its Tailwind class) plus `grow` px while it holds the gap.
 * The padding animates with the row transforms (200ms), except during the frames
 * the sensor holds transitions off (`[data-tm-dnd-list]` in globals.css).
 */
export function dndListStyle(grow: number, basePad: string): { paddingBottom?: string; transition: string } {
  return grow > 0
    ? { paddingBottom: `calc(${basePad} + ${grow}px)`, transition: 'padding-bottom 200ms ease' }
    : { transition: 'padding-bottom 200ms ease' };
}

/**
 * The row transform for `id` under `gap`.
 * `null` → no collapsed-gap drag is live; the caller keeps dnd-kit's own
 * sortable transform (keyboard drags, idle). `undefined` → no displacement.
 */
export function gapTransformFor(gap: DndGap | null | undefined, id: string): string | undefined | null {
  if (!gap) return null;
  return gap.shiftIds.has(id) ? `translate3d(0, ${Math.round(gap.height)}px, 0)` : undefined;
}

const TAB_ORDER = /::t(\d+)$/;
const WINDOW_ORDER = /::w(\d+)$/;

/** Original position of a sortable item, from its positional model id (or `data.index` for groups). */
export function orderOf(type: string, id: string, data?: { index?: number } | null): number {
  if (type === 'tab') return Number(TAB_ORDER.exec(id)?.[1] ?? NaN);
  if (type === 'window') return Number(WINDOW_ORDER.exec(id)?.[1] ?? NaN);
  if (type === 'group') return typeof data?.index === 'number' ? data.index : NaN;
  return NaN;
}

/** Which container a droppable of `type` sorts within. */
export function containerKeyOf(
  type: string,
  id: string,
  data?: { windowId?: string; groupId?: string } | null
): string | null {
  if (type === 'tab') return data?.windowId ?? id.replace(TAB_ORDER, '');
  if (type === 'window') return data?.groupId ?? id.replace(WINDOW_ORDER, '');
  if (type === 'group') return 'groups';
  return null;
}

/**
 * The container an ACTIVE item of `activeType` would be inserted into, given the
 * droppable it is over. A tab drag over a WINDOW row inserts into that window's
 * tab list; any other cross-type hit (group row, new-window zone, …) has no
 * insertion — those keep their existing `over`-based commit.
 */
export function targetContainerKey(
  activeType: string,
  hit: { id: string; type: string; data?: { windowId?: string; groupId?: string } | null }
): string | null {
  if (activeType === 'tab') {
    if (hit.type === 'tab') return containerKeyOf('tab', hit.id, hit.data);
    if (hit.type === 'window') return hit.id;
    return null;
  }
  if (activeType === 'window' && hit.type === 'window') return containerKeyOf('window', hit.id, hit.data);
  if (activeType === 'group' && hit.type === 'group') return 'groups';
  return null;
}

/**
 * Clamp a gap index into the dragged item's own zone.
 *
 * `others` is the post-removal list in render order, which is zone-ordered (starred
 * first), so the positions the block may legally occupy are the contiguous run
 * `[#others above the zone, … + #others in the zone]`. A pointer in the other zone
 * therefore parks the gap on the zone BOUNDARY instead of drawing a gap the commit could
 * never honour. Candidates with no `zone` count as same-zone, so an unzoned list (tabs) or
 * a caller that doesn't plumb zones is unaffected.
 */
function clampToZone(others: InsertionCandidate[], index: number, activeZone: number | undefined): number {
  if (activeZone == null) return index;
  const zone: number = activeZone;
  let above = 0;
  let same = 0;
  for (const c of others) {
    const r: number = c.zone ?? zone;
    if (r < zone) above++;
    else if (r === zone) same++;
  }
  return Math.min(Math.max(index, above), above + same);
}

export function computeInsertion(args: {
  activeId: string;
  activeType: string;
  activeContainerKey: string | null;
  activeOrder: number;
  targetKey: string;
  /** every droppable of the ACTIVE type (the active itself is ignored) */
  candidates: InsertionCandidate[];
  /** vertical center of the dragged item as it is being carried */
  probeY: number;
  /** the dragged item's height — the size of the gap that opens */
  gapHeight: number;
  /**
   * Multi-item drag: every OTHER selected id. Those rows are collapsed out of the
   * layout too, so they are not "others" the gap can sit between, and the commit
   * target is always "insert BEFORE the item after the gap" (or append via the
   * container) — `moveTabsMulti`/`moveWindowsMulti` subtract the selected items that
   * sat before that target, which lands the whole block exactly in the gap.
   */
  selectionIds?: ReadonlySet<string>;
  /**
   * Zone of the dragged item/block (`InsertionCandidate.zone`). When given, the gap is
   * CLAMPED into that zone: starred groups/windows are pinned above unstarred ones, so a
   * position outside the block's own zone is one the commit could never honour. Clamping
   * here (rather than letting `dndMove` re-sort afterwards) is what keeps the drawn gap
   * and the committed position identical — spec §6.1.
   */
  activeZone?: number;
}): DndInsertion | null {
  const { activeId, activeType, activeContainerKey, activeOrder, targetKey, candidates, probeY, gapHeight } = args;
  if (activeType !== 'tab' && activeType !== 'window' && activeType !== 'group') return null;
  // Every OTHER selected row is collapsed out of the layout, so `others` is the list as it
  // will be AFTER the block is removed — which is what makes the gap index and the commit
  // index the same number for a multi-item drag (spec §6.1).
  const selection = args.selectionIds && args.selectionIds.size > 1 ? args.selectionIds : null;
  const others = candidates
    .filter(
      (c) =>
        c.type === activeType &&
        c.containerKey === targetKey &&
        c.id !== activeId &&
        !selection?.has(c.id) &&
        Number.isFinite(c.order)
    )
    .sort((x, y) => x.order - y.order);
  // With the gap at k, member k is displaced down by `gapHeight`. The midpoint
  // between "gap before member k" and "gap after member k" is member k's collapsed
  // center + gapHeight/2 — so compare against that. This also gives a half-row
  // dead zone around the pickup point: picking up and releasing in place is a
  // no-op, not a flicker between two slots.
  const half = Math.max(0, gapHeight) / 2;
  const index = clampToZone(others, others.filter((c) => c.centerY + half < probeY).length, args.activeZone);
  const sameContainer = activeContainerKey === targetKey;
  const shiftIds = others.slice(index).map((c) => c.id);

  let commitOverId: string | null;
  // Left UNDEFINED for tab/window drags on purpose: their "past the end" case appends via
  // the container id instead, and a single same-list drag still wants `dndMove`'s
  // arrayMove direction. Forcing `after: false` on those would drop them one slot short.
  let commitAfter: boolean | undefined;
  if (activeType === 'group') {
    // The sidebar has no container droppable to append to, so "past the last row" is
    // expressed as "after the last row". Identical formula for a single group and a
    // block: the others ARE the post-removal list, so the gap index is the landing index.
    const last = others.length - 1;
    commitOverId = others[index]?.id ?? (last >= 0 ? others[last].id : null);
    commitAfter = index > last && last >= 0;
  } else if (selection && (activeType === 'tab' || activeType === 'window')) {
    // Multi: always "before the item after the gap", else append via the container —
    // the selected items are removed first, so arrayMove semantics don't apply.
    commitOverId = others[index]?.id ?? targetKey;
  } else if (sameContainer) {
    // Final position `index` == arrayMove(activeOrder, index): target the item that
    // ORIGINALLY sat at position `index` (the active itself when index is its own
    // slot → a no-op drop).
    const original = [...others, { id: activeId, order: activeOrder }].sort((x, y) => x.order - y.order);
    commitOverId = original[index]?.id ?? null;
  } else {
    // Foreign list: insert BEFORE the item after the gap, or append via the container
    // (the window for a tab list; the group id — i.e. its row, "add as a new window at
    // the end of its zone" — for a window list reached after spring-open).
    commitOverId = others[index]?.id ?? targetKey;
  }

  return { type: activeType, containerKey: targetKey, index, sameContainer, shiftIds, commitOverId, commitAfter };
}
