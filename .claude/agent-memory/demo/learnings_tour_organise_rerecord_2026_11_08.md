---
name: learnings-tour-organise-rerecord-2026-11-08
description: Re-recording tour scene 4 under machine load - slow capture makes the drop hover spring Work open, end view must be forced to Q4 Launch
metadata:
  type: project
---

- Under concurrent recorders, capture runs about 15-20 real fps (frame counts 396-510 vs 376 quiet; 2-3x duplicate runs in motion). Frame count and event times vary run to run, so re-record until the dark/light counts are close, and read events from the JSON, not from memory.
- With a slow capture the drag over the Work row can last long enough to spring Work open, so the scene ended on Work instead of Q4 Launch (the next scene's start view). The recorder now clicks the Q4 Launch row after leaving selection mode when Work's tabs are showing (event `backToQ4`, dark only in practice).
- Verify a scene seam by md5 of the last frame vs the next scene's f-0001; a just-clicked sidebar row keeps a slightly stronger grip handle, so a byte match is not guaranteed after a corrective click (visually identical).
