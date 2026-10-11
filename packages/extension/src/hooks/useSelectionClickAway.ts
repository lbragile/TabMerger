import { useEffect } from 'react';
import { isDndDragLive } from '@/lib/dndMultiDrag';
import { moveFocusOutOfSelectionControls, SELECTION_ACTION_BAR_ATTR } from '@/lib/selectionFocus';

/**
 * Exit selection mode on a background click: a plain left click whose whole gesture stays
 * off the selection controls. A row, the sidebar, the header and empty space are all
 * background, so every "never mind" gesture works, not only Escape.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A click is a background click only when ALL of these hold:
 *  1. the press that started it began on the background. A click that starts on a
 *     selection control keeps the selection wherever the browser delivers the `click`:
 *     a menu trigger opens its menu on `pointerdown`, an open menu takes pointer events
 *     away from the page behind it, and the `click` of that same press is then delivered
 *     to the document root;
 *  2. no menu, popover, dialog or toast was open when the press began. The press that
 *     dismisses an open menu closes it on `pointerdown`, so its `click` belongs to the
 *     menu, not to the background;
 *  3. no menu, popover, dialog or toast is open when the click arrives;
 *  4. the click target is not a selection control.
 *
 * A keyboard-activated click (Enter or Space on a focused control) has no press, so only
 * 3 and 4 apply to it.
 *
 * ── Selection controls ──────────────────────────────────────────────────────
 *  - the selection checkboxes and the selection action bar (its buttons act ON the
 *    selection, and its "Copy to group" / "Move to group" menu needs the selection to
 *    still be there when an item is chosen);
 *  - any menu trigger, and anything inside a menu, popover, dialog or toast: those
 *    actions frequently operate on the selection.
 *
 * ── Never a background click ────────────────────────────────────────────────
 *  - a click that MODIFIES the selection: Ctrl/Cmd-click and Shift-click are handled by
 *    the rows, so a modifier key is an unconditional opt-out;
 *  - a drag. A native HTML5 drag synthesises no `click` at all, and the pointer path
 *    swallows the one its own release produces (`suppressNextClick`, capture phase, so
 *    this bubble-phase listener never sees it); `isDndDragLive()` covers the rest;
 *  - the click that ENTERED selection mode (see `armed`).
 *
 * Focus is moved out of the controls first (`selectionFocus`), so unmounting every
 * checkbox can never drop focus onto `<body>`.
 */

/** Anything under one of these is a selection control. */
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

/** What was true when a press began; it vouches only for the click that press produces. */
interface Press {
  /** The press began on a selection control. */
  onControl: boolean;
  /** A menu, popover, dialog or toast was open. */
  overlayOpen: boolean;
}

const isOverlayOpen = (): boolean => !!document.querySelector(OVERLAY_OPEN);

const isSelectionControl = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(KEEP_SELECTION);

export function useSelectionClickAway(active: boolean, exit: () => void): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    // The press whose click has not arrived yet; `null` between gestures.
    let press: Press | null = null;
    /**
     * The click that ENTERED selection mode is usually STILL PROPAGATING when this effect
     * runs: for a discrete event React flushes passive effects synchronously inside its
     * own root-container listener, and a `document` listener added mid-dispatch still
     * receives that very event (the DOM spec only skips nodes already visited). That click
     * must leave selection mode on.
     *
     * So the click handler only ARMS on the next macrotask: a real click-away is always a
     * new task, while the entering click can only ever be the current one. (`Event.timeStamp`
     * is `performance.now()`-based in browsers and epoch-based in jsdom, so a timestamp
     * guard would not behave the same under test.) The press listeners attach immediately:
     * they only record.
     */
    let armed = false;
    const armId = setTimeout(() => {
      armed = true;
    }, 0);

    const onPointerDown = (e: PointerEvent) => {
      press = { onControl: isSelectionControl(e.target), overlayOpen: isOverlayOpen() };
    };

    // A key press starts a keyboard gesture: the click it activates has no press of its own.
    const onKeyDown = () => {
      press = null;
    };

    const onClick = (e: MouseEvent) => {
      const started = press;
      press = null;
      if (!armed) return; // the click that turned selection mode ON is still propagating
      if (started?.onControl || started?.overlayOpen) return;
      if (isOverlayOpen()) return;
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (isDndDragLive()) return;
      if (!(e.target instanceof Element)) return;
      if (isSelectionControl(e.target)) return;
      moveFocusOutOfSelectionControls();
      exit();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick);
    return () => {
      clearTimeout(armId);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick);
    };
  }, [active, exit]);
}
