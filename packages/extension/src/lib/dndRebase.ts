import type { DndModel } from '@/hooks/useDndModel';
import type { DndRef } from '@/lib/dndMove';
import type { GroupsState, Tab, Window as ExtWindow, Group } from '@/lib/types';

/**
 * Commit-time re-resolution of a drag against the CURRENT groups cache.
 *
 * Every id a drag carries (the dragged item, its selection, the drop target) is a
 * POSITIONAL model id taken from the drag-start snapshot. A realtime update, a poll
 * sync or a Now Open refresh can replace the cache while the drag is in progress, so
 * replaying those ids against the new state could move the wrong item — and committing
 * the snapshot itself would overwrite the update, re-bump stale groups and resurrect a
 * group deleted mid-drag. So the drop maps each snapshot id to the SAME item in the
 * current state and applies the move there:
 *   - groups: by real id
 *   - windows / tabs: inside the same group, by IDENTITY + OCCURRENCE RANK. Identity is
 *     the real browser id for live Now Open items; for saved (`id: 0`) tabs it is their
 *     user-visible content (`url`, `savedAt`, `customTitle`, `title`, `note`, `pinned`),
 *     for saved windows `name` + `starred` + `note` + every tab's identity.
 *     The k-th item with identity X in the snapshot (group visual order: window, then
 *     tab) maps to the k-th item with identity X in the current state.
 *   - an unchanged group object (`===`) maps positionally for free
 *
 * Why rank, not nearest position: duplicate URLs inside a group are common, and an
 * insert above the dragged item (a window prepended, a tab inserted) shifts positions.
 * "Nearest position" then picks the WRONG duplicate. Rank is shift-invariant.
 *
 * Rank is NOT permutation-invariant: a mid-drag REORDER of same-identity items (a star
 * toggle re-sorting windows, a remote reorder) keeps the count, so the k-th can be a
 * different item. So when an identity is DUPLICATED, the rank match must also agree on
 * CONTEXT (see {@link contextOf}); otherwise the match is ambiguous and the drop cancels.
 * A unique identity needs no context: it can only be that item. Fail safe — an extra
 * cancel is acceptable, a wrong move is not.
 *
 * If the number of items with that identity changed, WHICH one survived is unknowable,
 * so the match is AMBIGUOUS and the whole drop cancels. If none are left the item is
 * GONE: the primary/target → cancel; a selection member → dropped from the block ONLY if
 * it was clearly deleted (see {@link looksDeleted}); if it may have been EDITED instead,
 * the whole drop cancels.
 *
 * ONE claim set is shared by the dragged item, its selection and the target, so no two
 * snapshot ids can ever resolve to the same current item.
 *
 * Pure; no React, no chrome.
 */

const NEW_WINDOW_SUFFIX = '::new-window';
/** Kept in sync with `NEW_GROUP_ID` in `@/lib/dndMove` (duplicated to keep this file import-free of it). */
const NEW_GROUP_ID = '::new-group';

type Match = { ok: true; id: string } | { ok: false; reason: 'gone' | 'ambiguous' };
const GONE: Match = { ok: false, reason: 'gone' };
const AMBIGUOUS: Match = { ok: false, reason: 'ambiguous' };

/** Live tabs carry their real browser id; saved tabs (`id: 0`) match on their content. */
function tabIdentity(t: Tab): string {
  if (t.id) return `live:${t.id}`;
  return `saved:${JSON.stringify([
    t.url ?? '',
    t.savedAt ?? null,
    t.customTitle ?? null,
    t.title ?? null,
    t.note ?? null,
    t.pinned ?? false,
    // A reminder is the last user-visible per-tab field that could tell two otherwise
    // identical saved tabs apart. Including it shrinks the residual duplicate-identity
    // risk to fields the user can't see (`favIconUrl`, `chromeGroup`) — a wrong pick
    // there is cosmetic, not a wrong move.
    t.reminder?.fireAt ?? null
  ])}`;
}

/** A window's own fields, without its tabs (the "shell" a tab's context compares). */
function windowShell(w: ExtWindow): string {
  return JSON.stringify([w.name ?? null, w.starred ?? false, w.note ?? null]);
}

function windowIdentity(w: ExtWindow): string {
  if (w.id) return `live:${w.id}`;
  return `saved:${windowShell(w)}:${(w.tabs ?? []).filter(Boolean).map(tabIdentity).join('\n')}`;
}

interface Entry {
  id: string;
  ident: string;
  /** index of the containing list (window index for tabs; 0 for windows) */
  list: number;
  /** shell identity of the containing window (tabs only) */
  shell: string;
}

/** Tabs of a group in visual order, keyed by their model id (same filtering as `buildDndModel`). */
function tabEntries(group: Group | undefined): Entry[] {
  const out: Entry[] = [];
  (group?.windows ?? []).forEach((w, wi) =>
    (w.tabs ?? []).filter(Boolean).forEach((t, ti) =>
      out.push({ id: `${group!.id}::w${wi}::t${ti}`, ident: tabIdentity(t), list: wi, shell: windowShell(w) })
    )
  );
  return out;
}

function windowEntries(group: Group | undefined): Entry[] {
  return (group?.windows ?? []).map((w, wi) => ({ id: `${group!.id}::w${wi}`, ident: windowIdentity(w), list: 0, shell: '' }));
}

function counts(entries: Entry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.ident, (m.get(e.ident) ?? 0) + 1);
  return m;
}

/**
 * Where an entry sits, described by things that survived the drag: its containing
 * window's shell (tabs) and its nearest STABLE neighbours in the same list. A stable item
 * is one whose identity count is the same in the snapshot and the current state; inserted,
 * removed and edited items are skipped, so shifts don't disturb the context but a
 * permutation of the duplicates (relative to anything stable) does.
 */
function contextOf(entries: Entry[], index: number, stable: (ident: string) => boolean): string {
  const self = entries[index];
  let prev = '^';
  for (let i = index - 1; i >= 0 && entries[i].list === self.list; i--) {
    if (stable(entries[i].ident)) {
      prev = entries[i].ident;
      break;
    }
  }
  let next = '$';
  for (let i = index + 1; i < entries.length && entries[i].list === self.list; i++) {
    if (stable(entries[i].ident)) {
      next = entries[i].ident;
      break;
    }
  }
  return JSON.stringify([self.shell, prev, next]);
}

/** The k-th snapshot occurrence of `snapId`'s identity → the k-th current occurrence. */
function rankMatch(snapEntries: Entry[], snapId: string, curEntries: Entry[]): Match {
  const snapIndex = snapEntries.findIndex((e) => e.id === snapId);
  if (snapIndex < 0) return GONE;
  const want = snapEntries[snapIndex].ident;
  const snapSame = snapEntries.filter((e) => e.ident === want);
  const curSame = curEntries.filter((e) => e.ident === want);
  if (curSame.length === 0) return GONE;
  if (curSame.length !== snapSame.length) return AMBIGUOUS;
  const hit = curSame[snapSame.findIndex((e) => e.id === snapId)];
  if (snapSame.length > 1) {
    const snapCounts = counts(snapEntries);
    const curCounts = counts(curEntries);
    const stable = (ident: string) => snapCounts.get(ident) === curCounts.get(ident);
    const curIndex = curEntries.indexOf(hit);
    if (contextOf(snapEntries, snapIndex, stable) !== contextOf(curEntries, curIndex, stable)) return AMBIGUOUS;
  }
  return { ok: true, id: hit.id };
}

/**
 * A selection member that can't be found was DELETED elsewhere only when nothing in its
 * current group could be its edited form: no current item of the same kind carries an
 * identity the snapshot didn't have (or has more of it than the snapshot did). Otherwise
 * it may have been renamed / had a tab added, and silently leaving it behind would be a
 * wrong partial move.
 */
function looksDeleted(snapEntries: Entry[], curEntries: Entry[]): boolean {
  const snapCounts = counts(snapEntries);
  for (const [ident, n] of counts(curEntries)) if (n > (snapCounts.get(ident) ?? 0)) return false;
  return true;
}

interface Ctx {
  snapshot: GroupsState;
  snapModel: DndModel;
  current: GroupsState;
  curModel: DndModel;
  used: Set<string>;
}

function claim(ctx: Ctx, m: Match): Match {
  if (!m.ok) return m;
  // Two snapshot ids resolving to one current item can't be a real mapping — refuse.
  if (ctx.used.has(m.id)) return AMBIGUOUS;
  ctx.used.add(m.id);
  return m;
}

/** Snapshot + current groups for a tab/window id, or `null` when its group is gone. */
function groupsFor(ctx: Ctx, id: string): { snap: Group; cur: Group } | null {
  const bt = ctx.snapModel.tabs[id] ?? ctx.snapModel.windows[id];
  if (!bt) return null;
  const gid = ctx.snapModel.groupIds[bt.groupIndex];
  const cg = gid ? ctx.curModel.groups[gid] : undefined;
  if (!cg) return null;
  return { snap: ctx.snapshot.available[bt.groupIndex], cur: ctx.current.available[cg.index] };
}

function rebaseTab(ctx: Ctx, id: string): Match {
  const gs = groupsFor(ctx, id);
  if (!gs) return GONE;
  if (gs.snap === gs.cur) return claim(ctx, ctx.curModel.tabs[id] ? { ok: true, id } : GONE);
  return claim(ctx, rankMatch(tabEntries(gs.snap), id, tabEntries(gs.cur)));
}

function rebaseWindow(ctx: Ctx, id: string): Match {
  const gs = groupsFor(ctx, id);
  if (!gs) return GONE;
  if (gs.snap === gs.cur) return claim(ctx, ctx.curModel.windows[id] ? { ok: true, id } : GONE);
  return claim(ctx, rankMatch(windowEntries(gs.snap), id, windowEntries(gs.cur)));
}

function rebaseId(ctx: Ctx, id: string): Match {
  // The "new group" zone is a fixed sentinel that names no existing group, so there is
  // nothing to re-resolve: it is valid against ANY current state.
  if (id === NEW_GROUP_ID) return { ok: true, id };
  if (id.endsWith(NEW_WINDOW_SUFFIX)) {
    return ctx.curModel.groups[id.slice(0, -NEW_WINDOW_SUFFIX.length)] ? { ok: true, id } : GONE;
  }
  if (ctx.snapModel.tabs[id]) return rebaseTab(ctx, id);
  if (ctx.snapModel.windows[id]) return rebaseWindow(ctx, id);
  if (ctx.snapModel.groups[id]) return ctx.curModel.groups[id] ? { ok: true, id } : GONE;
  return GONE;
}

/** True when a GONE selection member was deleted (its group, or the item itself) rather than possibly edited. */
function memberDeleted(ctx: Ctx, id: string): boolean {
  const gs = groupsFor(ctx, id);
  if (!gs) return true;
  return ctx.snapModel.tabs[id]
    ? looksDeleted(tabEntries(gs.snap), tabEntries(gs.cur))
    : looksDeleted(windowEntries(gs.snap), windowEntries(gs.cur));
}

/** Re-point a ref's positional extras (`index`, `groupIndex`) at the current state. */
function refreshRef(curModel: DndModel, ref: DndRef, id: string): DndRef {
  if (ref.type === 'new-group') return { ...ref, id, index: undefined, groupIndex: undefined };
  if (ref.type === 'new-window') {
    const g = curModel.groups[id.slice(0, -NEW_WINDOW_SUFFIX.length)];
    return { ...ref, id, groupIndex: g?.index };
  }
  const g = curModel.groups[id];
  if (g) return { ...ref, id, index: g.index };
  // `index` on a tab/window ref is drag-start positional data — let the model decide.
  return { ...ref, id, index: undefined };
}

export interface RebasedMove {
  active: DndRef;
  over: DndRef;
  /** selection members that were deleted elsewhere during the drag and left out of the move */
  removed: number;
}

/**
 * Map a drag resolved against `snapshot` onto `current`. Returns `null` when the dragged
 * item or the drop target no longer exists, when any involved item can no longer be
 * identified unambiguously, or when a selection member may have been edited mid-drag (the
 * caller commits nothing). Selection members that were clearly deleted are dropped from
 * the selection and counted in `removed`; the primary must survive.
 */
export function rebaseMove(
  snapshot: GroupsState,
  snapModel: DndModel,
  current: GroupsState,
  curModel: DndModel,
  active: DndRef,
  over: DndRef
): RebasedMove | null {
  if (snapshot === current) return { active, over, removed: 0 };
  const ctx: Ctx = { snapshot, snapModel, current, curModel, used: new Set() };

  const primary = rebaseId(ctx, active.id);
  if (!primary.ok) return null;
  let selectionIds: string[] | undefined;
  let removed = 0;
  if (active.selectionIds && active.selectionIds.length > 1) {
    const mapped: string[] = [];
    for (const sid of active.selectionIds) {
      if (sid === active.id) {
        mapped.push(primary.id);
        continue;
      }
      const m = rebaseId(ctx, sid);
      if (m.ok) mapped.push(m.id);
      else if (m.reason === 'ambiguous' || !memberDeleted(ctx, sid)) return null;
      else removed++;
    }
    selectionIds = mapped.length > 1 ? mapped : undefined;
  }

  // Same claim set: under a shift the target must not resolve onto a dragged item.
  const target = rebaseId(ctx, over.id);
  if (!target.ok) return null;

  return {
    active: { ...refreshRef(curModel, active, primary.id), selectionIds },
    over: refreshRef(curModel, over, target.id),
    removed
  };
}
