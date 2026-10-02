---
name: dnd-reflow-feedback-loop
description: The unified DnD onDragOver live-reflow can infinite-loop ("Maximum update depth exceeded") and unmount the whole popup; how it happens and the guards that fix it
metadata:
  type: project
---

# Unified DnD: onDragOver live-reflow feedback loop

**Symptom:** "I cannot drag and drop anything" — a single failed drag (tabs, windows, or
groups) kills ALL drag types for the rest of the popup session.

**Root cause (found 2026-09-08):** `useDndHandlers.onDragOver` renders a live move
preview by writing the post-move tree to `overrideState`; `WindowsPanelInner` renders
from `dnd.overrideState?.available[groupIndex]`. A cross-window tab drag whose preview
relocates the dragged row *under the pointer* creates a droppable id
(`${groupId}::w0::t2`) that exists ONLY in the preview DOM, not in the pre-drag model.
dnd-kit's `over` then oscillates between that preview-only row and the real window
container. Resolving the preview-only id: `resolveRef` returns a truthy `DndRef`,
`canDrop` passes, but `applyMove` → `hydrate(model, o)` returns `null` (id absent from
the `base`-derived model) → `NOOP` → `setOverrideState(base)` reverts the preview →
the preview row vanishes → `over` flips back → repeat every render →
**"Maximum update depth exceeded"**. There is **no error boundary** in the popup, so
React unmounts the entire tree — `document.body.innerText` goes empty.

Also contributing: `measuring={{ droppable: { strategy: 0 } }}` (MeasuringStrategy.Always)
re-measures every render, so the reflow immediately changes collision results.

**The fix (3 guards in `useDndHandlers.ts` + 1 in `DndProvider.tsx`):**
1. `onDragOver`: `if (!idInModel(model, overId)) return;` — ignore any `over` id absent
   from the pre-drag model; keep the current preview instead of thrashing it.
2. `applyPreview(next)` de-dupes by `previewSignature(next)` (a JSON fingerprint that
   omits the volatile `updatedAt`/`pendingSync` that `bump()` stamps) — structurally
   identical previews never allocate a new `overrideState` object.
3. `onDragEnd`: track `lastRealOverRef` (last `over` that resolved against the base
   model); if the raw drop target is preview-only, commit against that fallback.
4. `DndProvider`: `measuring` droppable strategy `0` → `1` (BeforeDragging) so collision
   rects don't chase the reflow.

**Why the unit tests missed it:** most DnD unit tests mock `@dnd-kit/core`, so there is
no real `DndContext`/sensor/measuring loop — handlers are called with synthetic events
in isolation. `useDndHandlersUnified.test.tsx` (which does NOT mock dnd-kit, just fires
`result.current.onDragOver(...)` directly) is the right place for regression coverage —
added 4 tests there for the guards above.

**How to reproduce a real DnD bug (Playwright, headless):**
- `wxt build -m development` → `.output/chrome-mv3-dev` (bundled against `.env.local`,
  so the popup actually mounts — see the blank-popup learning below).
- `chromium.launchPersistentContext('', { headless: false, args: ['--headless=new',
  '--load-extension=<dir>', '--disable-extensions-except=<dir>', ...] })`. `--headless=new`
  loads MV3 extensions AND stays windowless; do NOT also pass Playwright `headless: true`
  (service worker fails to register).
- dnd-kit PointerSensor needs `mouse.down()` → a small move past the 5px activation
  distance → `{ steps }` moves to the target → `mouse.up()`.

## Related: e2e popup renders blank in a production build

`.env.production` ships placeholder values (`VITE_SUPABASE_URL=https://<prod-project-ref>.supabase.co`).
`wxt build` defaults to production mode → `new URL()` inside `@supabase/supabase-js`
throws at module init → the whole React tree fails to mount → blank popup, and every
`page.locator(...)` in e2e times out with "Target page/context/browser has been closed".
`e2e/fixtures.ts` now prefers `.output/chrome-mv3-dev` when present. For real local e2e,
build with `wxt build -m development` first.

## Gotcha: `[data-window-index]` is not unique

`Tab.tsx` sets `data-window-index` on every tab row, not just the `WindowItem` div, so
`page.locator('[data-window-index="0"]')` matches N+1 elements (strict-mode violation).
Target the window drag handle instead: `page.getByLabel('Drag to reorder window').nth(i)`.
