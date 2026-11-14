/**
 * The polite status line for the sidebar's section views (`SectionViewAnnouncer`): "Showing
 * archived group X, read-only" while a view is open, and "Restored X" / "Deleted X" after a
 * restore or delete from a section row or a view. A plain module store (no React state), so the
 * sidebar rows, the views and `MainPanel` can all write to the one region.
 */

let message = '';
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Puts `text` in the status line (replacing what was there). */
export function announceSectionView(text: string): void {
  message = text;
  emit();
}

/**
 * Empties the status line. With `onlyIf`, only when it still says exactly that (closing a view
 * clears its "Showing …" line, but not a "Restored …" that replaced it meanwhile).
 */
export function clearSectionViewStatus(onlyIf?: string): void {
  if (onlyIf !== undefined && message !== onlyIf) return;
  if (message === '') return;
  message = '';
  emit();
}

/** What the status line says now. */
export function getSectionViewStatus(): string {
  return message;
}

/** For `useSyncExternalStore`. */
export function subscribeSectionViewStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
