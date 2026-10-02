---
name: learnings-store-assets-captions-2026-08-12
description: Store screenshots/promo tiles had drifted stale against a renamed storyboard and had zero captions/headline text; fixed by wiring ScreenshotFrame captions to demoScript itself, plus a real content-driven weak-screenshot bug worth remembering when curating the 5-screenshot Chrome Store cap
metadata:
  type: project
---

Audited the rendered Chrome Web Store assets (`packages/demo/screenshots/store/*.jpg`,
`packages/demo/promo/*.jpg`) after a "make better screenshots" request and found the files on disk
were not just weak — they were **stale**, built against a demo-script storyboard that had already
been renamed/replaced (`view-groups`, `search`, `selection-mode`, `add-note`, `change-color` don't
exist as step ids anymore per `demo-script.ts`'s own 2026-08-01 ponytail comments). `screenshots/raw/`
and `screenshots/store/` are gitignored build artifacts — `render-store-assets.ts` happily composites
whatever `*.png` files happen to sit in `RAW_DIR`, so a stale raw dir silently produces a stale but
plausible-looking store dir with no error. **Always re-run `pnpm screenshots && pnpm store-assets`
before judging current store-asset quality — never trust what's already on disk.**

Root fixes:

1. `ScreenshotFrame.tsx` previously had NO caption/headline text at all — just the bare 800x600
   popup floating on an oversized 1280x800 canvas. Fixed by importing `demoScript`/`promoOnlySteps`
   from `../../demo-script` and building a `screenshotId -> caption` lookup (strip the `-light`/
   `-dark` theme suffix to get the step id). This means screenshot captions can never drift from the
   video's own captions — one caption per step id, both consumers read the same string.
2. `PromoTile.tsx`'s `SmallTile` (440x280) had no headline either — literally a cropped screenshot +
   corner inset. Added a headline with a top scrim (screenshot's own UI chrome near the top edge
   isn't reliably dark — light-mode sidebars, bright favicons — so text needs its own contrast
   floor, can't rely on the underlying image being dark there).
3. `launchDemoContext.ts`'s `getByRole("tab", { name: "Dev" })` (Settings tab click) went stale —
   a "Devices" tab was added elsewhere and now collides in Playwright strict mode ("resolved to 2
   elements"). Needed `exact: true`. This blocks EVERY capture/record run until fixed, not just
   screenshots — same selector is shared by `record.ts`'s use of `launchDemoContext`.

**Real content bug worth remembering when curating which 5 of N screenshots to publish (Chrome Web
Store hard-caps at 5):** the `color-new-group` step screenshot captures the group in a genuinely
empty state ("No windows in this group") because that's the real product flow order in
`demo-script.ts` — color is set immediately after group creation, before any window/tab is added to
it. Not a capture bug, a legitimately bad *choice* of screenshot for a static store listing (the
video's motion carries it fine; a still doesn't). When picking the curated 5, prefer steps whose
captured state has visible populated content over steps that are earlier/mid-workflow and happen to
be empty-panel at capture time — check the actual rendered JPG, don't assume from the caption alone.

**Follow-up (same day): coordinator caught that "fix the weak screenshots" wasn't enough — the
interactive ones (color picker, note editor, drag) were captured at rest (after the action
committed), not mid-gesture.** `screenshots.ts` calls `runStepAction` (which runs the full
`actions.ts` handler to completion: click swatch, select color, close popover; or type note, hit
Ctrl+Enter, unmount textarea; or drag, mouse.up) and only screenshots AFTER it returns — structurally
incapable of capturing an open popover or a live drag by itself.

Fix: added an optional `midGesture?: () => Promise<void>` hook threaded through
`runStepAction(page, action, minDurationMs, midGesture?)` down into the `actions` handler map (default
undefined — `record.ts`'s video capture never passes it, so video timing/behavior is byte-for-byte
unchanged). Only the 3 handlers that actually have an open-but-uncommitted middle state call it:
`colorNewGroup` (right after the picker opens, before the preset click), `addWindowNote` (right after
typing, before `Ctrl+Enter` — MUST fire before that keystroke since it unmounts the textarea),
`crossWindowTabDrag` (right after the drag reaches the drop target, before `mouse.up`, so @dnd-kit's
DragOverlay + drop-indicator are still on screen). `screenshots.ts` passes a per-step-id hook that
takes the screenshot itself, and skips the old post-completion screenshot for those 3 ids (the
committed/closed state is no longer the one being published).

Verified in the actual rendered JPGs, not just "file exists": color picker screenshot now shows the
9-swatch grid + custom hex input open (group's own empty-state panel still visible behind it, an
already-known content-order issue — see above — but no longer the focal point since the popover
covers most of it); note screenshot shows the textarea with typed text + Cancel/Save buttons, not
saved note text; drag screenshot shows the dragged tab pill mid-flight with the pink drop-target
outline and "Drop to create new window" zone visible.

**Pattern worth reusing:** when a demo action's Playwright handler needs to expose an intermediate
state to a caller (a still-image capture) without changing what the SAME handler does for a full
video recording, thread an optional no-op-by-default callback through the shared action-runner
rather than duplicating the handler's setup logic in the caller. Duplicating (re-clicking the swatch
open, re-opening the note menu) risks toggle-state bugs (a popover trigger button is often a toggle —
clicking it again to "re-open" for a real run can instead close it) and drifts from the video's own
timing/selectors over time.

See also [[learnings_store_assets_expansion_2026_07_30]], [[learnings_store_assets]].
