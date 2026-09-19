import { useEffect } from 'react';
import { isDndDragLive } from '@/lib/dndMultiDrag';
import { moveFocusOutOfSelectionControls, SELECTION_ACTION_BAR_ATTR } from '@/lib/selectionFocus';

/**
 * Exit selection mode when the user clicks anything that is not a selection control.
 *
 * Previously only an empty-space click INSIDE the windows panel exited, which left the
 * user stuck in selection mode after clicking a row, the sidebar or the header — every
 * obvious "never mind" gesture except Escape.
 *
 * ── What must NOT cancel ────────────────────────────────────────────────────
 *  - the selection checkboxes themselves, and the selection action bar (its buttons act
 *    ON the selection — cancelling first would unmount them mid-click);
 *  - any click that MODIFIES the selection: Ctrl/Cmd-click and Shift-click are handled by
 *    the rows, so a modifier key is an unconditional opt-out;
 *  - a drag. A native HTML5 drag synthesises no `click` at all, and the pointer path
 *    swallows the one its own release produces (`suppressNextClick`, capture phase, so
 *    this bubble-phase listener never sees it); `isDndDragLive()` covers the rest;
 *  - anything inside a menu / popover / dialog / toast, or the trigger that opened one —
 *    those actions frequently operate on the selection;
 *  - the click that DISMISSES an open menu. Radix closes on `pointerdown`, so by the time
 *    `click` fires the menu is already gone and the event looks like a plain background
 *    click. The `pointerdown` probe below remembers that an overlay was open and skips
 *    exactly one following click;
 *  - the click that ENTERED selection mode. It is typically still propagating when this
 *    effect attaches, so it is rejected by timestamp (see `attachedAt`).
 *
 * ── What does cancel ────────────────────────────────────────────────────────
 * A plain left click on a row, the sidebar, the header, or empty space.
 *
 * Focus is moved out of the controls first (`selectionFocus`), so unmounting every
 * checkbox can never drop focus onto `<body>`.
 */

/** Anything under one of these keeps the selection. */
const KEEP_SELECTION = [
  '[role="checkbox"]',
  `[${SELECTION_ACTION_BAR_ATTR}]`,
  '[aria-haspopup]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
  '[data-sonner-toast]'
].join(', ');

/** An open menu / popover / dialog / toast layer somewhere in the document. */
const OVERLAY_OPEN =
  '[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="alertdialog"], [data-sonner-toast]';

export function useSelectionClickAway(active: boolean, exit: () => void): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    // One-shot: set on `pointerdown` when an overlay is open, consumed by the click that
    // Radix's outside-dismiss produced.
    let dismissedOverlay = false;
    /**
     * The click that ENTERED selection mode is usually STILL PROPAGATING when this effect
     * runs: for a discrete event React flushes passive effects synchronously inside its
     * own root-container listener, and a `document` listener added mid-dispatch still
     * receives that very event (the DOM spec only skips nodes already visited). So the
     * header's "Select items" button turned selection mode on and then straight back off
     * — the E2E suite's "entering selection mode shows tab checkboxes" caught it.
     *
     * So the click handler only ARMS on the next macrotask: a real click-away is always a
     * new task, while the entering click can only ever be the current one. (Timestamps
     * were the other candidate, but `Event.timeStamp` is `performance.now()`-based in
     * browsers and epoch-based in jsdom, so such a guard would be silently inert in
     * tests.) The `pointerdown` probe attaches immediately — it has nothing to mis-read.
     */
    let armed = false;
    const armId = setTimeout(() => {
      armed = true;
    }, 0);

    const onPointerDown = () => {
      dismissedOverlay = !!document.querySelector(OVERLAY_OPEN);
    };

    const onClick = (e: MouseEvent) => {
      if (!armed) return; // the click that turned selection mode ON is still propagating
      if (dismissedOverlay) {
        dismissedOverlay = false;
        return;
      }
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (isDndDragLive()) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest(KEEP_SELECTION)) return;
      moveFocusOutOfSelectionControls();
      exit();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick);
    return () => {
      clearTimeout(armId);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick);
    };
  }, [active, exit]);
}
