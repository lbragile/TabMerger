---
name: dnd-cursor-probe-2026-08-02
description: launchDemoContext.ts can be reused as a live Playwright probe (not just record.ts's driver) to debug real extension UI bugs — used to find the actual root cause of a grab-cursor bug two code-only fix rounds missed
metadata:
  type: project
---

Not a demo-video task, but `packages/demo/lib/launchDemoContext.ts` is generically reusable as a
standalone live-browser probe for extension-dev bugs an agent without browser access can't verify.
Pattern: write a throwaway script in the scratchpad dir that imports `launchDemoContext` (absolute
path import, since `packages/demo` isn't set up for arbitrary external entrypoints), run it with
`npx tsx` from `packages/demo/` (cwd matters for its relative `EXTENSION_PATH`/`USER_DATA_DIR`
resolution), then delete the script when done. No test harness needed — `launchDemoContext()` with
no args gives a real popup page in demo mode with seeded "Now Open" tabs in ~10s.

**Bug found this way**: `[aria-label="Drag to reorder tab"]` (and the group/window equivalents)
computed `cursor: pointer` on hover instead of `grab`, despite the elements having Tailwind's
`cursor-grab active:cursor-grabbing` classes directly on them (confirmed present, confirmed compiled
into the CSS, confirmed not the wrong build — none of that mattered). Root cause, found by walking
`document.styleSheets`/`CSSStyleRule.selectorText` + `el.matches()` in a `page.evaluate` to list
every CSS rule actually matching the live element (not by reading source): @dnd-kit's `useSortable()`
spreads its `attributes` object onto the handle, which includes `role="button"` and
`aria-roledescription="sortable"`. `globals.css` has a global rule
`[role="button"]:not([aria-disabled="true"]) { cursor: pointer }` (attribute selector, specificity
0,2,0) that unconditionally beat the handle's own `.cursor-grab` class (0,1,0) — own-element cursor
declarations only auto-win over *inherited* values, not over a higher-specificity rule that also
directly matches the same element. Fix: scope the global rule with
`:not([aria-roledescription="sortable"])` so dnd-kit's auto-injected `role="button"` no longer
matches on drag handles, letting the lower-specificity Tailwind cursor utility apply. Verified fixed
by rebuilding (`pnpm --filter @tabmerger/extension build:extension:demo`) and re-running the same
probe: hover cursor went `pointer` → `grab`.

**Why two prior code-only fix rounds missed it**: both rounds treated the drag-cursor bug as "did I
apply `cursor-grab` to the handle" — which was already true and looked complete on read. The actual
conflict was a *different, unrelated* global CSS rule (added for an unrelated "make all buttons show
pointer cursor" pass) that also happened to match the handle because @dnd-kit silently tags every
sortable handle `role="button"`. This class of bug (a global reset rule colliding with a
library-injected ARIA attribute) is invisible from reading the component file in isolation — it only
shows up by asking the live DOM "what rules actually match this element right now," which is exactly
what `document.styleSheets` walking is for. Prefer that over guessing at specificity by hand when a
cursor/style bug survives a source-level fix.

**Drag-cursor while actively dragging (`document.body.style.cursor = 'grabbing'` via
`setBodyDragCursor` in `useDnd.ts`) was NOT broken** — confirmed working correctly both before and
after this fix (`getComputedStyle(document.body).cursor === "grabbing"` mid-drag). Only the
hover/idle state (`cursor: grab`) was affected by the CSS specificity bug above.
