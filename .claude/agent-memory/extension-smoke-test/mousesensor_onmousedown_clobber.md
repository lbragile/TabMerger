---
name: mousesensor-onmousedown-clobber
description: Popup DnD sensor history — MouseSensor was swapped back to a pointer-capture PointerSensor subclass (Mv3PointerSensor); drag-handle onMouseDown composition rules and which activator is live
metadata:
  type: feedback
---

**Current state (2026-09-09):** the popup DnD layer uses `getMv3PointerSensor(PointerSensor)`
from `@/lib/dndPointerSensor` — a cached subclass of dnd-kit's `PointerSensor`
that calls `target.setPointerCapture(pointerId)` in its constructor (on
`pointerdown`, before the 5px activation constraint). That capture is what makes
a real MV3 toolbar action popup deliver the `pointermove` stream dnd-kit needs;
without it the stock `PointerSensor`/`MouseSensor` never satisfy
`activationConstraint.distance` and drags never start. So the **live activator is
`onPointerDown` again**, not `onMouseDown`. See `useDnd.ts::useDndSensors` (sensor
set is `Mv3PointerSensor + TouchSensor + KeyboardSensor`),
`__tests__/unit/hooks/useDndSensors.test.ts`, and
`__tests__/unit/lib/dndPointerSensor.test.ts`.

History: there was a prior interim fix that swapped `PointerSensor -> MouseSensor`
(activator became `onMouseDown`); that was reverted in favour of the
pointer-capture subclass, which fixes the same popup coalescing problem without
losing Pointer Events semantics (`setPointerCapture` only affects pointer events,
not `mousemove` — MouseSensor could never have used it).

**Drag-handle onMouseDown rule (still load-bearing):** a drag handle that writes
its own `onMouseDown` AFTER `{...listeners}` is JSX last-prop-wins and will
clobber whatever `listeners` carries. With today's `Mv3PointerSensor` the
activator is `onPointerDown` so a plain `onMouseDown={e => e.stopPropagation()}`
is harmless — but keep the composed pattern anyway so a future sensor swap can't
silently kill activation again. Correct pattern (see `Windows/Tab.tsx`): spread
`{...dragHandleProps}` first, then `onMouseDown={onDragHandleMouseDown}` where
that handler calls `dragHandleProps.onMouseDown?.(e)` FIRST, then
`e.stopPropagation()`. `GroupItem.tsx` and `Windows/Window.tsx` handles add only
`onClick` after `{...listeners}`, not `onMouseDown` — already safe.

**Runtime-safety note on Mv3PointerSensor:** the pointer-capture work in the
subclass constructor is fully wrapped in typeof-guards + try/catch, so a failure
degrades to "drag doesn't start" — it cannot throw out of render and cannot
white-screen the popup. `@/lib/dndDebug` (imported by the sensor + handlers) is a
no-op unless `localStorage.tm_dnd_debug` is set; its one module-load side effect
(`chrome.storage.local.get`) is async and swallowed.

**How to apply:** when reviewing/adding any drag handle in `packages/extension`,
grep the handle element for an `onMouseDown` (or `preventDefault`-in-`onClick`)
sitting after `{...listeners}`/`{...dragHandleProps}` and confirm it composes the
spread handler rather than replacing it. Related:
[[dnd_ondragover_self_feed_loop]].
