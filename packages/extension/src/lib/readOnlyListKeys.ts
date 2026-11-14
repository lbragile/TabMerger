import type { KeyboardEvent } from 'react';

/** Marks the tab buttons of a read-only list (`ReadOnlyWindows`), for the arrow keys. */
export const READ_ONLY_TAB_ATTR = 'data-read-only-tab';

/** The keys a read-only tab button answers to, for its `aria-keyshortcuts`. */
export const READ_ONLY_TAB_KEYS = 'ArrowUp ArrowDown Home End';

/**
 * Up/Down move between the read-only tab buttons inside the element the handler is on (one list
 * across every window, and in a session view across every group); Home/End go to the first and
 * last. The key is consumed, so the popup-wide arrow-key group switching (`useKeyboardNav`) leaves
 * it alone. Other keys, and keys from anything but a tab button, pass through.
 */
export function handleReadOnlyListKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(`button[${READ_ONLY_TAB_ATTR}]:not(:disabled)`)];
  const at = buttons.indexOf(e.target as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.min(Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0), buttons.length - 1);
  buttons[next]?.focus();
}
