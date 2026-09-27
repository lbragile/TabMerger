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

**Drag-and-drop steps now work headless too (fixed 2026-09-26).** They used to fail 100% of the time under `--headless=new` — Playwright's `page.mouse.move/down/up` never activated the popup's native `dragstart` in that Chrome mode, even though it dispatches the same underlying CDP `Input.dispatchMouseEvent` call. `lib/actions.ts` now drives every drag (`moveTabToNewWindow`, `crossWindowTabDrag`, `multiSelectTabDrag`, `dragTabToSidebarGroup`, `dragTabBetweenGroups`) through a raw `CDPSession` (`getCdpMouse`/`CdpMouse` in `actions.ts`) instead — the same fix the extension's own real-popup e2e DnD spec (`packages/extension/e2e/rawCdp.ts`'s `RawCdp.drag`) uses, for a different underlying reason. Verified: both themes now record and re-render fully headless with zero relaunch/retry crashes. `TM_DEMO_HEADED=1` still exists as an opt-in for visual debugging, but is no longer required for a normal run.

**Still headed by necessity — `captureClutteredChrome()` in `screenshots.ts`.** This one capture (the promo marquee's "chaos" panel) uses an OS-level `PrintWindow` screen capture to show the real native Chrome tab strip/bookmarks bar (`page.screenshot()`/CDP cannot see native browser chrome at all, headless or not). It launches its own bare, extension-free Chrome window with `headless: false` — unrelated to the DnD fix above, and not portable to headless since there is no real window to `PrintWindow` in that mode. This is the one legitimate exception to "headless by default" in this package.

## Outputs

`recordings/`, `out/`, `screenshots/` and `promo/` are all gitignored (`packages/demo/.gitignore`). Nothing copies them into the web app automatically. After a render that should ship on the marketing site, run the user-invoked `/demo-asset-sync` skill. It copies `out/tabmerger-demo-{dark,light}.mp4` to `packages/web/public/videos/`, and only those videos are committed.

## Audio

The video is instrumental only, with no voiceover or TTS step. You can drop a background track at `public/audio/track.mp3`. If that file is absent, the render leaves out the `<Audio>` element. The file is not gitignored (only `public/audio/.gitkeep` is committed), so don't commit a licensed track by accident.

See `PROMO_VIDEO_SPEC.md` for the promo-cut plan.
