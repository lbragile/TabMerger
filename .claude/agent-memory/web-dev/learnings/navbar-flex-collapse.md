---
name: flex-img-collapse-mobile
description: next/image inside nested flex containers can collapse to 0x0 at narrow viewports unless pinned with shrink-0
metadata:
  type: project
---

`components/layout/Navbar.tsx`'s logo `<Image>` collapsed to 0x0 width/height specifically at mobile
viewports (confirmed via Playwright boundingBox: 26x26 at 1280px, 0x0 at 375px), making the whole
brand mark disappear on mobile while text-based siblings (buttons, hamburger) survived.

**Why:** next/image renders `max-width:100%` on the `<img>`. When it sits inside several layers of
nested `flex` divs with no `min-width`/`shrink` protection (`header > .container > wrapper > Link`),
and the header runs out of horizontal room at narrow widths, the flex-shrink algorithm can resolve the
img's percentage-based width against an unresolved auto container width, collapsing it to 0. Sibling
elements with min-content text (buttons, hamburger label) are naturally protected from this because
they have intrinsic min-content size; the img has none because its size comes from a CSS percentage,
not intrinsic replaced-element sizing in this shrink scenario.

**How to apply:** Any `next/image` (or other percentage/max-width-sized element) placed inside a flex
row that also contains other flexible/growing siblings needs an explicit `shrink-0` on it or its
immediate wrapper — don't rely on width/height props alone to protect it from disappearing under flex
pressure at small viewports. Always verify logo/icon elements specifically at ~375px with a real
boundingBox check (visual screenshots alone can miss a 0x0 collapsed element rendering as blank space
that's easy to misattribute to something else).

The signed-in app header (`app/(app)/layout.tsx`) had the opposite phone problem, overflowing
instead of collapsing; its fix and the scrollWidth check live in design-system's
learnings_app_header_mobile.md.
