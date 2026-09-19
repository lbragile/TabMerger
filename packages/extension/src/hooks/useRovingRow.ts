import { useCallback, useEffect, useRef } from 'react';
import { isDndDragLive } from '@/lib/dndMultiDrag';

/**
 * Roving tabindex for a popup row (a11y M3).
 *
 * A tab row carries 3–6 focusable controls (grip, checkbox, title, note, reminder, close,
 * menu trigger…), and every one of them used to be its own Tab stop: reaching the bottom
 * of a 10-tab window took ~33 Tab presses. With this hook the ROW is the only stop, and
 * Left/Right (plus Home/End) walk the controls inside it.
 *
 * ── How it works ────────────────────────────────────────────────────────────
 * `ref` is attached to the row. After each render it sets `tabIndex = -1` on every
 * focusable descendant, so Tab skips them but they stay programmatically focusable (which
 * is what roving tabindex needs, and what `dndFocus` relies on to focus a grip after a
 * keyboard drop). Doing it from an effect rather than on each control keeps the row
 * components untouched — with ONE exception: dnd-kit's `{...attributes}` spread declares
 * `tabIndex: 0` on the drag grip, and React re-applies a declared prop on every render, so
 * the grip must ALSO carry an explicit `tabIndex={-1}` after the spread.
 *
 * Writing `tabIndex` is an ATTRIBUTE-ONLY change, which spec C4 measured as safe even
 * synchronously inside `dragstart` — but the effect bails while a drag is live anyway,
 * because nothing it would do is useful mid-drag.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *  - It never touches ArrowUp/ArrowDown: those are `useKeyboardNav`'s group switcher and,
 *    mid-drag, dnd-kit's item mover.
 *  - It is inert while `isDndDragLive()`, so a keyboard drag's ArrowLeft still reaches
 *    dnd-kit and crosses into the sidebar (spec C13).
 *  - It never hijacks arrows inside a text field (the rename input, the note textarea).
 *  - It does not wrap around: ArrowLeft on the row itself, or ArrowRight on the last
 *    control, is left alone rather than silently jumping to the other end.
 */

/**
 * Anything the browser would normally make a Tab stop. `[tabindex]` is included so a
 * control that already opted in (or out) is still found for Left/Right navigation.
 */
const FOCUSABLE =
  'button, [role="button"], [role="checkbox"], a[href], input, select, textarea, summary, [tabindex]';

/** The row's own controls, in DOM order. Excludes the row and anything inert or hidden. */
export function rovingControls(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      el !== row &&
      !el.hasAttribute('disabled') &&
      !el.hasAttribute('hidden') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.getAttribute('inert') === null
  );
}

const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End']);

export interface RovingRow<T extends HTMLElement> {
  /** Attach to the row element (compose with any other ref the row already needs). */
  ref: (node: T | null) => void;
  /** Attach to the row's `onKeyDown`; safe to call alongside the row's own handler. */
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function useRovingRow<T extends HTMLElement>(): RovingRow<T> {
  const rowRef = useRef<T | null>(null);

  const ref = useCallback((node: T | null) => {
    rowRef.current = node;
  }, []);

  // No dependency array on purpose: a row re-renders whenever its controls change
  // (selection mode adds a checkbox, a note button appears), and each new control needs
  // the same treatment. The query is over a handful of nodes.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || isDndDragLive()) return;
    for (const el of rovingControls(row)) {
      if (el.tabIndex !== -1) el.tabIndex = -1;
    }
  });

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.defaultPrevented || isDndDragLive()) return;
    if (!NAV_KEYS.has(e.key)) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const row = rowRef.current;
    if (!row) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // A rename input / note textarea owns its own caret movement.
    if (target.closest('input, textarea, [contenteditable="true"]')) return;

    const controls = rovingControls(row);
    if (controls.length === 0) return;
    const stops: HTMLElement[] = [row, ...controls];
    // Resolve against the CONTROLS first: the row contains every control, so a
    // `stops.findIndex(el => el.contains(target))` would always match the row at index 0
    // and the cursor could never leave it.
    const inControl = controls.findIndex((el) => el === target || el.contains(target));
    const current = inControl >= 0 ? inControl + 1 : 0;

    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? stops.length - 1
          : e.key === 'ArrowRight'
            ? Math.min(current + 1, stops.length - 1)
            : Math.max(current - 1, 0);
    if (next === current) return;
    e.preventDefault();
    // `useKeyboardNav` ignores Left/Right, but a parent row (or a future handler) must
    // not also act on a key this row has consumed.
    e.stopPropagation();
    stops[next].focus();
  }, []);

  return { ref, onKeyDown };
}
