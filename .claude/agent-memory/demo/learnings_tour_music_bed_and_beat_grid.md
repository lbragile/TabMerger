---
name: learnings-tour-music-bed-and-beat-grid
description: Tour music bed (licensed Mixkit track, never committed), beat-phase maths, loudness/limiter trade-offs, and the pure beat-snapping helper
metadata:
  type: project
---

- Decision: the licensed MP3 is fetched on demand (`fetch-tour-music.ts`, `music:tour`) into gitignored `public/tour/audio/music/` and pinned by SHA-256; the beat phase constant (`MUSIC_FIRST_BEAT_SEC`) was measured on that exact file. `generate-tour-audio.ts` writes both `tour-<theme>.wav` (effects only) and `tour-<theme>-mix.wav`; `TourVideo` prefers the mix, `music: false` falls back to effects, `audio: false` is still no audio track.
- Beat alignment without delay: do not delay the track; start the file at `mod(firstBeat - firstCut/fps, beat)` seconds (0.223 s here) so music is already playing at frame 0 and a beat lands on the first cut. At 120 BPM a beat is exactly 15 frames.
- Beat snapping maths: with 15-frame beats, the +-7 range holds exactly one end position on the grid per scene, so snapping is unique and greedy (no search). Landing the closing card on a bar (60 frames) needs whole beats (+-15) moved between scenes: for the current registry that costs +45 frames over three scenes, so it is opt-in (`barAlignClosing`).
- Onset-envelope phase detection reads about 9 ms late versus the true transient (0.494 vs about 0.485); under one frame, harmless.
- Retuning to a new key: the chimes were major triads on every pentatonic degree, which leaves the key (D major version had G# and F#-vs-natural clashes); chimes now stack scale thirds (diatonic). Any retune should check chord tones, not just TONIC.
- Loudness: integrated LUFS is gated, so adding a quiet bed under sparse effects LOWERS the integrated figure (-19.4 effects only, -22.5 with music at -30 dB RMS, master 0). Reaching about -16 LUFS needs +7 dB master, which makes the limiter work on the intro stack and every chord; +4 dB (-18.7 LUFS) was used as the compromise. `MIX_MASTER_DB` and `MUSIC_RMS_DB` are the two constants.
- A full ffmpeg (essentials build 9.x) has ebur128, alimiter and loudnorm and also decodes the MP3; Remotion's bundled one has none of those. mp3 -> `-f f32le -ar 44100 -ac 2 -` through spawnSync with a Buffer (not utf-8) is the decode path.
- `getStaticFiles()` prints a server-side warning under tsx when a script imports the registry (TourVideo is not imported, but scenes are); harmless.
