---
name: learnings-video-blur-devicescalefactor
description: record.ts recorded video at deviceScaleFactor=1, causing blurry final .mp4 — same root cause screenshots.ts already fixed for PNGs
metadata:
  type: project
---

record.ts called `launchDemoContext(recordVideo, 1, theme)` — video recording ran at native
1x pixel density on the 800x600 popup. Playwright's built-in `recordVideo` (VP8/webm encoder)
is noticeably soft/lossy at 1x source resolution, especially for small popup UI text.
`screenshots.ts` already used `deviceScaleFactor=2` for this exact reason (see its own comment:
"a 1x-DPI source is what was making the composited Chrome Web Store assets look soft/upscaled")
but `record.ts` was never updated to match when that fix landed for screenshots.

Fix: bumped `record.ts`'s call to `deviceScaleFactor=2`. `recordVideo.size: {width:800,height:600}`
in `launchDemoContext.ts` still pins final output dimensions — Playwright downsamples the 2x
internal buffer to that size, so this is a free sharpness win with no extra file-size blowup
concern beyond normal video encoding.

Also bumped `render:dark`/`render:light` npm scripts in `packages/demo/package.json` to add
`--crf=16` (remotion's default h264 CRF is already ~18, visually-near-lossless range; 16 is a
small, cheap extra margin — not the actual root cause, the VP8 capture-time softness was).

**Why:** [[learnings_theme_pipeline_execution]] and prior passes never touched capture
resolution — this was a genuinely separate bug from the theme/timing issues those covered.

**How to apply:** Any new Playwright-recording entry point in this package (video or
screenshot) should default to `deviceScaleFactor=2`, not 1 — 1x is the wrong default for
anything that ends up in a rendered/composited output. `launchDemoContext.ts`'s own default
param is intentionally left at 1 (so future callers make an explicit choice) but both current
callers (`record.ts`, `screenshots.ts`) now pass 2 explicitly.

**Note:** did not re-run record+render myself — another agent was actively mid-edit on
demo-script.ts/actions.ts/Composition.tsx (mtimes within minutes) when this fix was made.
Verify the actual before/after sharpness via `remotion still` frame extraction (see
[[learnings_ripple_root_cause_and_pacing]] for the technique — Playwright's bundled ffmpeg
cannot open rendered .mp4 at all, see [[learnings_search_scope_picker]]) once that agent's
next re-render pass has produced fresh output.
