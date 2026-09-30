import type { KeyboardCoordinateGetter } from '@dnd-kit/core';
import { getDndDragSelection } from '@/lib/dndMultiDrag';

/**
 * Keyboard drag TARGET NAVIGATION.
 *
 * dnd-kit's stock `sortableKeyboardCoordinates` walks raw geometry (closest corner in the
 * pressed direction across EVERY droppable). That produced phantom stops (each window
 * CONTAINER counted as a target between its own tabs, and one more above the first tab), let
 * ArrowDown/Left leak into the sidebar by accident, and never clamped at the ends. This
 * module replaces it with an explicit target-list model: for every drag it builds the ordered
 * list of REAL targets for the pane the cursor is in and steps ±1 through it, clamping at
 * both ends (no wrap, no extra stop).
 *
 *  - MAIN pane, tab drag: every tab row (the dragged tab's own slot included), the rows of
 *    empty windows, then the "Drop here for a new window" zone.
 *  - MAIN pane, window drag: every window.
 *  - SIDEBAR pane (tab/window drag, entered with ArrowLeft at the active group, left with
 *    ArrowRight): group rows, then the "Drop for a new group" zone.
 *  - Group drag: the saved group rows (never Now Open).
 *
 * Every step is FORCED into collision detection (see {@link getForcedKeyboardTarget}) rather
 * than inferred from rect overlap, which is ambiguous between a wide tab rect and a narrow
 * sidebar row.
 */

export type KbDirection = 'up' | 'down';

export interface KbTargetInfo {
  id: string;
  /** droppable `data.type` */
  type: string | undefined;
  /** group-row position (0 = Now Open) */
  index?: number;
  /** the window a tab row belongs to (`data.windowId`) */
  windowId?: string;
  top: number;
  left?: number;
}

/** Sidebar-pane droppables: group rows and the "new group" zone. */
export const isSidebarType = (type: string | undefined): boolean => type === 'group' || type === 'new-group';

const byPosition = (a: KbTargetInfo, b: KbTargetInfo) => a.top - b.top || (a.left ?? 0) - (b.left ?? 0);

/**
 * Sidebar targets in visual order. The Now Open row is left out when the dragged item lives
 * in Now Open (`canDrop` refuses tearing a live tab out from under the popup), so a keyboard
 * user never lands on a target that cannot accept the drop.
 */
export function sidebarTargets(all: KbTargetInfo[], sourceInNowOpen: boolean): KbTargetInfo[] {
  return all
    .filter((t) => isSidebarType(t.type) && !(sourceInNowOpen && t.type === 'group' && t.index === 0))
    .sort(byPosition);
}

/**
 * Main-pane targets for a tab or window drag. `skip` holds the OTHER members of a
 * multi-selection (never a slot for their own selection). Window containers are only targets
 * for a window drag, or for a tab drag when the window is EMPTY (otherwise they are phantom
 * stops sitting between their own tabs).
 */
export function mainTargets(all: KbTargetInfo[], activeType: 'tab' | 'window', skip?: ReadonlySet<string> | null, activeId?: string): KbTargetInfo[] {
  const windowsWithTabs = new Set(all.filter((t) => t.type === 'tab' && t.windowId).map((t) => t.windowId as string));
  return all
    .filter((t) => {
      if (skip?.has(t.id) && t.id !== activeId) return false;
      if (activeType === 'window') return t.type === 'window';
      if (t.type === 'tab' || t.type === 'new-window') return true;
      return t.type === 'window' && !windowsWithTabs.has(t.id);
    })
    .sort(byPosition);
}

/** Group-drag targets: saved group rows only (Now Open never moves and nothing lands before it). */
export function groupTargets(all: KbTargetInfo[], skip?: ReadonlySet<string> | null, activeId?: string): KbTargetInfo[] {
  return all
    .filter((t) => t.type === 'group' && t.index !== 0 && !(skip?.has(t.id) && t.id !== activeId))
    .sort(byPosition);
}

/** Entry point when pressing ArrowLeft: the active group's row, else the nearest valid group row. */
export function pickSidebarStart(targets: KbTargetInfo[], activeGroupIndex: number): string | null {
  const groups = targets.filter((t) => t.type === 'group');
  if (groups.length === 0) return targets[0]?.id ?? null;
  const exact = groups.find((t) => t.index === activeGroupIndex);
  if (exact) return exact.id;
  let best = groups[0];
  for (const g of groups) {
    if (Math.abs((g.index ?? 0) - activeGroupIndex) < Math.abs((best.index ?? 0) - activeGroupIndex)) best = g;
  }
  return best.id;
}

/**
 * One step up/down a target list. Clamps at both ends: returns `currentId` unchanged when
 * there is nothing further (no wrap, no phantom stop). An id not in the list re-enters at
 * the first target.
 */
export function stepTargets(targets: KbTargetInfo[], currentId: string, dir: KbDirection): string {
  const i = targets.findIndex((t) => t.id === currentId);
  if (i < 0) return targets[0]?.id ?? currentId;
  const next = dir === 'down' ? Math.min(i + 1, targets.length - 1) : Math.max(i - 1, 0);
  return targets[next].id;
}

/** @deprecated alias kept for callers/tests written against the sidebar-only name. */
export const stepSidebar = stepTargets;

// ─── forced target (read by the collision layer) ────────────────────────────

let forced: { activeId: string; targetId: string } | null = null;

/** The target the keyboard cursor sits on, for THIS drag, or null before the first arrow key. */
export function getForcedKeyboardTarget(activeId: string | undefined): string | null {
  return forced && activeId != null && forced.activeId === activeId ? forced.targetId : null;
}

export function clearForcedKeyboardTarget(): void {
  forced = null;
}

// ─── the coordinate getter ──────────────────────────────────────────────────

type Ctx = Parameters<KeyboardCoordinateGetter>[1]['context'];
type DataOf = { type?: string; index?: number; groupId?: string; windowId?: string } | undefined;

function gather(context: Ctx): KbTargetInfo[] {
  const out: KbTargetInfo[] = [];
  context.droppableContainers.getEnabled().forEach((entry) => {
    const rect = context.droppableRects.get(entry.id);
    if (!rect) return;
    const d = entry.data?.current as DataOf;
    out.push({ id: String(entry.id), type: d?.type, index: d?.index, windowId: d?.windowId, top: rect.top, left: rect.left });
  });
  return out;
}

/**
 * KeyboardSensor `coordinateGetter`. `getActiveGroupIndex` is read lazily (the sidebar entry
 * point), keeping this module free of store imports.
 */
export function createKeyboardCoordinateGetter(getActiveGroupIndex: () => number): KeyboardCoordinateGetter {
  return (event, args) => {
    const { context } = args;
    const active = context.active;
    if (!active) return undefined;
    const code = event.code;
    // Tab must not walk focus out of a live drag (Escape cancels); the sensor itself no
    // longer treats it as "drop" (see `useDndSensors`).
    if (code === 'Tab') {
      event.preventDefault();
      return undefined;
    }
    if (code !== 'ArrowUp' && code !== 'ArrowDown' && code !== 'ArrowLeft' && code !== 'ArrowRight') return undefined;
    event.preventDefault();

    const activeData = active.data?.current as DataOf;
    const kind = activeData?.type;
    if (kind !== 'tab' && kind !== 'window' && kind !== 'group') return undefined;

    const activeId = String(active.id);
    const all = gather(context);
    const skip = getDndDragSelection();
    const typeOf = (id: string) => all.find((t) => t.id === id)?.type;
    const current = getForcedKeyboardTarget(activeId) ?? activeId;
    const inSidebar = kind !== 'group' && isSidebarType(typeOf(current));
    const coordsOf = (id: string) => {
      const r = context.droppableRects.get(id);
      return r ? { x: r.left, y: r.top } : undefined;
    };
    const go = (id: string) => {
      if (id === current) return undefined; // clamped at an end: no move, no announcement
      forced = { activeId, targetId: id };
      return coordsOf(id);
    };

    if (kind === 'group') {
      if (code === 'ArrowLeft' || code === 'ArrowRight') return undefined;
      return go(stepTargets(groupTargets(all, skip, activeId), current, code === 'ArrowDown' ? 'down' : 'up'));
    }

    if (code === 'ArrowLeft') {
      if (inSidebar) return undefined;
      const nowOpen = all.find((t) => t.type === 'group' && t.index === 0);
      const targets = sidebarTargets(all, !!nowOpen && nowOpen.id === activeData?.groupId);
      const start = pickSidebarStart(targets, getActiveGroupIndex());
      return start ? go(start) : undefined;
    }
    if (code === 'ArrowRight') {
      // Back to the item's own slot in the main pane.
      return inSidebar ? go(activeId) : undefined;
    }

    // ArrowUp / ArrowDown
    const dir: KbDirection = code === 'ArrowDown' ? 'down' : 'up';
    if (inSidebar) {
      const nowOpen = all.find((t) => t.type === 'group' && t.index === 0);
      const targets = sidebarTargets(all, !!nowOpen && nowOpen.id === activeData?.groupId);
      return go(stepTargets(targets, current, dir));
    }
    return go(stepTargets(mainTargets(all, kind, skip, activeId), current, dir));
  };
}
