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

The root `package.json`'s `demo:record`/`demo:render` aliases now run both themes back to back (`record:dark && record:light` / `render:dark && render:light`) — they used to call `record`/`render` scripts that never existed in this package; fixed 2026-09-26.

The recorder launches Chromium **headless by default** (`--headless=new`, `lib/launchDemoContext.ts`) with the unpacked demo build from `packages/extension/.output/chrome-mv3-demo`. It deletes and recreates its profile (`.pw-user-data`) on every run.

**Known headless gap — drag-and-drop steps:** every step whose `action` performs a real drag (`moveTabToNewWindow`, `crossWindowTabDrag`, `multiSelectTabDrag`, `dragTabToSidebarGroup`, `dragTabBetweenGroups`) reliably fails headless — the native `dragstart` the popup's dual pointer/native-HTML5 sensor (`dndHtml5Sensor.ts`) activates on never fires for Playwright's synthetic mouse input under `--headless=new`, so the drag never begins at all (confirmed by instrumenting `moveTabToNewWindow`: `getByText("Drop to create new window")` never appears, in any of 8 relaunch-and-retry attempts). This is a genuine Chromium headless limitation, not a selector or timing bug — the extension's own real-popup e2e DnD spec (`packages/extension/e2e/tests/popup-dnd.spec.ts`) works around the identical constraint by driving the drag over **raw CDP** (`RawCdp.drag`, dispatching `Input.dispatchMouseEvent` directly) instead of Playwright's `page.mouse` API. `actions.ts` has not been ported to that pattern yet. Until it is, set `TM_DEMO_HEADED=1` to record/screenshot with a real visible window — every other (non-drag) step already runs fine headless.

## Outputs

`recordings/`, `out/`, `screenshots/` and `promo/` are all gitignored (`packages/demo/.gitignore`). Nothing copies them into the web app automatically. After a render that should ship on the marketing site, run the user-invoked `/demo-asset-sync` skill. It copies `out/tabmerger-demo-{dark,light}.mp4` to `packages/web/public/videos/`, and only those videos are committed.

## Audio

The video is instrumental only, with no voiceover or TTS step. You can drop a background track at `public/audio/track.mp3`. If that file is absent, the render leaves out the `<Audio>` element. The file is not gitignored (only `public/audio/.gitkeep` is committed), so don't commit a licensed track by accident.

See `PROMO_VIDEO_SPEC.md` for the promo-cut plan.
