/**
 * useUndoRedo exposes undo/redo state from the UI store and applies it back to the groups state
 * via IndexedDB + TanStack Query cache.
 *
 * The undo/redo stacks live in uiStore (last 10 GroupsState snapshots each). Which writes get a
 * step is decided in one place, `recordStep` / `savedDataChanged` (lib/undoHistory.ts): every user
 * change to the saved groups, never a Now Open-only write. An entry whose change also closed or
 * opened real browser tabs carries a `LiveTabsEffect` (lib/undoLiveTabs.ts) that undo/redo runs
 * after the restore. See docs/undo-redo-spec.md.
 */
import { t } from '@/lib/i18n';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/uiStore';
import { updateGroupsState } from '@/lib/localDb';
import { restoreSnapshotAsLocalChange } from '@/lib/syncDirty';
import { toast } from '@/lib/toast';
import { deleteRemoteGroups } from '@/lib/syncEngine';
import { isTourDemoGroup } from '@tabmerger/shared';
import { TOUR_SIGNALS } from '@/lib/tourSandbox';
import { changedOutsideHistory, noteHistoryCursor } from '@/lib/undoHistory';
import { historyEntryEffect, runLiveTabsEffect, settledEntryEffect, tagHistoryEntry, type LiveTabsEffect } from '@/lib/undoLiveTabs';
import type { GroupsState } from '@/lib/types';
import { GROUPS_QUERY_KEY } from './useGroups';

/** Saved (synced) groups in `before` that `after` no longer has: never Now Open, never practice data. */
function removedSavedGroupIds(before: GroupsState, after: GroupsState): string[] {
  const kept = new Set(after.available.map((g) => g.id));
  return before.available.filter((g) => !g.permanent && !isTourDemoGroup(g) && !kept.has(g.id)).map((g) => g.id);
}

/**
 * One Undo (or Redo): moves the cursor one step, as ONE step of the serialized groups write queue.
 *
 * Inside that step (`updateGroupsState`: after every write issued before it, including an action
 * still saving when the button was clicked, and before every write issued after it):
 *  1. take the top entry of the stack AS IT IS NOW (what the previous Undo, Redo or action left);
 *  2. refuse only if the SAVED data changed without going through the history
 *     (`changedOutsideHistory`); a change to Now Open alone never refuses;
 *  3. restore the entry onto the fresh state as a new local change (the current Now Open is kept);
 *  4. once stored, move the entry to the other stack, the fresh state being its counterpart.
 * Then, outside the lock: remote deletes for the groups the restore removed, and the entry's
 * live-tabs effect (waiting for one still being collected). The counterpart is tagged with the
 * PROMISE of the inverse effect when it is pushed, so a Redo clicked right after waits for it.
 */
async function moveHistoryCursor(qc: QueryClient, direction: 'undo' | 'redo', signal: string): Promise<void> {
  let entry: GroupsState | undefined;
  let base: GroupsState | undefined;
  let conflict = false;
  let tourPractice = false;
  let resolveInverse!: (effect: LiveTabsEffect | null) => void;
  const inverse = new Promise<LiveTabsEffect | null>((resolve) => {
    resolveInverse = resolve;
  });
  let stored: GroupsState;
  try {
    stored = await updateGroupsState(
      (fresh) => {
        const history = useUIStore.getState();
        const top = (direction === 'undo' ? history.undoStack : history.redoStack)[0];
        if (!top) return null; // nothing (left) to undo: no write
        // During the guided tour's practice chapters the history holds practice data only, and a
        // practice restore never touches the user's groups, so their changes cannot refuse it
        tourPractice = history.tourHistory !== null;
        if (!tourPractice && changedOutsideHistory(fresh)) {
          conflict = true;
          return null;
        }
        entry = top;
        return restoreSnapshotAsLocalChange(fresh, top, { tourPractice });
      },
      {
        afterWrite: (written, fresh) => {
          noteHistoryCursor(written);
          base = fresh;
          if (!entry) return;
          try {
            const counterpart = useUIStore.getState().stepHistory(direction, entry, fresh);
            // (no effect runs on practice data: it has no real tabs)
            if (historyEntryEffect(entry) && !tourPractice) tagHistoryEntry(counterpart, inverse);
          } catch (err) {
            // History out of step with the data is worse than none: drop it (the restore stands)
            useUIStore.getState().clearHistory();
            throw err;
          }
        }
      }
    );
  } catch (err) {
    resolveInverse(null);
    throw err;
  }
  if (conflict) {
    resolveInverse(null);
    toast.info(t('errors.undoConflict'), { id: 'undo-conflict' });
    return;
  }
  if (!entry || !base) {
    resolveInverse(null);
    return;
  }
  qc.setQueryData(GROUPS_QUERY_KEY, stored);
  // Groups this restore removed (Redo of a delete or a replace, Undo of an add or an import) are
  // deleted remotely exactly as the forward action does it, not only when the write's
  // `cloudSyncActive` gate happens to be on (it is off until entitlements load)
  const removed = removedSavedGroupIds(base, stored);
  if (removed.length > 0) deleteRemoteGroups(removed).catch(() => {});
  // (counted for the tour's undo step; does nothing while no tour is under way)
  useUIStore.getState().signalTour(signal);
  // After the saved data is restored: reopen the tabs the change closed, or close the ones it
  // opened (waiting for ids still being collected), and hand the inverse to the counterpart
  try {
    const effect = tourPractice ? null : await settledEntryEffect(entry);
    resolveInverse(effect ? await runLiveTabsEffect(effect) : null);
  } catch {
    resolveInverse(null); // best effort: the saved data is restored either way
  }
}

export function useUndoRedo() {
  const qc = useQueryClient();
  const undoStack = useUIStore((s) => s.undoStack);
  const redoStack = useUIStore((s) => s.redoStack);

  // Buttons follow the stacks. A click while an earlier Undo, Redo or action is still saving is
  // queued behind it (the groups write queue) and applies in click order.
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const undo = () => moveHistoryCursor(qc, 'undo', TOUR_SIGNALS.undo);
  const redo = () => moveHistoryCursor(qc, 'redo', TOUR_SIGNALS.redo);

  return { canUndo, canRedo, undo, redo, undoStack, redoStack };
}
