import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Collision, DragStartEvent, DragOverEvent, DragMoveEvent, DragEndEvent } from '@dnd-kit/core';
import { useQueryClient, notifyManager, defaultScheduler, type QueryClient } from '@tanstack/react-query';
import { containerKeyOf, type DndGap, type DndInsertion } from '@/lib/dndInsertion';
import { saveGroupsState } from '@/lib/localDb';
import { trackEvent } from '@/lib/analytics';
import { dndDebugEnabled, dndDebugLog } from '@/lib/dndDebug';
import type { Group, GroupsState, Tab, Window as ExtWindow } from '@/lib/types';
import {
  buildDndModel,
  legacySelectionIdToModelId,
  modelIdToLegacySelectionId
} from '@/hooks/useDndModel';
import {
  canDrop,
  applyMove,
  NEW_GROUP_ID,
  type DndLanded,
  type DndRef,
  type DndRefType,
  type DndSideEffect
} from '@/lib/dndMove';
import { rebaseMove } from '@/lib/dndRebase';
import { closeTabsWhenPopupCloses } from '@/lib/deferredTabClose';
import {
  clearDndDragLive,
  clearDndDragSelection,
  getDndDragCount,
  getDndDragSelection,
  isDndDragLive,
  setDndDragLive,
  setDndDragSelection
} from '@/lib/dndMultiDrag';
import { announceDnd, cancelDndAnnouncement } from '@/lib/dndLiveRegion';
import {
  createDndAnnouncements,
  describeDropBail,
  describeDropCommitted,
  DND_KEYBOARD_CANCEL_TOKEN,
  DND_KEYBOARD_DROP_TOKEN,
  noteDropSelectionRemap,
  setDndDropOutcome,
  type DndBailReason
} from '@/lib/dndAnnouncements';
import {
  focusAfterDrop,
  focusSelectorsForGroupIndex,
  focusSelectorsForItem
} from '@/lib/dndFocus';
import { useUIStore, type SelectedItem } from '@/stores/uiStore';
import { GROUPS_QUERY_KEY } from './useGroups';

/** Announced when a drop's write fails (or the commit throws) and the UI is rolled back. */
export const DND_SAVE_FAILED_TEXT = "Couldn't save the move; restored.";

/** How far a drop's commit got — what {@link useDndHandlers}' rollback may undo. */
interface CommitProgress {
  selectionBefore: readonly SelectedItem[];
  remapped?: SelectedItem[];
  movedGroup?: { from: number; to: number };
  pushedBase?: GroupsState;
  redoBefore?: GroupsState[] | null;
  cacheWritten?: boolean;
  /**
   * The in-flight `saveGroupsState` promise, recorded the moment it is issued so a
   * synchronous throw LATER in the commit can still await it instead of leaving an
   * unobserved write (and an unhandled rejection) behind.
   */
  persist?: Promise<void>;
}

type UiSnapshot = {
  selectedItems?: SelectedItem[];
  activeGroupIndex?: number;
  undoStack?: GroupsState[];
  redoStack?: GroupsState[];
};

/** The store outside React; `undefined` for bare-selector test mocks that have no `getState`. */
function uiState(): UiSnapshot | undefined {
  return (useUIStore as { getState?: () => UiSnapshot }).getState?.();
}

const sameSelection = (a: readonly SelectedItem[], b: readonly SelectedItem[]) =>
  a.length === b.length && a.every((s, i) => s.type === b[i].type && s.id === b[i].id);

/** Wait after keyboard focus lands before announcing, so the focus change can't cut the outcome off. */
const KEYBOARD_OUTCOME_DELAY_MS = 150;

/**
 * Hand a drop/cancel outcome to the screen reader.
 *  - pointer drag: focus doesn't move, so dnd-kit's end announcement carries the full text
 *  - keyboard drag: focus moves to the item right after the drop, which cancels speech in
 *    NVDA/JAWS. dnd-kit gets a short token; the full text goes to the app-owned live
 *    region ~150ms after focus has landed
 */
function announceOutcome(text: string, keyboard: boolean, focusSelectors: string[] | null, token: string): void {
  if (!keyboard) {
    setDndDropOutcome(text);
    return;
  }
  setDndDropOutcome(token);
  focusAfterDrop(focusSelectors ?? [], () => announceDnd(text, KEYBOARD_OUTCOME_DELAY_MS));
}

/**
 * The single commit-only DnD handler for the unified popup drag layer.
 *
 *   onDragStart  → snapshot the query cache (`clonedItems`), record the active item
 *   onDragOver   → live placeholder reflow on a working copy seeded from the snapshot
 *   onDragCancel → drop the working copy, restoring the original structure exactly
 *   onDragEnd    → read the pre-move state, run pure `applyMove`, persist via
 *                  `saveGroupsState` + `qc.setQueryData`, then execute `sideEffects`
 *                  (chrome APIs live only here — `applyMove` never calls chrome)
 *
 * A non-Now-Open move pushes exactly one undo snapshot (multi-item move = ONE).
 */
export interface DndActive {
  id: string;
  type: DndRefType;
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
  display?: Tab | ExtWindow | Group;
  selectionIds?: string[];
  /** dnd-kit sortable position + sibling ids of the dragged row (from `active.data.current.sortable`) */
  sortableIndex?: number;
  sortableItems?: string[];
  /** the list the dragged row sorts within (see `containerKeyOf`) */
  containerKey?: string | null;
  /**
   * Started by the KeyboardSensor. A keyboard drag has no native HTML5 drag session, so
   * spec C4 doesn't apply: the dragged row may render dnd-kit's live transform + a lifted
   * style (a native drag must not — that aborts it).
   */
  keyboard?: boolean;
}

/** Read the store outside React; tolerant of bare-selector test mocks that have no `getState`. */
function currentActiveGroupIndex(fallback: number): number {
  return (useUIStore as { getState?: () => { activeGroupIndex?: number } }).getState?.().activeGroupIndex ?? fallback;
}

/** Focus candidates for an item that did NOT move (cancel / rejected / no-op drop). */
function ownFocusSelectors(state: GroupsState | null, id: string): string[] {
  const g = state ? buildDndModel(state).groups[id] : undefined;
  return g ? focusSelectorsForGroupIndex(g.index) : focusSelectorsForItem(id);
}

type Model = ReturnType<typeof buildDndModel>;

/** The tab/window object a model id points at in `state`. */
function objectFor(state: GroupsState, model: Model, id: string): Tab | ExtWindow | undefined {
  const t = model.tabs[id];
  if (t) return (state.available[t.groupIndex]?.windows[t.windowIndex]?.tabs ?? []).filter(Boolean)[t.tabIndex];
  const w = model.windows[id];
  return w ? state.available[w.groupIndex]?.windows[w.windowIndex] : undefined;
}

/**
 * Where an object from the pre-drop state sits in `next`, by IDENTITY. `applyMove` keeps
 * untouched tab objects (it only copies the arrays), and a window is recognised by one of
 * its tab objects. `null` when it is gone (moved elsewhere or removed).
 */
function locate(next: GroupsState, obj: Tab | ExtWindow | undefined): string | null {
  if (!obj) return null;
  const isWindow = Array.isArray((obj as ExtWindow).tabs);
  const firstTab = isWindow ? (obj as ExtWindow).tabs.find(Boolean) : undefined;
  for (const g of next.available) {
    const windows = g.windows ?? [];
    for (let wi = 0; wi < windows.length; wi++) {
      const w = windows[wi];
      if (isWindow) {
        if (w === obj || (firstTab && (w.tabs ?? []).includes(firstTab))) return `${g.id}::w${wi}`;
        continue;
      }
      const ti = (w.tabs ?? []).filter(Boolean).indexOf(obj as Tab);
      if (ti >= 0) return `${g.id}::w${wi}::t${ti}`;
    }
  }
  return null;
}

/** Sibling ids of a tab/window in its own list, nearest first: the next one, then the previous, outward. */
function siblingsOutward(model: Model, id: string): string[] {
  let list: string[] = [];
  const t = model.tabs[id];
  if (t) {
    list = model.windows[t.windowId]?.tabIds ?? [];
  } else {
    const w = model.windows[id];
    if (w) {
      list = Object.values(model.windows)
        .filter((x) => x.groupId === w.groupId)
        .sort((x, y) => x.windowIndex - y.windowIndex)
        .map((x) => x.id);
    }
  }
  const at = list.indexOf(id);
  const out: string[] = [];
  for (let d = 1; at >= 0 && (at + d < list.length || at - d >= 0); d++) {
    if (at + d < list.length) out.push(list[at + d]);
    if (at - d >= 0) out.push(list[at - d]);
  }
  return out;
}

/**
 * Focus candidates after a committed KEYBOARD drop, best first. Every fallback is found by
 * IDENTITY in the committed state — never by the old positional slot, which after a move
 * shows a different item:
 *   1. where the item landed, when that group is the one shown
 *   2. the item itself, if it is still in place (a copy out of Now Open)
 *   3. the nearest remaining item of the SAME list (next, then previous)
 *   4. the nearest remaining sibling WINDOW's header (the source window was emptied)
 *   5. the source group's sidebar row, then the destination group's
 */
function landedFocusSelectors(
  before: GroupsState,
  beforeModel: Model,
  next: GroupsState,
  active: DndRef,
  landed: DndLanded | undefined,
  visibleGroupIndex: number
): string[] {
  if (active.type === 'group') {
    return focusSelectorsForGroupIndex(next.available.findIndex((g) => g.id === active.id));
  }
  const out: string[] = [];
  const push = (id: string | null) => {
    if (id) out.push(...focusSelectorsForItem(id));
  };
  const p = landed?.positions[0];
  const gid = p ? next.available[p.groupIndex]?.id : undefined;
  if (p && gid && landed && p.groupIndex === visibleGroupIndex) {
    push(
      landed.type === 'tab'
        ? `${gid}::w${p.windowIndex}::t${(p as { tabIndex: number }).tabIndex}`
        : `${gid}::w${p.windowIndex}`
    );
  }
  // 2. still in place — a copy out of Now Open (the landed copy is in another, hidden group).
  // For a real move `locate` finds the landed object in its hidden group: no DOM, harmless.
  if (!(p && landed && p.groupIndex === visibleGroupIndex)) push(locate(next, objectFor(before, beforeModel, active.id)));
  const moved = new Set(active.selectionIds && active.selectionIds.length > 1 ? active.selectionIds : [active.id]);
  // 3. nearest remaining item of the same list
  for (const sid of siblingsOutward(beforeModel, active.id)) {
    if (!moved.has(sid)) push(locate(next, objectFor(before, beforeModel, sid)));
  }
  // 4. a tab whose window emptied: the nearest remaining sibling window.
  //    NOT the emptied window itself, even though it now survives the move (user rule,
  //    2026-09-18): `locate` matches by STRUCTURAL identity, and a window that just lost
  //    its last tab no longer matches its `before` self. Finding it would mean falling
  //    back to its positional slot, which is exactly what this function exists to avoid.
  const bt = beforeModel.tabs[active.id];
  if (bt) {
    for (const wid of siblingsOutward(beforeModel, bt.windowId)) push(locate(next, objectFor(before, beforeModel, wid)));
  }
  // 5. sidebar rows: the source group, then the destination
  const srcGroupIndex = (bt ?? beforeModel.windows[active.id])?.groupIndex;
  const srcGroupId = srcGroupIndex != null ? beforeModel.groupIds[srcGroupIndex] : undefined;
  const srcIndex = srcGroupId ? next.available.findIndex((g) => g.id === srcGroupId) : -1;
  if (srcIndex >= 0) out.push(...focusSelectorsForGroupIndex(srcIndex));
  if (p) out.push(...focusSelectorsForGroupIndex(p.groupIndex));
  return out;
}

/** Model id of the live tab with browser id `tabId` in the Now Open group, or `null`. */
function liveTabModelId(state: GroupsState | undefined, tabId: number): string | null {
  const g = state?.available.find((x) => x.permanent);
  if (!g) return null;
  const windows = g.windows ?? [];
  for (let wi = 0; wi < windows.length; wi++) {
    const ti = (windows[wi].tabs ?? []).filter(Boolean).findIndex((t) => t.id === tabId);
    if (ti >= 0) return `${g.id}::w${wi}::t${ti}`;
  }
  return null;
}

/** Give up following a Now Open reorder if the browser hasn't reported it by then. */
export const FOLLOW_LIVE_TAB_MS = 3000;

/**
 * A keyboard reorder WITHIN Now Open commits nothing locally: `chrome.tabs.move` runs and
 * `useCurrentTabs` re-syncs the group later. Row keys are positional, so until then focus
 * sits on the tab's old slot — which the re-sync then fills with a DIFFERENT tab. Follow
 * the real tab id: once the groups cache shows it somewhere else, focus it there. Gives up
 * after {@link FOLLOW_LIVE_TAB_MS}, and never steals focus the user has since moved.
 */
function followLiveTabFocus(qc: QueryClient, tabId: number, fromId: string): void {
  if (typeof document === 'undefined') return;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    done = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (done || event.type !== 'updated' || event.query.queryKey[0] !== GROUPS_QUERY_KEY[0]) return;
    const id = liveTabModelId(event.query.state.data as GroupsState | undefined, tabId);
    if (!id || id === fromId) return;
    stop();
    const focused = document.activeElement as HTMLElement | null;
    const stillOnSlot = !focused || focused === document.body || !!focused.closest?.(`[data-tm-dnd-id="${fromId}"]`);
    if (stillOnSlot) focusAfterDrop(focusSelectorsForItem(id));
  });
  timer = setTimeout(stop, FOLLOW_LIVE_TAB_MS);
}

/** The insertion computed by `attachInsertion` (DndProvider) for the winning collision. */
function readInsertion(collisions: Collision[] | null | undefined): DndInsertion | null {
  const data = collisions?.[0]?.data as { tmInsertion?: DndInsertion } | undefined;
  return data?.tmInsertion ?? null;
}

/**
 * `setQueryData` with a SYNCHRONOUS observer notification. TanStack batches
 * observer notifications through `setTimeout(0)` by default, so the re-render with
 * the new order lands a macrotask after the drop — measured in the real popup as
 * one painted frame of the OLD order after the drag state had already cleared.
 * Notifying inline lets the sensor's `flushSync` commit the new order in the drop
 * task itself. The default scheduler is restored immediately.
 */
function setGroupsNow(qc: QueryClient, next: GroupsState): void {
  notifyManager.setScheduler((cb) => cb());
  try {
    qc.setQueryData(GROUPS_QUERY_KEY, next);
  } finally {
    notifyManager.setScheduler(defaultScheduler);
  }
}

// STALE COMMENT CORRECTED (this predates the native-HTML5-drag rewrite — there
// is no `<DragOverlay>` anymore, see `dndHtml5Sensor.ts`): for the sensor that
// actually matters in the MV3 popup — `Html5DragSensor`, a NATIVE HTML5 drag —
// this call is INERT for its whole duration. Per the HTML Drag and Drop spec
// (and confirmed empirically: no CSS `cursor` value, on any element, changes
// what's rendered near the pointer once a native drag session has started),
// the browser/OS owns cursor feedback for a native drag; only
// `dataTransfer.effectAllowed`/`dropEffect` select among a small fixed set of
// OS-drawn glyphs (move/copy/link/no-drop) — never a fully custom cursor. This
// is a HARD PLATFORM CONSTRAINT, not a bug to chase further. The "dotted box"
// some users see near the cursor during a drag on Windows is that OS-drawn
// glyph, not anything this codebase renders or can suppress/restyle.
// This call still has real value for `KeyboardSensor`-driven (accessibility)
// drags, which are plain React state changes with no native OS drag session —
// CSS `cursor` genuinely applies there.
function setBodyDragCursor(active: boolean) {
  if (typeof document !== 'undefined') document.body.style.cursor = active ? 'grabbing' : '';
}

interface DataCurrent {
  type?: DndRefType;
  index?: number;
  groupId?: string;
  windowId?: string;
  groupIndex?: number;
  selectionIds?: string[];
}

/**
 * Sentinel suffix for the always-mounted "drop here for a new window" zone that
 * appears at the end of the windows list while a TAB drag is active. Its
 * droppable id is `${group.id}${NEW_WINDOW_SUFFIX}` — not a model node, so
 * `onDragEnd` resolves it via {@link newWindowRef} instead of `resolveRef`.
 */
export const NEW_WINDOW_SUFFIX = '::new-window';

/**
 * Re-exported so the sidebar zone and the tests share ONE literal with `dndMove` /
 * `dndRebase`. See {@link NEW_GROUP_ID} there for the id's shape.
 */
export { NEW_GROUP_ID };

/**
 * Resolve the sidebar "drop here for a new group" droppable id to a typed ref. There is
 * only one such zone, and it names no existing group, so this needs no model lookup —
 * which also means a throttled `drop` with `e.over === null` can still resolve to it
 * from `lastRealOverRef`.
 */
export function newGroupRef(): DndRef {
  return { type: 'new-group', id: NEW_GROUP_ID };
}

/**
 * Entitlement gate for the "new group" zone, published by the zone component itself.
 *
 * Creating a group is capped on the free tier, but `applyMove` is PURE and can't read the
 * subscription, and the drop target is often resolved from `lastRealOverRef` (the popup
 * throttles `dragover` — spec C2) where dnd-kit's `over.data` isn't available. So the
 * zone mirrors its own state into module scope, exactly like `dndMultiDrag`'s registry,
 * and `onDragEnd` reads it there.
 *
 * At the cap the zone HIDES (user decision, 2026-09-18) rather than showing and warning,
 * so this is a last-resort guard for a drop that resolved to the zone's id anyway: it
 * refuses SILENTLY. Warning here would be worse than useless — the user was never shown
 * a target to aim at. The "Add Group" button still warns on its own.
 */
let newGroupGate: { atLimit: boolean } = { atLimit: false };

export function setNewGroupZoneGate(atLimit: boolean): void {
  newGroupGate = { atLimit };
}

export function getNewGroupZoneGate(): { atLimit: boolean } {
  return newGroupGate;
}

/** Resolve a `${groupId}::new-window` droppable id to a typed ref. */
export function newWindowRef(
  model: ReturnType<typeof buildDndModel>,
  id: string
): DndRef | null {
  const groupId = id.slice(0, -NEW_WINDOW_SUFFIX.length);
  const g = model.groups[groupId];
  if (!g) return null;
  return { type: 'new-window', id, groupId, groupIndex: g.index };
}

/** Build a typed {@link DndRef} from a raw dnd-kit id + optional `data.current`. */
export function resolveRef(
  model: ReturnType<typeof buildDndModel>,
  id: string,
  dataCurrent?: unknown
): DndRef | null {
  const data = (dataCurrent ?? undefined) as DataCurrent | undefined;
  const type =
    data?.type ??
    (model.tabs[id]
      ? 'tab'
      : model.windows[id]
        ? 'window'
        : model.groups[id]
          ? 'group'
          : null);
  if (!type) return null;
  return {
    type,
    id,
    groupId: data?.groupId,
    windowId: data?.windowId,
    index: data?.index,
    selectionIds: data?.selectionIds
  };
}

function resolveActive(base: GroupsState, id: string, dataCurrent?: unknown): DndActive {
  const model = buildDndModel(base);
  const data = (dataCurrent ?? undefined) as DataCurrent | undefined;
  let type: DndRefType = data?.type ?? 'tab';
  let groupIndex = -1;
  let windowIndex = -1;
  let tabIndex = -1;
  let display: Tab | ExtWindow | Group | undefined;

  if (model.tabs[id]) {
    const t = model.tabs[id];
    type = 'tab';
    groupIndex = t.groupIndex;
    windowIndex = t.windowIndex;
    tabIndex = t.tabIndex;
    display = base.available[groupIndex]?.windows[windowIndex]?.tabs[tabIndex];
  } else if (model.windows[id]) {
    const w = model.windows[id];
    type = 'window';
    groupIndex = w.groupIndex;
    windowIndex = w.windowIndex;
    display = base.available[groupIndex]?.windows[windowIndex];
  } else if (model.groups[id]) {
    const g = model.groups[id];
    type = 'group';
    groupIndex = g.index;
    display = base.available[groupIndex];
  }

  return { id, type, groupIndex, windowIndex, tabIndex, display, selectionIds: data?.selectionIds };
}

/**
 * Split the tabs a Now Open drag-out wants closed into "safe to close right now" and
 * "must wait until the popup is gone".
 *
 * Closing the ACTIVE tab of the window the toolbar popup is anchored to dismisses the
 * popup instantly (spec C7). Rather than trying to identify that one window — the popup
 * has no reliable handle on its own anchor — every tab that is active in ANY window is
 * deferred. Over-deferring costs nothing (the close still happens, just on popup close);
 * under-deferring costs the user their popup mid-drop.
 *
 * Exported for tests; `chrome.tabs.query` failing degrades to "defer everything", which
 * is the safe direction.
 */
export async function partitionClosableTabs(
  tabIds: number[]
): Promise<{ now: number[]; deferred: number[] }> {
  const unique = [...new Set(tabIds)].filter((id) => typeof id === 'number' && id > 0);
  if (unique.length === 0) return { now: [], deferred: [] };
  let activeIds = new Set<number>();
  try {
    const active = await chrome.tabs.query({ active: true });
    activeIds = new Set(active.map((t) => t.id).filter((id): id is number => typeof id === 'number'));
  } catch {
    return { now: [], deferred: unique };
  }
  return {
    now: unique.filter((id) => !activeIds.has(id)),
    deferred: unique.filter((id) => activeIds.has(id))
  };
}

/**
 * Execute the chrome side effects `applyMove` described — the ONLY place popup DnD
 * touches chrome APIs. `windows.create` is always `focused: false` (hardcoded here as
 * well as carried on the effect): a new focused window steals focus from the window
 * the toolbar popup is anchored to, and Chrome dismisses the popup.
 *
 * `tabs.remove` (a drag OUT of Now Open, which now MOVES rather than copies) is the only
 * destructive effect, and it is split by {@link partitionClosableTabs} so the popup never
 * closes its own anchor tab. Side effects run AFTER `saveGroupsState` has been issued, so
 * even a dismissed popup leaves the destination group persisted.
 */
export async function runSideEffects(effects: DndSideEffect[]): Promise<void> {
  if (typeof chrome === 'undefined') return;
  for (const fx of effects) {
    try {
      if (fx.type === 'tabs.move') {
        const props = { windowId: fx.windowId, index: fx.index };
         
        if (Array.isArray(fx.tabId)) await chrome.tabs.move(fx.tabId, props);
         
        else await chrome.tabs.move(fx.tabId, props);
      } else if (fx.type === 'tabs.create') {
        // `active: false` always: activating a tab in the popup's anchor window dismisses the popup.
         
        await chrome.tabs.create({ windowId: fx.windowId, url: fx.url, index: fx.index, active: false });
      } else if (fx.type === 'windows.create') {
         
        await chrome.windows.create({ url: fx.url, focused: false });
      } else if (fx.type === 'tabs.remove') {
         
        const { now, deferred } = await partitionClosableTabs(fx.tabIds);
        // The deferred ids go first: if removing the others somehow dismisses the popup,
        // the background worker already holds the rest.
        if (deferred.length > 0) closeTabsWhenPopupCloses(deferred);
         
        if (now.length > 0) await chrome.tabs.remove(now);
      }
    } catch {
      /* best effort — Now Open re-syncs from the browser regardless */
    }
  }
}

/** ~600ms pointer dwell over a non-active, non-permanent group row springs it open. */
const SPRING_OPEN_MS = 600;

/**
 * Run `fn` in the first animation frame — i.e. strictly AFTER the current `dragstart`
 * dispatch and the microtask checkpoint React commits in (spec C4). `setTimeout`
 * fallback for environments without rAF.
 */
function afterDispatch(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
}

/**
 * Structural fingerprint of a would-be `onDragOver` preview, ignoring the volatile
 * `updatedAt` / `pendingSync` fields that `applyMove` stamps via `bump()`.
 *
 * Why this exists: the live preview renders the panels from `overrideState`, which
 * inserts/removes sortable rows mid-drag. That shifts which droppable the pointer
 * hits, so dnd-kit's `over` can flip between two targets (e.g. a window container
 * and a freshly-previewed tab row) that resolve to the SAME move. Without this
 * guard each flip produced a new `overrideState` object → re-render → layout shift
 * → another flip → "Maximum update depth exceeded" and the popup unmounts. Skipping
 * `setOverrideState` when the fingerprint is unchanged breaks that cycle.
 */
/**
 * True when `id` names a node that exists in the PRE-DRAG model. The live preview
 * renders extra sortable rows (e.g. a tab appended to a window it wasn't in), and
 * those preview-only ids must never drive `applyMove` — resolving one hydrates to
 * `null`, `applyMove` NOOPs, the preview reverts, the row vanishes, collision flips
 * back… → "Maximum update depth exceeded". `onDragOver` skips such events and
 * `onDragEnd` falls back to the last real target instead.
 */
function idInModel(model: ReturnType<typeof buildDndModel>, id: string): boolean {
  return Boolean(model.tabs[id] || model.windows[id] || model.groups[id]);
}

/**
 * True when `next` is `base` in everything but the `updatedAt` / `pendingSync` stamps
 * `applyMove` puts on touched groups — e.g. a contiguous selection released back in its
 * own slot. Only groups whose object changed are compared (full content, ids included,
 * so swapping two look-alike windows is still a real move).
 */
function isStructuralNoop(base: GroupsState, next: GroupsState): boolean {
  if (next === base) return true;
  if (next.available.length !== base.available.length) return false;
  const strip = (g: Group) => {
    const { updatedAt: _updatedAt, pendingSync: _pendingSync, ...rest } = g;
    return JSON.stringify(rest);
  };
  return next.available.every((g, i) => {
    const b = base.available[i];
    return g === b || (!!b && g.id === b.id && strip(g) === strip(b));
  });
}

function previewSignature(state: GroupsState | null): string {
  if (!state) return '';
  return JSON.stringify(
    state.available.map((g) => ({
      i: g.id,
      s: g.starred ?? false,
      w: g.windows.map((w) => ({
        s: w.starred ?? false,
        t: w.tabs.map((t) => `${t.url ?? ''} ${t.customTitle ?? t.title ?? ''}`)
      }))
    }))
  );
}

const EMPTY_SELECTION: readonly { type: string; id: string }[] = [];

/**
 * If the dragged row is part of a same-type `uiStore.selectedItems` multi-selection
 * (LEGACY ids), return the full ordered set of MODEL ids for that selection.
 * Returns `null` when the drag is a single-item drag.
 */
function promoteStoreSelection(
  model: ReturnType<typeof buildDndModel>,
  activeModelId: string,
  activeType: DndRefType,
  selected: readonly { type: string; id: string }[]
): string[] | null {
  if (selected.length <= 1) return null;
  if (!selected.every((s) => s.type === activeType)) return null;
  const anchorLegacy = modelIdToLegacySelectionId(model, activeModelId);
  if (!anchorLegacy || !selected.some((s) => s.id === anchorLegacy)) return null;
  const ids = selected
    .map((s) => legacySelectionIdToModelId(model, s.id))
    .filter((x): x is string => Boolean(x));
  return ids.length > 1 ? ids : null;
}

/**
 * Selection ids are POSITIONAL (`tab-{gi}-{wi}-{ti}` …), so after a commit they must point
 * at where the items landed. Returns the new selection, or `null` to leave it alone.
 *  - tab / window drag of a SELECTED item → the landed positions (`[]` when the items went
 *    into Now Open: they became real tabs, nothing saved to point at)
 *  - drag of an UNSELECTED item → `null` (the selection was already cleared at pickup)
 *  - group reorder → selected groups follow their group id to its new index
 */
export function remapSelectionAfterDrop(
  snapModel: ReturnType<typeof buildDndModel>,
  active: DndRef,
  selected: readonly SelectedItem[],
  next: GroupsState,
  landed: DndLanded | undefined
): SelectedItem[] | null {
  if (selected.length === 0) return null;
  if (active.type === 'group') {
    if (!selected.every((s) => s.type === 'group')) return null;
    return selected
      .map((s) => legacySelectionIdToModelId(snapModel, s.id))
      .map((gid) => (gid ? next.available.findIndex((g) => g.id === gid) : -1))
      .filter((i) => i >= 0)
      .map((i) => ({ type: 'group' as const, id: `group-${i}` }));
  }
  const legacy = modelIdToLegacySelectionId(snapModel, active.id);
  if (!legacy || !selected.some((s) => s.id === legacy)) return null;
  if (!landed) return [];
  return landed.type === 'tab'
    ? landed.positions.map((p) => ({ type: 'tab' as const, id: `tab-${p.groupIndex}-${p.windowIndex}-${p.tabIndex}` }))
    : landed.positions.map((p) => ({ type: 'window' as const, id: `window-${p.groupIndex}-${p.windowIndex}` }));
}

export function useDndHandlers() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex) ?? 0;
  const selectedItems = useUIStore((s) => s.selectedItems) ?? EMPTY_SELECTION;
  const clearSelection = useUIStore((s) => s.clearSelection);
  const setSelection = useUIStore((s) => s.setSelection);

  const clonedRef = useRef<GroupsState | null>(null);
  const activeRef = useRef<DndActive | null>(null);
  const sawFirstOverRef = useRef(false);
  const springTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const springOverIdRef = useRef<string | null>(null);
  const overrideSigRef = useRef<string>('');
  // Last `over` id that resolved against the pre-drag model — `onDragEnd` commits
  // against this when the raw drop target is a preview-only row.
  const lastRealOverRef = useRef<string | null>(null);
  const [overrideState, setOverrideState] = useState<GroupsState | null>(null);
  const [active, setActiveState] = useState<DndActive | null>(null);
  // Collapsed-source drag model (native HTML5 drags only — see `onSourceCollapse`).
  const collapsedHeightRef = useRef<number | null>(null);
  const insertionRef = useRef<DndInsertion | null>(null);
  const gapSigRef = useRef('');
  const [gap, setGap] = useState<DndGap | null>(null);

  // Debug flag only: lets the CDP repro harness observe groups-cache writes around a drop.
  if (dndDebugEnabled()) (globalThis as { __tmQueryClient?: unknown }).__tmQueryClient = qc;

  const applyGap = useCallback((next: DndGap | null) => {
    const sig = next ? `${next.height}|${next.containerKey}|${[...next.shiftIds].join(',')}` : '';
    if (sig === gapSigRef.current) return;
    gapSigRef.current = sig;
    setGap(next);
  }, []);

  const setActive = useCallback((next: DndActive | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);

  // Commit a preview only when its structure actually changed — see previewSignature.
  const applyPreview = useCallback((next: GroupsState | null) => {
    const sig = previewSignature(next);
    if (sig === overrideSigRef.current) return;
    overrideSigRef.current = sig;
    setOverrideState(next);
  }, []);

  const clearSpring = useCallback(() => {
    if (springTimerRef.current) {
      clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
    }
    springOverIdRef.current = null;
  }, []);

  const reset = useCallback(() => {
    // FIRST, before anything that can throw. A stuck live-drag flag silences every global
    // keyboard shortcut for the rest of the popup's life (`useKeyboardNav` bails on
    // `isDndDragLive()`), and it also makes `rollback`'s "don't clobber newer user state"
    // guards permanently false. This used to run LAST — after `setActive(null)` had
    // already disarmed the unmount fallback — so a throw in between wedged the flag with
    // nothing left to clear it.
    clearDndDragSelection();
    clearDndDragLive();
    setBodyDragCursor(false);
    clearSpring();
    applyPreview(null);
    setActive(null);
    clonedRef.current = null;
    lastRealOverRef.current = null;
    collapsedHeightRef.current = null;
    insertionRef.current = null;
    applyGap(null);
  }, [clearSpring, setActive, applyPreview, applyGap]);

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const keyboard = typeof KeyboardEvent !== 'undefined' && e.activatorEvent instanceof KeyboardEvent;
      cancelDndAnnouncement();
      begin(e, keyboard);
      // LAST, and still synchronous (before any keydown can reach `useKeyboardNav`, see
      // `isDndDragLive`): if anything above threw, the flag must not be left set — a stuck
      // flag silences every global shortcut until the popup closes.
      setDndDragLive(keyboard ? 'keyboard' : 'pointer');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, setActive, selectedItems, activeGroupIndex, setActiveGroupIndex, clearSelection]
  );

  function begin(e: DragStartEvent, keyboard: boolean): void {
    {
      setBodyDragCursor(true);
      sawFirstOverRef.current = false;
      dndDebugLog('onDragStart', {
        id: String(e.active.id),
        type: (e.active.data?.current as { type?: string } | undefined)?.type ?? null
      });
      const base = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY) ?? null;
      clonedRef.current = base;
      const id = String(e.active.id);
      if (!base) {
        setActive({ id, type: 'tab', groupIndex: -1, windowIndex: -1, tabIndex: -1, keyboard });
        return;
      }
      const resolved = resolveActive(base, id, e.active.data?.current);
      const sortable = (e.active.data?.current as { sortable?: { index?: number; items?: unknown[] } } | undefined)
        ?.sortable;
      resolved.containerKey = containerKeyOf(
        resolved.type,
        id,
        e.active.data?.current as { windowId?: string; groupId?: string } | undefined
      );
      if (sortable && Array.isArray(sortable.items)) {
        resolved.sortableIndex = sortable.index;
        resolved.sortableItems = sortable.items.map((it) =>
          String(typeof it === 'object' && it !== null && 'id' in it ? (it as { id: unknown }).id : it)
        );
      }
      const model = buildDndModel(base);
      // An explicit payload `selectionIds` (a drag handle already computed the set) wins;
      // otherwise promote a store-driven multi-selection. This now includes sidebar GROUPS
      // (they used to be forced single-drag): `moveGroupsMulti` moves the whole selection
      // as one contiguous block, and `canDrop` still refuses a block containing Now Open.
      if (!resolved.selectionIds || resolved.selectionIds.length <= 1) {
        const promoted = promoteStoreSelection(model, id, resolved.type, selectedItems);
        if (promoted) resolved.selectionIds = promoted;
      }
      if (resolved.type === 'group' && model.permanentGroupId) {
        // Never carry Now Open, whatever the store says.
        resolved.selectionIds = resolved.selectionIds?.filter((gid) => gid !== model.permanentGroupId);
        if ((resolved.selectionIds?.length ?? 0) <= 1) resolved.selectionIds = undefined;
      }
      // Sensor-agnostic registry: the sensor reads it right after this returns (still in
      // `dragstart`) for the ghost's `+N` badge, and in the first rAF to collapse the
      // other selected rows; the collision layer reads it for virtual geometry.
      setDndDragSelection(id, resolved.selectionIds);
      resolved.keyboard = keyboard;
      setActive(resolved);

      // Dragging an item that is NOT part of the store selection drags just that item and
      // clears the selection. DEFERRED past the dispatch (spec C4): a selected row can be
      // an ANCESTOR of the dragged row (a selected window around a dragged tab), and
      // un-highlighting it synchronously would mutate the drag source's ancestor chain.
      if (selectedItems.length > 0) {
        const legacy = modelIdToLegacySelectionId(model, id);
        if (!legacy || !selectedItems.some((s) => s.id === legacy)) {
          afterDispatch(() => clearSelection?.());
        }
      }

      // A picked-up sidebar GROUP becomes the active group, so the windows panel shows
      // its contents while it's being dragged (Chrome tab-strip style). DEFERRED past
      // the `dragstart` dispatch: this handler runs inside it, and a React commit in
      // that dispatch (or its microtask) aborts the native drag (spec C4). Swapping the
      // windows panel mid-drag is safe for a group drag — it only collides with sidebar
      // group rows, whose drag-start rect snapshot the panel swap doesn't touch.
      const gi = resolved.groupIndex;
      if (resolved.type === 'group' && gi > 0 && !base.available[gi]?.permanent && gi !== activeGroupIndex) {
        afterDispatch(() => {
          // The drag may already have ended (or another started) by now.
          if (activeRef.current?.id === id) setActiveGroupIndex(gi);
        });
      }
    }
  }

  const onDragOver = useCallback(
    (e: DragOverEvent) => {
      if (!sawFirstOverRef.current) {
        sawFirstOverRef.current = true;
        dndDebugLog('onDragOver:first', { over: e.over ? String(e.over.id) : null });
      }
      const base = clonedRef.current;
      if (!base || !e.over) {
        clearSpring();
        applyPreview(null);
        return;
      }
      const model = buildDndModel(base);
      const a = resolveRef(model, String(e.active.id), e.active.data?.current);
      const o = resolveRef(model, String(e.over.id), e.over.data?.current);

      // ── hover-to-spring-open: arm a dwell timer when a tab/window drag rests on a
      // NON-active, NON-permanent group row. Event-driven `onDragOver` can't measure
      // time itself, so a setTimeout is armed on first sight of a new group row and
      // cleared whenever the `over` target changes or the drag ends.
      const overId = String(e.over.id);
      const overGroup = model.groups[overId];
      // Never during a KEYBOARD drag: dnd-kit's arrow targeting reaches sidebar group rows
      // (it filters by direction only), and switching the panel would unmount the focused
      // grip and drop focus to <body>. A keyboard drop onto the row still works.
      const armSpring =
        !activeRef.current?.keyboard &&
        (a?.type === 'window' || a?.type === 'tab') &&
        !!overGroup &&
        overId !== model.permanentGroupId &&
        overGroup.index !== activeGroupIndex;
      if (armSpring) {
        if (springOverIdRef.current !== overId) {
          clearSpring();
          springOverIdRef.current = overId;
          springTimerRef.current = setTimeout(() => {
            springTimerRef.current = null;
            setActiveGroupIndex(overGroup.index);
          }, SPRING_OPEN_MS);
        }
      } else {
        clearSpring();
      }

      if (a && !a.selectionIds && activeRef.current?.selectionIds) {
        a.selectionIds = activeRef.current.selectionIds;
      }
      // The "new window" / "new group" zones are valid targets but not model nodes —
      // record them so a throttled `drop` (e.over === null) still resolves in onDragEnd.
      if (overId.endsWith(NEW_WINDOW_SUFFIX)) {
        const nw = newWindowRef(model, overId);
        if (a?.type === 'tab' && nw && canDrop(model, a, nw)) lastRealOverRef.current = overId;
        return;
      }
      if (overId === NEW_GROUP_ID) {
        if (a && canDrop(model, a, newGroupRef())) lastRealOverRef.current = overId;
        return;
      }
      if (a && o && a.id === o.id) return;
      if (!idInModel(model, overId)) return;
      if (!a || !o || !canDrop(model, a, o)) return;
      // NOTE: no live `overrideState` reflow. `Html5DragSensor` (the only sensor
      // now — see `@/lib/dndHtml5Sensor`) drives a NATIVE HTML5 drag, and
      // re-rendering / reordering the dragged row's DOM subtree mid-drag makes
      // Chrome abort the native drag (`dragend`, no `drop`). So during a drag the
      // panels stay rendered from the real query data; the source row is dimmed
      // in place (`isDragging`), the `<DragOverlay>` is the moving visual, and
      // `onDragEnd` commits the real move computed from `lastRealOverRef` /
      // `e.over` against the pre-drag snapshot.
      lastRealOverRef.current = overId;
    },
    [clearSpring, applyPreview, setActiveGroupIndex, activeGroupIndex]
  );

  /**
   * The native-drag sensor collapsed the source row (height = its outer height).
   * From here until the drag ends, rows render the insertion gap instead of
   * dnd-kit's sortable transforms. Called inside `flushSync` right before the
   * collapse, so the initial gap — at the source's own slot: every later sibling
   * shifted down — paints in the same frame as the collapse (no jump).
   */
  const onSourceCollapse = useCallback(
    (height: number) => {
      const act = activeRef.current;
      if (!act || !(height > 0)) return;
      collapsedHeightRef.current = height;
      let shift: string[] = [];
      if (act.sortableItems && typeof act.sortableIndex === 'number' && act.sortableIndex >= 0) {
        // Other selected rows collapse too — they are not siblings the gap displaces.
        const selection = getDndDragSelection();
        shift = act.sortableItems.slice(act.sortableIndex + 1).filter((sid) => !selection?.has(sid));
      }
      applyGap({ height, shiftIds: new Set(shift), containerKey: act.containerKey ?? null });
    },
    [applyGap]
  );

  /** Track the insertion gap at the pointer while the source is collapsed. */
  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const height = collapsedHeightRef.current;
      if (height == null || !e.collisions || e.collisions.length === 0) return;
      const insertion = readInsertion(e.collisions);
      insertionRef.current = insertion;
      // No insertion (e.g. over a group row / the new-window zone): every list
      // closes up — the home list included.
      applyGap({
        height,
        shiftIds: new Set(insertion ? insertion.shiftIds : []),
        containerKey: insertion?.containerKey ?? null
      });
    },
    [applyGap]
  );

  const onDragCancel = useCallback(() => {
    dndDebugLog('onDragCancel');
    const act = activeRef.current;
    const snapshot = clonedRef.current;
    try {
      if (act) {
        const keyboard = act.keyboard === true;
        announceOutcome(
          describeDropBail(snapshot, act.id, 'cancelled', getDndDragCount()),
          keyboard,
          keyboard ? ownFocusSelectors(snapshot, act.id) : null,
          DND_KEYBOARD_CANCEL_TOKEN
        );
      }
    } finally {
      reset();
    }
  }, [reset]);

  /**
   * A failed drop write (or a throw mid-commit): put back only what is still ours to put
   * back. The rollback can run arbitrarily long after the drop (the write is queued), so:
   *  - the selection / active group are restored only if the store still holds the values
   *    this drop wrote AND no other drag is live (never clobber newer user state)
   *  - the undo entry is removed only if it is still on top, and the redo stack the push
   *    wiped comes back if nothing has written it since. `popUndo: false` suppresses that
   *    entirely, for the one case where the write was already ISSUED and will probably
   *    land: popping there would leave a real, persisted move with no way to undo it
   *  - the groups query re-reads IDB WITHOUT cancelling an in-flight fetch: `cancelRefetch`
   *    defaults to true and would reject every mutation that joined that fetch
   *
   * CALL ORDER: `reset()` must run BEFORE this. Two of the guards above test
   * `isDndDragLive()`, which only `reset` clears — calling rollback first made them
   * permanently false on the synchronous-throw path, so nothing was ever restored.
   */
  const rollback = (p: CommitProgress, opts: { popUndo?: boolean } = {}) => {
    const store = uiState();
    const live = isDndDragLive();
    if (p.remapped && store && !live && sameSelection(store.selectedItems ?? [], p.remapped)) {
      noteDropSelectionRemap(p.selectionBefore);
      setSelection?.([...p.selectionBefore]);
    }
    if (p.movedGroup && store && !live && store.activeGroupIndex === p.movedGroup.to) {
      setActiveGroupIndex(p.movedGroup.from);
    }
    if (opts.popUndo !== false && p.pushedBase && store && store.undoStack?.[0] === p.pushedBase) {
      (useUIStore as { setState?: (s: Record<string, unknown>) => void }).setState?.({
        undoStack: store.undoStack.slice(1),
        redoStack: store.redoStack && store.redoStack.length > 0 ? store.redoStack : (p.redoBefore ?? [])
      });
    }
    if (p.cacheWritten) void qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false });
  };

  /**
   * The synchronous part of a drop: resolve, rebase, apply, issue the write, update the
   * cache/selection/outcome. Returns the async tail (await the write → side effects), or
   * `null` when nothing was committed. `p` records how far it got, for {@link rollback}.
   */
  const commitDrop = (e: DragEndEvent, p: CommitProgress): (() => Promise<void>) | null => {
    // Every id the drag carries (active, selection, gap target, over) is positional
    // against the DRAG-START snapshot, so the drop is RESOLVED there — but COMMITTED
    // against the current cache (see the rebase below).
    const current = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY) ?? null;
    const base = clonedRef.current ?? current;
    const rawOverId = e.over ? String(e.over.id) : null;
    const activeData = e.active.data?.current;
    const overData = e.over?.data?.current;
    const carriedSelectionIds = activeRef.current?.selectionIds;
    const fallbackOverId = lastRealOverRef.current;
    // Collapsed-source drag: commit where the GAP is, not against `over` (whose
    // arrayMove semantics assume the source still owns its slot). Use the final
    // collisions' insertion; if the release resolved no target at all, the last
    // gap the user saw.
    const insertion =
      collapsedHeightRef.current != null
        ? (readInsertion(e.collisions) ?? (e.over ? null : insertionRef.current))
        : null;
    dndDebugLog('onDragEnd', {
      rawOverId,
      fallbackOverId,
      insertion: insertion
        ? { container: insertion.containerKey, index: insertion.index, commitOverId: insertion.commitOverId, after: insertion.commitAfter }
        : null
    });

    const keyboard = activeRef.current?.keyboard === true;
    const dragCount = getDndDragCount();
    const draggedId = String(e.active.id);
    /** Every exit that commits nothing: record the outcome and keep keyboard focus on the item. */
    const bail = (reason: DndBailReason): null => {
      announceOutcome(
        describeDropBail(base, draggedId, reason, dragCount),
        keyboard,
        keyboard ? ownFocusSelectors(base, draggedId) : null,
        DND_KEYBOARD_DROP_TOKEN
      );
      return null;
    };

    if (!base) return bail('rejected');
    const model = buildDndModel(base);
    // Released back into its own slot — nothing moves.
    if (insertion && insertion.commitOverId === draggedId) return bail('noop');
    const isNewWindow = (id: string | null) => !!id && id.endsWith(NEW_WINDOW_SUFFIX);
    const isNewGroup = (id: string | null) => id === NEW_GROUP_ID;
    const insertionOverId =
      insertion?.commitOverId && idInModel(model, insertion.commitOverId) ? insertion.commitOverId : null;
    // The drop target can be a preview-only row (see idInModel) OR one of the always-
    // mounted "new window" / "new group" zones (not in the model). Fall back to the last
    // target that resolved against the pre-drag model so the move still commits.
    const overId =
      insertionOverId ??
      (rawOverId && (idInModel(model, rawOverId) || isNewWindow(rawOverId) || isNewGroup(rawOverId))
        ? rawOverId
        : fallbackOverId);
    if (!overId) return bail('rejected');
    const a = resolveRef(model, draggedId, activeData);
    let o = isNewGroup(overId)
      ? newGroupRef()
      : isNewWindow(overId)
        ? newWindowRef(model, overId)
        : resolveRef(model, overId, overId === rawOverId ? overData : undefined);
    // A WINDOW drag whose resolved target is a TAB is not a real "drop on a tab" —
    // a window can never target a tab (spec: window → window | group only), so this
    // can only mean the pointer landed on one of the target window's ROWS rather
    // than empty space in its card. This is the spring-open cross-group bug: right
    // after `setActiveGroupIndex` swaps the windows panel to the sprung-open group,
    // dnd-kit's own `over` resolution can still be settling (a passive-effect-gated
    // state update racing the sensor's `requestAnimationFrame`-deferred `onEnd`) and
    // land on a child tab a beat before the window container itself. Redirect to the
    // tab's OWN window — every legal window target IS a window or group row, so this
    // can only turn a wrongly-rejected drop into the right one, never a wrong one.
    if (a?.type === 'window' && o?.type === 'tab') {
      const tabWindowId = model.tabs[o.id]?.windowId;
      const redirected = tabWindowId ? resolveRef(model, tabWindowId) : null;
      if (redirected) {
        dndDebugLog('commit:window-onto-tab-redirect', { tabId: o.id, windowId: tabWindowId });
        o = redirected;
      }
    }
    // Identity-anchored ordering (spec §6.1): when the target came from the GAP, the gap
    // also says which SIDE of it the block lands on. Without this the engine would have to
    // guess a direction from the indices, which is exactly how a multi-item block ended up
    // one slot away from the gap the user was shown. `rebaseMove` carries it through.
    if (o && overId === insertionOverId && insertion?.commitAfter !== undefined) o.after = insertion.commitAfter;
    // Creating a group is entitlement-gated — see `setNewGroupZoneGate`. At the cap the
    // zone is hidden and disabled, so this only catches a target resolved from the
    // throttled event stream; refuse it silently.
    if (o?.type === 'new-group' && getNewGroupZoneGate().atLimit) return bail('rejected');
    if (a && !a.selectionIds && carriedSelectionIds) a.selectionIds = carriedSelectionIds;
    if (!a || !o || a.id === o.id || !canDrop(model, a, o)) {
      return bail(a && o && a.id === o.id ? 'noop' : 'rejected');
    }

    // COMMIT against the CURRENT cache. A realtime update / poll sync / Now Open refresh
    // may have replaced it mid-drag: applying the move to the snapshot would overwrite
    // that update, re-bump stale groups (last-write-wins would push them everywhere) and
    // resurrect a group deleted mid-drag. Re-resolve the dragged item(s) and the target
    // in the current state; if either is gone or ambiguous, commit nothing.
    let commitBase = base;
    let commitModel = model;
    let ca = a;
    let co = o;
    let removed = 0;
    if (current && current !== base) {
      commitBase = current;
      commitModel = buildDndModel(current);
      const rebased = rebaseMove(base, model, current, commitModel, a, o);
      if (!rebased || !canDrop(commitModel, rebased.active, rebased.over)) {
        dndDebugLog('commit-cancelled-stale', { from: a.id, to: o.id });
        return bail('stale');
      }
      ca = rebased.active;
      co = rebased.over;
      removed = rebased.removed;
    }

    const { next, sideEffects, undoable, landed } = applyMove(commitModel, commitBase, ca, co);
    // Nothing structurally changed (e.g. a contiguous selection released in place):
    // no write, no undo entry, no `updatedAt` bump to sync.
    if (sideEffects.length === 0 && isStructuralNoop(commitBase, next)) return bail('noop');
    dndDebugLog('committed', {
      type: ca.type,
      from: ca.id,
      to: co.id,
      undoable,
      newWindow: co.type === 'new-window'
    });
    if (undoable) {
      p.redoBefore = uiState()?.redoStack ?? null;
      pushUndo(commitBase);
      p.pushedBase = commitBase;
    }
    // The IDB write is ISSUED first, synchronously: `saveGroupsState` bumps the write
    // generation and queue tail before returning, so any groups read in flight re-reads
    // and any read that starts later waits for this write (`localDb` read-your-writes).
    // No `await` may sit between here and the cache write below. (There is deliberately
    // NO `cancelQueries`: it rejected every mutation that had joined the in-flight fetch.)
    const persist = saveGroupsState(next);
    p.persist = persist;
    // Final order + cleared drag state in ONE commit. The sensor wraps this whole
    // handler in `flushSync`; `setGroupsNow` makes the query notification
    // synchronous so the new order is part of that commit too.
    p.cacheWritten = true;
    setGroupsNow(qc, next);
    // A drop on the "new group" zone created a group the user can't see yet — show it,
    // in the SAME commit, so the items don't appear to vanish. `moveToNewGroup` already
    // set `next.active`; this mirrors it into the store (which drives the visible panel).
    if (co.type === 'new-group' && next !== commitBase && next.active) {
      const newIndex = next.available.findIndex((g) => g.id === next.active.id);
      if (newIndex > 0) {
        p.movedGroup = { from: currentActiveGroupIndex(activeGroupIndex), to: newIndex };
        setActiveGroupIndex(newIndex);
      }
    }
    if (a.type === 'group' && next !== base) {
      // The dragged group was made active at pickup; the selection follows it to its
      // new index IN THE SAME COMMIT (a separate commit would paint one frame of
      // whatever group now sits at the old index). This also persists the
      // `activeGroupIndex` setting, matching `next.active` written by `moveGroup`.
      const newIndex = next.available.findIndex((g) => g.id === a.id);
      if (newIndex > 0) {
        const from = commitModel.groups[ca.id]?.index;
        if (from != null) p.movedGroup = { from, to: newIndex };
        setActiveGroupIndex(newIndex);
      }
    }
    // Positional selection ids follow the items to where they landed — same commit.
    p.selectionBefore = selectedItems;
    const remapped = remapSelectionAfterDrop(model, a, selectedItems, next, landed);
    if (remapped) {
      p.remapped = remapped;
      noteDropSelectionRemap(remapped);
      setSelection?.(remapped);
    }
    const visibleGroupIndex = currentActiveGroupIndex(activeGroupIndex);
    announceOutcome(
      describeDropCommitted({
        before: commitBase,
        next,
        active: ca,
        count: ca.selectionIds?.length ?? 1,
        landed,
        sideEffects,
        activeGroupIndex: visibleGroupIndex,
        removed,
        stillSelected: !!remapped && remapped.length > 0
      }),
      keyboard,
      keyboard ? landedFocusSelectors(commitBase, commitModel, next, ca, landed, visibleGroupIndex) : null,
      DND_KEYBOARD_DROP_TOKEN
    );

    // A keyboard reorder inside Now Open lands later, via the browser re-sync (A4).
    if (keyboard && !landed && sideEffects.some((fx) => fx.type === 'tabs.move')) {
      const liveTab = objectFor(commitBase, commitModel, ca.id) as Tab | undefined;
      if (liveTab?.id) followLiveTabFocus(qc, liveTab.id, ca.id);
    }

    return async () => {
      try {
        await persist;
      } catch (err) {
        // The IDB write failed (quota, abort…): the cache shows a move that isn't stored.
        // Re-read IDB so the UI rolls back to what actually persisted, and run NO side
        // effects (they would open real tabs/windows for a move that didn't happen).
        dndDebugLog('commit-persist-failed', { message: err instanceof Error ? err.message : String(err) });
        console.error('[tm-dnd] drop could not be saved; reloading groups from IndexedDB', err);
        rollback(p);
        announceDnd(DND_SAVE_FAILED_TEXT);
        return;
      }
      if (sideEffects.length) await runSideEffects(sideEffects);
      try {
        trackEvent('dnd_move', { type: ca.type });
      } catch {
        /* analytics is best-effort */
      }
    };
  };

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const p: CommitProgress = { selectionBefore: [] };
      let tail: (() => Promise<void>) | null = null;
      try {
        tail = commitDrop(e, p);
      } catch (err) {
        dndDebugLog('commit-threw', { message: err instanceof Error ? err.message : String(err) });
        console.error('[tm-dnd] drop failed', err);
        // `reset()` FIRST: rollback's "no drag is live" guards are only true once the
        // live-drag flag is cleared, and `finally` runs too late for them.
        reset();
        if (p.cacheWritten) {
          // The throw landed AFTER `saveGroupsState` was issued, so the move is very
          // likely already persisted. Don't pop the undo entry and don't announce a
          // failure for a write that will succeed — just re-read IDB so the cache matches
          // whatever actually landed, and keep awaiting the write so a REAL failure still
          // rolls back and announces (the old code dropped `persist` on the floor here).
          rollback(p, { popUndo: false });
          const persist = p.persist;
          if (persist) {
            tail = async () => {
              try {
                await persist;
              } catch (writeErr) {
                dndDebugLog('commit-persist-failed', {
                  message: writeErr instanceof Error ? writeErr.message : String(writeErr)
                });
                rollback(p);
                announceDnd(DND_SAVE_FAILED_TEXT);
              }
            };
          }
        } else {
          // Nothing was written: the drop is a clean no-op, so undo it fully and say so.
          rollback(p);
          setDndDropOutcome(DND_SAVE_FAILED_TEXT);
        }
      } finally {
        // EVERY exit — commit, bail or throw — clears the drag state and the live-drag flag.
        // A flag left set would silence every global shortcut until the popup closes.
        reset();
      }
      if (tail) await tail();
    },
    // `commitDrop` / `rollback` are recreated each render from exactly these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, pushUndo, reset, setActiveGroupIndex, selectedItems, setSelection, activeGroupIndex]
  );

  // DndProvider unmounted mid-drag (popup teardown, a parent re-key): the module-level
  // drag state would outlive it, and a stuck live flag silences every global shortcut.
  useEffect(
    () => () => {
      // Unconditional on purpose. Guarding on `activeRef.current` made this a no-op
      // exactly when it was needed most: `reset()` nulls `activeRef` early, so a throw
      // AFTER that point left the module-level drag state set with the only remaining
      // cleanup path disarmed. Every call below is idempotent.
      if (springTimerRef.current) clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
      clearDndDragSelection();
      clearDndDragLive();
      setBodyDragCursor(false);
      activeRef.current = null;
    },
    []
  );

  // Screen-reader text built from real names/positions in the groups cache.
  const announcements = useMemo(
    () =>
      createDndAnnouncements({
        getState: () => qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY),
        getActiveGroupIndex: () => currentActiveGroupIndex(0)
      }),
    [qc]
  );

  return {
    announcements,
    onDragStart,
    onDragOver,
    onDragMove,
    onDragCancel,
    onDragEnd,
    onSourceCollapse,
    overrideState,
    active,
    gap
  };
}
