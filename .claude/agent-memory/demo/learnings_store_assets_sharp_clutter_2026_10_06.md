---
name: store-assets-sharp-clutter
description: cluttered-chrome raw is a native 1400x155 strip; how to composite it sharply, and what store-assets rewrites besides store images
metadata:
  type: reference
---

- `screenshots/raw/cluttered-chrome.png` is a headed-only OS capture (1400x155, cannot be recaptured headless). `ScreenshotFrame` used to stretch it into the 760x570 popup box (blurry). Now it has a dedicated `ClutteredChromeFrame` (native aspect, 1180px wide, crop below the bookmarks bar at native y=118).
- The marquee's left panel shows the strip at native 1:1 pixels, left-aligned and cropped to the panel width, not downscaled to 0.44x.
- `pnpm demo:store-assets` also rewrites `promo/social-preview.png`, `public/logo.png` and `public/screenshots/raw/*` (all gitignored); `pnpm demo:screenshots` wipes `screenshots/raw` (cluttered-chrome is restored from memory). Back up `promo/` before running if the social preview must stay as it was.
- Default extension dir for these scripts is already `chrome-mv3-demo`; only the beta-screenshots scripts default to the stale `.pw-ext-dev`.
- Raw captures are deterministic: scenes whose UI did not change come out byte-identical, so a hash diff of raw/store shows exactly which scenes changed.
