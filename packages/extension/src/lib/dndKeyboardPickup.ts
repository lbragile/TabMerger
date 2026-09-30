import { isDndDragLive } from '@/lib/dndMultiDrag';

/**
 * Keyboard pickup from a focused ROW (tab row, window header, group row).
 *
 * The rows are the only Tab stops (roving tabindex) and their drag grip is `tabIndex=-1`,
 * so a keyboard user's focus sits on the ROW, not the grip. dnd-kit's KeyboardSensor only
 * activates when the keydown's target IS the activator node (the grip), so Space pressed on
 * the row never started a drag — it fell through to the row's own "open / activate"
 * handler instead (opening the tab's URL).
 *
 * This forwards a plain Space from the row to its grip: focus moves to the grip (so the
 * drop keypress does not also reach the row's handler) and a real `keydown` is dispatched
 * there for dnd-kit's own activator to consume. Enter is deliberately NOT forwarded — it
 * stays the row's "open" key.
 *
 * @returns true when the key was consumed (a pickup was started), false to let the caller
 * fall through to its default behaviour (no grip, disabled grip, modifier held, drag live).
 */
export function pickUpFromRow(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (e.key !== ' ' && e.code !== 'Space') return false;
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.target !== e.currentTarget || isDndDragLive()) return false;
  const grip = e.currentTarget.querySelector<HTMLElement>('[aria-label^="Drag to reorder"]');
  if (!grip || grip.getAttribute('aria-disabled') === 'true') return false;
  e.preventDefault();
  grip.focus();
  grip.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
  );
  return true;
}
