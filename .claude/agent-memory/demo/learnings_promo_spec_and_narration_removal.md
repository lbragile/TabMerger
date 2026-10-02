---
name: learnings-promo-spec-and-narration-removal
description: Chrome Web Store promo video spec (PROMO_VIDEO_SPEC.md) grounded in the existing walkthrough pipeline, and removal of the Piper TTS narration pipeline once no-voiceover was confirmed as the direction
metadata:
  type: project
---

## Promo video spec

`packages/demo/PROMO_VIDEO_SPEC.md` is a planning-only doc for a 30-60s Chrome Web
Store cut (+ shorter Product Hunt / longer landing-page hero notes). Key structural
decision: it does NOT try to force the existing 800x600/30fps `WalkthroughDemo`
composition to serve the promo cut — it proposes a new `WalkthroughPromo` composition
in `Root.tsx` at 1920x1080, reusing the *same recorded* `recordings/<theme>/<id>.webm`
clips already produced for the full walkthrough (no new Playwright recording pass
needed for steps that already exist in `demoScript`). New asset work flagged: a real
"messy tab bar" hook shot doesn't exist anywhere in the pipeline today (every existing
`hook` step is a text-only card) — that's new, not a script reuse.

Also flagged as gaps, not confirmed: `launchDemoContext.ts` doesn't demonstrably hide
the bookmarks bar or otherwise scrub browser chrome beyond loading only TabMerger's
extension — matters if any promo shot ever shows full browser chrome (none currently
do; all shots are popup-only recordings).

## Narration (Piper) — removed entirely, 2026-07-31

The project decided no-voiceover (instrumental music + on-screen text only) is the
actual direction, so the whole Piper TTS narration side-pipeline was deleted rather
than left dormant:
- Deleted `packages/demo/narrate.ts` outright (was already opt-in/not part of the
  default record/render flow, so nothing else executed it).
- Removed the `"narrate": "tsx narrate.ts"` script from `packages/demo/package.json`.
  There was never a Piper *npm* dependency to remove — Piper is invoked via
  `child_process` against a local Python venv (`.piper-venv/`), not a node_modules
  package, so `package.json`'s `devDependencies` needed no change.
- Removed the narration-lookup block from `remotion/Composition.tsx`
  (`staticFileNames`/`narrationFileFor`) and the `{narrationFile && <Audio .../>}`
  line inside the per-step `<Sequence>`. Left the *background-track* `<Audio>` +
  `hasAudioTrack`/`getStaticFiles()` check completely alone — that's a separate,
  still-valid mechanism (optional `public/audio/track.mp3`) and both `Audio` and
  `getStaticFiles` imports stayed in use, so no dangling imports resulted.
- Removed the `.piper-venv/`/`.piper-voices/` gitignore block and the now-dead
  `packages/demo/public/audio/*.wav` gitignore line (that line existed solely for
  per-step narration wavs; foley/sfx assets, if added later per the promo spec's
  audio section, will need their own gitignore entry under `public/audio/sfx/`).
- Replaced the README's entire "Narration (Piper TTS)" section (setup instructions,
  GPLv3 license note, Windows onnxruntime DLL fix) with a two-line "Audio" section
  stating the pipeline is instrumental-only with no TTS step.
- `demo-script.ts` needed NO changes — narration was never represented as a field on
  `DemoStep`; it was purely a side-file (`narrate.ts`) that read `demoScript` and
  patched `durationMs` via regex on the source text. No narration-cue field existed
  to clean up.
- No test files existed for `narrate.ts` or the narration lookup (checked
  `packages/demo/**/*.test.*` — none matched), so no test suite changes were needed.
- Nothing else in the pipeline assumed narration audio length for timing —
  `durationMs` values in `demo-script.ts` were already tuned to real recorded-clip
  length per the ponytail comment there (narration, when it existed, only ever
  *bumped* durationMs upward if speech ran long; removing narration doesn't shrink
  anything back down, current durations remain correct as clip-length-driven values).

Net effect: `packages/demo/` has zero Piper/TTS/`.wav`-narration references left
(verified via grep across the whole package post-removal). The prior learnings entry
[[learnings_narration_piper_and_record_resilience]] documents Piper setup/Windows
onnxruntime gotchas for historical reference — those instructions no longer apply to
this codebase but the record.ts crash-resume fix described in that same file is
unrelated and still valid.
