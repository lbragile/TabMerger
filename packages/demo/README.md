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

## Feature tour (drawn browser windows)

A separate 1920x1080/30fps tour of roughly 60-90s that shows browser windows next to TabMerger's popup. Playwright's `recordVideo` cannot capture a browser's own frame and tab strip, so the windows are **drawn in Remotion** (`remotion/tour/BrowserWindow.tsx`: tab strip, toolbar with address bar, page screenshot; props for theme, tab list, per-tab presence and window appear progress so scenes can animate tabs and windows). No real browser window is recorded. The existing compositions, scripts and clips are untouched.

- **One scene per component** in `remotion/tour/scenes/`, listed in `remotion/tour/registry.ts` (id, duration, component). `remotion/tour/TourVideo.tsx` assembles the full tour from the registry with the same hand-rolled cross-fade as `WalkthroughDemo`. Scenes 1 ("the-mess"), 2 ("open-tabmerger") and 3 ("drag-to-new-group") are built; later scenes are added by appending a registry entry.
- **Compositions** (`remotion/Root.tsx`): `TourDark` / `TourLight` (full tour) plus `TourScene-<id>-dark|light` for every registry scene.
- **Shared tab data**: `lib/chaosWindows.ts` holds the three windows' URL lists (moved out of `lib/actions.ts`; `chaosHook` imports them, so the real browser windows and the drawn ones can't drift). The real page titles, host and local favicon/screenshot paths for each tab are in `lib/chaosTabs.json`, written by `capture-tour-assets.ts`, which visits every URL headless. Images land in `public/tour/` (gitignored: third-party page content), so on a fresh checkout run the capture once; the render itself needs no network.

```bash
pnpm --filter @tabmerger/demo tour-assets                         # capture titles, favicons, page screenshots (needs network once)
pnpm --filter @tabmerger/demo render:tour-scene the-mess          # one scene -> out/tour/scene-01-the-mess-dark.mp4
pnpm --filter @tabmerger/demo render:tour-scene 1 light           # by number, light theme
pnpm --filter @tabmerger/demo render:tour-scene the-mess --frame=60   # a single still -> out/tour/scene-01-the-mess-dark-f060.png
pnpm --filter @tabmerger/demo render:tour-dark                    # full tour -> out/tour/tabmerger-tour-dark.mp4 (also render:tour-light)
```

- **Scene 2 uses its own popup footage**, not `open-popup`/`chaos-hook`: those shared clips predate the current chaos data (a 4th seed window, 18 tabs, older titles). `record-tour.ts` (`pnpm --filter @tabmerger/demo record:tour [dark|light]`, headless, run once per theme after `build:extension:demo`) opens the same `CHAOS_WINDOW_URLS` windows, clears the setup window, and records `public/tour/recordings/<theme>/tour-open-popup.webm` (800x600, shown 1:1). It never touches `public/recordings/`. It also writes `lib/tourPopupLayout.json` (the three card rects inside the clip and where the settled list starts) and the popup's real tab titles into `lib/chaosTabs.json`, because the popup is the source of truth for what the drawn windows show. Re-run it if the popup layout or the tab list changes.
- **Scene 3 ("drag-to-new-group")** is real, sharp footage recorded by `record-tour-window.ts` (`pnpm --filter @tabmerger/demo record:tour-window [dark|light]`, headless; shared helpers in `lib/tourCapture.ts`). Playwright's `recordVideo` can only record the raw 800x600 viewport, so this grabs 1600x1200 JPEGs via CDP `Page.captureScreenshot` (`clip.scale = 2`), resamples them to 30fps and writes `public/tour/frames/<theme>/window/f-NNNN.jpg` plus `lib/tourWindowFootage.json` (frame counts, event frames, measured timings). The scene pushes in to 1.5x, so it stays crisp. The flow is all real: the first Now Open window card is dragged by its grip onto "Drop for a new group" (`dragWindowToNewGroup` in `lib/actions.ts`), the new "temp group" is renamed "Q4 Launch" (`renameGroup` with `setPace({ renameGroup })`) and coloured pink (`colorNewGroup`), and the popup stays open. Per `docs/drag-and-drop-spec.md` a drop out of Now Open closes every dragged tab at once except the active tab of the window the TabMerger page lives in. So the recorder first moves the popup page into the third real window (where scene 2 opened TabMerger from) and makes the real active tabs match the drawn ones (GitHub, React, Dribbble); the first window then closes completely a fraction of a second after the release. The recorder proves that from the browser (`chrome.windows.get` polling, stored as `windowClosed` and `closeAfterReleaseMs`), and the scene closes drawn window 1 at that measured frame and shows a "Saved and closed" tag where it was. Scene 2's clip is a plain 800x600 video and would benefit from the same capture method.
- **Open windows per scene** live in `remotion/tour/openWindows.ts` (which drawn windows are open when each scene ends); scenes read `openWindowsBefore/After(sceneId)` so a closed window cannot reappear by accident. Scene 8 (restore) flips the entry back.
- **Timed captions**: a scene's registry `caption` is a string or a list of `{from, text}` cues (scene-local frames); the tour layer draws them and blanks the text for 6 frames around each change.
- Captions are drawn once at the tour level (`TourVideo.tsx`, text from the registry's `caption`), blank for a few frames around each cut so two captions never overlap; scenes draw no caption themselves. Every drawn window carries the pinned TabMerger toolbar icon in every scene, so it never pops in during a cross-fade.
- The window-to-card link in scene 2 is colour + number + connector line per pair (`PAIR_COLORS`, `POPUP` and `SETTLED` in `Scene02OpenTabMerger.tsx`; card positions from `lib/tourPopup.ts`).

One tab (Super User) has no usable headless page capture (bot-wall HTML), so it shows a blank page with its favicon and is never the active tab in a scene. The third window's LinkedIn and X tabs were swapped for Dribbble and Flickr (2026-10-08) because the extension recorder got a Cloudflare wall and an empty title for them; see the comment in `lib/chaosWindows.ts`.

## Outputs

`recordings/`, `out/`, `screenshots/` and `promo/` are all gitignored (`packages/demo/.gitignore`). Nothing copies them into the web app automatically. After a render that should ship on the marketing site, run the user-invoked `/demo-asset-sync` skill. It copies `out/tabmerger-demo-{dark,light}.mp4` to `packages/web/public/videos/`, and only those videos are committed.

## Audio

The video is instrumental only, with no voiceover or TTS step. You can drop a background track at `public/audio/track.mp3`. If that file is absent, the render leaves out the `<Audio>` element. The file is not gitignored (only `public/audio/.gitkeep` is committed), so don't commit a licensed track by accident.

See `PROMO_VIDEO_SPEC.md` for the promo-cut plan.
