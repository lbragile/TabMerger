---
name: learnings-promo-replan-2026-07-31
description: Root cause of the "drag isn't dragging" promo feedback, the Settings > Dev tab selector drift discovered while re-recording, and how the chaos-hook real-footage scene was built
metadata:
  type: project
---

Context for future promo/demo re-recording passes after the 2026-07-31 replan.

**dragTabBetweenGroups root cause**: it never simulated a real pointer drag — it
right-clicked a tab and used the "Move to group" context-menu shortcut (chosen
originally to dodge perceived `@dnd-kit` `PointerSensor` flakiness). Result: a
jump-cut with zero visible drag motion under a caption claiming "drag." Fixed by
driving the REAL drag handle instead: `Tab.tsx` has `aria-label="Drag to reorder
tab"` (a `useSortable` handle), and `useDndSensors`' `PointerSensor` only needs 5px
of movement to activate (`useDnd.ts`) — trivial to clear with real
`page.mouse.move/down/up` events. The action now reorders two tabs within the same
group (`[aria-label="Drag to reorder tab"]` locator, indices 0 and 2), with a small
activation nudge, a stepped move to the midpoint + 400ms hold, a stepped move to
the target + 400ms hold, then release — the holds are what make it read as
"dragging" instead of "teleporting" on camera. Cross-group moves are still easiest
done via the context menu if ever needed again; don't fake THAT as a drag too, use
real copy/move UI language instead.

**`launchDemoContext.ts`'s Demo Mode entry point selector had drifted again** (see
[[learnings_theme_pipeline_execution]] for the prior drift) — Demo Mode moved off
the "Data" tab onto its own "Dev" tab (`Settings.tsx` ~line 381, gated by
`import.meta.env.DEV || VITE_DEMO_BUILD === 'true'`), and the trigger button's
accessible name is "Enter" (the literal text "Demo Mode" is now a `<Label>`, not the
button). Old code: `getByRole("tab", {name:"Data"})` → `getByRole("button",
{name:"Demo Mode"})`, both wrong now. Fixed chain: `getByRole("tab", {name:"Dev"})`
→ `getByRole("button", {name:"Enter"})`. **Any time record.ts/screenshots.ts
timeout waiting for "Demo Mode"**, check this chain first before assuming a deeper
break — Settings.tsx's dev-tools tab has moved/renamed things twice now.

**`.output/chrome-mv3` vs `.output/chrome-mv3-demo` mismatch (since fixed)** —
`launchDemoContext.ts`'s `EXTENSION_PATH` used to be hardcoded to `.output/chrome-mv3`,
but `pnpm build:extension:demo` (`wxt build -m demo`) outputs to
`.output/chrome-mv3-demo`, so every pass needed a copy step. It now resolves
`chrome-mv3-demo` (overridable with `TM_DEMO_EXT_DIR`); if Demo Mode selectors start
failing with no source change, check this path first.

**Real seeded chaos for a promo hook, not an illustrated graphic**: "Now Open"
mirrors real `chrome.tabs` state (`useCurrentTabs`), so a genuinely cluttered hook
shot doesn't need any extension-side seed-data work — just open a lot of real tabs
via Playwright (`context.newPage()` in a loop) before recording. Used
`waitUntil: "commit"` (not `domcontentloaded`/`load`) for all 40 tabs — the popup
only ever renders title + favicon, never page content, so waiting for full loads
is wasted time. At native 800×600, 40 rows of real footage reads as noise, not
"overwhelming" — needed a deliberate zoom-in crop to land. Added a generic
`zoom?: number` field on `DemoStep` (Composition.tsx applies it as `transform:
scale()` on the `OffthreadVideo`, wrapped in `overflow: hidden`) rather than a
one-off special case for this single step — reusable for any future step that
needs the same treatment.

**demoScript vs promoScript is still single-source**: added `chaos-hook` once to
`demoScript` (shared), both `demoScript`'s full walkthrough and `promoScript`
reference the same entry — do not add promo-only steps directly to `promoScript`,
record.ts only ever iterates `demoScript` to produce `.webm` clips.
