import type { Group, GroupsState } from './types';

/**
 * The one rule for "does this write get an undo step": a write is a user change worth undoing
 * exactly when it changed the SAVED data, i.e. the saved groups (everything but "Now Open"), their
 * order, or their content.
 *
 *  - "Now Open" (permanent) is ignored: it mirrors the live browser, and an undo never restores it
 *    (`restoreSnapshotAsLocalChange` keeps the current one), so a step for a Now Open-only change
 *    would do nothing when undone and only use up a slot of history.
 *  - Sync bookkeeping (`updatedAt`, `pendingSync`, `positionDirty`, `remoteUpdatedAt`) and the derived
 *    `info` line are ignored: a write that only re-stamps or recounts is not a change the user made.
 *  - A write that changed nothing (a toggle on a group that no longer exists, a note saved with the
 *    same text) gets no step either, so the step Undo offers is always the user's last real change.
 *
 * Cheap on purpose: every mutation clones only the groups it touches, so untouched groups are skipped
 * by reference and only the touched ones are compared by content.
 */
export function savedDataChanged(before: GroupsState, after: GroupsState): boolean {
  if (before === after) return false;
  const a = savedGroups(before);
  const b = savedGroups(after);
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i].id !== b[i].id) return true;
    if (contentKey(a[i]) !== contentKey(b[i])) return true;
  }
  return false;
}

function savedGroups(state: GroupsState): Group[] {
  return Array.isArray(state?.available) ? state.available.filter((g) => g && !g.permanent) : [];
}

/** A group's content as the user sees it: everything except sync bookkeeping and the derived count line. */
function contentKey(g: Group): string {
  const { updatedAt: _u, pendingSync: _p, positionDirty: _d, remoteUpdatedAt: _r, info: _i, ...content } = g;
  return JSON.stringify(content);
}
