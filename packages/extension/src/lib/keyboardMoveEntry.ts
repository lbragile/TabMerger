import type { MoveKind } from '@/lib/keyboardMove';
import { isDndDragLive } from '@/lib/dndMultiDrag';
import { announceDnd } from '@/lib/dndLiveRegion';
import { plural } from '@/lib/dndAnnouncements';
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore';
import { useUIStore, type SelectedItem } from '@/stores/uiStore';

const isSpace = (e: React.KeyboardEvent) => e.key === ' ' || e.code === 'Space';

/**
 * Plain Space on a focused draggable row or its grip starts keyboard MOVE MODE for it
 * (`useKeyboardMove` picks the request up). Enter is deliberately not a move key: it stays
 * "open". Modified Space belongs to selection ({@link toggleSelectionOnCtrlSpace}) and is
 * left alone here.
 *
 * @returns true when the key was consumed (the caller must not also activate the row).
 */
export function startMoveOnSpace(e: React.KeyboardEvent, kind: MoveKind, id: string): boolean {
  if (!isSpace(e)) return false;
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  if (isDndDragLive()) return false;
  e.preventDefault();
  e.stopPropagation();
  useKeyboardMoveStore.getState().requestMove(kind, id);
  return true;
}

/**
 * Ctrl (Cmd) + Space on a focused row or grip toggles it in / out of the selection WITHOUT
 * starting a move: the keyboard Ctrl+click, through the same store action, so the same
 * rule applies (a different kind than the current selection replaces it). The key is
 * consumed so the row's own Space behaviour (open, move) does not also run.
 *
 * @param item the row's selection item (`tab-g-w-t` / `window-g-w` / group id)
 * @returns true when the key was consumed
 */
export function toggleSelectionOnCtrlSpace(e: React.KeyboardEvent, item: SelectedItem): boolean {
  if (!isSpace(e) || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat || isDndDragLive()) return true;
  const ui = useUIStore.getState();
  const was = ui.selectedItems.some((s) => s.id === item.id);
  ui.enterSelectionMode();
  ui.toggleSelection(item);
  const now = useUIStore.getState().selectedItems;
  const left = now.length === 0 ? 'nothing selected' : `${plural(now.length, now[0].type)} selected`;
  announceDnd(`${was ? 'Deselected' : 'Selected'}. ${left}.`);
  return true;
}
