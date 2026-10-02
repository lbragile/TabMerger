---
name: learnings-promo-tile-real-browser-capture
description: Diagonal small-tile split and how to capture real native Chrome UI (tab strip, bookmarks bar) for promo assets, since Playwright's page.screenshot() cannot render it
metadata:
  type: project
---

Two 2026-08-13 corrections to PromoTile.tsx from review, both worth remembering for future promo-asset work:

**1. `page.screenshot()`/CDP cannot capture native browser chrome at all.** Tabs strip, bookmarks bar, address bar — none of it is in the page's own render tree, so no Playwright API (not `page.screenshot()`, not `Page.captureScreenshot` over CDP) will ever include it. If a task explicitly asks for "a real Chrome window screenshot" (tabs/bookmarks visible), the only way is an OS-level screen capture cropped to the window bounds:
- Launch a bare `chromium.launchPersistentContext` (no extension needed) with `headless: false`, sized via `--window-size=W,H --window-position=X,Y`.
- Get the real window rect via CDP: `context.newCDPSession(page)` → `Browser.getWindowForTarget` → `Browser.setWindowBounds`/`getWindowBounds`.
- Capture the whole screen and crop to those bounds. On Windows there's no existing infra for this in the repo — I wrote it as a one-off PowerShell script (`Add-Type -AssemblyName System.Drawing` + `Graphics.CopyFromScreen`) invoked via `execFileSync`, cropped with a `System.Drawing.Rectangle` matching the CDP bounds. See `captureClutteredChrome()` in `packages/demo/screenshots.ts`.
- Known artifact: the left edge of the crop sometimes shows a sliver of whatever's behind/left of the window (a few px of bleed-through, likely a bounds/DPI rounding gap between CDP's reported rect and the actual OS window frame). Cosmetically minor and gets cropped out by `objectFit: cover` in the panel that displays it, but don't rely on this capture being pixel-exact at the very edges.
- To seed a "cluttered" real profile (many tabs, packed bookmarks bar) without any UI automation: write Chrome's `Default/Bookmarks` JSON directly (`{version:1, roots:{bookmark_bar:{children:[...]}, other:{...}, synced:{...}}}`) and `Default/Preferences` with `{"bookmark_bar":{"show_on_all_tabs":true}}` into a fresh `userDataDir` before `launchPersistentContext`. No checksum needed for Chrome to load it for a one-off capture.

**2. "Split it diagonally" means a `clip-path` triangle, not a rotated straight divider.** For a same-image-twice diagonal split: full-bleed base layer (theme A), then an absolutely-positioned overlay of theme B with `clipPath: "polygon(0 0, 100% 0, 0 100%)"` (top-right/bottom-left triangle), plus an SVG `<line>` drawn along the identical `(W,0)`→`(0,H)` coordinates (matching the tile's own pixel dimensions in the `viewBox`, with `preserveAspectRatio="none"` and `vectorEffect="non-scaling-stroke"`) so the visible seam lines up exactly with the clip edge.

**3. Decision: no illustrated/CSS-drawn stand-ins for "real" screenshots, and no compositing/overlaying two images on top of each other when "side by side" is asked for.** Take "actual" / "real" screenshot requests literally (go capture it, don't fake it), and keep multi-source layouts as clearly separated panels, never stacked.

See also [[learnings_store_assets_captions_2026_08_12]] for the surrounding raw-screenshot pipeline (`screenshots.ts` → `screenshots/raw/` → `render-store-assets.ts` mirrors into `public/screenshots/raw/` for `staticFile()`).
