---
name: learnings-mv3-popup-pointer-capture
description: MV3 toolbar action popup withholds pointermove/mousemove after pointerdown unless the pressed element holds explicit pointer capture — dnd-kit needs a custom setPointerCapture sensor
metadata:
  type: project
---

# MV3 action-popup DnD: pointer capture is the fix, not the sensor type

Supersedes the "MouseSensor not PointerSensor" conclusion in
[[learnings_mv3_popup_dnd_sensor]] — that was wrong, MouseSensor also fails in the
real popup.

**Root cause:** In a real MV3 *toolbar action popup* (clicking the extension
icon), Chrome does not deliver `pointermove` / `mousemove` to the popup document
after `pointerdown` while a button is held **unless the pressed element holds an
explicit pointer capture**. dnd-kit's stock `PointerSensor` and `MouseSensor`
both attach move listeners to `ownerDocument` and never call
`setPointerCapture`, so the `{ distance: 5 }` activation constraint is never
satisfied, `onDragStart` never fires, "the drag never starts". `popup.html`
opened as a normal browser tab works with the identical build because a tab gets
the full pointer stream regardless of capture — this is why every automated repro
(Playwright, raw CDP `Input.dispatchMouseEvent`) PASSES: synthesized event
streams don't reproduce the withholding. **This bug cannot be verified by
automation** — only a human dragging in the real toolbar popup.

**Fix:** `src/lib/dndPointerSensor.ts` — `getMv3PointerSensor(BasePointerSensor)`
returns a cached subclass of dnd-kit `PointerSensor` whose constructor calls
`target.setPointerCapture(pointerId)` on activation. Captured pointer events
still bubble to `document`, so dnd-kit's existing document listeners then fire in
BOTH environments. `MouseSensor` can't be the fix — `setPointerCapture` only
affects Pointer Events, not `mousemove`. Capture releases implicitly on
`pointerup`/`pointercancel`; we also release defensively + on `lostpointercapture`.

**Why the base class is injected, not imported:** `class X extends PointerSensor`
evaluates the base at module-eval time. ~10 unit-test files mock `@dnd-kit/core`
with an incomplete factory that omits `PointerSensor`, and vitest v4 throws on
reading an undefined named export from a factory mock (see
[[vitest-dndkit-mocks]]). Keeping the `@dnd-kit/core` value-import out of
`dndPointerSensor.ts` (only `import type { Sensor }`, which is erased) means
`useDnd.ts` passes `PointerSensor` in and none of those mocks need touching.
`useDnd.ts` already value-imports other sensors fine because those are only
*read* inside `useDndSensors()`, never at module scope.

**Instrumentation:** `src/lib/dndDebug.ts` — `dndDebugLog(stage, detail)` gated
behind `localStorage.tm_dnd_debug` (also mirrored from `chrome.storage.local` on
load). No-op by default. Logs `[tm-dnd] <stage>` + writes the last stage to a
fixed bottom-right corner chip div (readable without devtools, which can't stay
attached to a real action popup). Stage order for a healthy drag:
`press-registered → pointer-capture-set → first-move-seen → onDragStart →
onDragOver:first → onDragEnd/committed → pointer-capture-released`.
Interpreting a stuck drag: last stage `pointer-capture-set` with no
`first-move-seen` = capture didn't unblock the move stream (hypothesis wrong);
`first-move-seen` but no `onDragStart` = moves arriving but < 5px / constraint
issue.

(ESLint was broken repo-wide at the time, `minimatch@3.1.5` "expand is not a
function"; since fixed, unrelated to DnD.)

## Repro runners

The old ad-hoc `packages/extension/_repro*.mjs` scripts are consolidated into
`packages/extension/e2e/repro/` (TS, run via Playwright's own runner — no `tsx`
dep in the repo). `settings.ts` = all knobs + seed scenarios (env-overridable:
`REPRO_HEADED`/`REPRO_DEBUG`/`REPRO_KEEP_OPEN`/…); `harness.ts` = launch context
w/ `--remote-debugging-port`, seed IDB via popup.html tab, `chrome.action.openPopup()`,
then a SECOND `connectOverCDP` client (the fresh one DOES surface the popup page
target; the launch client never does). Scripts: `pnpm --filter @tabmerger/extension
repro:dnd[:popup|:matrix]`. A standalone `playwright.repro.config.ts`
(`testMatch: '**/*.repro.ts'`) keeps them out of `pnpm test:e2e`. Same caveat as
`popup-dnd.spec.ts`: synthetic CDP events can't prove the real-popup fix.

Gotcha: on an `SVGElement` (the grip's `<svg>`/`<path>` can be `event.target`),
`.className` is an `SVGAnimatedString`, not a string — use
`el.getAttribute('class')` when logging it.
