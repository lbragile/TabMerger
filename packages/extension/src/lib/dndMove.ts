import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types';
import type { DndModel } from '@/hooks/useDndModel';
import { sortWindowsByStarred } from '@/lib/utils';

/**
 * Pure DnD move engine for the unified popup drag layer.
 *
 * `canDrop` / `applyMove` hold EVERY structural constraint for tab / window / group
 * drags. Neither calls a chrome API: moves that touch the permanent "Now Open" group
 * are described as `DndSideEffect`s for the handler layer to execute, and such moves
 * are always `undoable: false` (Now Open re-syncs from the browser and must never
 * enter the undo stack). `applyMove` only rearranges already-decrypted in-memory
 * state — the commit still goes through the normal `saveGroupsState` path.
 *
 * Dragging anything OUT of Now Open into a saved group is a COPY and emits NO side
 * effect — it never closes a real tab or window. Closing the active tab of the window
 * the toolbar popup is anchored to makes Chrome dismiss the popup instantly (and a
 * whole-window drag would close the user's real browser window). It also matches the
 * tab context menu's "Copy to group" rule for Now Open. Copies are DETACHED: `id: 0`
 * plus `savedAt` — a saved tab carrying a real browser id would let a later "remove
 * tab" in `useGroups` close the real tab. The only Now Open side effects are
 * non-destructive: `tabs.move` (reorder within Now Open) and `tabs.create` /
 * `windows.create` (saved item dropped INTO Now Open). Every `windows.create` carries
 * `focused: false` and every `tabs.create` carries `active: false`: a newly focused
 * window or activated tab takes focus away from the window the toolbar popup is
 * anchored to, which dismisses the popup (same failure class as closing its tab).
 *
 * Dropping a tab or window on a sidebar GROUP ROW (not a specific window inside it)
 * always adds it as a NEW window at the end of that group — including the item's own
 * group. On the Now Open row that means a new REAL browser window. A move that empties
 * its saved source window removes that window in the same commit.
 *
 * MULTI-ITEM (`selectionIds`): the whole selection moves as ONE contiguous block in its
 * original relative order (source group, window, tab index), as ONE undoable op.
 * `ApplyMoveResult.landed` reports where the moved items ended up so the handler can
 * remap the positional selection ids in the same commit.
 */
/**
 * `'new-window'` is a DROP-ONLY pseudo-type: the always-mounted "drop here for a
 * new window" zone at the end of the windows list (visible only during a tab
 * drag). It is never an `active` ref.
 */
export type DndRefType = 'tab' | 'window' | 'group' | 'new-window';

export interface DndRef {
  type: DndRefType;
  /** a synthesised model id from `buildDndModel` */
  id: string;
  groupId?: string;
  windowId?: string;
  /** target group index — only carried by the `'new-window'` ref */
  groupIndex?: number;
  /** target insertion index when dropping between siblings */
  index?: number;
  /** multi-select: all dragged model ids (must be a single type); drag anchor === `id` */
  selectionIds?: string[];
}

export type DndSideEffect =
  /** `tabId` is an array for a multi-tab reorder inside Now Open (kept contiguous by chrome). */
  | { type: 'tabs.move'; tabId: number | number[]; windowId: number; index: number }
  /** `focused` is always `false` — a focused new window dismisses the toolbar popup. */
  | { type: 'windows.create'; url: string | string[]; focused: false }
  /** `active` is always `false` — activating a tab in the popup's window dismisses the popup. */
  | { type: 'tabs.create'; windowId: number; url: string; index?: number; active: false };

export interface TabPosition {
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
}
export interface WindowPosition {
  groupIndex: number;
  windowIndex: number;
}

/** Final positions (in `next`) of the items a move put into a SAVED group, in selection order. */
export type DndLanded =
  | { type: 'tab'; positions: TabPosition[] }
  | { type: 'window'; positions: WindowPosition[] };

export interface ApplyMoveResult {
  next: GroupsState;
  sideEffects: DndSideEffect[];
  undoable: boolean;
  /** absent when nothing landed in a saved group (Now Open destination, NOOP, group reorder) */
  landed?: DndLanded;
}

// ─── ref helpers (map lookups only — no string parsing) ──────────────────────

function refKind(model: DndModel, id: string): DndRefType | null {
  if (model.tabs[id]) return 'tab';
  if (model.windows[id]) return 'window';
  if (model.groups[id]) return 'group';
  return null;
}

interface HydratedRef {
  type: DndRefType;
  id: string;
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
  index?: number;
  selectionIds?: string[];
}

function hydrate(model: DndModel, ref: DndRef): HydratedRef | null {
  const type = ref.type ?? refKind(model, ref.id);
  if (!type) return null;

  if (type === 'tab') {
    const t = model.tabs[ref.id];
    if (!t) return null;
    return {
      type,
      id: ref.id,
      groupIndex: t.groupIndex,
      windowIndex: t.windowIndex,
      tabIndex: t.tabIndex,
      index: ref.index,
      selectionIds: ref.selectionIds
    };
  }

  if (type === 'window') {
    const w = model.windows[ref.id];
    if (!w) return null;
    return {
      type,
      id: ref.id,
      groupIndex: w.groupIndex,
      windowIndex: w.windowIndex,
      tabIndex: -1,
      index: ref.index,
      selectionIds: ref.selectionIds
    };
  }

  if (type === 'new-window') {
    // Drop-only: the "new window" zone. groupIndex rides on the ref itself.
    if (ref.groupIndex == null || ref.groupIndex < 0) return null;
    return {
      type,
      id: ref.id,
      groupIndex: ref.groupIndex,
      windowIndex: -1,
      tabIndex: -1,
      index: ref.index,
      selectionIds: ref.selectionIds
    };
  }

  const g = model.groups[ref.id];
  if (!g) return null;
  return {
    type,
    id: ref.id,
    groupIndex: g.index,
    windowIndex: -1,
    tabIndex: -1,
    index: ref.index,
    selectionIds: ref.selectionIds
  };
}

function isMixedSelection(model: DndModel, ref: DndRef): boolean {
  if (!ref.selectionIds || ref.selectionIds.length <= 1) return false;
  const kinds = new Set(ref.selectionIds.map((id) => refKind(model, id)));
  return kinds.size > 1;
}

function groupIndexOf(model: DndModel, id: string): number | undefined {
  return model.tabs[id]?.groupIndex ?? model.windows[id]?.groupIndex;
}

// ─── canDrop ────────────────────────────────────────────────────────────────

export function canDrop(model: DndModel, active: DndRef, over: DndRef): boolean {
  if (!active || !over || !active.id || !over.id) return false;
  if (active.id === over.id) return false;

  const aKind = active.type ?? refKind(model, active.id);
  const oKind = over.type ?? refKind(model, over.id);
  if (!aKind || !oKind) return false;

  if (isMixedSelection(model, active)) return false;
  // A selected item is never a target for its own selection (it is collapsed out of the list).
  if (active.selectionIds && active.selectionIds.length > 1 && active.selectionIds.includes(over.id)) return false;

  if (aKind === 'group') {
    // The permanent "Now Open" group is not reorderable…
    if (active.id === model.permanentGroupId) return false;
    // …and nothing may land before it.
    if (oKind !== 'group') return false;
    if (over.index === 0) return false;
    if (over.id === model.permanentGroupId) return false;
    return true;
  }

  // A LIVE Now Open tab/window dropped on the Now Open row itself: "add as a new
  // window" would mean tearing a real tab out from under the popup (C7 class), so
  // it is not a target at all and nothing commits. For a multi-selection, ANY live
  // member makes the Now Open row an invalid target.
  if (
    (aKind === 'tab' || aKind === 'window') &&
    oKind === 'group' &&
    model.permanentGroupId &&
    over.id === model.permanentGroupId
  ) {
    const permGi = model.groups[model.permanentGroupId]?.index;
    const ids = active.selectionIds && active.selectionIds.length > 1 ? active.selectionIds : [active.id];
    if (permGi != null && ids.some((id) => groupIndexOf(model, id) === permGi)) return false;
  }

  if (aKind === 'window') {
    return oKind === 'window' || oKind === 'group';
  }

  // aKind === 'tab'
  return (
    oKind === 'tab' || oKind === 'window' || oKind === 'group' || oKind === 'new-window'
  );
}

// ─── applyMove ──────────────────────────────────────────────────────────────

const NOOP = (s: GroupsState): ApplyMoveResult => ({ next: s, sideEffects: [], undoable: false });

/**
 * Copy a group deep enough to mutate its window/tab arrays. Tolerates a missing `windows`
 * or `tabs` (and null tabs) exactly like `buildDndModel`, so model positions and the
 * cloned arrays line up — a throw here would leave the drop half-committed.
 */
function cloneGroup(g: Group): Group {
  return {
    ...g,
    windows: (g.windows ?? []).map((w) => ({ ...w, tabs: (w.tabs ?? []).filter(Boolean) }))
  };
}

function bump(g: Group): Group {
  return { ...g, updatedAt: Date.now(), pendingSync: true };
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(Math.min(Math.max(to, 0), copy.length), 0, item);
  return copy;
}

function emptyWindow(): ExtWindow {
  return { id: 0, tabs: [], incognito: false, focused: false, starred: false };
}

/**
 * Remove window `wi` of (an already-cloned) saved group if a move just emptied it, so
 * no empty saved window is left behind — in the same commit as the move. Never call
 * it on Now Open (that group re-syncs from the browser).
 */
function pruneEmptyWindow(g: Group, wi: number): void {
  if (g.windows[wi] && g.windows[wi].tabs.length === 0) g.windows.splice(wi, 1);
}

/** Strip "position-ish" / live-only flags from a tab that's being moved or copied. */
function detachTab(tab: Tab): Tab {
  const { pinned, ...rest } = tab;
  void pinned;
  return { ...rest, id: 0 };
}

/** A saved, detached copy of a LIVE Now Open tab. */
function copyLiveTab(tab: Tab): Tab {
  return { ...detachTab(tab), savedAt: Date.now() };
}

/** A saved, detached copy of a LIVE Now Open window (the real window stays open). */
function copyLiveWindow(w: ExtWindow): ExtWindow {
  return {
    ...w,
    id: 0,
    incognito: w.incognito ?? false,
    focused: false,
    starred: false,
    tabs: w.tabs.map(copyLiveTab)
  };
}

/** Positions of `objs` (by identity) inside group `gi` of `available`; missing ones are skipped. */
function locateTabs(available: Group[], gi: number, objs: Tab[]): TabPosition[] {
  const out: TabPosition[] = [];
  const g = available[gi];
  if (!g) return out;
  for (const obj of objs) {
    for (let wi = 0; wi < g.windows.length; wi++) {
      const ti = g.windows[wi].tabs.indexOf(obj);
      if (ti >= 0) {
        out.push({ groupIndex: gi, windowIndex: wi, tabIndex: ti });
        break;
      }
    }
  }
  return out;
}

function locateWindows(available: Group[], gi: number, objs: ExtWindow[]): WindowPosition[] {
  const g = available[gi];
  if (!g) return [];
  return objs
    .map((obj) => g.windows.indexOf(obj))
    .filter((wi) => wi >= 0)
    .map((wi) => ({ groupIndex: gi, windowIndex: wi }));
}

export function applyMove(
  model: DndModel,
  groupsState: GroupsState,
  activeRaw: DndRef,
  overRaw: DndRef
): ApplyMoveResult {
  // Defence in depth behind canDrop.
  if (isMixedSelection(model, activeRaw)) return NOOP(groupsState);
  if (!canDrop(model, activeRaw, overRaw)) return NOOP(groupsState);

  const a = hydrate(model, activeRaw);
  const o = hydrate(model, overRaw);
  if (!a || !o) return NOOP(groupsState);

  const permIndex = groupsState.available.findIndex((g) => g.permanent);

  if (a.type === 'group') return moveGroup(groupsState, a, o);
  if (a.type === 'window') {
    if (activeRaw.selectionIds && activeRaw.selectionIds.length > 1) {
      return moveWindowsMulti(model, groupsState, o, permIndex, activeRaw.selectionIds);
    }
    return moveWindow(groupsState, a, o, permIndex);
  }
  return moveTab(model, groupsState, a, o, permIndex, activeRaw.selectionIds);
}

// ─── group reorder ──────────────────────────────────────────────────────────

function moveGroup(s: GroupsState, a: HydratedRef, o: HydratedRef): ApplyMoveResult {
  const fromIdx = a.groupIndex;
  const toIdx = o.index ?? o.groupIndex;
  if (fromIdx < 0 || s.available[fromIdx]?.permanent) return NOOP(s);
  if (toIdx <= 0) return NOOP(s);

  const available = s.available.slice();
  const moved = bump(available[fromIdx]);
  available.splice(fromIdx, 1);
  available.splice(Math.min(Math.max(toIdx, 1), available.length), 0, moved);

  // Zone order: Now Open → starred → unstarred. Re-sorting after the splice keeps
  // relative order within each zone while clamping cross-zone drops to the boundary.
  const head = available[0];
  const rest = available.slice(1);
  const zoneSorted = [head, ...rest.filter((g) => g.starred), ...rest.filter((g) => !g.starred)];
  const finalIndex = Math.max(0, zoneSorted.findIndex((g) => g.id === moved.id));

  return {
    next: { ...s, active: { id: moved.id, index: finalIndex }, available: zoneSorted },
    sideEffects: [],
    undoable: true
  };
}

// ─── window moves ───────────────────────────────────────────────────────────

function moveWindow(s: GroupsState, a: HydratedRef, o: HydratedRef, permIndex: number): ApplyMoveResult {
  const srcGi = a.groupIndex;
  if (srcGi < 0) return NOOP(s);

  if (srcGi === permIndex) {
    // Reordering live windows *within* Now Open is delegated to chrome by the
    // handler layer — nothing to mutate in the model here.
    if (o.groupIndex === permIndex) return NOOP(s);

    // A LIVE "Now Open" window dragged onto a saved group is a COPY: the saved group
    // gains a detached copy (tabs `id:0`, not focused/starred) and the real browser
    // window stays open — NO side effect. Closing it would close the user's actual
    // window and dismiss the toolbar popup mid-drop (see module doc).
    // `available[permIndex]` is left untouched — Now Open re-syncs from the browser.
    const liveW = s.available[permIndex].windows[a.windowIndex];
    if (!liveW) return NOOP(s);

    const available = s.available.slice();
    const dst = cloneGroup(available[o.groupIndex]);
    const copy = copyLiveWindow(liveW);
    dst.windows = sortWindowsByStarred([...dst.windows, copy]);
    available[o.groupIndex] = bump(dst);

    return {
      next: { ...s, available },
      sideEffects: [],
      undoable: false,
      landed: { type: 'window', positions: locateWindows(available, o.groupIndex, [copy]) }
    };
  }

  const involvesPerm = permIndex >= 0 && (srcGi === permIndex || o.groupIndex === permIndex);
  const available = s.available.slice();
  const src = cloneGroup(available[srcGi]);
  available[srcGi] = src;

  // SAVED window dropped INTO "Now Open" → open real windows, drop from source.
  if (o.groupIndex === permIndex) {
    const [movedW] = src.windows.splice(a.windowIndex, 1);
    if (!movedW) return NOOP(s);
    available[srcGi] = bump(src);
    const urls = movedW.tabs.map((t) => t.url).filter(Boolean) as string[];
    return {
      next: { ...s, available },
      sideEffects: [{ type: 'windows.create', url: urls, focused: false }],
      undoable: false
    };
  }

  const sameGroup =
    (o.type === 'window' && o.groupIndex === srcGi) || (o.type === 'group' && o.groupIndex === srcGi);

  if (sameGroup) {
    const [movedW] = src.windows.splice(a.windowIndex, 1);
    if (!movedW) return NOOP(s);
    // Group row → a new window at the END of the group; a window target → arrayMove.
    const toW = o.type === 'window' ? o.index ?? o.windowIndex : src.windows.length;
    src.windows.splice(Math.min(Math.max(toW, 0), src.windows.length), 0, movedW);
    src.windows = sortWindowsByStarred(src.windows);
    available[srcGi] = bump(src);
    return {
      next: { ...s, available },
      sideEffects: [],
      undoable: !involvesPerm,
      landed: { type: 'window', positions: locateWindows(available, srcGi, [movedW]) }
    };
  }

  // Cross-group: a group row appends it as a new window at the end; a window in the
  // target's list (after spring-open) inserts it BEFORE that window, which is where
  // `dndInsertion` draws the gap. Then re-run the starred-first invariant.
  const dstGi = o.groupIndex;
  const [movedW] = src.windows.splice(a.windowIndex, 1);
  if (!movedW) return NOOP(s);
  available[srcGi] = bump(src);

  const dst = cloneGroup(available[dstGi]);
  const at =
    o.type === 'window'
      ? Math.min(Math.max(o.index ?? o.windowIndex, 0), dst.windows.length)
      : dst.windows.length;
  const inserted = { ...movedW, focused: false };
  dst.windows.splice(at, 0, inserted);
  dst.windows = sortWindowsByStarred(dst.windows);
  available[dstGi] = bump(dst);

  return {
    next: { ...s, available },
    sideEffects: [],
    undoable: !involvesPerm,
    landed: { type: 'window', positions: locateWindows(available, dstGi, [inserted]) }
  };
}

// ─── tab moves ──────────────────────────────────────────────────────────────

interface TabDest {
  groupIndex: number;
  windowIndex: number;
  index: number;
  /** a window had to be synthesised in the target group */
  createdWindow: boolean;
}

function resolveTabDest(available: Group[], o: HydratedRef): TabDest {
  if (o.type === 'new-window' || o.type === 'group') {
    // The new-window zone AND a sidebar group row: always a fresh window at the END
    // of the target group (user rule: "dropping into the group itself just adds it in
    // a new window within that group"). Only a tab/window target inserts positionally.
    return { groupIndex: o.groupIndex, windowIndex: available[o.groupIndex]?.windows?.length ?? 0, index: 0, createdWindow: true };
  }
  if (o.type === 'tab') {
    return {
      groupIndex: o.groupIndex,
      windowIndex: o.windowIndex,
      index: o.index ?? o.tabIndex,
      createdWindow: false
    };
  }
  // o.type === 'window' → append to that window (or insert at an explicit index)
  const win = available[o.groupIndex]?.windows[o.windowIndex];
  return {
    groupIndex: o.groupIndex,
    windowIndex: o.windowIndex,
    index: o.index ?? (win ? win.tabs.length : 0),
    createdWindow: false
  };
}

function moveTab(
  model: DndModel,
  s: GroupsState,
  a: HydratedRef,
  o: HydratedRef,
  permIndex: number,
  selectionIds?: string[]
): ApplyMoveResult {
  if (selectionIds && selectionIds.length > 1) {
    return moveTabsMulti(model, s, o, permIndex, selectionIds);
  }

  const srcGi = a.groupIndex;
  const srcWi = a.windowIndex;
  const srcTi = a.tabIndex;
  const srcIsPerm = permIndex >= 0 && srcGi === permIndex;

  const dest = resolveTabDest(s.available, o);
  const destIsPerm = permIndex >= 0 && dest.groupIndex === permIndex;

  // ── Now Open delegation ──────────────────────────────────────────────────
  if (srcIsPerm && destIsPerm) {
    // Reorder within Now Open → chrome.tabs.move on the real tab. A live tab on the
    // Now Open ROW ("new window") is rejected by canDrop; guard the engine as well.
    if (dest.createdWindow) return NOOP(s);
    const realTab = s.available[permIndex].windows[srcWi]?.tabs[srcTi];
    const destWin = s.available[permIndex].windows[dest.windowIndex];
    if (!realTab || !destWin) return NOOP(s);
    return {
      next: s,
      sideEffects: [{ type: 'tabs.move', tabId: realTab.id, windowId: destWin.id, index: dest.index }],
      undoable: false
    };
  }

  if (srcIsPerm && !destIsPerm) {
    // Drag a live tab OUT of Now Open into a saved group is a COPY: the saved group
    // gets a detached copy and the real tab stays open — NO side effect. Closing the
    // popup's own active tab makes Chrome dismiss the popup mid-drop; this also matches
    // Tab.tsx's "Copy to group" context-menu rule. available[permIndex] is untouched.
    const realTab = s.available[permIndex].windows[srcWi]?.tabs[srcTi];
    if (!realTab) return NOOP(s);

    const available = s.available.slice();
    const dst = cloneGroup(available[dest.groupIndex]);
    if (dest.createdWindow) dst.windows.push(emptyWindow());
    const destWi = dest.createdWindow ? dst.windows.length - 1 : dest.windowIndex;
    if (!dst.windows[destWi]) return NOOP(s);
    const insertAt = dest.createdWindow ? 0 : dest.index;
    const copy = copyLiveTab(realTab);
    dst.windows[destWi].tabs.splice(insertAt, 0, copy);
    available[dest.groupIndex] = bump(dst);

    return {
      next: { ...s, available },
      sideEffects: [],
      undoable: false,
      landed: { type: 'tab', positions: locateTabs(available, dest.groupIndex, [copy]) }
    };
  }

  if (!srcIsPerm && destIsPerm) {
    // Drag a SAVED tab INTO Now Open → source loses it (+ an emptied source window) and
    // is bumped. Onto a live tab/window: a real tab at that position. Onto the Now Open
    // ROW: a NEW real browser window, unfocused (a focused one dismisses the popup).
    const available = s.available.slice();
    const src = cloneGroup(available[srcGi]);
    const [movedTab] = src.windows[srcWi]?.tabs.splice(srcTi, 1) ?? [];
    if (!movedTab) return NOOP(s);
    pruneEmptyWindow(src, srcWi);
    available[srcGi] = bump(src);

    const nowOpen = s.available[permIndex];
    const targetWin = dest.createdWindow
      ? undefined
      : nowOpen.windows[dest.windowIndex] ?? nowOpen.windows[nowOpen.windows.length - 1];
    const url = movedTab.url ?? '';
    const sideEffects: DndSideEffect[] = targetWin
      ? [{ type: 'tabs.create', windowId: targetWin.id, url, index: dest.index, active: false }]
      : [{ type: 'windows.create', url, focused: false }];

    return { next: { ...s, available }, sideEffects, undoable: false };
  }

  // ── purely-saved tab move ────────────────────────────────────────────────
  const available = s.available.slice();
  const src = cloneGroup(available[srcGi]);
  available[srcGi] = src;

  const sourceTab = src.windows[srcWi]?.tabs[srcTi];
  if (!sourceTab) return NOOP(s);

  // same window → arrayMove
  if (dest.groupIndex === srcGi && dest.windowIndex === srcWi && !dest.createdWindow) {
    src.windows[srcWi].tabs = arrayMove(src.windows[srcWi].tabs, srcTi, dest.index);
    available[srcGi] = bump(src);
    return {
      next: { ...s, available },
      sideEffects: [],
      undoable: true,
      landed: { type: 'tab', positions: locateTabs(available, srcGi, [sourceTab]) }
    };
  }

  // remove from source
  src.windows[srcWi].tabs.splice(srcTi, 1);

  const sameGroup = dest.groupIndex === srcGi;
  const dst = sameGroup ? src : cloneGroup(available[dest.groupIndex]);
  if (dest.createdWindow) dst.windows.push(emptyWindow());
  const destWi = dest.createdWindow ? dst.windows.length - 1 : dest.windowIndex;
  if (!dst.windows[destWi]) return NOOP(s);
  const insertAt = dest.createdWindow ? 0 : dest.index;
  const inserted = sameGroup ? sourceTab : detachTab(sourceTab);
  dst.windows[destWi].tabs.splice(insertAt, 0, inserted);
  // An emptied source window goes away in this same commit. Pruned AFTER the insert
  // on purpose: `destWi` indexes the pre-removal window list when `dst === src`.
  pruneEmptyWindow(src, srcWi);

  available[srcGi] = bump(src);
  if (!sameGroup) available[dest.groupIndex] = bump(dst);

  return {
    next: { ...s, available },
    sideEffects: [],
    undoable: true,
    landed: { type: 'tab', positions: locateTabs(available, dest.groupIndex, [inserted]) }
  };
}

// ─── multi-item tab move ────────────────────────────────────────────────────

/** Remove the listed tabs from (already-cloned) groups, descending per window so indices don't drift. */
function removeTabs(available: Group[], tabs: TabPosition[]): Array<{ gi: number; wi: number }> {
  const perWindow = new Map<string, { gi: number; wi: number; tis: number[] }>();
  tabs.forEach((t) => {
    const key = `${t.groupIndex}|${t.windowIndex}`;
    const bucket = perWindow.get(key) ?? { gi: t.groupIndex, wi: t.windowIndex, tis: [] };
    bucket.tis.push(t.tabIndex);
    perWindow.set(key, bucket);
  });
  perWindow.forEach(({ gi, wi, tis }) => {
    tis
      .slice()
      .sort((x, y) => y - x)
      .forEach((ti) => available[gi].windows[wi]?.tabs.splice(ti, 1));
  });
  return [...perWindow.values()].map(({ gi, wi }) => ({ gi, wi }));
}

/** Remove the saved windows a move emptied — descending per group so earlier indices don't drift. */
function pruneEmptied(available: Group[], touchedWindows: Array<{ gi: number; wi: number }>, permIndex: number): void {
  touchedWindows
    .filter(({ gi }) => gi !== permIndex)
    .sort((x, y) => x.gi - y.gi || y.wi - x.wi)
    .forEach(({ gi, wi }) => pruneEmptyWindow(available[gi], wi));
}

/**
 * A multi-tab selection moves as ONE contiguous block in original order. Sources in
 * Now Open are COPIED (detached, `savedAt`), saved sources are moved and their emptied
 * windows pruned. Dropped INTO Now Open: saved sources leave their groups and real tabs
 * open (one unfocused window on the Now Open row, background tabs at a live position);
 * live sources reorder via one contiguous `tabs.move`.
 */
function moveTabsMulti(
  model: DndModel,
  s: GroupsState,
  o: HydratedRef,
  permIndex: number,
  selectionIds: string[]
): ApplyMoveResult {
  const sel = selectionIds
    .map((id) => model.tabs[id])
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .sort(
      (x, y) =>
        x.groupIndex - y.groupIndex || x.windowIndex - y.windowIndex || x.tabIndex - y.tabIndex
    );
  if (sel.length === 0) return NOOP(s);

  const isPerm = (gi: number) => permIndex >= 0 && gi === permIndex;
  const orig = (t: TabPosition) => s.available[t.groupIndex]?.windows[t.windowIndex]?.tabs[t.tabIndex];
  if (sel.some((t) => !orig(t))) return NOOP(s);
  const liveSel = sel.filter((t) => isPerm(t.groupIndex));
  const savedSel = sel.filter((t) => !isPerm(t.groupIndex));

  const dest = resolveTabDest(s.available, o);

  // ── INTO Now Open ─────────────────────────────────────────────────────────
  if (isPerm(dest.groupIndex)) {
    if (dest.createdWindow && liveSel.length > 0) return NOOP(s); // canDrop rejects this too
    const nowOpen = s.available[permIndex];
    const targetWin = dest.createdWindow
      ? undefined
      : nowOpen.windows[dest.windowIndex] ?? nowOpen.windows[nowOpen.windows.length - 1];
    if (!dest.createdWindow && !targetWin) return NOOP(s);

    const available = s.available.slice();
    const touched = new Set(savedSel.map((t) => t.groupIndex));
    touched.forEach((gi) => {
      available[gi] = cloneGroup(available[gi]);
    });
    pruneEmptied(available, removeTabs(available, savedSel), permIndex);
    touched.forEach((gi) => {
      available[gi] = bump(available[gi]);
    });

    const savedUrls = savedSel.map((t) => orig(t)!.url ?? '');
    const sideEffects: DndSideEffect[] = [];
    if (!targetWin) {
      sideEffects.push({ type: 'windows.create', url: savedUrls.filter(Boolean), focused: false });
    } else {
      const liveIds = liveSel.map((t) => orig(t)!.id);
      if (liveIds.length > 0) {
        sideEffects.push({
          type: 'tabs.move',
          tabId: liveIds.length === 1 ? liveIds[0] : liveIds,
          windowId: targetWin.id,
          index: dest.index
        });
      }
      savedUrls.forEach((url, i) =>
        sideEffects.push({
          type: 'tabs.create',
          windowId: targetWin.id,
          url,
          index: dest.index + liveIds.length + i,
          active: false
        })
      );
    }
    return { next: savedSel.length > 0 ? { ...s, available } : s, sideEffects, undoable: false };
  }

  // ── INTO a saved group ────────────────────────────────────────────────────
  const touched = new Set<number>([...savedSel.map((t) => t.groupIndex), dest.groupIndex]);
  const available = s.available.slice();
  touched.forEach((gi) => {
    available[gi] = cloneGroup(available[gi]);
  });

  // New objects for every moved item — they're also the identity `locateTabs` finds.
  const inserted = sel.map((t) =>
    isPerm(t.groupIndex)
      ? copyLiveTab(orig(t)!)
      : t.groupIndex === dest.groupIndex
        ? { ...orig(t)!, id: 0 }
        : detachTab(orig(t)!)
  );

  if (dest.createdWindow) available[dest.groupIndex].windows.push(emptyWindow());
  const destWi = dest.createdWindow ? available[dest.groupIndex].windows.length - 1 : dest.windowIndex;
  if (!available[dest.groupIndex].windows[destWi]) return NOOP(s);

  const removedBeforeInDest = savedSel.filter(
    (t) => t.groupIndex === dest.groupIndex && t.windowIndex === destWi && t.tabIndex < dest.index
  ).length;
  const emptiedCandidates = removeTabs(available, savedSel);

  const insertAt = Math.max(0, (dest.createdWindow ? 0 : dest.index) - removedBeforeInDest);
  available[dest.groupIndex].windows[destWi].tabs.splice(insertAt, 0, ...inserted);

  // Pruned AFTER the insert: the indices above are pre-removal.
  pruneEmptied(available, emptiedCandidates, permIndex);

  touched.forEach((gi) => {
    if (!isPerm(gi)) available[gi] = bump(available[gi]);
  });

  return {
    next: { ...s, available },
    sideEffects: [],
    undoable: liveSel.length === 0,
    landed: { type: 'tab', positions: locateTabs(available, dest.groupIndex, inserted) }
  };
}

// ─── multi-item window move ─────────────────────────────────────────────────

/**
 * Analogue of {@link moveTabsMulti} for a multi-window selection. Moves the WHOLE
 * ordered run (sorted by source groupIndex then windowIndex) as ONE undoable op,
 * re-running the starred-first invariant in the target. Live Now Open windows are
 * COPIED (detached). A drop INTO Now Open opens one real unfocused window per selected
 * SAVED window (`undoable:false`).
 */
function moveWindowsMulti(
  model: DndModel,
  s: GroupsState,
  o: HydratedRef,
  permIndex: number,
  selectionIds: string[]
): ApplyMoveResult {
  const sel = selectionIds
    .map((id) => model.windows[id])
    .filter((w): w is NonNullable<typeof w> => Boolean(w))
    .sort((x, y) => x.groupIndex - y.groupIndex || x.windowIndex - y.windowIndex);
  if (sel.length === 0) return NOOP(s);

  const isPerm = (gi: number) => permIndex >= 0 && gi === permIndex;
  const orig = (w: WindowPosition) => s.available[w.groupIndex]?.windows[w.windowIndex];
  if (sel.some((w) => !orig(w))) return NOOP(s);
  const liveSel = sel.filter((w) => isPerm(w.groupIndex));
  const savedSel = sel.filter((w) => !isPerm(w.groupIndex));

  const removeWindows = (available: Group[]) => {
    const perGroup = new Map<number, number[]>();
    savedSel.forEach((w) => perGroup.set(w.groupIndex, [...(perGroup.get(w.groupIndex) ?? []), w.windowIndex]));
    perGroup.forEach((wis, gi) =>
      wis
        .slice()
        .sort((x, y) => y - x)
        .forEach((wi) => available[gi].windows.splice(wi, 1))
    );
  };

  // ── drop INTO Now Open → one real window per selected SAVED window ──────────
  if (isPerm(o.groupIndex)) {
    if (savedSel.length === 0) return NOOP(s);
    const touched = new Set<number>(savedSel.map((w) => w.groupIndex));
    const available = s.available.slice();
    touched.forEach((gi) => {
      available[gi] = cloneGroup(available[gi]);
    });
    removeWindows(available);
    touched.forEach((gi) => {
      available[gi] = bump(available[gi]);
    });
    const sideEffects: DndSideEffect[] = savedSel.map((w) => ({
      type: 'windows.create',
      url: orig(w)!.tabs.map((t) => t.url).filter(Boolean) as string[],
      focused: false
    }));
    return { next: { ...s, available }, sideEffects, undoable: false };
  }

  // ── drop onto a saved group row / window ───────────────────────────────────
  const dstGi = o.groupIndex;
  const touched = new Set<number>([...savedSel.map((w) => w.groupIndex), dstGi]);
  const available = s.available.slice();
  touched.forEach((gi) => {
    available[gi] = cloneGroup(available[gi]);
  });

  const movedWindows = sel.map((w) =>
    isPerm(w.groupIndex)
      ? copyLiveWindow(orig(w)!)
      : { ...orig(w)!, focused: false, tabs: orig(w)!.tabs.map((t) => (t.id === 0 ? t : { ...t, id: 0 })) }
  );

  const dropIndex = o.type === 'window' ? o.index ?? o.windowIndex : -1;
  const removedBeforeInDst =
    dropIndex >= 0 ? savedSel.filter((w) => w.groupIndex === dstGi && w.windowIndex < dropIndex).length : 0;

  removeWindows(available);

  const insertAt =
    dropIndex >= 0 ? Math.max(0, dropIndex - removedBeforeInDst) : available[dstGi].windows.length;
  available[dstGi].windows.splice(Math.min(insertAt, available[dstGi].windows.length), 0, ...movedWindows);
  available[dstGi].windows = sortWindowsByStarred(available[dstGi].windows);

  touched.forEach((gi) => {
    if (!isPerm(gi)) available[gi] = bump(available[gi]);
  });

  return {
    next: { ...s, available },
    sideEffects: [],
    undoable: liveSel.length === 0,
    landed: { type: 'window', positions: locateWindows(available, dstGi, movedWindows) }
  };
}
