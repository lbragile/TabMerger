---
name: learnings-ripple-root-cause-and-pacing
description: The actual root cause of "ripples never show up in any recorded video" (a null documentElement in addInitScript), how it was proven with real frame extraction, and the durationMs-is-also-a-hard-cap gotcha that follow-up features keep re-triggering
metadata:
  type: project
---

A prior pass (see [[learnings_redo_pass_2026_07_30]] item 9) added click ripples via
`context.addInitScript()` and reported them working — but never actually looked at a rendered frame.
They didn't work at all, on any step, ever. Two more debugging rounds fixed it for real and added
key-press indicators, a settings-walkthrough scene, and a tab-rename scene using the same patterns.

1. **How the ripple bug was actually found — don't trust `.click()` not throwing as proof a visual
   effect fired.** `clickWithRipple`'s ripple call used `window.__tmRipple?.(x, y)` with an optional
   call — if `__tmRipple` was never defined, this is a silent no-op, no error, nothing to notice. The
   only way to catch this was to check `typeof window.__tmRipple` directly (`page.evaluate(() =>
   typeof (window as any).__tmRipple)`), which returned `"undefined"` on the actual page objects
   `record.ts` uses, despite the addInitScript being registered. Any `?.()`-guarded call to a
   window-injected function is unverifiable by output alone — always positively assert the function
   exists before trusting the call sites that use it.

2. **ROOT CAUSE: `document.documentElement` (and `document.head`) is `null` at the moment Chromium
   fires `Page.addScriptToEvaluateOnNewDocument` for this extension's `chrome-extension://` pages** —
   confirmed by wrapping the init script body in try/catch and reading the caught error back out via
   `window.__tmRippleInitErr`: a plain `TypeError: Cannot read properties of null (reading
   'appendChild')`. The init script had been doing `document.documentElement.appendChild(style)`
   *inside the registration body itself* (to inject a `<style>` tag once, up front) — that line threw,
   which aborted the ENTIRE script before the next line (`window.__tmRipple = ...`) ever ran. So the
   function silently never existed, on any page, the whole time. This is NOT documented Playwright
   behavior anywhere obvious — discovered only by instrumenting the exact production code with a
   try/catch probe and reading back the real exception, not by reasoning about the API from docs.
   **Fix:** the init script body must do NOTHING except assign a bare function reference (zero DOM
   access). All DOM reads/writes (creating the `<style>` tag once via an `id` check, appending the
   ripple/badge element) must be deferred to CALL TIME, inside the function itself — by which point
   the real document has fully loaded. Any other `context.addInitScript()` that touches
   `document.documentElement`/`document.body`/`document.head` synchronously at registration time has
   the same latent bug on this extension's pages — the background-color-paint init script had the
   identical issue and was fixed with a `setTimeout`-based poll-until-it-exists retry (that one, unlike
   the ripple, has no "call site" to defer to — it must run as early as possible to avoid a flash, so
   it retries instead of deferring).

3. **How to actually verify pixels in a recorded `.webm`/`.mp4` when there's no system `ffmpeg`:**
   Playwright bundles its own ffmpeg at `<ms-playwright install dir>/ffmpeg-<version>/ffmpeg-*.exe` —
   find it via `find <playwright browsers dir> -iname "*ffmpeg*"` (on Windows:
   `%LOCALAPPDATA%\ms-playwright`). Extract every frame with
   `ffmpeg -i clip.webm ripple-frames/f-%03d.png` (no `-vf fps=N` — that filter syntax threw a parse
   error in this specific bundled build for an unknown reason; requesting ALL frames and just sampling
   which PNGs to `Read` afterward sidesteps it entirely). This bundled ffmpeg is compiled
   `--disable-everything` except vp8/webm/mjpeg/png — it CANNOT decode the final rendered `.mp4`
   (h264) at all ("Invalid data found when processing input"). To verify the FINAL rendered `.mp4`
   (after Remotion's own encode), use `npx remotion still <root> <CompositionId> out.png
   --frame=<N>` instead — Remotion's renderer has its own decode/encode path and doesn't depend on
   this stripped-down ffmpeg. Compute the target frame number from the composition's own frame math
   (fps × cumulative seconds across `Sequence`s) rather than guessing.

4. **`durationMs` in `demo-script.ts` is a MINIMUM at record time but a HARD CAP at render time —
   this bites again every time an action gains more clicks/typing/reveal-pauses.** `record.ts`'s
   `runStepAction` only enforces `durationMs` as a floor (pads with `waitForTimeout` if the action
   finished early). But `Composition.tsx`'s `<Sequence durationInFrames={msToFrames(step.durationMs)}>`
   uses the exact same number as a hard playback cap — content recorded past that point is simply
   never shown, with no error or warning anywhere. Adding the mandatory 350ms post-click pause (see
   below) and the key-press badges made several steps' *actual* recorded length silently exceed their
   existing `durationMs`, truncating the tail of the interaction (e.g. a final "Save" or "Enter" click
   landing after the cut). The only reliable fix is empirical, not estimated: after every recording
   pass, `ffprobe`/`ffmpeg -i` (or `remotion still` at frame math) the ACTUAL clip length for every
   step and diff it against `demo-script.ts`'s `durationMs` — do not try to hand-compute "N clicks ×
   350ms + M waits" as a substitute, it undercounts by hundreds of ms almost every time once click
   pacing, key badges, and reveal-pauses stack up. This needs to be re-checked after ANY change to
   `actions.ts`'s pacing/helpers, not just once.

5. **Mandatory post-click pacing implemented ONCE in the shared `clickWithRipple`/`dblclickWithRipple`
   helpers** (`POST_CLICK_PAUSE_MS = 350`), not scattered as per-call-site waits — this is the
   root-cause-not-symptom fix: every click across every scene gets the pause automatically, including
   future ones, instead of relying on each new action remembering to add its own gap. An
   `ElementHandle`-based click (renameGroup/renameTab's rename `<input>`, which isn't a `Locator`) needs
   its own tiny `clickHandleWithRipple` mirror since `Locator` and `ElementHandle` don't share a click
   method signature — don't skip ripple/pacing on handle-based clicks just because the main helper
   doesn't accept them.

6. **Key-press indicators reuse the exact same lazy-DOM-at-call-time pattern as the ripple fix** —
   `window.__tmKeyBadge(x, y, char)`, same brand color, registered in the same `context.addInitScript`
   pass. `typeWithIndicator(page, locatorOrHandle, text, delayMs)` resolves the target's bounding box
   ONCE up front (the element doesn't move while being typed into) then loops char-by-char, showing the
   badge before each `page.keyboard.type(ch)`. This replaced every `pressSequentially()` /
   `keyboard.type(text, {delay})` call across the file (rename group, rename tab, search, group note) —
   audit ALL typing call sites when adding this kind of feature, not just the first one found; it's
   easy to convert one and miss siblings.

7. **The extension has TWO independent rename features and TWO independent note features that look
   similar but are separate code paths** — `SidePanel/GroupItem.tsx` (group name rename, group note via
   `GroupContextMenu`) vs `Windows/Tab.tsx` (tab custom-title rename via `commitTitle`/`customTitle`,
   AND a separate tab-level note via `noteOpen`/`commitNote` on the same file). Before assuming a
   requested "add a scene for X" already exists or doesn't exist, grep the actual component tree
   (`customTitle`, `noteOpen`, `editingTitle` in `Tab.tsx` here) rather than assuming that a
   demo-script step named similarly (`rename-group`, `add-note`) already covers it — they don't
   automatically generalize to the tab-level equivalents. `Tab.tsx`'s `editingTitle` input has the
   IDENTICAL 50ms auto-focus/caret-reset race as `GroupItem.tsx`'s rename input (same `setTimeout(...,
   50)` pattern) — the same out-wait-then-select-all fix applies verbatim.

8. **Key-press indicator was scoped down mid-pass: per-character badges were too noisy, then
   corrected to modifier/special-key-only.** The first cut showed a badge for every typed character
   (`typeWithIndicator`) — review scoped this down to ONLY modifier/special-key presses
   (Ctrl+A, Enter, Escape, Backspace, etc.), not regular text entry. Fix was a straight split: `typeText`
   (plain `pressSequentially`/`type`, zero badge) for actual text content, `pressWithIndicator` (shows
   `window.__tmKeyBadge` once, then `page.keyboard.press`) for the modifier presses. In this script that
   meant exactly two moments per rename step (`Control+a` before select-all, `Enter` to commit) — search
   and the group-note textarea have no modifier presses at all, so they're plain `typeText` with no
   badge. **Positioning also changed**: originally per-keystroke badges were placed at the target
   element's bounding box (needed a `Locator`/`ElementHandle` + box lookup). Once scoped to
   modifier/special keys only, the badge moved to a FIXED bottom-center overlay instead (same
   region as the caption bar in `Composition.tsx`, offset above it, `bottom: 90px` vs the caption's
   `bottom: 32` + ~40px height) — this let `__tmKeyBadge` drop its `(x, y)` params entirely and
   `pressWithIndicator` drop the box-lookup arg, since Composition.tsx's video canvas is 800x600 with
   NO scaling relative to the recorded page's viewport, so a `position: fixed` CSS coordinate picked
   once in `launchDemoContext.ts` lines up correctly in the final render without any per-call
   coordinate math.

9. **Switching a `Locator`'s `pressSequentially()` to a manual `ElementHandle.type()` loop (needed
   because `renameGroup`/`renameTab` type into a frozen `ElementHandle`, not a `Locator`) measurably
   slows down typing** — enough to add several hundred ms across an 11-17 character string, apparently
   from Playwright doing more per-call actionability/CDP round-trip overhead on individual
   `ElementHandle.type(char)` calls than its own batched `pressSequentially` implementation does
   internally. This is exactly the kind of thing that re-triggers the `durationMs`-hard-cap trap from
   item 4 above — re-measure actual recorded length after ANY change to how text gets typed, even
   "simplifications" that remove code (like dropping the per-char badge calls) can paradoxically make
   the ACTUAL recording longer if the typing mechanism itself changed shape at the same time.

See also [[learnings_redo_pass_2026_07_30]], [[selectors_and_app_mode]].
