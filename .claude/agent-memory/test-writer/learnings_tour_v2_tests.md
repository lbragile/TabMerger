---
name: learnings-tour-v2-tests
description: Where the guided-tour v2 tests live and the traps hit writing them (jsdom rects, Playwright inert, build isolation, hook signature)
metadata:
  type: learning
---

**Layout.** Unit: `unit/lib/tour{,Dom,DomFocus,DomLock,GeometryAvoid,Steps,Tasks}.test.ts`, `unit/hooks/useTourKeys{,Task,Held}.test.tsx`,
`unit/components/Tour/{Tour,TourCard,TourCardChapter,TourActionRing}.test.tsx`, anchors in `SidePanel/GroupItemTour`,
`ColorPicker/tourAnchors`, `Modal/SettingsTourAnchors`. Integration: `tourClearData.integration.test.ts`.
E2E: `tour.spec.ts` (basics, happy path) and `tourV2.spec.ts` (ring positions, keyboard, chapters, resume, limit).

**jsdom has no layout.** To test the action ring / region in `Tour`, spy on `Element.prototype.getBoundingClientRect`
and read the box from a `data-rect="left,top,width,height"` attribute on each fixture element; set
`documentElement.clientWidth/Height`. The ring's cut-out is the control grown by 3px and kept 8px from the frame.

**Playwright `getByRole` does not skip `inert`.** An element under `[inert]` is still found. Assert lock state with
`el.closest('[inert]')` in `evaluate`, never with `toHaveCount(0)` on a role query.

**Isolate the e2e build.** Another agent may rebuild `.output/chrome-mv3-dev` mid-run ("No built extension").
Copy the build to a private folder and run with `TM_E2E_EXT_DIR=<absolute path>` (`extensionPath.ts` honours it).

**Playwright hook signature.** `test.beforeEach(({}, info) => ...)`: the first argument must be an object destructuring.

**Timing in keyboard e2e.** After a task completes, Tour.tsx hands focus back to the card for 500 ms; a keyboard run that
presses keys faster than that gets focus pulled back. The long keyboard run waits ~700 ms after each "done".

**Shell.** `node -e` and heredocs containing apostrophes break in the Bash tool; use the Write tool for test files and
a `.cjs` script file for scripted edits. Tests under `__tests__` and `e2e/tests` are ignored by ESLint; `tsc` for e2e
has pre-existing `document`/`chrome` lib errors.
