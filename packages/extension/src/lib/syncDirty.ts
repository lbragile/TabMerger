import { nanoid } from 'nanoid';
import type { Group, GroupsState } from './types';

/** The server base and the unpushed-position flag belong to ONE row; a copy under another identity must not inherit them. */
function withoutSyncIdentity(g: Group): Group {
  const { remoteUpdatedAt: _base, positionDirty: _dirty, ...rest } = g;
  return rest;
}

/** Content of a group as sync sees it: everything except the sync bookkeeping fields. */
function contentKey(g: Group): string {
  return JSON.stringify({ ...g, updatedAt: 0, pendingSync: false, positionDirty: false });
}

/**
 * Turns an undo/redo snapshot into a NEW local change. The snapshot carries the old
 * `updatedAt` and `pendingSync:false`, so restoring it verbatim looks "already synced and
 * older than the server": the next pull would bring the undone change straight back.
 * Groups whose content differs from `current` (or that `current` lacks, e.g. an undone
 * delete) get a fresh `updatedAt` and `pendingSync:true`; groups with identical content keep
 * their current sync state. A moved group needs nothing here: the write derives
 * `positionDirty` from the stored order.
 *
 * Now Open (permanent) is never taken from the snapshot: its tabs are the LIVE browser
 * tabs, and a snapshot's copy is stale (and it is never synced). The current one is kept.
 */
export function restoreSnapshotAsLocalChange(current: GroupsState, snapshot: GroupsState): GroupsState {
  const currentById = new Map(current.available.map((g) => [g.id, g]));
  const currentNowOpen = current.available.find((g) => g.permanent);
  const now = Date.now();
  const available = snapshot.available.map((g) => {
    if (g.permanent) return currentNowOpen ?? g;
    const cur = currentById.get(g.id);
    // A group the current state lacks (an undone delete) keeps its OLD id, but its server row may be
    // gone (or a pending delete away from it): drop the base so it re-inserts instead of doing a
    // compare-and-swap on a missing row and turning into a "(conflict copy)". If the row does still
    // exist, the insert hits a unique violation and the merge adopts it (equal content) or keeps both.
    if (!cur) return { ...withoutSyncIdentity(g), updatedAt: now, pendingSync: true };
    if (contentKey(cur) !== contentKey(g)) return { ...g, updatedAt: now, pendingSync: true };
    return { ...g, updatedAt: cur.updatedAt, pendingSync: cur.pendingSync }; // same content: keep its sync state
  });
  return { ...snapshot, available };
}

/**
 * A copy of `g` under a NEW identity (duplicate, import): new id, no server base, no position flag,
 * pending so it is inserted by the next push. Inheriting the source's `remoteUpdatedAt` would make
 * the push a compare-and-swap on a row that does not exist, which the merge reads as "deleted
 * elsewhere" and turns into a "(conflict copy)".
 */
export function asNewGroup(g: Group, id: string = nanoid(10)): Group {
  return { ...withoutSyncIdentity(g), id, pendingSync: true };
}

/**
 * The state to store when the user imports a full JSON backup (replace mode). Every saved group
 * becomes a new group (fresh id, no bookkeeping): an export made on this very account carries the
 * ids and server stamps of rows that still exist, so keeping them would collide with those rows.
 * The replaced groups are pruned (and deleted remotely) by the write. Now Open is never taken from
 * the file: its tabs are the live browser tabs, so the current one is kept (and stays first).
 */
export function prepareImportedState(parsed: GroupsState, current: GroupsState | undefined): GroupsState {
  const nowOpen = current?.available.find((g) => g.permanent) ?? parsed.available.find((g) => g.permanent);
  const idMap = new Map<string, string>();
  const saved = parsed.available
    .filter((g) => !g.permanent)
    .map((g) => {
      const fresh = asNewGroup(g);
      idMap.set(g.id, fresh.id);
      return fresh;
    });
  const available = nowOpen ? [nowOpen, ...saved] : saved;
  const activeId = idMap.get(parsed.active?.id) ?? parsed.active?.id;
  return { ...parsed, available, active: { id: available.some((g) => g.id === activeId) ? activeId : (available[0]?.id ?? ''), index: parsed.active?.index ?? 0 }, rev: current?.rev };
}
