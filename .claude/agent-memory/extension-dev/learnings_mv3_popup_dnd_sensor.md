---
name: learnings_mv3_popup_dnd_sensor
description: Why @dnd-kit DnD fails to even START in the real MV3 toolbar action popup (but works in popup.html-as-a-tab), the MouseSensor fix, and the hidden onMouseDown-clobber it exposed in Tab.tsx
metadata:
  type: project
---

Symptom: after the unified-DnD rework, drag did not start at all (no overlay, no
lift) in the REAL MV3 toolbar action popup (clicking the extension icon), yet the
same build dragged fine when `popup.html` was opened as a normal browser tab.

## Root cause
`useDndSensors()` used `PointerSensor` with `activationConstraint:{distance:5}`.
The MV3 action popup is a borderless always-on-top widget with no implicit pointer
capture; Chrome coalesces / silently drops its `pointermove` samples after
`pointerdown`, so the 5px distance threshold is never crossed → `onDragStart`
never fires. A full browser tab gets the uncoalesced pointer stream, so it works
there. Fix: use `MouseSensor` (+ `TouchSensor` + `KeyboardSensor`) — `MouseSensor`
keys off `mousedown`/`mousemove`, which the action popup DOES deliver. This is the
standard dnd-kit-in-extension-popup fix.

## The trap the sensor swap exposed (had to fix too)
`@dnd-kit/sortable`'s `listeners` object is sensor-specific: PointerSensor →
`{onPointerDown}`, MouseSensor → `{onMouseDown}`. `Tab.tsx`'s drag handle spread
`{...listeners}` and THEN a literal `onMouseDown={(e)=>e.stopPropagation()}` after
it. Harmless with PointerSensor (different key); with MouseSensor that literal
**overrides the sensor's activator** → the tab won't drag anywhere, popup or tab.
Fix: compose — `const dragHandleProps = selectionMode ? {} : {...attributes,...listeners}`
then `onMouseDown={(e)=>{ (dragHandleProps as {onMouseDown?}).onMouseDown?.(e); e.stopPropagation(); }}`.
`Window.tsx` (no onMouseDown on its handle) and `GroupItem.tsx` (uses `onClick`
stopPropagation, not onMouseDown) were already fine. When changing the sensor set,
audit every `{...listeners}` handle for a literal `onMouseDown`/`onPointerDown`
sibling.

## Testing the real action popup (hard-won)
- Playwright CANNOT attach a `Page` to the action-popup target: not via
  `context.pages()`, `context.waitForEvent('page')`, nor `chromium.connectOverCDP`.
  It IS a real CDP `type:"page"` target (visible in `Target.getTargets`) with its
  own `webSocketDebuggerUrl`; Playwright just filters it out.
- Working approach (see `e2e/rawCdp.ts` + `e2e/tests/popup-dnd.spec.ts`): launch
  the persistent context with `--remote-debugging-port=<n>` (coexists fine with
  Playwright's pipe, stays `--headless=new`), open the popup from the SW via
  `chrome.action.openPopup()` (needs a focused normal window first — create an
  about:blank page and `bringToFront()`), then `fetch('http://127.0.0.1:<n>/json')`,
  find the `/popup.html` entry, and drive it with a hand-rolled CDP client over
  Node's global `WebSocket` (no `ws` dep): `Input.dispatchMouseEvent` for the drag,
  `Runtime.evaluate` for assertions. Seed IndexedDB first via popup.html-as-a-tab
  (Playwright CAN drive that) — same origin, shared DB.
- CDP `Input.dispatchMouseEvent` makes Chrome synthesize a CLEAN pointer stream,
  so `PointerSensor` also passes this e2e test — automation can't reproduce the
  hardware coalescing. The e2e still guards real-popup end-to-end DnD (it caught
  the Tab.tsx onMouseDown-clobber). The actual "don't regress to PointerSensor"
  guard is the unit test `src/__tests__/unit/hooks/useDndSensors.test.ts`.
- Group sidebar rows have NO `button` with accessible name = group name in the raw
  DOM (Playwright's `getByRole('button',{name})` works via computed a11y tree). For
  raw-CDP `Runtime.evaluate` clicks, target the name `<span>` (`textContent ===
  'Work'`); the click bubbles to the row's `onWrapperClick`.
- "Drag actually started" signal that survives DragOverlay's `pointer-events-none`:
  `onDragStart` sets `document.body.style.cursor='grabbing'` (setBodyDragCursor).
