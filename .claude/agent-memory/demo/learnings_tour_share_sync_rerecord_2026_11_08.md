---
name: learnings-tour-share-sync-rerecord-2026-11-08
description: Re-recording tour scenes 8 and 9 - inline scene-6 replay needs Clear search, one flaky pre-roll rename, sed pitfalls
metadata:
  type: project
---

- Scenes 8/9 recorders replay scenes 3-7 inline; after the search rework the scene-6 replay must click `header-clear-search` and wait for six sidebar rows, or the Q4 Launch checks fail.
- The pre-roll's "second window is named Assets" check failed once (window titles `Window, Window`) and passed on every retry; treat a single failure there as a flake and rerun before changing the check.
- Capture rate on a loaded machine: about 55-65% unique consecutive frames (glides 65%); static holds duplicate by design, so judge only motion ranges.
- A global `sed s/600/400/` on a recorder also rewrote unrelated waits; use line-scoped edits and check `git diff -U0 | grep timeout`.
- A still beyond the scene's duration (scene 8 is 217 frames, capture 324) errors with a RangeError; use `durationInFrames - 1`, not the capture frame count.
