---
name: learnings-tour-sound-design-only
description: The tour audio is sound effects only (no music, no transition noise); why the gain is a fixed constant, how it was proven unchanged by md5, limiter behaviour, and ffmpeg/WAV measuring gotchas
metadata:
  type: project
---

- Decision: the tour audio is `generate-tour-audio.ts` in one mode only: key-tuned (D major) event sounds, an intro rise, a strummed closing chord, silence between, fade to exact silence. No music bed, no noise whoosh, no third-party audio (so no credits). The licensed-track candidate mode, `audio/tracks*` and the old pad/pulse bed were removed.
- Gain is a constant (`SFX_GAIN_DB` = 7.5 dB) followed by `alimiter=limit=0.8`, not a normalisation to a LUFS target. With long silences integrated loudness depends on how many sounds exist, so removing the whooshes only moved the measured value from -19.6 to -20.1 LUFS (and the swells, later, to -19.7); re-normalising would have made every other sound louder. Measured result (after removing the cut swells): about -19.7 LUFS, -1.9 dBTP, LRA 24 LU, same in the wav and the AAC mp4.
- To prove a refactor of a deterministic synth, first add temporary env switches to the old code (layer off, fixed gain), write the reference wavs, then compare md5 against the refactored output. Done here: the old code reproduced the approved candidate byte for byte, and the refactor matched the whoosh-off reference byte for byte (dark and light).
- The limiter touches only the closing strum (unlimited peak 0.898 = -0.94 dBFS, reduced by 1.0 dB for a few ms around 66.4 s; residual vs a pure gain change -32 dB, so a smooth gain dip, not clipping). `alimiter` also delays the output by 131 samples (3 ms), which is inaudible and the same for all sounds.
- Decision: nothing is tied to a scene cut (no whoosh, no tonal swell into cuts). One tonal swell remains, on the sync scene's "second device arrives" event (cut + 12 frames). Removing the 9 cut swells changed the integrated loudness from -20.1 to -19.7 LUFS and LRA from 12 to 24 LU, with the gain unchanged.
- Gotcha: a removed sound can still shift others. `counter` in `accent()` picks each sound's note and pan, and the cut swells advanced it, so removal keeps a bare `counter++` per cut to leave every other note identical. Proof method: diff the old and new wav; all differing samples must lie in windows around the removed sounds (here cut -0.6 s to +0.5 s: 0 differing samples outside).
- A first-order-filtered noise swell leaves broadband hiss at every cut (a reason noise transitions sound harsh).
- A WAV written by ffmpeg has a LIST chunk before `data`; find the `data` tag instead of assuming a 44-byte header. MSYS paths like `/c/Users/...` embedded in a script run by Node resolve to `C:\c\Users\...` and silently create a stray directory: pass Windows paths (`pwd -W`) to Node.
- The mp4 container reports 69.12 s (AAC priming and padding); the video stream is 2072 frames = 69.07 s. The last 0.6 s measures about -64 dB mean (silence).
- A reference demo "with a background track" was sound effects only (16 events in 30 s, about 11 s of digital silence, LRA 13.4 LU, -19.5 LUFS). Measure before assuming a music bed exists.
- Type-checking `packages/demo` still needs a throwaway tsconfig (no project tsconfig or ESLint config there): see the scene 1 note.
