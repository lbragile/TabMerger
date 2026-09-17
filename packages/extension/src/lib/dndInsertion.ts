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
 *   - `commitOverId` — the target id that makes the existing `applyMove` land the
 *                   item EXACTLY in that gap (same container: the item at original
 *                   position `index`, i.e. arrayMove(a, index); foreign tab list:
 *                   the item the gap sits before, or the window itself to append)
 * so the gap the user sees and the committed position can never disagree.
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
}

export interface DndInsertion {
  type: InsertableType;
  containerKey: string;
  index: number;
  sameContainer: boolean;
  shiftIds: string[];
  /** `null` = no valid commit target for this insertion (caller falls back to `over`). */
  commitOverId: string | null;
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
}): DndInsertion | null {
  const { activeId, activeType, activeContainerKey, activeOrder, targetKey, candidates, probeY, gapHeight } = args;
  if (activeType !== 'tab' && activeType !== 'window' && activeType !== 'group') return null;
  const selection = activeType !== 'group' && args.selectionIds && args.selectionIds.size > 1 ? args.selectionIds : null;
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
  const index = others.filter((c) => c.centerY + half < probeY).length;
  const sameContainer = activeContainerKey === targetKey;
  const shiftIds = others.slice(index).map((c) => c.id);

  let commitOverId: string | null;
  if (selection && (activeType === 'tab' || activeType === 'window')) {
    // Multi: always "before the item after the gap", else append via the container —
    // the selected items are removed first, so arrayMove semantics don't apply.
    commitOverId = others[index]?.id ?? targetKey;
  } else if (sameContainer) {
    // Final position `index` == arrayMove(activeOrder, index): target the item that
    // ORIGINALLY sat at position `index` (the active itself when index is its own
    // slot → a no-op drop).
    const original = [...others, { id: activeId, order: activeOrder }].sort((x, y) => x.order - y.order);
    commitOverId = original[index]?.id ?? null;
  } else if (activeType === 'tab' || activeType === 'window') {
    // Foreign list: insert BEFORE the item after the gap, or append via the container
    // (the window for a tab list; the group id — i.e. its row, "add as a new window at
    // the end" — for a window list reached after spring-open).
    commitOverId = others[index]?.id ?? targetKey;
  } else {
    commitOverId = null;
  }

  return { type: activeType, containerKey: targetKey, index, sameContainer, shiftIds, commitOverId };
}
