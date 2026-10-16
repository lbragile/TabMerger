/**
 * What counts as a change to the user's SAVED data. Store-free on purpose: the undo history
 * (lib/undoHistory.ts, popup) and the sync merge (lib/syncEngine.ts, also the service worker)
 * share it.
 */
import type { Group, GroupsState } from './types';
import { isTourDemoGroup } from '@tabmerger/shared';

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

/** `savedDataChanged`, not counting the guided tour's practice groups (the tour adds and removes them itself). */
export function userDataChanged(before: GroupsState, after: GroupsState): boolean {
  const strip = (s: GroupsState): GroupsState =>
    Array.isArray(s?.available) ? { ...s, available: s.available.filter((g) => g && !isTourDemoGroup(g)) } : s;
  return savedDataChanged(strip(before), strip(after));
}

/**
 * A short fingerprint of the user's saved data (same rules as `userDataChanged`: saved groups in
 * order with their content; Now Open, practice groups and sync bookkeeping left out). Two states
 * with the same fingerprint are the same as far as the undo history is concerned. A write of
 * another context that the popup keeps its history for sends it (`GroupsChangedMessage.saved`), so
 * the popup can re-anchor its cursor on exactly that saved data however many Now Open writes
 * landed since (lib/undoHistory.ts `reanchorHistoryCursor`).
 */
export function savedDataFingerprint(state: GroupsState): string {
  const groups = savedGroups(state).filter((g) => !isTourDemoGroup(g));
  return hash53(JSON.stringify(groups.map((g) => [g.id, contentKey(g)])));
}

/** cyrb53: a fast 53-bit string hash (not cryptographic; collisions are not a security concern here). */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
