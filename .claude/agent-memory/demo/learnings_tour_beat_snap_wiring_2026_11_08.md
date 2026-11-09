---
name: learnings-tour-beat-snap-wiring-2026-11-08
description: Beat snapping wired into the tour registry, frame extraction pitfalls with Remotion's ffmpeg, and the full-ffmpeg requirement for audio
metadata:
  type: project
---

- Registry holds base length, snap extra and maxShorten per scene; TourVideo freezes the last frame for a positive extra, cuts at the end for a negative one. Only scenes whose footage ends on 20+ identical frames get maxShorten (check with an md5 of trailing frames). Single-scene compositions use the base length.
- Quiet re-record on this machine still gives only 55-65% new frames in drag glides (capture ceiling), but frame counts return to the old values and seams stay byte-identical (md5 of last vs next first frame).
- Remotion's bundled ffmpeg: `select=eq(n\,N)` expressions fail to parse here; extract single frames with `-ss N/30 -frames:v 1` instead. Output must go inside the project (a short 8.3 scratchpad path gave "Invalid argument").
- `audio:tour` needs a full ffmpeg (ebur128, alimiter). No such build is installed by default; a downloaded one is blocked by the permission system, so a full build must be provided via TM_FFMPEG.
- packages/demo has no tsconfig; a scratchpad tsconfig with types node+chrome from the extension's node_modules/@types works.
