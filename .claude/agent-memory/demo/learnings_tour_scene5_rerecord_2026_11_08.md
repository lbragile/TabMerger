---
name: tour-scene5-rerecord-2026-11-08
description: Scene 5 (name-and-note) re-record on a rebuilt demo extension - no code fixes needed, capture-rate under parallel load, cross-scene first/last frame check
metadata:
  type: reference
---

- Scene 5's recorder needed no change after the extension rebuild; the ring overlay (measured from last-frame pixels) still lands on the note icon, verified with `render:tour-scene name-and-note [light] --frame=205`.
- With several recorders running at once (CPU ~65%), footage runs longer (about 300 frames vs 272) and roughly half the 30fps frames are duplicates of the previous one (the grabber nominally gets ~25fps and less under load). Event frames shift by 20-30 frames; the scene reads them from the JSON so nothing else changes.
- To check the seam between scenes, md5 the previous scene's last frame against the next scene's `f-0001.jpg`. Identical md5 means a seamless cut. Do this after both recordings are finished, since each scene's recorder replays the earlier scenes itself and a stale or half-written neighbour gives false mismatches.
- Scene 4's recorder clicks Work/Q4 Launch after stopping the grabber (verification only); if the grabber stop is late, the footage's last frame shows the Work group selected instead of Q4 Launch, which breaks the seam to scene 5.
