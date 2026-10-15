/**
 * useUndoRedo exposes undo/redo state from the UI store and applies it
 * back to the groups state via IndexedDB + TanStack Query cache.
 *
 * The actual undo/redo stack lives in uiStore (last 10 GroupsState snapshots).
 * Operations excluded from undo: NOW_OPEN sync, info updates.
 */
import { useUIStore } from '@/stores/uiStore';
import { restoreSnapshotAsLocalChange } from '@/lib/syncDirty';
import { toast } from '@/lib/toast';
import { TOUR_SIGNALS } from '@/lib/tourSandbox';
import type { GroupsState } from '@/lib/types';
import { useGroups, useSetGroupsState } from './useGroups';

export function useUndoRedo() {
  const undoStack = useUIStore((s) => s.undoStack);
  const redoStack = useUIStore((s) => s.redoStack);
  const undoFn = useUIStore((s) => s.undo);
  const redoFn = useUIStore((s) => s.redo);
  const restoreHistory = useUIStore((s) => s.restoreHistory);
  const { data: groupsState } = useGroups();
  const setGroupsState = useSetGroupsState();

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  /**
   * Applies a popped snapshot as a NEW local change (it must be pushed, not overwritten by the next
   * pull). If the groups changed since the cache was read the write is refused: the history entry
   * is put back and the user is told, instead of silently consuming it.
   */
  const apply = async (pop: (s: GroupsState) => GroupsState | undefined, signal: string) => {
    if (!groupsState) return;
    // Read from the store, not the render: a stale render value would put back old history
    const live = useUIStore.getState();
    const before = { undo: live.undoStack, redo: live.redoStack };
    const snapshot = pop(groupsState);
    if (!snapshot) return;
    const after = useUIStore.getState();
    // During the guided tour's practice chapters the history holds practice data only
    const tourPractice = after.tourHistory !== null;
    const applied = await setGroupsState(restoreSnapshotAsLocalChange(groupsState, snapshot, { tourPractice }), { expectedRev: groupsState.rev });
    if (applied === false) {
      // Put the entry back only if nothing touched the history meanwhile (a clear, a new change,
      // the tour starting or ending): restoring then would bring back history that is gone
      const now = useUIStore.getState();
      const untouched = now.undoStack === after.undoStack && now.redoStack === after.redoStack && now.tourHistory === after.tourHistory;
      if (untouched) restoreHistory(before.undo, before.redo);
      toast.info('Your groups changed elsewhere, so nothing was undone. Try again.', { id: 'undo-conflict' });
      return;
    }
    // (counted for the tour's undo step; does nothing while no tour is under way)
    useUIStore.getState().signalTour(signal);
  };

  const undo = () => apply(undoFn, TOUR_SIGNALS.undo);
  const redo = () => apply(redoFn, TOUR_SIGNALS.redo);

  return { canUndo, canRedo, undo, redo, undoStack, redoStack };
}
