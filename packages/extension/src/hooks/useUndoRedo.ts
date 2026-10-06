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
  const apply = async (pop: (s: GroupsState) => GroupsState | undefined) => {
    if (!groupsState) return;
    const before = { undo: undoStack, redo: redoStack };
    const snapshot = pop(groupsState);
    if (!snapshot) return;
    const applied = await setGroupsState(restoreSnapshotAsLocalChange(groupsState, snapshot), { expectedRev: groupsState.rev });
    if (applied === false) {
      restoreHistory(before.undo, before.redo);
      toast.info('Your groups changed elsewhere, so nothing was undone. Try again.', { id: 'undo-conflict' });
    }
  };

  const undo = () => apply(undoFn);
  const redo = () => apply(redoFn);

  return { canUndo, canRedo, undo, redo, undoStack, redoStack };
}
