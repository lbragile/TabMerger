import { useCallback, useLayoutEffect, useRef, type FocusEvent, type RefObject } from 'react';
import { SEARCH_COPY } from '@tabmerger/shared';
import { announceDnd } from '@/lib/dndLiveRegion';

/** A row of a list: every tab, window and sidebar group row carries its DnD model id. */
const ROW_SELECTOR = '[data-tm-dnd-id]';
/** The list a row belongs to (a window's tabs, a group's windows, the sidebar's groups). */
const LIST_SELECTOR = '[data-tm-dnd-list]';
/** The "Clear search" button of the panel's search status line: the last place focus can go. */
export const SEARCH_STATUS_CLEAR_ATTR = 'data-search-status-clear';

interface FocusRecord {
  row: HTMLElement;
  /** Ids of the rows of the same list, in order, when the row took focus. */
  ids: string[];
  index: number;
}

const rowsOf = (list: Element): HTMLElement[] =>
  Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter((el) => el.closest(LIST_SELECTOR) === list);

/** The element to focus for a row: the row itself when it is a Tab stop, else its first Tab stop. */
function focusTargetOf(row: HTMLElement): HTMLElement | null {
  if (row.tabIndex >= 0 && row.hasAttribute('tabindex')) return row;
  return row.querySelector<HTMLElement>('[tabindex="0"], button:not([tabindex="-1"]), a[href]');
}

/**
 * Keeps keyboard focus in a list when the focused row disappears: a search in "hide" mode stops
 * drawing it, or the browser tab behind a "Now Open" row closed. Focus would otherwise drop to
 * the page body and a keyboard or screen reader user would have to start over from the top.
 *
 * Focus goes to the nearest row that is still there AFTER the lost one in the same list, else the
 * nearest one before it, else the search status line's "Clear search" button, and the move is
 * announced. Nothing happens when focus is already somewhere else (only a focus left on the
 * body counts as lost) or while `enabled` is false.
 *
 * Spread the returned `onFocusCapture` / `onBlurCapture` on the container that holds the rows;
 * the check runs after every render of the component that calls the hook.
 */
export function useKeepFocusInList(containerRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const recordRef = useRef<FocusRecord | null>(null);

  const onFocusCapture = useCallback((e: FocusEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(ROW_SELECTOR);
    const list = row?.closest(LIST_SELECTOR);
    if (!row || !list || !containerRef.current?.contains(row)) {
      recordRef.current = null;
      return;
    }
    const ids = rowsOf(list).map((el) => el.dataset.tmDndId ?? '');
    recordRef.current = { row, ids, index: ids.indexOf(row.dataset.tmDndId ?? '') };
  }, [containerRef]);

  // Focus moved on to a real element (not dropped by a removal): forget the row
  const onBlurCapture = useCallback((e: FocusEvent<HTMLElement>) => {
    if (e.relatedTarget && !recordRef.current?.row.contains(e.relatedTarget as Node)) recordRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const record = recordRef.current;
    if (!record || record.row.isConnected) return;
    recordRef.current = null;
    const active = document.activeElement;
    if (!enabled || (active && active !== document.body)) return;
    const container = containerRef.current;
    if (!container) return;
    const byId = new Map(Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR)).map((el) => [el.dataset.tmDndId ?? '', el]));
    const { ids, index } = record;
    let next: HTMLElement | undefined;
    for (let i = index + 1; i < ids.length && !next; i++) next = byId.get(ids[i]);
    for (let i = index - 1; i >= 0 && !next; i--) next = byId.get(ids[i]);
    const target = next ? focusTargetOf(next) : document.querySelector<HTMLElement>(`[${SEARCH_STATUS_CLEAR_ATTR}]`);
    if (!target) return;
    target.focus({ preventScroll: false });
    const title = next?.getAttribute('aria-label') || target.getAttribute('aria-label') || target.textContent?.trim() || '';
    if (title) announceDnd(SEARCH_COPY.focusMoved(title));
  });

  return { onFocusCapture, onBlurCapture };
}
