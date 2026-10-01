import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  DndContext,
  pointerWithin,
  rectIntersection,
  closestCenter,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type Announcements,
  type UniqueIdentifier
} from '@dnd-kit/core';
import { useDndSensors } from '@/hooks/useDnd';
import { useDndHandlers, type DndActive } from '@/hooks/useDndHandlers';
import {
  DND_SOURCE_COLLAPSE_EVENT,
  getDndDragSession,
  getDndDragSourceHeight,
  type DndDragSession
} from '@/lib/dndHtml5Sensor';
import {
  computeInsertion,
  containerKeyOf,
  orderOf,
  targetContainerKey,
  type DndGap,
  type DndInsertion,
  type InsertionCandidate
} from '@/lib/dndInsertion';
import { getDndDragSelection } from '@/lib/dndMultiDrag';
import { dndDebugLog } from '@/lib/dndDebug';
import { DND_SCREEN_READER_INSTRUCTIONS } from '@/lib/dndAnnouncements';
import type { GroupsState } from '@/lib/types';
import type { DndRef } from '@/lib/dndMove';

/**
 * ONE drag-and-drop layer for the popup: exactly one `<DndContext>`, with the live
 * drag state exposed through context.
 *
 * It is nesting-aware: mounting a second `<DndProvider>` inside an existing one is a
 * no-op passthrough, so `WindowsPanel` can host its own provider in isolation
 * (unit tests) while the real app hoists a single provider around both panels.
 */
interface DndProviderValue {
  /** working copy produced by `onDragOver` — render from this while a drag is live */
  overrideState: GroupsState | null;
  active: DndActive | null;
  isDragging: boolean;
  /**
   * Non-null while a native HTML5 drag has COLLAPSED its source row: sortable rows
   * whose id is in `gap.shiftIds` translate down by `gap.height` (the insertion gap
   * at the pointer) instead of using dnd-kit's sortable transform. See
   * `@/lib/dndInsertion`.
   */
  gap: DndGap | null;
  /**
   * Commit a keyboard MOVE MODE move (`useKeyboardMove`) through the exact commit tail a
   * pointer drop ends in. No-op outside a provider.
   */
  commitKeyboardMove: (active: DndRef, over: DndRef) => Promise<void>;
  /**
   * Set (or clear with `null`) the insertion gap rendered by the rows — the SAME state the
   * pointer drives from `onDragMove`. Keyboard move mode feeds it the gap of each target.
   */
  applyGap: (gap: DndGap | null) => void;
}

const EMPTY: DndProviderValue = {
  overrideState: null,
  active: null,
  isDragging: false,
  gap: null,
  commitKeyboardMove: async () => {},
  applyGap: () => {}
};
const DndProviderCtx = createContext<DndProviderValue | null>(null);

export function useDndContext(): DndProviderValue {
  return useContext(DndProviderCtx) ?? EMPTY;
}

const asCollisions = (v: unknown): Collision[] => (Array.isArray(v) ? (v as Collision[]) : []);

/**
 * Collision cascade: `pointerWithin` → `rectIntersection` → `closestCenter`.
 * Window/group drags only collide with containers of their own type (or a group row).
 *
 * Why the `closestCenter` tail matters — this is the toolbar-popup fix:
 * `pointerWithin` and `rectIntersection` are both "hit or miss" — each returns `[]`
 * whenever the live pointer coordinate isn't inside a droppable rect / the dragging
 * rect overlaps nothing. In the fixed 800×600 MV3 *action popup* a real-mouse drag
 * routinely ends with the last delivered pointer sample sitting over a row gap, the
 * toolbar, the scrollbar, or a hair outside the popup, so both algorithms return
 * `[]`, `over` resolves to nothing, and `onDragEnd` bails → "nothing happens".
 * `closestCenter` is rect-geometry only and ALWAYS resolves to the nearest droppable
 * when any exist, so it is the final fallback.
 */
export const unifiedCollision: CollisionDetection = (args) => {
  const activeType = (args.active?.data?.current as { type?: string } | undefined)?.type;

  const sameTypeOnly = (hits: Collision[]): Collision[] => {
    if (activeType !== 'window' && activeType !== 'group') return hits;
    const filtered = hits.filter((hit) => {
      const container = args.droppableContainers.find((c) => c.id === hit.id);
      const d = container?.data?.current as { type?: string; index?: number } | undefined;
      const t = d?.type;
      if (activeType === 'group') {
        // A group may only reorder among OTHER non-permanent group rows. Never let
        // the permanent "Now Open" row (index 0) be a target, so no drop
        // indicator shows above/on it and a group can't land at index 0.
        return t === 'group' && d?.index !== 0;
      }
      return t === activeType || t === 'group';
    });
    // For group drags, do NOT fall back to the unfiltered hits — that would
    // re-admit the Now Open row. An empty result = "no valid target here".
    if (activeType === 'group') return filtered;
    if (filtered.length > 0) return filtered;
    // No window/group-type hit at the pointer — only a bare tab (or nothing). This is
    // DEFENSE IN DEPTH for the spring-open cross-group window-drop bug (spec C15): the
    // CONFIRMED root cause is dnd-kit's own `over` STATE (not this collision result)
    // lagging the live collision layer by a render right after `setActiveGroupIndex`
    // swaps the windows panel — see the model-based redirect in `commitDrop`
    // (`useDndHandlers.ts`), which is what actually fixes the repro. This branch never
    // fired in that repro (confirmed via a `dndDebugLog` probe), but if `pointerWithin`
    // ever genuinely returns only a tab hit for a window drag (no window/group hit at
    // all), a bare tab hit would otherwise flow through to `onDragEnd` as
    // `over.type === 'tab'`, which `canDrop` correctly REJECTS for a window drag (spec:
    // window → window | group only) — "nothing commits". Resolve it up to its OWN
    // window container instead: every allowed WINDOW target is itself either a window
    // or a group row, never a tab, so this can only turn a rejected drop into the right
    // one, never a wrong one.
    if (activeType === 'window') {
      const tabHit = hits.find((hit) => {
        const d = args.droppableContainers.find((c) => c.id === hit.id)?.data?.current as
          | { type?: string }
          | undefined;
        return d?.type === 'tab';
      });
      const windowId = tabHit
        ? (args.droppableContainers.find((c) => c.id === tabHit.id)?.data?.current as { windowId?: string } | undefined)
            ?.windowId
        : undefined;
      const windowContainer = windowId ? args.droppableContainers.find((c) => c.id === windowId) : undefined;
      if (windowContainer) {
        dndDebugLog('collision:window-fallback-tab', { tabHitId: tabHit ? String(tabHit.id) : null, windowId });
        return [{ id: windowContainer.id, data: { droppableContainer: windowContainer, value: 0 } }];
      }
    }
    return hits;
  };

  const pointer = asCollisions(pointerWithin(args));
  if (pointer.length > 0) return sameTypeOnly(pointer);

  const rect = asCollisions(rectIntersection(args));
  if (rect.length > 0) return sameTypeOnly(rect);

  // Final fallback — geometric, never returns [] when droppables exist.
  return sameTypeOnly(asCollisions(closestCenter(args)));
};

type SortableData = { type?: string; windowId?: string; groupId?: string; index?: number; starred?: boolean };

/**
 * Zone of a group/window row — starred rows are pinned above unstarred ones, so this is
 * what stops the gap being drawn at a position the commit could never honour (spec §6.1).
 * Tabs are unzoned (`undefined` disables clamping).
 */
function zoneOf(type: string | undefined, data: SortableData | undefined): number | undefined {
  if (type !== 'group' && type !== 'window') return undefined;
  return data?.starred ? 0 : 1;
}

/**
 * Decorate the winning collision with `data.tmInsertion` — the pointer-driven
 * insertion index for the collapsed-source drag model (`@/lib/dndInsertion`).
 * Runs against dnd-kit's own transform-agnostic `droppableRects`, so the gap
 * transforms it drives can never feed back into it. Never throws.
 */
export function attachInsertion(args: Parameters<CollisionDetection>[0], hits: Collision[]): Collision[] {
  try {
    if (hits.length === 0 || !args.active) return hits;
    const activeData = args.active.data?.current as SortableData | undefined;
    const activeType = activeData?.type;
    if (activeType !== 'tab' && activeType !== 'window' && activeType !== 'group') return hits;
    const first = hits[0];
    const hitData = args.droppableContainers.find((c) => c.id === first.id)?.data?.current as SortableData | undefined;
    if (!hitData?.type) return hits;
    const targetKey = targetContainerKey(activeType, { id: String(first.id), type: hitData.type, data: hitData });
    if (!targetKey) return hits;

    // The sensor's measured source height. NOT `active.rect.current.initial`: dnd-kit
    // assigns it the LIVE active-node rect, which reads height 0 once collapsed.
    // (That fallback only matters for non-native drags, which ignore insertions.)
    const gapHeight = getDndDragSourceHeight() || (args.active.rect.current.initial?.height ?? 0);
    // Center of the item as carried. `collisionRect.top` tracks the dragged item's
    // top (the collapsed active node keeps its top); fall back to the pointer.
    const probeY = args.collisionRect
      ? args.collisionRect.top + gapHeight / 2
      : args.pointerCoordinates?.y;
    if (typeof probeY !== 'number' || !Number.isFinite(probeY)) return hits;

    const activeZone = zoneOf(activeType, activeData);
    const selectionIds = getDndDragSelection() ?? undefined;
    const candidates: InsertionCandidate[] = [];
    /** A selection straddling the starred boundary is refused at drop (`canDrop`) — draw no gap for it. */
    let spansZones = false;
    for (const c of args.droppableContainers) {
      const d = c.data?.current as SortableData | undefined;
      if (d?.type !== activeType) continue;
      if (selectionIds?.has(String(c.id)) && zoneOf(activeType, d) !== activeZone) spansZones = true;
      if (activeType === 'group' && d.index === 0) continue; // "Now Open" never moves
      const rect = args.droppableRects.get(c.id);
      const key = containerKeyOf(activeType, String(c.id), d);
      if (!rect || !key) continue;
      candidates.push({
        id: String(c.id),
        type: activeType,
        containerKey: key,
        order: orderOf(activeType, String(c.id), d),
        centerY: rect.top + rect.height / 2,
        zone: zoneOf(activeType, d)
      });
    }
    if (spansZones) return hits;
    const activeId = String(args.active.id);
    const insertion = computeInsertion({
      activeId,
      activeType,
      activeContainerKey: containerKeyOf(activeType, activeId, activeData),
      activeOrder: orderOf(activeType, activeId, activeData),
      targetKey,
      candidates,
      probeY,
      gapHeight,
      // multi-drag: the other selected rows are collapsed, never slots the gap sits between
      selectionIds,
      activeZone
    });
    if (!insertion) return hits;
    return [{ ...first, data: { ...(first.data ?? {}), tmInsertion: insertion } }, ...hits.slice(1)];
  } catch {
    return hits;
  }
}

// ─── Virtual drag geometry ───────────────────────────────────────────────────
//
// While a native drag has collapsed its source, the live layout differs from what
// dnd-kit measured at drag start in two KNOWN ways:
//   1. the collapsed source removes `h` below itself (its ancestors shrink by `h`)
//   2. the list holding the gap grows by `h` of bottom padding (`gapGrowthFor`)
// Rather than re-measuring the DOM mid-drag (which feeds the gap's own layout
// changes back into collision detection → oscillation at list boundaries), the
// collision layer works on the drag-start SNAPSHOT of dnd-kit's rects with those
// two offsets applied. Offsets are keyed off pre-collapse coordinates and only hit
// rects in the same column (horizontal overlap), so the sidebar and the windows
// panel never affect each other. Moving between lists has built-in hysteresis of
// `h`: entering a list grows it under the pointer; leaving it shrinks it behind.
// Measuring stays `BeforeDragging`, so the snapshot and dnd-kit's rects agree.

type SortableGeoData = { type?: string; windowId?: string; groupId?: string; index?: number };

interface DndGeometry {
  seq: number;
  base: Map<UniqueIdentifier, ClientRect>;
  /** list currently holding the gap (what the UI renders the extra padding on) */
  gapKey: string | null;
}
let geometry: DndGeometry | null = null;

/** Record which list the gap is in (drives the virtual growth offset). */
export function noteGapContainer(key: string | null): void {
  if (geometry) geometry.gapKey = key;
}

/** Test hook — forget the cached drag-start snapshot. */
export function resetDndGeometry(): void {
  geometry = null;
}

const overlapsX = (a: { left: number; right: number }, b: { left: number; right: number }) =>
  a.left < b.right && b.left < a.right;

function shifted(r: ClientRect, dTop: number, dBottom: number): ClientRect {
  const top = r.top + dTop;
  const bottom = Math.max(top, r.bottom + dBottom);
  return { ...r, top, bottom, height: bottom - top };
}

/** Where the gap list's extra padding starts (pre-collapse coords) and the column it affects. */
function growthLine(
  args: Parameters<CollisionDetection>[0],
  base: Map<UniqueIdentifier, ClientRect>,
  key: string,
  activeType: string,
  activeId: string,
  session: DndDragSession
): { y: number; left: number; right: number } | null {
  let y = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const c of args.droppableContainers) {
    const d = c.data?.current as SortableGeoData | undefined;
    if (d?.type !== activeType || String(c.id) === activeId) continue;
    if (containerKeyOf(activeType, String(c.id), d) !== key) continue;
    const r = base.get(c.id) ?? args.droppableRects.get(c.id);
    if (!r) continue;
    y = Math.max(y, r.bottom);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  if (Number.isFinite(y)) return { y, left, right };
  // No other rows: the home list whose only row is the source, or an empty foreign window.
  const s = session.sourceRect;
  const activeKey = containerKeyOf(activeType, activeId, args.active?.data?.current as SortableGeoData | undefined);
  if (s && key === activeKey) return { y: s.top, left: s.left, right: s.right };
  const container = base.get(key) ?? args.droppableRects.get(key);
  return container ? { y: container.bottom - 6, left: container.left, right: container.right } : null;
}

/**
 * dnd-kit's droppable rects adjusted for the collapsed source + the growing gap
 * list (see above). Returns the live map untouched when no collapsed native drag
 * is in progress.
 */
export function virtualDroppableRects(
  args: Parameters<CollisionDetection>[0],
  session: DndDragSession | null
): Map<UniqueIdentifier, ClientRect> {
  const live = args.droppableRects;
  if (!session || !args.active) {
    if (!session) geometry = null;
    return live;
  }
  const activeId = String(args.active.id);
  const activeData = args.active.data?.current as SortableGeoData | undefined;
  const activeType = activeData?.type;
  if (!geometry || geometry.seq !== session.seq) {
    // First collision pass of this drag runs during dispatch — before the collapse.
    geometry = {
      seq: session.seq,
      base: new Map(live),
      gapKey: activeType ? containerKeyOf(activeType, activeId, activeData) : null
    };
  }
  if (!session.collapsed) return live;

  const h = session.height;
  const s = session.sourceConnected() ? session.sourceRect : null;
  // Every row collapsed out of the layout: the source plus, for a multi-drag, the other
  // visible selected rows. Each removes its own height below itself in its column.
  const collapsedRows: Array<{ rect: { top: number; bottom: number; left: number; right: number }; h: number }> = [];
  if (s) collapsedRows.push({ rect: s, h });
  const extraIds = new Set<string>();
  for (const x of session.extras ?? []) {
    if (!x.connected()) continue;
    collapsedRows.push({ rect: x.rect, h: x.height });
    if (x.id) extraIds.add(x.id);
  }
  const growth =
    geometry.gapKey && activeType
      ? growthLine(args, geometry.base, geometry.gapKey, activeType, activeId, session)
      : null;
  const out = new Map(live);
  for (const [id, r] of geometry.base) {
    if (!live.has(id)) continue; // unmounted since drag start
    if (s && String(id) === activeId) {
      out.set(id, { ...r, bottom: r.top, height: 0 });
      continue;
    }
    if (extraIds.has(String(id))) {
      // A collapsed selected row is no drop target at all (not even a closestCenter fallback).
      out.delete(id);
      continue;
    }
    let dTop = 0;
    let dBottom = 0;
    for (const c of collapsedRows) {
      if (!overlapsX(r, c.rect)) continue;
      if (r.top >= c.rect.bottom - 1) {
        dTop -= c.h;
        dBottom -= c.h;
      } else if (r.top <= c.rect.top + 1 && r.bottom >= c.rect.bottom - 1) {
        dBottom -= c.h;
      }
    }
    if (growth && overlapsX(r, growth)) {
      if (r.top >= growth.y - 1) {
        dTop += h;
        dBottom += h;
      } else if (r.bottom > growth.y + 1) {
        dBottom += h;
      }
    }
    out.set(id, dTop || dBottom ? shifted(r, dTop, dBottom) : r);
  }
  return out;
}

export const unifiedCollisionWithInsertion: CollisionDetection = (args) => {
  const rects = virtualDroppableRects(args, getDndDragSession());
  const vargs = rects === args.droppableRects ? args : { ...args, droppableRects: rects };
  const hits = attachInsertion(vargs, unifiedCollision(vargs));
  if (hits.length > 0) {
    noteGapContainer((hits[0].data as { tmInsertion?: DndInsertion } | undefined)?.tmInsertion?.containerKey ?? null);
  }
  return hits;
};

function label(entry: { data?: { current?: { type?: string } | null } } | null | undefined): string {
  return entry?.data?.current?.type ?? 'item';
}

/** Only used if the handlers hook supplies none (e.g. a test mock); the real text is `@/lib/dndAnnouncements`. */
const fallbackAnnouncements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${label(active)}`,
  onDragOver: ({ active, over }) =>
    over
      ? `${label(active)} moved over ${label(over)} ${String(over.id)}`
      : `${label(active)} is no longer over a drop target`,
  onDragEnd: ({ active, over }) =>
    over
      ? `${label(active)} dropped into ${label(over)} ${String(over.id)}`
      : `${label(active)} dropped`,
  onDragCancel: ({ active }) => `Movement cancelled; ${label(active)} returned to its position`
};

/**
 * There is NO `<DragOverlay>`: it mounts a `<div>` inside the `<DndContext>`
 * subtree, and a React commit during the `dragstart` dispatch that moves the drag
 * source aborts the native HTML5 drag in the MV3 popup. The drag visual is the
 * sensor's imperative cloned ghost in `#tm-dnd-aux-host` (`@/lib/dndHtml5Sensor`).
 */
function DndProviderRoot({ children }: { children: React.ReactNode }) {
  const sensors = useDndSensors();
  const {
    announcements,
    onDragStart,
    onDragOver,
    onDragMove,
    onDragCancel,
    onDragEnd,
    commitKeyboardMove,
    applyGap,
    onSourceCollapse,
    overrideState,
    active,
    gap
  } = useDndHandlers();
  useEffect(() => {
    const onCollapse = (ev: Event) => {
      const height = Number((ev as CustomEvent<{ height?: number }>).detail?.height);
      // Open the gap at the source slot (home list +h padding, later siblings
      // shifted) in the SAME task the sensor collapses the row, so the collapse and
      // the compensation share one style recalc — no visible jump.
      flushSync(() => onSourceCollapse(height));
    };
    document.addEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse);
    return () => document.removeEventListener(DND_SOURCE_COLLAPSE_EVENT, onCollapse);
  }, [onSourceCollapse]);

  const value = useMemo<DndProviderValue>(
    () => ({ overrideState, active, isDragging: active != null, gap, commitKeyboardMove, applyGap }),
    [overrideState, active, gap, commitKeyboardMove, applyGap]
  );

  return (
    <DndProviderCtx.Provider value={value}>
      {/* layout-neutral wrapper so tests / tooling can find the single provider */}
      <div data-testid="dnd-provider" style={{ display: 'contents' }}>
      <DndContext
        sensors={sensors}
        collisionDetection={unifiedCollisionWithInsertion}
        // MeasuringStrategy.BeforeDragging === 1 (hardcoded: unit-test mocks of
        // '@dnd-kit/core' omit the enum and vitest v4 throws on reading it).
        //
        // Measure once, before the drag. The collapsed source + growing gap list change
        // the live layout mid-drag, but `unifiedCollisionWithInsertion` accounts for
        // both analytically (virtual geometry) — re-measuring the DOM would feed the
        // gap's own layout back into collision detection. Also MUST NOT be Always(0):
        // that was the "Maximum update depth exceeded" loop of the old data reflow.
        measuring={{ droppable: { strategy: 1 } }}
        autoScroll={{ threshold: { x: 0, y: 0.2 } }}
        // `restoreFocus: false`: dnd-kit restores focus by the active id, but tab/window ids
        // are positional — after a move that is a DIFFERENT item (or nothing → <body>).
        // `useDndHandlers` focuses where the item actually landed instead.
        accessibility={{
          announcements: announcements ?? fallbackAnnouncements,
          restoreFocus: false,
          screenReaderInstructions: DND_SCREEN_READER_INSTRUCTIONS
        }}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragOver}
        onDragCancel={onDragCancel}
        onDragEnd={(e) => void onDragEnd(e)}
      >
        {children}
      </DndContext>
      </div>
    </DndProviderCtx.Provider>
  );
}

export function DndProvider({ children }: { children: React.ReactNode }) {
  const parent = useContext(DndProviderCtx);
  if (parent) return <>{children}</>;
  return <DndProviderRoot>{children}</DndProviderRoot>;
}
