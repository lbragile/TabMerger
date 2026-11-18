/**
 * The polite status line for the sidebar's section views (`SectionViewAnnouncer`): "Showing
 * archived group X, read-only" while a view is open, and "Restored X" / "Deleted X" after a
 * restore or delete from a section row or a view. A plain module store (no React state), so the
 * sidebar rows, the views and `MainPanel` can all write to the one region.
 */

let message = '';
const listeners = new Set<() => void>();

/**
 * A no-break space appended to every other repeat of the same text: a live region only speaks
 * when its text changes, so "3 matches" twice in a row must not leave the text as it was.
 */
const REPEAT_MARK = ' ';

/** The text as written by a caller (without the repeat mark). */
const plain = (text: string) => (text.endsWith(REPEAT_MARK) ? text.slice(0, -1) : text);

function emit() {
  for (const listener of listeners) listener();
}

/** Puts `text` in the status line (replacing what was there); the same text again is announced again. */
export function announceSectionView(text: string): void {
  message = message !== '' && plain(message) === text && !message.endsWith(REPEAT_MARK) ? text + REPEAT_MARK : text;
  emit();
}

/**
 * Empties the status line. With `onlyIf`, only when it still says exactly that (closing a view
 * clears its "Showing …" line, but not a "Restored …" that replaced it meanwhile).
 */
export function clearSectionViewStatus(onlyIf?: string): void {
  if (onlyIf !== undefined && plain(message) !== onlyIf) return;
  if (message === '') return;
  message = '';
  emit();
}

/** What the status line says now (with the repeat mark, if any: a live region compares text). */
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
