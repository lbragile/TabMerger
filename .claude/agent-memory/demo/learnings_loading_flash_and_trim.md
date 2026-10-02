---
name: learnings-loading-flash-and-trim
description: Root cause of a spinner/blank-white flash at the start of every recorded step clip, why a wait in record.ts alone can't fix it, and the LEADING_TRIM_MS pattern (record extra, trim at playback) that does
metadata:
  type: project
---

Audited every step in `demo-script.ts` for a visible loading flash (2026-07-30 pass). Found one,
real, affecting EVERY non-textCard step's clip (not just `open-popup`) — fixed via a
record-extra/trim-at-playback pattern, not a wait alone.

1. **The bug: every step's `.webm` opens with a genuine TanStack Query/IndexedDB spinner or blank
   frame** — confirmed by extracting real frames with Playwright's bundled ffmpeg
   (`ffmpeg -i clip.webm frames/f-%03d.png`, no `-vf fps=N`, see
   [[learnings_ripple_root_cause_and_pacing]] item 3 for why) from `view-groups.webm`,
   `tab-preview.webm`, `settings-walkthrough.webm`, `drag-reorder.webm`, `add-note.webm` — every one
   showed a spinner/blank frame at t=0 that cleared by ~frame 10-11 at the recorded ~25fps
   (~400ms), consistently.

2. **Why the existing `openPopup` action's `waitFor({state:"visible"})` fix (from a prior pass)
   only fixed the FIRST step, not the other 14** — `record.ts`'s main loop gives every step a FRESH
   `page.goto(popupUrl)`, and Playwright's `recordVideo` starts capturing frames at page/context
   creation, well before `goto()` resolves, let alone any wait after it. The old fix lived INSIDE
   the `openPopup` action handler, so it only ever ran for that one step. Every other step
   (`viewGroups`, `tabPreview`, etc.) navigated the same fresh page and immediately started
   clicking, with zero content-readiness wait — same flash, uncaught until frame-level
   verification. **Root-cause fix moved the wait to `record.ts`'s main loop** (once, for every
   step, right after `page.goto()` and before `runStepAction()`), not duplicated per-action.

3. **A readiness wait alone cannot remove the flash from the FINAL video — it can only shrink it**
   — the wait affects when the *Playwright action* starts clicking, but the raw `.webm` file still
   physically contains every frame recorded from page-creation onward, spinner included.
   `Composition.tsx`'s `<OffthreadVideo>` plays each step's clip from time 0 with no trim, so the
   spinner frames were always going to end up in the rendered `.mp4` regardless of any wait, until
   something explicitly skips past them at playback time.

4. **Fix: `startFrom` on `OffthreadVideo` to trim the leading flash, PAIRED with recording extra
   buffer time so the trim doesn't just eat into the tail of the action instead.** Since
   `durationMs` in `demo-script.ts` is a hard cap on `<Sequence>` playback (see
   [[learnings_ripple_root_cause_and_pacing]] item 4), and `record.ts`'s `runStepAction` only pads
   the ACTUAL recording up to `durationMs` as a floor — trimming `startFrom` frames off the front of
   a clip whose raw length is exactly `durationMs` would silently truncate the END of the action by
   that same amount (freezing on the last frame, or worse). Fixed by defining ONE constant,
   `LEADING_TRIM_MS` (450ms — empirically safe margin above every step's observed ~400ms
   spinner-clear time, all >300ms of headroom rechecked), exported from `demo-script.ts` (the
   established single-source-of-truth file) and consumed by BOTH: `record.ts` passes
   `step.durationMs + LEADING_TRIM_MS` as `runStepAction`'s minimum record time (recording extra
   buffer), and `Composition.tsx` passes `msToFrames(LEADING_TRIM_MS)` as `OffthreadVideo`'s
   `startFrom` (trimming that exact amount back off at playback). Verified post-fix with
   `npx remotion still` at the exact computed start frame of `view-groups` (frame 310, one frame
   into its `<Sequence>`) — real UI content, no spinner, ripple even mid-animation. Re-verify actual
   clip length vs `durationMs + LEADING_TRIM_MS + 300ms` safety margin after ANY change to
   `actions.ts` pacing, same as the existing hard-cap check — this is now a THIRD number
   (`durationMs`, real actions.ts pacing, `LEADING_TRIM_MS`) that must all stay in sync.

5. **Changing a group's swatch color to a color the group ALREADY has by default is a real risk
   worth flagging, not silently "fixing."** The storyboard asked `changeGroupColor` (targets the
   `Research` group) to land on blue specifically. `demoData.ts` seeds `Research` with
   `PRESET_COLORS[5]` (blue, `rgba(59,130,246,1)`) as its DEFAULT color already — so setting the
   swatch to blue makes the step's before/after look visually identical on camera (previously it
   used pink, index 8, specifically because it was the only preset none of the 5 seeded groups
   already used). Implemented literally as asked but left an inline comment flagging the no-op risk
   — don't silently reinterpret an explicit ask, but don't hide a correctness concern either.

See also [[learnings_ripple_root_cause_and_pacing]], [[learnings_theme_pipeline_execution]].
