---
name: learnings-dnd-keyboard-a11y-rebase-rank
description: 2026-09-14 DnD audit-fix batch — rank-based dndRebase, keyboard DnD made to work (row keydown bubbling, useKeyboardNav vs KeyboardSensor ordering), aria-pressed pin DISPROVEN and removed, dnd-kit announcement ordering gotchas, real-popup keyboard CDP case
metadata:
  type: project
---

Findings from implementing the sync-conflict + accessibility audit fixes for the DnD rebuild.

**aria-pressed pin was wrong — removed.** `popupAbortWindow.repro.ts` kind `gripAriaPressed` (setAttribute on the grip at `sync`/`micro`/`raf` in `dragstart`) → all `OK`, `committed=true`. All real-popup commit tests pass with dnd-kit managing `aria-pressed`. Don't reintroduce `aria-pressed={undefined}` on grips; attribute-only changes are safe (C4 was right, the code comment wasn't).

**dnd-kit 6.3.1 ordering facts that shaped the design**
- `DndContext` calls `props.onDragEnd` BEFORE `dispatchMonitorEvent` (which drives announcements). By the time `announcements.onDragEnd` runs, the sync part of our async `onDragEnd` has already committed the new cache → names/positions read from the wrong state. Solution: handler records outcome text (`setDndDropOutcome`), announcement consumes it (`@/lib/dndAnnouncements`).
- dnd-kit fires `onDragOver(over = active itself)` immediately after a keyboard pickup; announcing it OVERWRITES "Picked up …" in the assertive live region before a reader speaks it. Only the real-popup keyboard repro caught this (unit tests passed). Seed the dedupe with the self-over text at start.
- KeyboardSensor activator: `preventDefault` but no `stopPropagation` → Space/Enter reached `Tab.tsx` row `onKeyDown` → `chrome.tabs.create({active:true})`. Guard with `e.target !== e.currentTarget`.
- KeyboardSensor adds its document keydown listener in a `setTimeout` → earlier document listeners (`useKeyboardNav`) see Arrows first. Use a module live-drag flag (`isDndDragLive` in `dndMultiDrag.ts`, set in `onDragStart`, cleared in `reset`), not `defaultPrevented` alone.
- `accessibility.restoreFocus` must be `false` (positional ids); focus is done in `@/lib/dndFocus` via rAF after commit, keyboard drags only.

**Rebase:** nearest-position matching replaced by occurrence rank within the group + one shared claim set; identity for saved tabs is url+savedAt+customTitle+title. A changed identity COUNT → ambiguous → whole drop cancels (a selection member whose count went to 0 is just dropped).

**Keyboard DnD in the real popup via CDP works** (no native session, so C10 doesn't apply): focus grip with `Runtime.evaluate`, then `Input.dispatchKeyEvent` keyDown/keyUp with `code:'Space', key:' ', windowsVirtualKeyCode:32, text:' '` / `code:'ArrowDown', windowsVirtualKeyCode:40`. dnd-kit live region is `[id^="DndLiveRegion"]`. Two ArrowDowns from Alpha in [Alpha,Bravo,Charlie] commit [Bravo,Charlie,Alpha] — `sortableKeyboardCoordinates` + `unifiedCollision`'s closestCenter tail picks the next row, not sidebar rows.

**Test gotchas**
- Changing grip labels to `Drag to reorder tab: <title>` broke ~60 EXACT `[aria-label="Drag to reorder tab"]` selectors in `e2e/repro/*` and `popup-dnd.spec` → switched to `^=`. Playwright `getByLabel('…')` / `getByRole({name:'…'})` string names are SUBSTRING matches, so those survive; RegExp names on `role:'button'` for checkboxes do not (now `role:'checkbox'`).
- Negative assertions like `queryByRole('button', {name:/select group/i})).toBeNull()` silently become vacuous after a role change — rewrite them, don't just fix the positive ones.
- jsdom normalises inline `rgba(r, g, b, 1)` to `rgb(r, g, b)`.
- `git diff` on staged-new (`A`) files shows only unstaged deltas vs the index; untracked (`??`) files like `dndRebase.ts` never appear — don't misread that as "my edits didn't land" or as a concurrent writer.

**Why:** these are the exact traps that cost time this run. **How to apply:** before touching DnD a11y, announcements, grip ARIA, or `dndRebase`, read this; keep the keyboard repro case green. Related: [[learnings_mv3_popup_native_html5_dnd]], [[learnings_multi_drag_and_commit_rebase]].
