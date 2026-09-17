/**
 * Keep keyboard focus off `<body>` when selection UI unmounts:
 *  - exiting selection mode unmounts every selection checkbox
 *  - the selection action bar disappears on Escape, "Cancel selection", or once a bulk
 *    delete/move empties the selection
 *
 * Focus goes to the owning row (tab row, window grip, sidebar group row), else the header's
 * selection-mode toggle, else the first drag grip in the panel.
 */

/** Marks the selection action bar root (static attribute). */
export const SELECTION_ACTION_BAR_ATTR = 'data-selection-action-bar';

const TOGGLE = 'button[aria-label="Exit selection mode"], button[aria-label="Select items"]';

/** Where focus should go when `from` (a selection control) is about to unmount. */
export function selectionFocusFallback(from?: Element | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = from as HTMLElement | null | undefined;
  const inBar = !!el?.closest?.(`[${SELECTION_ACTION_BAR_ATTR}]`);
  const own = inBar
    ? null
    : (el?.closest?.<HTMLElement>('[role="listitem"]') ??
      el?.closest?.('[data-window-index]')?.querySelector<HTMLElement>('[aria-label^="Drag to reorder window"]') ??
      el?.closest?.<HTMLElement>('[data-sidebar-group-index]'));
  return (
    own ??
    document.querySelector<HTMLElement>(TOGGLE) ??
    document.querySelector<HTMLElement>('[data-tm-dnd-id] [aria-label^="Drag to reorder"]')
  );
}

/** If focus is on a selection checkbox or inside the action bar, move it somewhere that survives. */
export function moveFocusOutOfSelectionControls(): void {
  if (typeof document === 'undefined') return;
  const el = document.activeElement as HTMLElement | null;
  if (!el?.closest?.(`[role="checkbox"], [${SELECTION_ACTION_BAR_ATTR}]`)) return;
  selectionFocusFallback(el)?.focus();
}
