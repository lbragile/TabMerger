import type { KeyboardEvent } from 'react';

/** Marks the tab buttons of a read-only list (`ReadOnlyWindows`), for the arrow keys. */
export const READ_ONLY_TAB_ATTR = 'data-read-only-tab';

/**
 * Marks a row whose other buttons (a chevron, a ⋯ menu) take part in the arrow keys too: from any
 * of them, Up/Down move on from the row's own read-only tab button (the recently-closed day list).
 */
export const READ_ONLY_ROW_ATTR = 'data-read-only-row';

/** The keys a read-only tab button answers to, for its `aria-keyshortcuts`. */
export const READ_ONLY_TAB_KEYS = 'ArrowUp ArrowDown Home End';

/** The same on a row's ⋯ menu button, whose ArrowDown opens its menu instead. */
export const READ_ONLY_MENU_BUTTON_KEYS = 'ArrowUp Home End';

/**
 * Up/Down move between the read-only tab buttons inside the element the handler is on (one list
 * across every window, and in a session view across every group); Home/End go to the first and
 * last. From another button of a {@link READ_ONLY_ROW_ATTR} row (a chevron, a ⋯), the move starts
 * from that row's own tab button, so the arrows never scroll the panel instead. The key is
 * consumed, so the popup-wide arrow-key group switching (`useKeyboardNav`) leaves it alone. Other
 * keys, and keys from anything else, pass through.
 */
export function handleReadOnlyListKeyDown(e: KeyboardEvent<HTMLElement>): void {
  // already handled (a ⋯ menu button opens its menu on ArrowDown)
  if (e.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(`button[${READ_ONLY_TAB_ATTR}]:not(:disabled)`)];
  const target = e.target as HTMLElement;
  let at = buttons.indexOf(target as HTMLButtonElement);
  if (at < 0 && target.tagName === 'BUTTON') {
    const row = target.closest(`[${READ_ONLY_ROW_ATTR}]`);
    const own = row?.querySelector<HTMLButtonElement>(`button[${READ_ONLY_TAB_ATTR}]:not(:disabled)`);
    at = own && e.currentTarget.contains(row) ? buttons.indexOf(own) : -1;
  }
  if (at < 0) return;
  e.preventDefault();
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.min(Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0), buttons.length - 1);
  buttons[next]?.focus();
}
