---
name: social-preview-still
description: SocialPreview 1280x640 still lives as a third PromoTile variant and renders via the store-assets script; layout and size notes
metadata:
  type: reference
---

`SocialPreview` (1280x640, 2:1 for the GitHub repo social preview and og:image) is the `"social"` variant of `PromoTile.tsx`, registered in `Root.tsx`, and rendered by `render-store-assets.ts` to `promo/social-preview.png` (about 96 KB; the script falls back to `.jpg` if the PNG reaches 1 MB).

- It reuses the marquee's `ORGANIZED_SCREENSHOT_ID` (dark popup), so no new capture is needed; `pnpm store-assets` regenerates it with the other promo stills.
- Layout: the 4:3 popup at 680px wide is about 510px tall, which keeps all content clear of the top/bottom 5% crop zone (1.91:1 crops). The left column is about 28rem wide, so the tagline wraps to 3 lines at 4.25rem; the subline (no version or "beta", since the image is long-lived) wraps to 2 lines, with `encrypted&nbsp;sync` kept together so "sync" never sits alone.
- `pnpm store-assets` wipes and rewrites `screenshots/store/` and all promo stills as a side effect, so it is not a cheap single-still render.
