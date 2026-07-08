/**
 * useUndoRedo exposes undo/redo state from the UI store and applies it
 * back to the groups state via IndexedDB + TanStack Query cache.
 *
 * The actual undo/redo stack lives in uiStore (last 10 GroupsState snapshots).
 * Operations excluded from undo: NOW_OPEN sync, info updates.
 */
import { useUIStore } from '@/stores/uiStore';
import { useGroups, useSetGroupsState } from './useGroups';

export function useUndoRedo() {
  const undoStack = useUIStore((s) => s.undoStack);
  const redoStack = useUIStore((s) => s.redoStack);
  const undoFn = useUIStore((s) => s.undo);
  const redoFn = useUIStore((s) => s.redo);
  const { data: groupsState } = useGroups();
  const setGroupsState = useSetGroupsState();

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const undo = async () => {
    if (!groupsState) return;
    const prev = undoFn(groupsState);
    if (prev) await setGroupsState(prev);
  };

  const redo = async () => {
    if (!groupsState) return;
    const next = redoFn(groupsState);
    if (next) await setGroupsState(next);
  };

  return { canUndo, canRedo, undo, redo, undoStack, redoStack };
}
