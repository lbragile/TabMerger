---
name: web-carousel-a11y
description: Checklist of recurring a11y traps in the web landing-page reviews marquee (transform-driven carousel, tiles, light-theme cyan)
metadata:
  type: reference
---

- Light theme `--primary` (cyan, hsl 189 100% 40%) is about 2.6:1 on white/off-white, below the 3:1 that non-text indicators need (1.4.11). Rule: do not use it for star glyphs or focus rings; use a darker star token and `ring-foreground` rings. Dark primary is about 9:1. Text tokens `text2`, `text3`, `muted-foreground` all pass 4.5:1 on surface and background in both themes (about 5.4 to 7.3).
- A carousel moved by a JS `transform` inside an `overflow-hidden` box: focusing an off-screen link makes the browser scroll that box (`scrollLeft`), which the transform loop does not know about. Check for a focus handler that resets `scrollLeft` and moves the offset.
- Prev/next buttons that are `hidden sm:flex` leave touch users with only a swipe (2.5.1, 2.5.7) and sit after all the card links in DOM order (2.4.3).
- Auto-moving content needs a visible pause control (2.2.2); hover/focus pause and `prefers-reduced-motion` alone are not enough.
- `aria-label` on a tile link replaces its visible text; keep the visible words in the same order (2.5.3) or use visually hidden spans instead.
- Card width is fixed at 320px inside a `px-6` section: at a 320px viewport the strip is 272px wide and the card's right edge (the link) is clipped.
