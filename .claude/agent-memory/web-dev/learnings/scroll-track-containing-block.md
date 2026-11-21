---
name: scroll-track-containing-block
description: An overflow-x:auto scroller doesn't clip absolute descendants whose containing block is outside it; sr-only spans in off-screen carousel slides widened RTL pages by 9px; fix with `relative` on the track; how to find it by bisecting
metadata:
  type: reference
---

A scroll container (`overflow-x: auto`) only clips descendants it contains *as a containing block*.
An `absolute` element (even a 1px `sr-only` span) whose nearest positioned ancestor is outside the
scroller is laid out at its static position inside the off-screen slide but is not clipped. It then
adds to the document's scrollable overflow.

Seen in `components/blog/Carousel.tsx`: the `<section className="relative">` was the containing
block. In RTL the off-screen slides sit to the left, so two sr-only labels at x≈−9 gave
he/ar/fa posts a 9px horizontal scroll at 390px. LTR looked fine because the right-hand overflow fell
inside the track's own scroll area. Fix: add `relative` to the track itself (never `overflow-x: hidden`
on body). The e2e asserts `scrollWidth <= clientWidth` for he, ar and fa at 390.

**Finding the culprit when "elements past the edge" lists nothing.** Filtering out elements under a
clipping ancestor hides exactly this case. Bisect instead: starting at `body`, set each child to
`display: none` in turn, re-measure `scrollWidth - clientWidth`, and descend into the child that zeroes
it. Then list `position: absolute|fixed` descendants of the scroller whose `offsetParent` is outside
it.

Related: an arrow-geometry e2e read 109px off because the arrow layer is positioned by a
ResizeObserver one frame after the image lays out. Waiting for `img.decode()` and then
`expect.poll` on the offset fixes the test without loosening the tolerance.
