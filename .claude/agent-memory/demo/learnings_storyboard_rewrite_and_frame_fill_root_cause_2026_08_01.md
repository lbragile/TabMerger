---
name: learnings-storyboard-rewrite-and-frame-fill-root-cause-2026-08-01
description: Full demoScript storyboard replacement (one real workflow instead of a highlight reel) plus the ACTUAL root cause of the recurring "cropped popup / gray borders" bug — a Playwright non-headless recordVideo scale quirk, not Composition.tsx CSS — found by measuring real pixels, not trusting object-fit alone
metadata:
  type: project
---

## Storyboard rewrite (2026-08-01)

`demoScript` in `demo-script.ts` was fully replaced: one complete real
workflow (cluttered real browser -> popup shows it in Now Open -> create+color a group -> copy a
window in -> organize tabs across windows -> rename windows -> note a window -> rename a tab ->
outro) instead of the old 17-beat highlight reel. `promoOnlySteps` was moved to the TOP of
demo-script.ts (before `demoScript`) because most of the new storyboard's beats are literally the
same real action as an existing promo beat — `fromPromo(id)` pulls them verbatim so both cuts share
one recorded clip per shared beat. **Ordering matters here**: `fromPromo` calls execute at module-eval
time inside the `demoScript` array literal, so `promoOnlySteps` MUST be defined earlier in the file
or it's a TDZ ReferenceError.

Two brand-new real actions added (verified against the actual component before writing, not
assumed): `renameWindow` (Window.tsx's own inline dblclick-title rename — same 50ms
auto-focus/caret-reset race as GroupItem.tsx/Tab.tsx, same fix) and `addWindowNote` (Window.tsx's
window-level note feature, distinct from the group-level one — commits via **Ctrl+Enter**, not a
"Save" button click, because there are THREE visually-identical unlabeled "Save" buttons rendered
across Window.tsx/GroupItem.tsx and none has a unique accessible name — the keyboard shortcut avoids
strict-mode ambiguity entirely and is more interesting to show on camera anyway).

`record.ts`'s `recordedSteps` used to be a flat concat of `[...demoScript, ...promoOnlySteps]` with
an implicit assumption that only `chaos-hook` overlapped by id. Once `demoScript` started reusing
`promoOnlySteps` entries verbatim, that assumption broke — **must dedupe by id** (`new
Map(...).values()`) or the same step gets recorded twice into the same output path in one pass.

**Seed-data constraint** ("Now Open should show ONLY the real seeded chaos, no leftover extra
content"): `chaosHook` (actions.ts) now captures every pre-existing `chrome.windows` id (except the
current/popup window) BEFORE creating its 3 real chaos windows, and closes them right after — so
`launchDemoContext.ts`'s own `NOW_OPEN_SEED_URLS` window (kept for `screenshots.ts`'s independent
needs) never leaks into the video's Now Open view. Removing/renaming demoScript steps also silently
starves `screenshots.ts`'s `SCREENSHOT_STEP_IDS` and `PromoTile.tsx`'s hardcoded screenshot ids — grep
for a removed step id across the whole `packages/demo/` tree before deleting it, not just
`demo-script.ts`.

## THE REAL frame-fill/cropped-popup root cause (not CSS, not object-fit)

A prior pass already added `object-fit: cover` in Composition.tsx and reported it "fixed" — real
playback showed it was NOT actually fixed. This time the diagnosis was done from raw
pixels, per the explicit instruction to not trust CSS reasoning alone:

1. Rendered a real still frame (`remotion render` + `ffmpeg`/PIL frame extraction — Playwright's own
   bundled ffmpeg **cannot open the rendered .mp4** at all on this machine, per prior learnings; a
   separate `imageio_ffmpeg` binary could). The frame showed the popup content occupying only the
   top-left ~83% of the canvas, with solid mid-gray (`~rgb(128,128,128)`) filling the rest —
   asymmetric (flush top-left, padding only right/bottom), which is the signature of Playwright's
   `recordVideo` padding an under-sized capture into a larger requested `size`, NOT a CSS
   letterboxing artifact (CSS `object-fit: contain` pads symmetrically, and `cover` never pads at
   all — it can only crop within whatever pixels the video file already contains).
2. Extracted the SAME frame directly from the raw `.webm` (not the rendered `.mp4`) and found the
   exact same gray padding baked into the source recording itself — this conclusively ruled out
   Composition.tsx/CSS as the cause, exactly as instructed to verify. `object-fit: cover` cannot
   remove padding that's already baked into the source video's own pixel data.
3. Ruled out a viewport-application bug: a standalone diagnostic script confirmed
   `page.viewportSize()` correctly reports `{800,600}` and `page.screenshot()` correctly returns a
   true `1600x1200` buffer (800x600 @ deviceScaleFactor 2) — screenshots are unaffected.
4. Measured the actual content boundary in a fully-loaded frame with PIL (scan for where the gray
   band starts): content stopped at exactly `x=999, y=749` inside a `1200x900` requested canvas —
   i.e. the REAL captured video resolution was `1000x750`, not `1600x1200` scaled down to `1200x900`
   as intended. `1000/800 = 750/600 = 1.25`, not the requested `deviceScaleFactor: 2`.
5. **Root cause**: Playwright's non-headless (`headless: false`) `recordVideo` screencast backend on
   this Windows environment captures real windows at an effective ~1.25x scale regardless of the
   requested `deviceScaleFactor` — a real discrepancy between the CDP `screenshot` API (which fully
   honors device-metrics overrides) and the video-recording backend (which apparently does not, in
   non-headless/real-window mode). Requesting a LARGER `recordVideo.size` than the backend can
   actually produce does NOT upscale the real capture — Playwright's recordVideo only ever
   **scales down** an oversized capture to fit `size`, it never scales up an undersized one, so the
   real (smaller) frame just sits top-left-anchored inside a bigger gray canvas.
6. **Fix**: set `recordVideo.size` to exactly what the backend actually produces (`{width: 1000,
   height: 750}`, i.e. `viewport * 1.25`, not `viewport * deviceScaleFactor`) instead of the
   previously-assumed `{1200, 900}` (`viewport * 2`). Re-recorded and re-measured the content
   boundary in the new output — fills the full canvas edge-to-edge, zero padding, confirmed by
   direct pixel inspection, not just re-applying the same CSS trick that was already tried and
   failed. This value (1.25x) is specific to whatever OS/display-scaling this exact machine runs —
   if this pipeline runs on different hardware, re-run the same "requested vs actual pixel boundary"
   measurement rather than trusting `1000x750` as a portable constant.
7. **Separately**, `record.ts`'s per-step `context.newPage()` calls never called
   `page.setViewportSize()` (only `launchDemoContext.ts`'s own `freshPage` did) — added it
   defensively for correctness/consistency, but it was NOT the actual root cause here (a diagnostic
   confirmed the viewport itself was already correct before this fix). Kept anyway since it's cheap
   insurance and matches the established pattern.

**Process lesson**: when a user says a previously-claimed "fix" didn't actually work, the fastest
path to ground truth is extracting real pixels from the RAW source file (not the final render) and
measuring exact boundaries (PIL pixel scan, not eyeballing) — that's what separated "CSS problem"
from "recordVideo backend problem" in under 10 minutes, versus another round of CSS guessing.

## Loading-flash trim also needed re-measuring

`LEADING_TRIM_MS` (450ms, tuned on a previous pass) was nowhere near enough on this run — direct
frame extraction showed the loading spinner still visible 1.0-1.5s into freshly-created step pages
(heavier now: Now Open carries 15 real seeded tabs across 3 windows plus 4 saved demoData.ts groups,
more IndexedDB/TanStack Query weight than whatever machine 450ms was tuned on). Bumped to 2000ms and
re-verified via frame extraction that the spinner is reliably clear by that point on the slowest
observed step (`open-popup`, which runs right after `chaos-hook` so Now Open is already fully
populated). This is environment-dependent, not a fixed constant — re-measure via frame extraction
after any change to seed data volume or on a different machine, don't just trust the last-recorded
number.

## Duration-formula sign error caught before rendering (worth flagging for next time)

First pass at re-tuning `durationMs` after measuring real clip lengths via ffprobe used `observed -
LEADING_TRIM_MS + 300ms buffer` — this is backwards. `durationMs` is Composition.tsx's **hard
playback cap** on footage that's already had `LEADING_TRIM_MS` trimmed off the front; the correct
formula is `observed - LEADING_TRIM_MS - ~200ms safety margin` (subtract, not add). Adding a buffer
makes durationMs *exceed* the remaining trimmed footage, which plays past the end of the actual
recorded content (dead/blank frames) — a subtler, worse version of the exact truncation bug this
pipeline already has extensive tooling to avoid. Caught by re-reading the OLD convention comment
carefully before rendering, not after. Worth re-reading before ever touching this formula again.

## Mobile-friendly export (2026-08-01)

Added `MobileWalkthroughDemo` (Composition.tsx) — wraps an UNMODIFIED 800x600 `WalkthroughDemo`
instance in a CSS `transform: scale(1080/800)` centered inside a portrait 1080x1920 canvas, brand
gradient background filling the letterboxed top/bottom. This scales EVERYTHING proportionally
(video, captions, key-press badges) with zero changes to WalkthroughDemo itself, since it's a single
outer CSS transform rather than a rewrite of every fixed-pixel position inside it. Registered as
`PromoDarkVertical`/`PromoLightVertical` (1080x1920) in Root.tsx, alongside (not replacing) the
existing 800x600 landscape exports. Verified via a rendered still frame — text/UI legible at full
portrait width, letterboxing reads as intentional (matches the brand gradient), not a landscape clip
awkwardly shrunk into a phone frame.

See also [[learnings_loading_flash_and_trim]], [[learnings_video_blur_devicescalefactor]],
[[learnings_theme_pipeline_execution]] (also flagged the chrome-mv3 vs chrome-mv3-demo path bug this
pass had to re-fix, since fixed for good — `launchDemoContext.ts`'s `EXTENSION_PATH` had regressed back to the wrong
non-demo build dir at some point after that learning was written; the Settings > Dev tab's Demo Mode
button doesn't exist in that build, so this silently breaks the entire pipeline with no error until
`launchDemoContext.ts`'s own selectors start failing).
