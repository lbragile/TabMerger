---
name: learnings-keyboard-move-reanchor-tests
description: How to inject a groups-cache change during a keyboard move or pointer drag in CI e2e and the repro harness, and where each layer is tested
metadata:
  type: reference
---

- The page exposes `globalThis.__tmQueryClient` and the `__tmDndLog` stage ring buffer only when `localStorage.tm_dnd_debug = '1'` on the extension origin. CI e2e opts in through `openRealPopup(groups, { dndDebug: true })` (`e2e/kbdPopup.ts`), which sets the flag on the seed page before the popup opens; the `cell(...)` helper in `popup-keyboard-move.spec.ts` forwards `dndDebug`.
- Inject a change with `qc.setQueryData(['groups'], (s) => ...)`, then wait about 600 ms for the render before pressing the next key (the follow frames rebuild targets from rendered rows).
- Keyboard move announcements are in `#tm-dnd-live-region`; a pointer drop's outcome is spoken through dnd-kit's own region (`[id^="DndLiveRegion"]`), so read the right one per path.
- The repro harness picks the pointer path with `launch({ forcePath: 'pointer' })`; nudge size alone does not choose it when the default `native` force is on.
- Stages: `keyboard:reanchored` only logs when the picked-up ids changed; `keyboard:cancelled-stale` for an unidentifiable item; pointer path logs `commit-cancelled-stale`.
- A pointer release at a window card's centre while the gap is open above its single row commits at index 0; a release lower in the card falls into the new-window zone, so a "drop after the existing row" case needs a real row to be the target.
- Unit layer: `useKeyboardMoveReanchor.test.tsx` drives the real `useDndHandlers.commitKeyboardMove` with a mocked `localDb`; rows are fake 30 px divs re-mounted by `mountRows` after each injected change.
