# @tabmerger/demo

Playwright recording + Remotion rendering pipeline for the TabMerger walkthrough video.
See `demo-script.ts` for the ordered list of scenes/captions/timings — it's the single
source of truth for both the recording driver (`record.ts`) and the Remotion captions
(`remotion/Composition.tsx`).

## Pipeline

```bash
pnpm --filter @tabmerger/extension build:extension:demo   # demo-mode build
pnpm --filter @tabmerger/demo record:dark                 # or record:light
pnpm --filter @tabmerger/demo render:dark                 # or render:light
```

## Audio

The video is instrumental-only, no voiceover — an optional background music track at
`packages/demo/public/audio/track.mp3` (gitignored; render skips the `<Audio>` element
entirely if the file is absent). There is no narration/TTS step in this pipeline.
