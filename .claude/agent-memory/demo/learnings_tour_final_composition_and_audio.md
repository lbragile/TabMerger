---
name: learnings-tour-final-composition-and-audio
description: Full-tour assembly gotchas (cross-fade dips and ghosting with frame-matched scenes, poster intro) and the synthesised audio pipeline (loudness tooling, tsx/page.evaluate trap, noise swell artefact, FM vibrato trap)
metadata:
  type: project
---

- Frame-matched scenes only cross-fade invisibly if the incoming scene is frozen on its first frame while it fades in (`Freeze frame={0}` for the first TRANSITION_FRAMES, content starts at the cut) and the outgoing scene stays opaque underneath (`fadeOut={false}`). With both fading you get a 25% dip toward the background even between identical frames; with the incoming scene already moving you get two popups at once.
- A poster intro that equals the thumbnail PNG is just the same component rendered as the first Sequence (fully opaque, no fade-in); the standalone still and frame 0 of the video have the same md5. Scene 1 then dissolves in from its frozen first frame, and the caption bar fades in with that dissolve.
- Remotion's bundled ffmpeg is a minimal build without the `ebur128` filter (also no `showspectrumpic`). Loudness work needs a full ffmpeg: the generator reads `TM_FFMPEG`. Even a 2018 build is enough for `ebur128=peak=true`, `volumedetect`, `showspectrumpic` (without the `fscale` and `stop` options) and `showwavespic`.
- Synthesis pitfalls found by looking at the spectrogram: a filtered-noise swell with a first-order low-pass leaves HF hiss (broadband vertical bars at every cut), so use tonal swells; end every accent with a short fade so nothing clicks; model vibrato as a small phase offset, not `f * (1 + depth * sin)` times time (that makes the pitch drift further out as time grows).
- `page.evaluate` in a script run through tsx fails with `__name is not defined`; add `page.addInitScript("window.__name = (f) => f;")` and navigate before evaluating.
- Sounds are placed on the real event and cut frames; a beat grid fitted to the cuts cannot beat roughly +-6 frames, which is why the tempo-based bed was dropped (see the sound-design note).
