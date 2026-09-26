# @tabmerger/demo

Playwright recording and Remotion rendering pipeline for the TabMerger walkthrough and promo videos and the Chrome Web Store listing assets. This is dev tooling and is never shipped.

`demo-script.ts` holds the ordered list of steps, captions and timings. It is the single source of truth for the recording driver (`record.ts`), the screenshot capture (`screenshots.ts`) and the Remotion captions (`remotion/Composition.tsx`). `zoom-origins.json` is committed. `record.ts` measures it and `Composition.tsx` imports it.

## Pipeline

Run from the repo root. Every step uses `pnpm --filter @tabmerger/demo <script>`.

```bash
# 1. Demo-mode extension build (VITE_DEMO_BUILD=true via packages/extension/.env.demo).
#    A regular build dead-code-eliminates Settings > Demo Mode, which the recorder needs.
pnpm --filter @tabmerger/extension build:extension:demo

# 2. Record one .webm per step into public/recordings/<theme>/
pnpm --filter @tabmerger/demo record:dark            # or record:light

# 3. Render into out/
pnpm --filter @tabmerger/demo render:dark            # WalkthroughDemoDark  → out/tabmerger-demo-dark.mp4
pnpm --filter @tabmerger/demo render:light           # WalkthroughDemoLight → out/tabmerger-demo-light.mp4
pnpm --filter @tabmerger/demo render:promo-dark      # also: promo-light, promo-dark-vertical, promo-light-vertical

# Store listing assets
pnpm --filter @tabmerger/demo screenshots            # raw 800×600 PNGs → screenshots/raw/
pnpm --filter @tabmerger/demo store-assets           # 1280×800 screenshots → screenshots/store/, promo tiles → promo/

# Preview compositions interactively
pnpm --filter @tabmerger/demo studio
```

The root `package.json` aliases `demo:screenshots` and `demo:store-assets` work. `demo:record` and `demo:render` do **not**: they call `record` and `render` scripts that don't exist in this package. Use the `record:<theme>` / `render:<theme>` scripts above.

The recorder launches Chromium **headed** (`headless: false` in `lib/launchDemoContext.ts`) with the unpacked demo build from `packages/extension/.output/chrome-mv3-demo`. It deletes and recreates its profile (`.pw-user-data`) on every run.

## Outputs

`recordings/`, `out/`, `screenshots/` and `promo/` are all gitignored (`packages/demo/.gitignore`). Nothing copies them into the web app automatically. After a render that should ship on the marketing site, run the user-invoked `/demo-asset-sync` skill. It copies `out/tabmerger-demo-{dark,light}.mp4` to `packages/web/public/videos/`, and only those videos are committed.

## Audio

The video is instrumental only, with no voiceover or TTS step. You can drop a background track at `public/audio/track.mp3`. If that file is absent, the render leaves out the `<Audio>` element. The file is not gitignored (only `public/audio/.gitkeep` is committed), so don't commit a licensed track by accident.

See `PROMO_VIDEO_SPEC.md` for the promo-cut plan.
