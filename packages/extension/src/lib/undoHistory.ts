import type { GroupsState } from './types';
import { savedDataChanged, savedDataFingerprint, userDataChanged } from './savedData';
import { historyEntryEffect, tagHistoryEntry, type PendingLiveTabsEffect } from './undoLiveTabs';
import { useUIStore } from '@/stores/uiStore';
import { updateGroupsState } from './localDb';

export { savedDataChanged } from './savedData';

// ─── Recording steps ─────────────────────────────────────────────────────────────────────────────
//
// Every history change happens INSIDE the groups write it belongs to (the `afterWrite` hook of
// `updateGroupsState` / `saveGroupsState`, which runs in that write's step of the serialized write
// queue). So the history is ordered exactly like the writes: an Undo clicked while an action is
// still saving is queued behind that action's write and finds its step, and two quick Undos each
// find the history the previous one left. A write that failed records nothing.

/**
 * The stored state after the last write this popup made through the history: every action (also
 * the ones that are no step, like reminders), every undo, redo and drop. An Undo compares the fresh
 * state with it: saved data that changed in between did not go through the history (another
 * context, or a sync pull whose history clear has not arrived yet), and restoring an older snapshot
 * would silently revert it. Now Open is not compared: it changes all the time as the user browses
 * and is never restored. Null = unknown (nothing written yet, or forgotten): nothing to compare.
 */
let cursor: GroupsState | null = null;

/** Moves the cursor to a state this popup just stored. */
export function noteHistoryCursor(stored: GroupsState): void {
  cursor = stored;
}

/** Forgets the cursor (tests; nothing to compare until the next write through the history). */
export function forgetHistoryCursor(): void {
  cursor = null;
}

/**
 * Re-anchors the cursor on the stored state, as one step of the write queue: a change the
 * history deliberately keeps landed without going through it (a URL rule saving a tab this popup
 * just opened, which an Undo of the action takes back too). Unlike forgetting the cursor, this
 * keeps the guard on for anything that lands after it. `saved` is the fingerprint of the saved
 * data that write left (`GroupsChangedMessage.saved`): the cursor moves only while the store still
 * holds exactly that saved data. Now Open writes since (the live-tab mirror reacts to the very tab
 * events the rule does) do not matter; any other saved-data change leaves the cursor where it was,
 * so it still refuses the next Undo instead of being adopted. Anything but a string: no re-anchor.
 * (Not gated on `rev`: every Now Open write moves it, and a data wipe resets it to 0.)
 */
export async function reanchorHistoryCursor(saved: unknown): Promise<void> {
  if (typeof saved !== 'string' || saved === '') return;
  try {
    await updateGroupsState((fresh) => {
      if (savedDataFingerprint(fresh) === saved) cursor = fresh;
      return null; // a read: nothing is written
    });
  } catch {
    // (the store is unavailable: the cursor stays where it was, and the next Undo may be refused)
  }
}

/** A maintenance write (the `savedAt` migration): carries the cursor along when it was at the state the write started from. */
export function carryHistoryCursor(stored: GroupsState, base: GroupsState): void {
  if (cursor && !userDataChanged(cursor, base)) cursor = stored;
}

/** Whether the saved data in `fresh` changed since the cursor without going through the history. */
export function changedOutsideHistory(fresh: GroupsState): boolean {
  return cursor !== null && userDataChanged(cursor, fresh);
}

/** One action's write, as {@link recordStep} records it. */
export interface StepRecord {
  /** `uiStore.pushUndo` (passed in, so the caller's store selector is the one used). */
  push: (state: GroupsState) => GroupsState | void;
  /** Record no step (an info recount, a reminder): the cursor still moves. */
  skip?: boolean;
  /** The real tabs the action closed or opened, possibly still a promise (lib/undoLiveTabs.ts). Read after the write. */
  effect?: () => PendingLiveTabsEffect | null | undefined;
  /**
   * The action takes back the step before it (cancelling the name of a group just added deletes
   * it): when the result is exactly the top entry's saved data, that entry is removed instead of a
   * new one being pushed, so the add and its cancel leave nothing to undo.
   */
  revertsLastStep?: boolean;
}

/**
 * The `afterWrite` hook of a user action's write: records it as ONE step when it changed the saved
 * data (`savedDataChanged(base, stored)`). The entry is `base`, the fresh state the write started
 * from, so exactly the previous cursor state. The action's live-tabs effect goes on the entry.
 */
export function recordStep(rec: StepRecord): (stored: GroupsState, base: GroupsState) => void {
  return (stored, base) => {
    try {
      record(rec, stored, base);
    } catch (err) {
      // History out of step with the data is worse than none: drop it (the write still stands)
      historyStore()?.clearHistory?.();
      throw err;
    }
  };
}

function record(rec: StepRecord, stored: GroupsState, base: GroupsState): void {
  const history = historyStore();
  // The write started from saved data the history has not seen (a write of another context whose
  // "clear the history" message is still on its way): every entry predates it, and restoring one
  // would revert it. Drop them, so this step is the first of a history that matches the data.
  if (changedOutsideHistory(base)) {
    history?.clearHistory?.();
    if (oneStep) oneStep.entry = null;
  }
  cursor = stored;
  if (rec.skip || !savedDataChanged(base, stored)) return;
  const top = historyStore()?.undoStack?.[0]; // (read after a clear above)
  if (rec.revertsLastStep && top && history && !userDataChanged(top, stored)) {
    history.dropUndoEntry(top);
    return;
  }
  if (oneStep?.entry && top === oneStep.entry) {
    // A later write of the same action (asOneHistoryStep): the entry already holds the state before all of it
    if (!historyEntryEffect(top)) tagHistoryEntry(top, rec.effect?.());
    return;
  }
  const entry = rec.push(base) ?? historyStore()?.undoStack?.[0];
  if (oneStep && entry) oneStep.entry = entry;
  tagHistoryEntry(entry, rec.effect?.());
}

type HistoryStore = { undoStack?: GroupsState[]; dropUndoEntry: (entry: GroupsState) => boolean; clearHistory?: () => void };

/** The store outside React; undefined for bare-selector test mocks that have no `getState`. */
function historyStore(): HistoryStore | undefined {
  return (useUIStore as { getState?: () => HistoryStore }).getState?.();
}

/** The action {@link asOneHistoryStep} is running, and the entry its first write pushed. */
let oneStep: { entry: GroupsState | null } | null = null;

/**
 * Runs an action made of SEVERAL mutations as one step: the first write that changes the saved
 * data pushes the entry, and every later one while `action` runs folds into it (as long as that
 * entry is still the top one). "Create new group…" in a move menu (add the group, then move the
 * item into it) uses it. Keep `action` short: a write of another action landing while it runs
 * would fold into the same step. A nested call joins the outer one.
 */
export async function asOneHistoryStep<T>(action: () => Promise<T>): Promise<T> {
  if (oneStep) return action();
  const own: { entry: GroupsState | null } = { entry: null };
  oneStep = own;
  try {
    return await action();
  } finally {
    if (oneStep === own) oneStep = null;
  }
}
