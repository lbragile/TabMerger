import { KeyboardSensor, TouchSensor, useSensor, useSensors, type KeyboardCode } from '@dnd-kit/core';
import { createKeyboardCoordinateGetter } from '@/lib/dndKeyboardTargets';
import { useUIStore } from '@/stores/uiStore';
import { Html5DragSensor } from '@/lib/dndHtml5Sensor';
import { DND_POINTER_PROBE_ACTIVE } from '@/lib/dndPointerProbe';
import { motionScrollBehavior } from '@/lib/reducedMotion';

// The unified DnD layer lives in `useDndHandlers` + `@/components/dnd/DndProvider`,
// keyed off the normalised model from `@/hooks/useDndModel` (no string-id parsing).
// `export *` (not a named re-export) keeps `@/hooks/useDnd` a valid runtime import
// site for `useDndHandlers` without registering a SECOND auto-import entry for the
// name — a named `export { useDndHandlers } from …` here collides with
// `DndProvider`'s direct `@/hooks/useDndHandlers` import ("Duplicated imports" warn).
// Prefer importing from `@/hooks/useDndHandlers` directly in new code.
export * from './useDndHandlers';

// NOTE: `setBodyDragCursor` used to be defined here (a leftover from the
// pre-native-drag `<DragOverlay>` era). The real, wired-up version now lives
// as a private helper inside `useDndHandlers.ts` (called from `onDragStart`/
// `reset`) — see its doc comment there for why it's effectively inert during
// a native-HTML5-driven drag (the primary path in this popup) but still
// matters for `KeyboardSensor` drags. This export was dead (nothing in
// production imported it from here — only test mocks stubbed the whole
// `@/hooks/useDnd` module, which doesn't need the real export to exist).

/**
 * Sensor set for the ONE unified popup drag layer.
 *
 * The primary sensor MUST be {@link Html5DragSensor}. Despite the name it is now a
 * DUAL-PATH sensor: its activator is still the native `onDragStart` (so the drag
 * handles in `Tab.tsx` / `Window.tsx` / `GroupItem.tsx` still need their `draggable`
 * attr), but it decides PER PRESS whether to let the native drag run or to cancel it
 * and drive the drag from pointer events instead — see `@/lib/dndPressTracker` for
 * the decision and `@/lib/dndHtml5Sensor` for both paths.
 *
 * The original real-popup finding (three drags with `tm_dnd_debug` on and the old
 * `Mv3PointerSensor` wired) was that the popup delivers only the FIRST sub-5px
 * `pointermove` after `pointerdown` and then nothing until the press ends, so a
 * move-delta sensor never crosses its threshold. That log could not tell "the popup
 * withheld the stream" apart from "a native drag took the stream over and ended it
 * with a `pointercancel`" — the ordinary behaviour of any `draggable` element. The
 * dual path measures which one it is on every real drag instead of assuming.
 *
 * `@/lib/dndPointerSensor` (`getMv3PointerSensor`) is kept in the tree but is NO
 * LONGER wired here — it documents the dead end of a *standalone* pointer sensor
 * (its problem was that it had to win the drag before `dragstart`; the dual path
 * doesn't, because it decides AT `dragstart`).
 *
 * No `activationConstraint` on the drag sensor: the browser's own native drag
 * threshold (a few px before `dragstart` fires) already stops a plain click on a
 * handle from starting a drag.
 *
 * `TouchSensor` covers touchscreen laptops / Chromebooks — touch gets implicit
 * capture and delivers `touchmove` fine in the popup, and Chrome doesn't start an
 * HTML5 drag from touch, so the stock sensor is correct there. `KeyboardSensor`
 * keeps the layer accessible.
 */
/**
 * ONLY Space picks up and drops; Escape cancels. dnd-kit's defaults also use Enter as a
 * start AND end key (and Tab as an end key): Enter on a focused grip started a drag, and
 * Enter mid-drag DROPPED it — for a Now Open tab dropped on a group that is a MOVE, which
 * closes the real browser tab. Enter stays "open" on a row and is inert on the grip / mid-drag.
 * Plain strings cast to the enum: unit-test mocks of '@dnd-kit/core' omit the runtime enum.
 */
export const DND_KEYBOARD_CODES = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space']
} as unknown as { start: KeyboardCode[]; cancel: KeyboardCode[]; end: KeyboardCode[] };

const keyboardCoordinateGetter = createKeyboardCoordinateGetter(() => useUIStore.getState().activeGroupIndex);

export function useDndSensors() {
  const html5 = useSensor(Html5DragSensor);
  const touch = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } });
  // Reduced motion: the sensor scrolls the moved item into view instantly, not smoothly.
  const keyboard = useSensor(KeyboardSensor, {
    // Two-pane target model (main panel <-> sidebar, drop zones): see `@/lib/dndKeyboardTargets`.
    keyboardCodes: DND_KEYBOARD_CODES,
    coordinateGetter: keyboardCoordinateGetter,
    scrollBehavior: motionScrollBehavior()
  });
  // Diagnostic pointer-stream probe (`@/lib/dndPointerProbe`, localStorage flag,
  // off for every real user): leave the HTML5 sensor out so no drag can start and
  // the probe measures the raw pointer stream of a grip press.
  return useSensors(...(DND_POINTER_PROBE_ACTIVE ? [] : [html5]), touch, keyboard);
}
