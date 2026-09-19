import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types';
import type { DndModel } from '@/hooks/useDndModel';
import { createGroup } from '@/lib/utils';

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
 * Dragging anything OUT of Now Open into a saved group MOVES it: the destination gains a
 * DETACHED copy (`id: 0` plus `savedAt` — a saved tab carrying a real browser id would
 * let a later "remove tab" in `useGroups` close the real tab) and the real browser tabs
 * are closed through a `tabs.remove` side effect. It stays `undoable: false`, because
 * undo cannot faithfully reopen a closed tab (history, scroll position, form state).
 *
 * `tabs.remove` is the ONE destructive side effect, and it is deliberately not executed
 * verbatim: `runSideEffects` closes only tabs that are NOT active in their window, and
 * hands every ACTIVE tab to the background worker to close once the popup goes away.
 * Closing the active tab of the window the toolbar popup is anchored to dismisses the
 * popup instantly (spec C7), which used to kill the commit mid-flight. Persistence runs
 * before side effects, so the move survives even if the popup does die.
 *
 * `available[permIndex]` is NOT edited here: Now Open mirrors the real browser, and
 * `useCurrentTabs` re-syncs it as the closes land. A deferred (active) tab therefore
 * legitimately stays visible until the popup closes.
 *
 * The other Now Open side effects are non-destructive: `tabs.move` (reorder within Now
 * Open) and `tabs.create` / `windows.create` (saved item dropped INTO Now Open). Every
 * `windows.create` carries `focused: false` and every `tabs.create` carries
 * `active: false`: a newly focused window or activated tab takes focus away from the
 * window the toolbar popup is anchored to, which dismisses the popup (same failure class
 * as closing its tab).
 *
 * Dropping a tab or window on a sidebar GROUP ROW (not a specific window inside it)
 * always adds it as a NEW window at the end of that group — including the item's own
 * group. On the Now Open row that means a new REAL browser window.
 *
 * A move that EMPTIES its saved source window LEAVES THAT WINDOW IN PLACE (user rule,
 * 2026-09-18 — this reverses the earlier "prune emptied windows" behaviour). An empty
 * window card still renders, still counts in the group's badges, and is still a drop
 * target, so tabs can be dragged straight back into it. Together with a group's last
 * window now being draggable out, no DnD path silently deletes structure the user made;
 * removing a window is always an explicit action. `useGroups`'s tab delete / move-tab
 * paths keep emptied windows for the same reason.
 *
 * MULTI-ITEM (`selectionIds`): the whole selection moves as ONE contiguous block in its
 * original relative order (source group, window, tab index), as ONE undoable op.
 * This covers sidebar GROUPS too: a multi-group selection re-enters as one contiguous
 * block at the gap, never at index 0 (see {@link moveGroupsMulti}).
 * `ApplyMoveResult.landed` reports where the moved items ended up so the handler can
 * remap the positional selection ids in the same commit.
 */
/**
 * Two DROP-ONLY pseudo-types, neither of which is ever an `active` ref:
 *  - `'new-window'` — the always-mounted "drop here for a new window" zone at the end
 *    of the windows list (visible only during a TAB drag).
 *  - `'new-group'` — the always-mounted "drop here for a new group" zone at the end of
 *    the SIDEBAR list (visible during a TAB or WINDOW drag). Dropping there creates a
 *    fresh group (same `createGroup` defaults as the "Add Group" button) and runs the
 *    ordinary "dropped on a group row" move into it, so a tab lands in one new window
 *    and a whole selection lands in ONE new group.
 */
export type DndRefType = 'tab' | 'window' | 'group' | 'new-window' | 'new-group';

/**
 * Droppable id of the sidebar "new group" zone. Unlike `${groupId}::new-window` there is
 * exactly ONE of these in the popup, so it is a fixed sentinel rather than a suffix. The
 * `::` prefix keeps it outside every real model id (`groupId::wN::tN`, and `groupId` is a
 * `nanoid(10)`), so `idInModel` / `rebaseId` can never confuse it for a node.
 */
export const NEW_GROUP_ID = '::new-group';

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
  /**
   * Identity-anchored ordering (spec §6.1): the dragged block lands immediately AFTER the
   * target instead of before it. Set by the insertion layer from the gap the user actually
   * saw (`DndInsertion.commitAfter`), so "at the very end of the list/zone" needs no
   * sentinel — it is "after the last non-dragged sibling".
   *
   * Absent means "derive it": a drop resolved from `over` alone (keyboard drags, a
   * throttled native drop with no collisions) follows dnd-kit's arrayMove convention —
   * dropping a SINGLE item on a row below it takes that row's slot, i.e. lands after it.
   * A multi-item block defaults to "before the target", which is what the gap draws.
   */
  after?: boolean;
  /** multi-select: all dragged model ids (must be a single type); drag anchor === `id` */
  selectionIds?: string[];
}

export type DndSideEffect =
  /** `tabId` is an array for a multi-tab reorder inside Now Open (kept contiguous by chrome). */
  | { type: 'tabs.move'; tabId: number | number[]; windowId: number; index: number }
  /** `focused` is always `false` — a focused new window dismisses the toolbar popup. */
  | { type: 'windows.create'; url: string | string[]; focused: false }
  /** `active` is always `false` — activating a tab in the popup's window dismisses the popup. */
  | { type: 'tabs.create'; windowId: number; url: string; index?: number; active: false }
  /**
   * Real Now Open tabs the user dragged OUT into a saved group: the move closes them.
   * `runSideEffects` splits these — non-active tabs close immediately, an ACTIVE tab is
   * deferred to popup teardown so closing the popup's anchor tab can't dismiss it
   * mid-commit (spec C7). Always accompanied by detached copies in the destination.
   */
  | { type: 'tabs.remove'; tabIds: number[] };

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
  after?: boolean;
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
      after: ref.after,
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
      after: ref.after,
      selectionIds: ref.selectionIds
    };
  }

  if (type === 'new-group') {
    // Drop-only sentinel with no position at all — the group it creates doesn't exist yet.
    return {
      type,
      id: ref.id,
      groupIndex: -1,
      windowIndex: -1,
      tabIndex: -1,
      index: ref.index,
      after: ref.after,
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
      after: ref.after,
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
    after: ref.after,
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

// ─── zones (starred-first) ──────────────────────────────────────────────────
//
// Two of the three lists are ZONED: the sidebar pins starred GROUPS above unstarred ones,
// and a group's window list pins starred WINDOWS above unstarred ones. That pinning is an
// invariant, not a preference, so an item can only ever occupy a position inside its own
// zone. Spec §6.1: ordering is applied as remove-then-insert against an IDENTITY anchor,
// and the zone normalisation runs on the OTHERS *before* the block goes in — never as a
// re-sort of the whole list afterwards, which used to split a mixed selection apart and
// move the block away from the gap the user was shown.

/** Zone of a starrable item: 0 = starred (pinned first), 1 = unstarred. */
export function zoneRank(item: { starred?: boolean } | undefined): number {
  return item?.starred ? 0 : 1;
}

/** Stable starred-first normalisation. Identity-preserving, so anchors stay findable. */
function normaliseZones<T extends { starred?: boolean }>(items: T[]): T[] {
  return [...items.filter((i) => i.starred), ...items.filter((i) => !i.starred)];
}

/**
 * Where a removed block re-enters `rest` — the ONE ordering primitive for zoned lists.
 *
 * `rest` is the list with the block already removed and its zones normalised. `anchor` is
 * an item OF `rest` (never a block member — `canDrop` refuses a selected item as its own
 * target) matched by object identity, so index drift from the removal is impossible:
 *   - no anchor (a group-row "append" target, or an anchor deleted mid-drag) → end of list
 *   - `after` → immediately after the anchor, else immediately before it
 * The result is then CLAMPED into the block's own zone (and never above `minIndex`, which
 * keeps a group block below the permanent "Now Open" row). Clamping slides the WHOLE block;
 * it can never split or reorder it.
 */
function blockInsertIndex<T extends { starred?: boolean }>(
  rest: T[],
  anchor: T | undefined,
  after: boolean,
  blockRank: number,
  minIndex = 0
): number {
  const found = anchor ? rest.indexOf(anchor) : -1;
  const at = found < 0 ? rest.length : found + (after ? 1 : 0);
  let above = 0;
  let same = 0;
  for (let i = minIndex; i < rest.length; i++) {
    const r = zoneRank(rest[i]);
    if (r < blockRank) above++;
    else if (r === blockRank) same++;
  }
  const lo = minIndex + above;
  return Math.min(Math.max(at, lo), lo + same);
}

/**
 * A selection spanning BOTH zones (some starred, some not) is rejected outright, exactly
 * like a mixed-TYPE selection: starred items are pinned above unstarred ones, so no single
 * contiguous landing place exists and any insertion would tear the block in two. Refusing
 * predictably beats splitting silently.
 */
function spansZones(model: DndModel, ref: DndRef): boolean {
  if (!ref.selectionIds || ref.selectionIds.length <= 1) return false;
  const ranks = new Set<number>();
  for (const id of ref.selectionIds) {
    const item = model.groups[id] ?? model.windows[id];
    if (item) ranks.add(zoneRank(item));
  }
  return ranks.size > 1;
}

// ─── canDrop ────────────────────────────────────────────────────────────────

export function canDrop(model: DndModel, active: DndRef, over: DndRef): boolean {
  if (!active || !over || !active.id || !over.id) return false;
  if (active.id === over.id) return false;

  const aKind = active.type ?? refKind(model, active.id);
  const oKind = over.type ?? refKind(model, over.id);
  if (!aKind || !oKind) return false;

  if (isMixedSelection(model, active)) return false;
  // Starred groups/windows are pinned above unstarred ones — a block straddling that
  // boundary can't land contiguously anywhere (spec §6.1).
  if (spansZones(model, active)) return false;
  // A selected item is never a target for its own selection (it is collapsed out of the list).
  if (active.selectionIds && active.selectionIds.length > 1 && active.selectionIds.includes(over.id)) return false;

  if (aKind === 'group') {
    // The permanent "Now Open" group is not reorderable — as the anchor OR as any
    // member of a multi-group selection (a Ctrl+A-ish selection could include it).
    if (active.id === model.permanentGroupId) return false;
    if (model.permanentGroupId) {
      const ids = active.selectionIds && active.selectionIds.length > 1 ? active.selectionIds : [];
      if (ids.includes(model.permanentGroupId)) return false;
    }
    // …and nothing may land before it. Groups only ever target other group ROWS —
    // never the "new group" zone (a group is already a group).
    if (oKind !== 'group') return false;
    if (over.index === 0) return false;
    if (over.id === model.permanentGroupId) return false;
    return true;
  }

  // The sidebar "new group" zone accepts any tab/window drag, including a copy out of
  // Now Open. It has no identity of its own, so it can never be a selected member.
  if (oKind === 'new-group') return aKind === 'tab' || aKind === 'window';

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

/**
 * Real browser tab ids among `tabs` — what a drag OUT of Now Open has to close. Saved
 * tabs are all `id: 0`, so the filter doubles as a "this really is a live tab" guard.
 */
function liveTabIds(tabs: Tab[]): number[] {
  return tabs.map((t) => t.id).filter((id): id is number => typeof id === 'number' && id > 0);
}

/** A saved, detached copy of a LIVE Now Open window (the real window's tabs are closed). */
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

  if (a.type === 'group') {
    if (activeRaw.selectionIds && activeRaw.selectionIds.length > 1) {
      return moveGroupsMulti(model, groupsState, a, o, activeRaw.selectionIds);
    }
    return moveGroup(groupsState, a, o);
  }
  if (o.type === 'new-group') {
    return moveToNewGroup(model, groupsState, a, permIndex, activeRaw.selectionIds);
  }
  if (a.type === 'window') {
    if (activeRaw.selectionIds && activeRaw.selectionIds.length > 1) {
      return moveWindowsMulti(model, groupsState, o, permIndex, activeRaw.selectionIds);
    }
    return moveWindow(groupsState, a, o, permIndex);
  }
  return moveTab(model, groupsState, a, o, permIndex, activeRaw.selectionIds);
}

// ─── group reorder ──────────────────────────────────────────────────────────

/**
 * The ONE sidebar reorder, shared by {@link moveGroup} and {@link moveGroupsMulti}.
 *
 * Remove every dragged group, normalise the zones of what's LEFT, then insert the whole
 * block — in its original sidebar order — immediately before (or after) the anchor group,
 * clamped into its own zone and never above index 0. Because the block goes in last,
 * nothing can move it afterwards: the gap the user saw IS the committed position.
 */
function reorderGroups(
  s: GroupsState,
  movedIdx: number[],
  o: HydratedRef,
  activeId: string,
  after: boolean
): ApplyMoveResult {
  const movedSet = new Set(movedIdx);
  const moved = movedIdx.map((i) => bump(s.available[i]));
  const rawRest = s.available.filter((_g, i) => !movedSet.has(i));
  if (rawRest.length === 0 || moved.length === 0) return NOOP(s);
  // `rawRest[0]` is the permanent "Now Open" row (it can never be part of the block), and
  // it is pinned: only the groups BELOW it are zone-normalised.
  const rest = [rawRest[0], ...normaliseZones(rawRest.slice(1))];
  const anchor = rest.find((g) => g.id === o.id);
  const at = blockInsertIndex(rest, anchor, after, zoneRank(moved[0]), 1);
  const available = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  const index = Math.max(0, available.findIndex((g) => g.id === activeId));

  return {
    next: { ...s, active: { id: activeId, index }, available },
    sideEffects: [],
    undoable: true
  };
}

function moveGroup(s: GroupsState, a: HydratedRef, o: HydratedRef): ApplyMoveResult {
  const fromIdx = a.groupIndex;
  const toIdx = o.index ?? o.groupIndex;
  if (fromIdx < 0 || s.available[fromIdx]?.permanent) return NOOP(s);
  if (toIdx <= 0) return NOOP(s);
  // Pointer drags carry the gap's own answer; a keyboard / `over`-only drop falls back to
  // dnd-kit's arrayMove convention (drop on a row below you → take its slot).
  return reorderGroups(s, [fromIdx], o, a.id, o.after ?? toIdx > fromIdx);
}

/**
 * Multi-group reorder — the sidebar analogue of {@link moveTabsMulti} /
 * {@link moveWindowsMulti}. Every selected group leaves its slot and the whole set
 * re-enters as ONE contiguous block at the drop gap, in its ORIGINAL relative order,
 * as ONE undoable op.
 *
 * Invariants kept from the single-group path:
 *  - "Now Open" is never part of the block and never moves (rejected in `canDrop`, and
 *    re-checked here because `applyMove` is the last line of defence);
 *  - nothing lands at index 0 — the block is clamped to index ≥ 1;
 *  - starred groups stay ahead of unstarred ones, but the block is placed INTO its own
 *    zone rather than being re-sorted afterwards (spec §6.1 — the old post-insert sort
 *    split mixed selections apart and moved the block away from the drawn gap; a selection
 *    spanning both zones is now refused by `canDrop` instead);
 *  - the DRAG ANCHOR stays the active group, exactly as a single-group drag does.
 *
 * The insertion point is the ANCHOR GROUP's identity ("immediately before group X"), so
 * pulling the block out first can't slide the target slot by however many selected groups
 * happened to sit above it.
 */
function moveGroupsMulti(
  model: DndModel,
  s: GroupsState,
  a: HydratedRef,
  o: HydratedRef,
  selectionIds: string[]
): ApplyMoveResult {
  const permIndex = s.available.findIndex((g) => g.permanent);
  const selIdx = Array.from(
    new Set(
      selectionIds
        .map((id) => model.groups[id]?.index)
        .filter((i): i is number => typeof i === 'number' && i >= 0)
    )
  ).sort((x, y) => x - y);
  if (selIdx.length < 2) return NOOP(s);
  // Now Open can never be carried, and a group that vanished mid-drag is not ours to move.
  if (selIdx.some((i) => i === 0 || i === permIndex || !s.available[i] || s.available[i].permanent)) {
    return NOOP(s);
  }

  const toIdx = o.index ?? o.groupIndex;
  if (toIdx <= 0) return NOOP(s);

  // A block defaults to landing BEFORE the anchor — which is exactly where the gap is
  // drawn — unless the insertion layer says the gap was past the last sibling.
  return reorderGroups(s, selIdx, o, a.id, o.after ?? false);
}

/**
 * Sidebar "drop here for a new group" zone. Creates ONE group with the same defaults as
 * the "Add Group" button (`createGroup` → `DEFAULT_GROUP_TITLE` + `DEFAULT_GROUP_COLOR`)
 * and then replays the ordinary "dropped on a group ROW" move into it, so every existing
 * rule is reused verbatim:
 *  - a tab (or a multi-tab selection) → ONE new window inside the new group,
 *  - a window (or a multi-window selection) → the window(s) as the new group's contents,
 *  - Now Open sources are MOVED: a detached copy lands here and the real tabs are closed
 *    through `tabs.remove` (actives deferred to popup teardown, C7); not undoable.
 *
 * The new group is left ACTIVE so the user can see where the drop landed — otherwise the
 * items would vanish into a group that isn't on screen. If the underlying move turns out
 * to be a no-op the whole thing is discarded, so a bad drop can never leave an empty
 * group behind.
 *
 * NOTE: entitlement gating (free tier ≤ N groups) is NOT here — `applyMove` is pure and
 * has no access to the subscription. `useDndHandlers` rejects the drop before calling it.
 */
function moveToNewGroup(
  model: DndModel,
  s: GroupsState,
  a: HydratedRef,
  permIndex: number,
  selectionIds?: string[]
): ApplyMoveResult {
  if (a.type !== 'tab' && a.type !== 'window') return NOOP(s);
  const fresh = createGroup();
  const withNew: GroupsState = { ...s, available: [...s.available, fresh] };
  // A synthetic "group row" target: `resolveTabDest` / `moveWindow` already treat a group
  // row as "append as a new last window", which is exactly the wanted shape.
  const target: HydratedRef = {
    type: 'group',
    id: fresh.id,
    groupIndex: withNew.available.length - 1,
    windowIndex: -1,
    tabIndex: -1
  };

  const multi = !!selectionIds && selectionIds.length > 1;
  const res =
    a.type === 'window'
      ? multi
        ? moveWindowsMulti(model, withNew, target, permIndex, selectionIds!)
        : moveWindow(withNew, a, target, permIndex)
      : moveTab(model, withNew, a, target, permIndex, selectionIds);

  // Nothing actually moved → don't strand an empty group in the sidebar.
  if (res.next === withNew || res.next === s) return NOOP(s);
  const index = res.next.available.findIndex((g) => g.id === fresh.id);
  if (index < 0) return NOOP(s);
  return { ...res, next: { ...res.next, active: { id: fresh.id, index } } };
}

// ─── window moves ───────────────────────────────────────────────────────────

/**
 * Pre-removal index of the window a drop is anchored to, or -1 for "append" targets (a
 * sidebar group row / the new-group zone). Resolved against the array that will actually
 * be mutated — `cloneGroup` makes fresh window objects, so an object taken from the
 * pre-clone state would never be found again.
 */
function windowAnchorIndex(o: HydratedRef): number {
  return o.type === 'window' ? o.index ?? o.windowIndex : -1;
}

/**
 * Put `moved` into `dst` as one contiguous block: normalise the zones of the windows
 * already there, then insert before/after `anchor` (identity), clamped into the block's
 * own starred/unstarred zone. `dst.windows` must already have the moved windows removed,
 * and `anchor` must have been read from `dst.windows` BEFORE that removal.
 */
function placeWindows(dst: Group, moved: ExtWindow[], anchor: ExtWindow | undefined, after: boolean): void {
  const rest = normaliseZones(dst.windows);
  const at = blockInsertIndex(rest, anchor, after, zoneRank(moved[0]));
  dst.windows = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

function moveWindow(s: GroupsState, a: HydratedRef, o: HydratedRef, permIndex: number): ApplyMoveResult {
  const srcGi = a.groupIndex;
  if (srcGi < 0) return NOOP(s);

  if (srcGi === permIndex) {
    // Reordering live windows *within* Now Open is delegated to chrome by the
    // handler layer — nothing to mutate in the model here.
    if (o.groupIndex === permIndex) return NOOP(s);

    // A LIVE "Now Open" window dragged onto a saved group MOVES it: the saved group gains
    // a detached copy (tabs `id:0`, not focused/starred) and every real tab of that window
    // is closed via `tabs.remove` — which closes the real window once its last tab goes.
    // The executor defers the window's ACTIVE tab to popup teardown, so the popup is never
    // dismissed mid-commit (spec C7). `available[permIndex]` is left untouched — Now Open
    // re-syncs from the browser.
    const liveW = s.available[permIndex].windows[a.windowIndex];
    if (!liveW) return NOOP(s);

    const available = s.available.slice();
    const dst = cloneGroup(available[o.groupIndex]);
    const anchorIdx = windowAnchorIndex(o);
    const copy = copyLiveWindow(liveW);
    placeWindows(dst, [copy], anchorIdx >= 0 ? dst.windows[anchorIdx] : undefined, o.after ?? false);
    available[o.groupIndex] = bump(dst);

    const closing = liveTabIds(liveW.tabs);
    return {
      next: { ...s, available },
      sideEffects: closing.length > 0 ? [{ type: 'tabs.remove', tabIds: closing }] : [],
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
    // Group row → the END of the window's own zone; a window target → before/after it.
    const toW = windowAnchorIndex(o);
    const anchor = toW >= 0 ? src.windows[toW] : undefined;
    const [movedW] = src.windows.splice(a.windowIndex, 1);
    if (!movedW) return NOOP(s);
    placeWindows(src, [movedW], anchor, o.after ?? (toW > a.windowIndex));
    available[srcGi] = bump(src);
    return {
      next: { ...s, available },
      sideEffects: [],
      undoable: !involvesPerm,
      landed: { type: 'window', positions: locateWindows(available, srcGi, [movedW]) }
    };
  }

  // Cross-group: a group row appends it at the end of its zone; a window in the target's
  // list (after spring-open) inserts it BEFORE that window, which is where `dndInsertion`
  // draws the gap. Nothing is removed from the target, so there is no arrayMove direction.
  const dstGi = o.groupIndex;
  const [movedW] = src.windows.splice(a.windowIndex, 1);
  if (!movedW) return NOOP(s);
  available[srcGi] = bump(src);

  const dst = cloneGroup(available[dstGi]);
  const anchorIdx = windowAnchorIndex(o);
  const inserted = { ...movedW, focused: false };
  placeWindows(dst, [inserted], anchorIdx >= 0 ? dst.windows[anchorIdx] : undefined, o.after ?? false);
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
    // Drag a live tab OUT of Now Open into a saved group MOVES it: the saved group gets a
    // detached copy and the real tab is closed via `tabs.remove` (deferred by the executor
    // if it is the active/anchor tab — spec C7). `available[permIndex]` is untouched;
    // `useCurrentTabs` re-syncs Now Open once the close lands.
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

    const closing = liveTabIds([realTab]);
    return {
      next: { ...s, available },
      sideEffects: closing.length > 0 ? [{ type: 'tabs.remove', tabIds: closing }] : [],
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
    // The emptied source window STAYS (user rule, 2026-09-18) — see the module doc.
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
  // The source window is LEFT IN PLACE even if that emptied it (user rule, 2026-09-18):
  // an empty window card is a usable drop target, and silently deleting structure the
  // user built was the surprise this replaced.
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

/**
 * Remove the listed tabs from (already-cloned) groups, descending per window so indices
 * don't drift. Windows this empties are deliberately LEFT BEHIND (user rule, 2026-09-18);
 * the returned window list is kept for callers that need to know which were touched.
 */
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

/**
 * A multi-tab selection moves as ONE contiguous block in original order. Sources in
 * Now Open are MOVED (detached copy + `tabs.remove`), saved sources are moved and any
 * window they empty is KEPT. Dropped INTO Now Open: saved sources leave their groups and real tabs
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
    removeTabs(available, savedSel); // emptied source windows are kept (user rule)
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
  removeTabs(available, savedSel); // emptied source windows are kept (user rule)

  const insertAt = Math.max(0, (dest.createdWindow ? 0 : dest.index) - removedBeforeInDest);
  available[dest.groupIndex].windows[destWi].tabs.splice(insertAt, 0, ...inserted);

  touched.forEach((gi) => {
    if (!isPerm(gi)) available[gi] = bump(available[gi]);
  });

  // Live members are MOVED, not copied: close their real tabs (the executor defers any
  // active one to popup teardown). Saved members need no side effect.
  const closingTabs = liveTabIds(liveSel.map((t) => orig(t)!));

  return {
    next: { ...s, available },
    sideEffects: closingTabs.length > 0 ? [{ type: 'tabs.remove', tabIds: closingTabs }] : [],
    undoable: liveSel.length === 0,
    landed: { type: 'tab', positions: locateTabs(available, dest.groupIndex, inserted) }
  };
}

// ─── multi-item window move ─────────────────────────────────────────────────

/**
 * Analogue of {@link moveTabsMulti} for a multi-window selection. Moves the WHOLE
 * ordered run (sorted by source groupIndex then windowIndex) as ONE undoable op, landing
 * it inside its own starred/unstarred zone in the target (spec §6.1; a selection spanning
 * both zones is refused by `canDrop`). Live Now Open windows are COPIED (detached). A drop
 * INTO Now Open opens one real unfocused window per selected SAVED window
 * (`undoable:false`).
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

  // Anchor by IDENTITY, read before the removal: subtracting "how many selected windows
  // sat above the drop index" only works while the indices still line up, and it said
  // nothing about which zone the block belonged in.
  const dropIndex = windowAnchorIndex(o);
  const anchor = dropIndex >= 0 ? available[dstGi].windows[dropIndex] : undefined;

  removeWindows(available);

  placeWindows(available[dstGi], movedWindows, anchor, o.after ?? false);

  touched.forEach((gi) => {
    if (!isPerm(gi)) available[gi] = bump(available[gi]);
  });

  // Live windows are MOVED: close every real tab they hold (the executor defers actives).
  const closingWindowTabs = liveTabIds(liveSel.flatMap((w) => orig(w)!.tabs));

  return {
    next: { ...s, available },
    sideEffects: closingWindowTabs.length > 0 ? [{ type: 'tabs.remove', tabIds: closingWindowTabs }] : [],
    undoable: liveSel.length === 0,
    landed: { type: 'window', positions: locateWindows(available, dstGi, movedWindows) }
  };
}
