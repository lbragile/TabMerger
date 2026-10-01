import { buildDndModel, type DndModel } from '@/hooks/useDndModel';
import { canDrop, NEW_GROUP_ID, type DndRef } from '@/lib/dndMove';
import { describeItem, plural, windowName } from '@/lib/dndAnnouncements';
import { getSidebarDisplayOrder } from '@/lib/sidebarOrder';
import type { GroupsState } from '@/lib/types';

/**
 * Keyboard MOVE MODE: the pure model.
 *
 * Keyboard moves do not go through dnd-kit at all. Space on a focused row picks the item
 * (or the current selection) up; from then on the user walks an explicit, ordered list of
 * REAL drop targets, and Space commits the chosen (source, target) pair through the same
 * commit path pointer drops use (`commitKeyboardMove` in `useDndHandlers`). Nothing here
 * touches the DOM, coordinates or dnd-kit, so every scenario is a plain function of
 * (groups state, source, key presses) and is unit-testable.
 *
 * Two MODES, both WRAPPING at their ends (Up past the first stop lands on the last, Down
 * past the last on the first):
 *
 *  - `main` (items are positioned in the SHOWN group; groups are positioned in the sidebar):
 *      tab    : Up / Down walk the insertion SLOTS between each window's other visible tabs,
 *               crossing from one window into the next (an empty window is a stop of its
 *               own), then the group's "new window" zone, then wrap to the top. Every
 *               non-origin target is filtered through `canDrop`, so an invalid target is
 *               never offered.
 *      window : Up / Down walk the insertion slots among the shown group's windows (same
 *               starred zone as the source, since starred windows are pinned to the top); a
 *               group with no window of that zone is one "add as a window" target.
 *      group  : Up / Down walk the slots among the saved groups (same starred zone); it can
 *               never go above Now Open. Left / Right do nothing.
 *  - `list` (tab and window sources only; reached with Left from `main`): the cursor is in
 *    the sidebar's group list. Up / Down pick a group (wrapping; groups that cannot take the
 *    item are skipped; the "new group" stop closes the list when the free-tier gate allows
 *    it) and the caller makes the highlighted group the SHOWN one. The current target is
 *    always the END of the highlighted group, so Space drops there; Right enters `main`
 *    with the item already placed at that end. Right on the "new group" stop does nothing:
 *    it stays the drop target.
 *
 * Slots are anchored to a neighbouring row with `after` set explicitly, so the result never
 * depends on an index heuristic in the engine. Every target also carries the insertion
 * `gap` the pointer would show for it (`DndGap` in `@/lib/dndInsertion`): the list holding
 * the gap and the rows it displaces. The UI renders the keyboard preview from that, through
 * the same code as the pointer preview.
 */

export type MoveKind = 'tab' | 'window' | 'group';
export type MoveDirection = 'up' | 'down';
export type MoveMode = 'main' | 'list';
/** The real index of the shown group, the "new group" zone, or the sidebar (group sources). */
export type MoveScope = number | 'new-group' | 'sidebar';

export interface MoveSource {
  kind: MoveKind;
  /** the row the user pressed Space on */
  anchorId: string;
  /** every moving model id (the whole selection when the anchor is part of one), anchor included */
  ids: string[];
}

/** What to scroll to / highlight for the current target. Only zones are drawn (as highlights). */
export type MarkerSpec =
  | { type: 'line'; elementId: string; side: 'before' | 'after' }
  | { type: 'box'; elementId: string }
  | { type: 'zone'; zone: 'new-window' | 'new-group' }
  | null;

/** The insertion gap for a target: the list that holds it and the rows it displaces. */
export interface GapSpec {
  /** window id for tabs, group id for windows, `'groups'` for the sidebar, null over a zone */
  containerKey: string | null;
  /** the other rows at / after the slot, in order (they shift down by the gap height) */
  shiftIds: string[];
}

export interface MoveTarget {
  /** stable across rebuilds, used to keep the cursor when the state changes under it */
  key: string;
  /** the drop target handed to the commit; `null` for the "nothing moves" origin of a lone item */
  over: DndRef | null;
  /** spoken when the cursor lands here, e.g. "Play, last in Window 2" */
  text: string;
  marker: MarkerSpec;
  gap: GapSpec;
  /** the slot the item already occupies */
  origin?: boolean;
  /** the "new window" / "new group" zone rather than a slot among rows */
  zone?: boolean;
}

export interface MoveOptions {
  /** the group whose windows are shown */
  activeGroupIndex: number;
  /** false at the free-tier group cap: the "new group" zone is not offered */
  newGroupAllowed: boolean;
  /** rows that are not in the DOM (search filter, collapsed sections) are never targets */
  isVisible?: (modelId: string) => boolean;
}

export interface MoveState {
  source: MoveSource;
  targets: MoveTarget[];
  index: number;
  /** the real index of the shown group (`main`) / highlighted list stop (`list`), 'sidebar' for groups */
  scope: MoveScope;
  mode: MoveMode;
  /** the real index of the group the source started in (-1 for group sources) */
  originGroup: number;
}

export function activeRefFor(source: MoveSource): DndRef {
  return {
    type: source.kind,
    id: source.anchorId,
    selectionIds: source.ids.length > 1 ? source.ids : undefined
  };
}

/** The drop target for slot `k` of the ordered rows `ids`: before `ids[k]`, or after the last. */
function slotOver(ids: string[], k: number, type: 'tab' | 'window' | 'group', model?: DndModel): DndRef {
  const before = k < ids.length;
  const id = before ? ids[k] : ids[ids.length - 1];
  const ref: DndRef = { type, id, after: !before };
  if (type === 'group' && model) ref.index = model.groups[id]?.index;
  return ref;
}

/** What the announcements call the moving item(s): "Play" for one, "3 tabs" for a selection. */
function movingLabel(state: GroupsState, model: DndModel, source: MoveSource): string {
  if (source.ids.length > 1) return plural(source.ids.length, source.kind);
  return describeItem(state, source.anchorId, model)?.name ?? source.kind;
}

/** "first" / "last" / "position 3 of 5": slot `k` among `rest` staying rows, `total` including the moving ones. */
const slotPhrase = (k: number, rest: number, total: number): string =>
  k <= 0 ? 'first' : k >= rest ? 'last' : `position ${k + 1} of ${total}`;

const rowMarker = (rest: string[], k: number): MarkerSpec => ({
  type: 'line',
  elementId: k < rest.length ? rest[k] : rest[rest.length - 1],
  side: k < rest.length ? 'before' : 'after'
});

/** Targets for `source` inside the group shown at `opts.activeGroupIndex` (or the sidebar for a group source). */
export function buildTargets(
  state: GroupsState,
  source: MoveSource,
  opts: MoveOptions
): { targets: MoveTarget[]; originIndex: number } {
  const model = buildDndModel(state);
  const active = activeRefFor(source);
  const vis = opts.isVisible ?? (() => true);
  const sel = new Set(source.ids);
  const count = source.ids.length;
  const me = movingLabel(state, model, source);
  const original = `${me}, original position`;
  const gi = Math.min(Math.max(opts.activeGroupIndex, 0), Math.max(state.available.length - 1, 0));
  const shown = state.available[gi];
  const targets: MoveTarget[] = [];
  let originIndex = -1;

  const allowed = (over: DndRef) => canDrop(model, active, over);

  if (source.kind === 'tab' && shown) {
    const anchor = model.tabs[source.anchorId];
    for (const wid of model.groups[shown.id]?.windowIds ?? []) {
      const w = model.windows[wid];
      if (!w || !vis(wid)) continue;
      const wname = windowName(shown.windows[w.windowIndex], w.windowIndex);
      const rest = w.tabIds.filter((id) => vis(id) && !sel.has(id));
      const holdsAnchor = anchor?.windowId === wid;
      if (rest.length === 0) {
        const over: DndRef = { type: 'window', id: wid };
        if (holdsAnchor || allowed(over)) {
          if (holdsAnchor) originIndex = targets.length;
          targets.push({
            key: `win:${wid}`,
            over,
            text: holdsAnchor ? original : `${me}, in ${wname}${w.tabIds.length === 0 ? ', empty' : ''}`,
            marker: { type: 'box', elementId: wid },
            gap: { containerKey: wid, shiftIds: [] },
            origin: holdsAnchor
          });
        }
        continue;
      }
      const k0 = holdsAnchor ? rest.filter((id) => model.tabs[id].tabIndex < (anchor?.tabIndex ?? 0)).length : -1;
      // The engine places tabs by INDEX (`over.index`, original coordinates of the target
      // window), not by `after`: the original index of the tab the slot sits before, or the
      // window's length for the end slot. A lone tab moving inside its own window is an
      // arrayMove, whose index is the FINAL position, so it shifts down by one past itself.
      const lone = count === 1 && holdsAnchor;
      const indexFor = (k: number) => {
        const j = k < rest.length ? model.tabs[rest[k]].tabIndex : w.tabIds.length;
        return lone && (anchor?.tabIndex ?? 0) < j ? j - 1 : j;
      };
      for (let k = 0; k <= rest.length; k++) {
        const over: DndRef = { type: 'tab', id: rest[Math.min(k, rest.length - 1)], index: indexFor(k) };
        const isOrigin = k === k0;
        if (!isOrigin && !allowed(over)) continue;
        if (isOrigin) originIndex = targets.length;
        targets.push({
          key: `tab:${wid}:${k}`,
          over,
          text: isOrigin ? original : `${me}, ${slotPhrase(k, rest.length, rest.length + count)} in ${wname}`,
          marker: rowMarker(rest, k),
          gap: { containerKey: wid, shiftIds: rest.slice(k) },
          origin: isOrigin
        });
      }
    }
    const zoneOver: DndRef = { type: 'new-window', id: `${shown.id}::new-window`, groupId: shown.id, groupIndex: gi };
    if (allowed(zoneOver)) {
      targets.push({
        key: 'zone:new-window',
        over: zoneOver,
        text: `${me}, in a new window`,
        marker: { type: 'zone', zone: 'new-window' },
        gap: { containerKey: null, shiftIds: [] },
        zone: true
      });
    }
  }

  if (source.kind === 'window' && shown) {
    const anchor = model.windows[source.anchorId];
    const star = !!anchor?.starred;
    const inOrigin = anchor?.groupId === shown.id;
    const pool = (model.groups[shown.id]?.windowIds ?? []).filter(
      (id) => vis(id) && !sel.has(id) && model.windows[id].starred === star
    );
    const k0 = inOrigin ? pool.filter((id) => model.windows[id].windowIndex < (anchor?.windowIndex ?? 0)).length : -1;
    if (pool.length === 0) {
      if (inOrigin) {
        originIndex = targets.length;
        targets.push({
          key: 'origin',
          over: null,
          text: original,
          marker: null,
          gap: { containerKey: shown.id, shiftIds: [] },
          origin: true
        });
      } else {
        // A group with no window of the source's zone: dropping on the group's own row appends it.
        const over: DndRef = { type: 'group', id: shown.id, index: gi };
        if (allowed(over)) {
          targets.push({
            key: 'win:append',
            over,
            text: `${me}, first window in ${shown.name}`,
            marker: null,
            gap: { containerKey: shown.id, shiftIds: [] }
          });
        }
      }
    }
    for (let k = 0; pool.length > 0 && k <= pool.length; k++) {
      const over = slotOver(pool, k, 'window');
      const isOrigin = k === k0;
      if (!isOrigin && !allowed(over)) continue;
      if (isOrigin) originIndex = targets.length;
      targets.push({
        key: `win:${k}`,
        over,
        text: isOrigin ? original : `${me}, ${slotPhrase(k, pool.length, pool.length + count)} in ${shown.name}`,
        marker: rowMarker(pool, k),
        gap: { containerKey: shown.id, shiftIds: pool.slice(k) },
        origin: isOrigin
      });
    }
  }

  if (source.kind === 'group') {
    const anchor = model.groups[source.anchorId];
    const star = !!anchor?.starred;
    const saved = model.groupIds.filter((id) => id !== model.permanentGroupId);
    const pool = saved.filter((id) => vis(id) && !sel.has(id) && model.groups[id].starred === star);
    const k0 = pool.filter((id) => model.groups[id].index < (anchor?.index ?? 0)).length;
    if (pool.length === 0) {
      originIndex = targets.length;
      targets.push({
        key: 'origin',
        over: null,
        text: original,
        marker: null,
        gap: { containerKey: 'groups', shiftIds: [] },
        origin: true
      });
    }
    for (let k = 0; pool.length > 0 && k <= pool.length; k++) {
      const over = slotOver(pool, k, 'group', model);
      const isOrigin = k === k0;
      if (!isOrigin && !allowed(over)) continue;
      if (isOrigin) originIndex = targets.length;
      targets.push({
        key: `grp:${k}`,
        over,
        text: isOrigin ? original : `${me}, ${slotPhrase(k, pool.length, pool.length + count)}`,
        marker: rowMarker(pool, k),
        gap: { containerKey: 'groups', shiftIds: pool.slice(k) },
        origin: isOrigin
      });
    }
  }
  return { targets, originIndex };
}

/** The single target of the "new group" zone, or `[]` when it is not offered (cap, or `canDrop` says no). */
export function buildNewGroupTargets(state: GroupsState, source: MoveSource, opts: MoveOptions): MoveTarget[] {
  if (!opts.newGroupAllowed || source.kind === 'group') return [];
  const over: DndRef = { type: 'new-group', id: NEW_GROUP_ID };
  const model = buildDndModel(state);
  if (!canDrop(model, activeRefFor(source), over)) return [];
  return [
    {
      key: 'zone:new-group',
      over,
      text: `${movingLabel(state, model, source)}, in a new group`,
      marker: { type: 'zone', zone: 'new-group' },
      gap: { containerKey: null, shiftIds: [] },
      zone: true
    }
  ];
}

/** The real index of the group the source currently lives in, or -1. */
function originGroupOf(model: DndModel, source: MoveSource): number {
  if (source.kind === 'tab') return model.tabs[source.anchorId]?.groupIndex ?? -1;
  if (source.kind === 'window') return model.windows[source.anchorId]?.groupIndex ?? -1;
  return -1;
}

/**
 * The target that puts the item at the END of the group `targets` was built for: the last
 * slot among rows (the "new window" zone is not a slot), or the zone itself when the group
 * has nothing else. `-1` for an empty list.
 */
export function endIndex(targets: MoveTarget[]): number {
  for (let i = targets.length - 1; i >= 0; i--) if (!targets[i].zone) return i;
  return targets.length - 1;
}

/** Enter move mode: the cursor starts on the item's own slot. */
export function startMove(state: GroupsState, source: MoveSource, opts: MoveOptions): MoveState {
  const { targets, originIndex } = buildTargets(state, source, opts);
  const model = buildDndModel(state);
  const scope: MoveScope = source.kind === 'group' ? 'sidebar' : Math.min(Math.max(opts.activeGroupIndex, 0), Math.max(state.available.length - 1, 0));
  return { source, targets, index: Math.max(originIndex, 0), scope, mode: 'main', originGroup: originGroupOf(model, source) };
}

export function currentTarget(ms: MoveState): MoveTarget | null {
  return ms.targets[ms.index] ?? null;
}

/** Would an Up / Down step from here wrap around the target list? */
export function wouldWrap(ms: MoveState, dir: MoveDirection): boolean {
  if (ms.targets.length < 2) return false;
  return dir === 'down' ? ms.index === ms.targets.length - 1 : ms.index === 0;
}

/** One step up/down the target list, wrapping at both ends. Same object back = nothing to step to. */
export function stepMove(ms: MoveState, dir: MoveDirection): MoveState {
  const n = ms.targets.length;
  if (n < 2) return ms;
  return { ...ms, index: (ms.index + (dir === 'down' ? 1 : -1) + n) % n };
}

/**
 * The real indices of the groups the source may be moved into, in SIDEBAR order (Now Open,
 * starred groups, the rest; archived groups are not in the sidebar). A group is a stop when
 * its sidebar row is visible and either the source already lives there or `canDrop` accepts
 * the source on the group's row.
 */
export function groupStops(state: GroupsState, source: MoveSource, opts: MoveOptions): number[] {
  if (source.kind === 'group') return [];
  const model = buildDndModel(state);
  const active = activeRefFor(source);
  const vis = opts.isVisible ?? (() => true);
  const origin = originGroupOf(model, source);
  return getSidebarDisplayOrder(state.available)
    .filter(({ group, realIndex }) => {
      if (!vis(group.id)) return false;
      return realIndex === origin || canDrop(model, active, { type: 'group', id: group.id, index: realIndex });
    })
    .map(({ realIndex }) => realIndex);
}

/** The stops of the group list: the groups, then the "new group" zone when it is offered. */
export function listStops(state: GroupsState, source: MoveSource, opts: MoveOptions): MoveScope[] {
  const stops: MoveScope[] = groupStops(state, source, opts);
  if (buildNewGroupTargets(state, source, opts).length > 0) stops.push('new-group');
  return stops;
}

/** Left from the main panel: the cursor moves to the group list, on the group that is shown. Group sources have no list. */
export function enterList(ms: MoveState): MoveState | null {
  if (ms.source.kind === 'group' || ms.mode === 'list' || typeof ms.scope !== 'number') return null;
  const at = endIndex(ms.targets);
  return at < 0 ? null : { ...ms, mode: 'list', index: at };
}

/**
 * The list stop one Up / Down step from `from`, wrapping. `wrapped` says it went past an
 * end. `null` when there is nowhere else to go.
 */
export function listNeighbor(
  from: MoveScope,
  dir: MoveDirection,
  stops: MoveScope[]
): { scope: MoveScope; wrapped: boolean } | null {
  if (stops.length === 0) return null;
  const pos = stops.indexOf(from);
  if (pos < 0) return { scope: stops[0], wrapped: false };
  if (stops.length < 2) return null;
  const next = dir === 'down' ? pos + 1 : pos - 1;
  const wrapped = next < 0 || next >= stops.length;
  return { scope: stops[(next + stops.length) % stops.length], wrapped };
}

/**
 * Put the list cursor on `scope` (a group the caller has already made the shown one, or the
 * "new group" zone): the target is the END of that group. `null` when it offers no target.
 */
export function enterListScope(ms: MoveState, scope: MoveScope, state: GroupsState, opts: MoveOptions): MoveState | null {
  if (scope === 'sidebar') return null;
  const targets =
    scope === 'new-group'
      ? buildNewGroupTargets(state, ms.source, opts)
      : buildTargets(state, ms.source, { ...opts, activeGroupIndex: scope }).targets;
  const at = endIndex(targets);
  return at < 0 ? null : { ...ms, targets, index: at, scope, mode: 'list' };
}

/** Right in the list: the item is already at the end of the highlighted group; hand the cursor back to the main panel. */
export function enterGroup(ms: MoveState): MoveState | null {
  if (ms.mode !== 'list' || ms.scope === 'new-group') return null;
  return { ...ms, mode: 'main' };
}

/**
 * Recompute the list after the groups state changed under a live move. Keeps the cursor on
 * the same target key when it still exists (the end of the group in `list` mode), else
 * returns to the origin (or the first target). `null` when the moving items are gone (the
 * move must be cancelled).
 */
export function rebuildMove(ms: MoveState, state: GroupsState, opts: MoveOptions): MoveState | null {
  const model = buildDndModel(state);
  const exists = (id: string) => Boolean(model.tabs[id] || model.windows[id] || model.groups[id]);
  if (!ms.source.ids.every(exists)) return null;
  const current = currentTarget(ms);
  const built =
    ms.scope === 'new-group'
      ? { targets: buildNewGroupTargets(state, ms.source, opts), originIndex: -1 }
      : buildTargets(state, ms.source, { ...opts, activeGroupIndex: typeof ms.scope === 'number' ? ms.scope : opts.activeGroupIndex });
  const at = current ? built.targets.findIndex((t) => t.key === current.key) : -1;
  const index = ms.mode === 'list' ? Math.max(endIndex(built.targets), 0) : at >= 0 ? at : Math.max(built.originIndex, 0);
  return { ...ms, targets: built.targets, index, originGroup: originGroupOf(model, ms.source) };
}

/** Spoken on pick-up: what was picked up, where it is, and how to move it. */
export function describePickup(state: GroupsState, source: MoveSource): string {
  const label = describeItem(state, source.anchorId);
  if (!label) return 'Picked up.';
  const count = source.ids.length;
  const head = count > 1 ? `Picked up ${plural(count, source.kind)}.` : `Picked up ${label.type} ${label.name}, ${label.position}.`;
  const how =
    source.kind === 'group'
      ? 'Up and Down arrows move it, Space drops, Escape cancels.'
      : 'Up and Down arrows move it, Left chooses a group, Space drops, Escape cancels.';
  return `${head} ${how}`;
}

/** Spoken when the cursor lands on a list stop: "Group list: Play" / "Group list: New group". */
export function describeListStop(state: GroupsState, scope: MoveScope): string {
  if (scope === 'new-group') return 'Group list: New group';
  return `Group list: ${typeof scope === 'number' ? (state.available[scope]?.name ?? '') : ''}`;
}

/** Spoken when Right enters a group from the list: the group name, then where the item sits in it. */
export function describeGroupEntry(state: GroupsState, ms: MoveState): string {
  const name = typeof ms.scope === 'number' ? (state.available[ms.scope]?.name ?? '') : '';
  return `${name}: ${currentTarget(ms)?.text ?? ''}`;
}

/** Spoken before the target text when an Up / Down step wrapped around. */
export const describeWrap = (dir: MoveDirection): string => (dir === 'down' ? 'Wrapped to top.' : 'Wrapped to bottom.');
