---
name: learnings-feature-tour-scene3
description: Sharp popup capture via CDP frame grabs, reusing walkthrough actions with a pace/pointer hook, and the footage gotchas for a recorded popup scene
metadata:
  type: project
---

- Playwright `recordVideo` (even with deviceScaleFactor 2) only ever records the raw CSS viewport (800x600), and `Page.startScreencast` also returns DIP-sized frames. For a crisp push-in, loop `Page.captureScreenshot` with `clip: {..., scale: 2}` (jpeg, `optimizeForSpeed`): about 23-28 fps at 1600x1200 headless. Resample to a fixed 30fps and write one image per frame; Remotion shows them with `<Img>` by frame index, no video encoding or ffmpeg needed.
- The tour reuses the walkthrough's `renameGroup`/`colorNewGroup` through `setPace` in `lib/actions.ts` (post-click pause, typing delay, hold scale, key badges, and a `pointer` hook that glides a cursor before each click). Defaults equal the walkthrough's, so existing recordings are unaffected.
- A cursor in headless footage must be real DOM: inject a div that follows `mousemove`. Gliding needs eased `mouse.move` steps with short waits; Playwright's `steps` option moves too fast to read.
- Radix tooltips reopen on focus: the colour dot regains focus after Apply and pops "Change color". An in-page interval that blurs `button.rounded-full` while no colour picker input (`input[value^="#"]`) exists removes it.
- Idle cursor position matters: parked over the list it triggers row hover and underline. Park it on blank sidebar space.
- Titles can flap back to the bare host just after the popup settles (Dribbble): re-check twice right before capturing and re-open from scratch if a row's title equals its host.
- To fade a previous scene's final frame out inside the next scene, render that scene in a `Sequence` with negative `from` (so its local frame continues past its end) and fade the wrapper; every layer beneath must reproduce the same geometry.
- Multi-line bash heredocs containing apostrophes failed in the Bash tool; write files with the Write tool or a `python - <<'PYEOF'` script that avoids them.
