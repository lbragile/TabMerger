/**
 * useUndoRedo exposes undo/redo state from the UI store and applies it
 * back to the groups state via IndexedDB + TanStack Query cache.
 *
 * The actual undo/redo stack lives in uiStore (last 10 GroupsState snapshots). Which writes get a
 * step is decided in one place, `savedDataChanged` (lib/undoHistory.ts): every user change to the
 * saved groups, never a Now Open-only write. An entry whose change also closed or opened real
 * browser tabs carries a `LiveTabsEffect` (lib/undoLiveTabs.ts) that undo/redo runs after the
 * restore.
 */
import { useUIStore } from '@/stores/uiStore';
import { restoreSnapshotAsLocalChange } from '@/lib/syncDirty';
import { toast } from '@/lib/toast';
import { deleteRemoteGroups } from '@/lib/syncEngine';
import { isTourDemoGroup } from '@tabmerger/shared';
import { TOUR_SIGNALS } from '@/lib/tourSandbox';
import { historyEntryEffect, runLiveTabsEffect, tagHistoryEntry } from '@/lib/undoLiveTabs';
import type { GroupsState } from '@/lib/types';
import { useGroups, useGroupsSnapshot, useSetGroupsState } from './useGroups';

/** Saved (synced) groups in `before` that `after` no longer has: never Now Open, never practice data. */
function removedSavedGroupIds(before: GroupsState, after: GroupsState): string[] {
  const kept = new Set(after.available.map((g) => g.id));
  return before.available.filter((g) => !g.permanent && !isTourDemoGroup(g) && !kept.has(g.id)).map((g) => g.id);
}

export function useUndoRedo() {
  const undoStack = useUIStore((s) => s.undoStack);
  const redoStack = useUIStore((s) => s.redoStack);
  const undoFn = useUIStore((s) => s.undo);
  const redoFn = useUIStore((s) => s.redo);
  const restoreHistory = useUIStore((s) => s.restoreHistory);
  const { data: renderedGroups } = useGroups();
  const readGroups = useGroupsSnapshot();
  const setGroupsState = useSetGroupsState();

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  /**
   * Applies a popped snapshot as a NEW local change (it must be pushed, not overwritten by the next
   * pull). If the groups changed since the cache was read the write is refused: the history entry
   * is put back and the user is told, instead of silently consuming it.
   */
  const apply = async (direction: 'undo' | 'redo', pop: (s: GroupsState) => GroupsState | undefined, signal: string) => {
    // The cache NOW, not this render's value: an Undo right after a write (Now Open's re-sync, the
    // previous Undo) would otherwise carry a stale rev and be refused
    const groupsState = readGroups() ?? renderedGroups;
    if (!groupsState) return;
    // Read from the store, not the render: a stale render value would put back old history
    const live = useUIStore.getState();
    const before = { undo: live.undoStack, redo: live.redoStack };
    // Real browser tabs the entry's change closed or opened (see lib/undoLiveTabs.ts)
    const effect = historyEntryEffect(direction === 'undo' ? live.undoStack?.[0] : live.redoStack?.[0]);
    const snapshot = pop(groupsState);
    if (!snapshot) return;
    const after = useUIStore.getState();
    // The entry this pop pushed onto the OTHER stack: it gets the inverse effect
    const counterpart = direction === 'undo' ? after.redoStack?.[0] : after.undoStack?.[0];
    // During the guided tour's practice chapters the history holds practice data only
    const tourPractice = after.tourHistory !== null;
    const restored = restoreSnapshotAsLocalChange(groupsState, snapshot, { tourPractice });
    const applied = await setGroupsState(restored, { expectedRev: groupsState.rev });
    if (applied === false) {
      // Put the entry back only if nothing touched the history meanwhile (a clear, a new change,
      // the tour starting or ending): restoring then would bring back history that is gone
      const now = useUIStore.getState();
      const untouched = now.undoStack === after.undoStack && now.redoStack === after.redoStack && now.tourHistory === after.tourHistory;
      if (untouched) restoreHistory(before.undo, before.redo);
      toast.info('Your groups changed elsewhere, so nothing was undone. Try again.', { id: 'undo-conflict' });
      return;
    }
    // Groups this restore removed (Redo of a delete or a replace, Undo of an add or an import) are
    // deleted remotely exactly as the forward action does it, not only when the write's
    // `cloudSyncActive` gate happens to be on (it is off until entitlements load)
    const removed = removedSavedGroupIds(groupsState, restored);
    if (removed.length > 0) deleteRemoteGroups(removed).catch(() => {});
    // (counted for the tour's undo step; does nothing while no tour is under way)
    useUIStore.getState().signalTour(signal);
    // After the saved data is restored: reopen the tabs the change closed, or close the ones it
    // opened, and remember the inverse so the opposite button does the reverse
    if (effect && !tourPractice) tagHistoryEntry(counterpart, await runLiveTabsEffect(effect));
  };

  const undo = () => apply('undo', undoFn, TOUR_SIGNALS.undo);
  const redo = () => apply('redo', redoFn, TOUR_SIGNALS.redo);

  return { canUndo, canRedo, undo, redo, undoStack, redoStack };
}
