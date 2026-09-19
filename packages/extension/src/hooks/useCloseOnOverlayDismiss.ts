import { useEffect, useRef } from 'react';
import { useUIStore } from '@/stores/uiStore';

/**
 * Close a transient overlay when the user starts a multi-select.
 *
 * Entering selection mode (or ticking the first item) turns every row into a checkbox
 * target, so a dropdown, context menu, colour picker or inline note/reminder editor left
 * floating over those rows is both visually wrong and in the way. `uiStore` bumps
 * {@link UIState.overlayDismissNonce} on exactly those transitions and each overlay owner
 * subscribes here.
 *
 * ── Why a store signal and not an Escape keypress ───────────────────────────
 * Synthesising Escape would also cancel a rename input, close a modal, and — via
 * `useKeyboardNav` — potentially exit the selection mode we just entered. A signal closes
 * precisely the overlays that opted in.
 *
 * ── Why this cannot fight `useSelectionClickAway` ───────────────────────────
 * Closing an overlay from React state produces no pointer or click event at all, so the
 * click-away hook's one-shot `pointerdown` probe (which exists for Radix's own
 * dismiss-on-pointerdown) never sees anything, and no background click is manufactured
 * that could immediately exit the selection mode being entered.
 *
 * `close` is read through a ref, so an inline arrow function is fine — the effect only
 * ever runs when the nonce actually changes.
 */
export function useCloseOnOverlayDismiss(close: () => void): void {
  const nonce = useUIStore((s) => s.overlayDismissNonce);
  const closeRef = useRef(close);
  closeRef.current = close;
  // The nonce at mount is the baseline: a component that mounts AFTER a dismissal (a row
  // rendered later, a menu opened later) must not immediately close itself.
  const seen = useRef(nonce);

  useEffect(() => {
    if (nonce === seen.current) return;
    seen.current = nonce;
    closeRef.current();
  }, [nonce]);
}
