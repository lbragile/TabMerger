---
name: learnings-search-scope-picker
description: SearchOverlay.tsx has no native <select> dropdown for search scope — the real affordance is a click-driven EXAMPLES chip -> picker-list pattern; role="button" ambiguity between the picker list and the sidebar group row when scripting it with Playwright
metadata:
  type: project
---

Investigated (2026-07-30) whether `packages/extension/src/components/Header/SearchOverlay.tsx` has an
actual scope/filter dropdown, per a request to stop typing raw `group:"Name"` query syntax directly
into the search input in `searchTabs` (lib/actions.ts).

1. **There is no native dropdown/`<select>`.** The real affordance is: an empty query shows an
   `EXAMPLES` list of clickable chips (`react`, `group:`, `window:`, `tag:`). Clicking the `group:`
   chip sets the query to the bare prefix, which flips the overlay into "picker mode" — a list of
   real group-name buttons (`getGroupPicks`). Clicking one of those calls `completePick()`, which
   inserts `group:"Name" ` into the query and refocuses the input. This click-through IS the closest
   real equivalent to a scope dropdown, so `searchTabs` now drives it via two `clickWithRipple` calls
   (chip, then group) instead of typing the syntax by hand — only the trailing "react" term is typed.

2. **Playwright ambiguity: the picker's group button and the sidebar's group row are BOTH accessible
   buttons named "Research".** `SidePanel/GroupItem.tsx`'s row is `role="button" aria-label="Research"`
   for DnD/keyboard reasons, so an unscoped `page.getByRole("button", { name: /^Research$/ })` hits 2
   elements (strict-mode violation) once the overlay is open. Fix: scope to the overlay's fixed
   container first — `page.locator(".fixed.z-50").getByRole("button", { name: /^Research$/ })`.

3. **Composition.tsx adds a 1500ms brand intro (`INTRO_DURATION_MS`) before step 0's timeline
   starts**, at 30fps that's 45 frames. Any manual frame-offset math for `remotion still` verification
   (summing `demo-script.ts` durationMs to find a step's start) must add `INTRO_DURATION_MS/1000*fps`
   frames on top, or you'll sample the wrong step entirely (confirmed by landing mid-`selection-mode`
   instead of `search` on the first attempt).

4. **Playwright's bundled ffmpeg (`ms-playwright/ffmpeg-*/ffmpeg-win64.exe`) is built libvpx/webm-only
   — it cannot open the rendered `.mp4` output at all** ("Invalid data found when processing input"),
   not even for `-i`/probing. It's only useful against the raw `.webm` recordings. To verify a frame
   of the final rendered `.mp4`, use `npx remotion still remotion/Root.tsx <CompositionId> out.png
   --frame=N` directly against the composition (which is also cheaper — no need to re-render the
   whole video to check one frame).

5. **Re-affirms the existing "measure the real recorded clip length, don't estimate from code" rule**
   ([[learnings_ripple_root_cause_and_pacing]]) — first duration estimate for the simplified `search`
   step (4300ms) undershot real actions.ts pacing by ~2.5x; final value (6150ms) was reached only by
   iterating record -> ffmpeg-duration-check -> adjust `durationMs` twice.

See also [[learnings_ripple_root_cause_and_pacing]], [[learnings_loading_flash_and_trim]],
[[learnings_theme_pipeline_execution]].
