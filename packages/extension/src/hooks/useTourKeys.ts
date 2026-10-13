import { useEffect, useRef } from 'react';
import type React from 'react';
import { nextTrapIndex } from '@/lib/tour';
import {
  TOUR_APP_ROOT_ID,
  TOUR_TOAST_SELECTOR,
  isForeignLayerOpen,
  isInAllowed,
  isInForeignLayer,
  isInToastRegion,
  tourFocusables
} from '@/lib/tourDom';

export interface TourKeyHandlers {
  /** Right arrow, and Enter while focus is on the card itself (not on one of its controls). */
  onNext: (via: 'arrow' | 'enter') => void;
  onBack: () => void;
  /** Escape. */
  onSkip: () => void;
  /**
   * The controls an interactive step unlocks inside the app, read on every key press. Omit, or
   * return nothing, for a read-only step.
   */
  getAllowed?: () => readonly Element[];
  /**
   * True while a task is waiting to be tried: Tab then visits the unlocked controls BEFORE the
   * card's buttons, so one Tab from the card reaches the control the step asks for.
   */
  allowedFirst?: () => boolean;
}

/** Marks the part of the card that scrolls when the text is taller than the popup. */
export const TOUR_BODY_ATTR = 'data-tour-body';

/** Fraction of the visible text height each key scrolls by. */
const SCROLL_KEYS: Record<string, number> = { ArrowDown: 0.25, ArrowUp: -0.25, PageDown: 0.9, PageUp: -0.9 };

/** Pointer and mouse events kept away from everything the step does not unlock. */
const GUARDED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart'] as const;

/**
 * Keyboard (and stray pointer) handling while the tour card is shown.
 *
 * One capture-phase listener on `window`, the first stop of every key event, which stops the
 * event from travelling any further. That is what keeps the popup's own shortcuts quiet under
 * the tour: group navigation (`useKeyboardNav`), keyboard move, the drag sensor, search
 * (Ctrl+K) and selection mode's Escape all listen on `document` or `window` after this point.
 * The card's own buttons (and a toast's) still work: activating a focused button with Enter or
 * Space is the browser's default action for the key, not a listener, and it is left alone here.
 *
 * - Escape: `onSkip`. Left / Right: back / next.
 * - Enter: next, but only while focus is on the card itself. On a button it presses that
 *   button; anywhere else it does nothing.
 * - A HELD Enter or arrow key does nothing after the first press (`event.repeat`), so holding a
 *   key down cannot run through every step and end the tour. That includes Enter on a focused
 *   button, whose native repeat would otherwise click it again and again.
 * - Tab / Shift+Tab cycle through the card's buttons, the controls the step unlocks and the
 *   buttons of any toast on screen. While a task is waiting to be tried the unlocked controls
 *   come first, so one Tab from the card lands on the control the step asks for.
 * - Up / Down / Page Up / Page Down scroll the card's text when it is taller than the popup.
 *
 * Interactive steps add two exceptions, so the control being tried really works:
 *
 * - A key pressed INSIDE A SURFACE THE APP OPENED (a menu, a popover, a select list, a dialog:
 *   `TOUR_FOREIGN_LAYER`) is not touched at all. That surface has its own key handling and its
 *   own focus trap, and the tour's must not fight them: Escape there closes the menu or the
 *   dialog, it does not skip the tour, and Tab stays inside a modal dialog. The same goes for
 *   Escape pressed anywhere while such a surface is open.
 * - A key pressed on a control the step unlocks (`getAllowed`) reaches that control's own
 *   handlers (typing a group name, Enter to save it, Escape to cancel it), but not the popup's
 *   global shortcuts: a second listener on the app root, which runs after React's, stops the
 *   event there. Only Tab is still handled here, so focus can leave the control for the card.
 *
 * Pointer events are guarded the same way: inside the app root, anything outside the unlocked
 * controls is swallowed. `inert` already covers most of it; this covers the ANCESTORS of an
 * unlocked control, which cannot be inert (a group row around its colour dot).
 */
export function useTourKeys(cardRef: React.RefObject<HTMLElement | null>, handlers: TourKeyHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const allowed = () => latest.current.getAllowed?.() ?? [];

    const onKeyDown = (e: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      const target = e.target instanceof Element ? e.target : null;

      // A menu, popover, select list or dialog the app opened owns its keys
      if (target && isInForeignLayer(target)) return;
      if (e.key === 'Escape' && isForeignLayerOpen()) return;

      const inAllowed = !!target && !card.contains(target) && isInAllowed(target, allowed());
      // On an unlocked control everything but Tab belongs to that control (see the root listener)
      if (inAllowed && e.key !== 'Tab') return;

      e.stopImmediatePropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        if (!e.repeat) latest.current.onSkip();
        return;
      }
      // Leave browser and OS shortcuts (Ctrl+W, Alt+Left…) alone
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        const items = tourFocusables(card, allowed(), latest.current.allowedFirst?.() ?? false);
        const current = items.indexOf(document.activeElement as HTMLElement);
        items[nextTrapIndex(current, items.length, e.shiftKey)]?.focus();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.repeat) return;
        if (e.key === 'ArrowRight') latest.current.onNext('arrow');
        else latest.current.onBack();
        return;
      }
      if (e.key in SCROLL_KEYS) {
        e.preventDefault();
        const body = card.querySelector<HTMLElement>(`[${TOUR_BODY_ATTR}]`);
        if (body) body.scrollTop += SCROLL_KEYS[e.key] * body.clientHeight;
        return;
      }
      if (e.key === 'Enter') {
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        // On a focused button Enter presses that button (Back, Skip, a toast's action), natively
        const control = target?.closest('button, a[href]');
        if (control && (card.contains(control) || control.closest(TOUR_TOAST_SELECTOR))) return;
        e.preventDefault();
        if (target === card) latest.current.onNext('enter');
      }
    };

    // Runs after React's own listener on the same node: the unlocked control has handled the
    // key by now, and the popup's document / window shortcuts must not see it
    const root = document.getElementById(TOUR_APP_ROOT_ID);
    const quarantine = (e: Event) => {
      if (cardRef.current) e.stopPropagation();
    };

    const guardPointer = (e: Event) => {
      if (!cardRef.current || !root) return;
      const target = e.target instanceof Node ? e.target : null;
      if (!target || !root.contains(target)) return;
      if (target instanceof Element && isInToastRegion(target)) return;
      if (isInAllowed(target, allowed())) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    window.addEventListener('keydown', onKeyDown, true);
    root?.addEventListener('keydown', quarantine);
    GUARDED_EVENTS.forEach((type) => window.addEventListener(type, guardPointer, true));
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      root?.removeEventListener('keydown', quarantine);
      GUARDED_EVENTS.forEach((type) => window.removeEventListener(type, guardPointer, true));
    };
  }, [cardRef]);
}
