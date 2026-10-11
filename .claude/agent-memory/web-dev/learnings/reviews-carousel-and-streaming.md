---
name: reviews-carousel-and-streaming
description: Transform-driven carousel traps (browser scroll on focus, focus-pause scope, seam width, container-unit card width), accessible-name spacing with sr-only spans, jsdom clock mismatch for rAF tests, and how to verify a Suspense-streamed section (chunk timing, cold path on a dev server, holding the fallback on screen)
metadata:
  type: reference
---

Applies to `components/marketing/ReviewsCarousel.tsx`, `ReviewCard.tsx`, `ReviewsStrip.tsx`, `ReviewsStripSkeleton.tsx` and their shared `reviewsLayout.ts`. Related: [[store-ratings-sources]].

**A carousel moved by `transform` inside an `overflow: hidden` box**
- The box is still scrollable by the browser: focusing a link outside it, `scrollIntoView` and find-in-page all change its `scrollLeft`, which the transform loop knows nothing about. Chrome centres a link that is fully outside, and does not scroll at all for one that is only cut off, so the scroll cannot be relied on either way.
- Pattern: on focus inside the track, compute the card's position from the model (`card.offsetLeft - first.offsetLeft`, the wrapped offset, the viewport's `clientWidth`) and tween the offset until the card is fully in view; in an `onScroll` handler put `scrollLeft` back to 0, and when focus did not cause the scroll add the distance to the offset instead of discarding it. A scroll event is dispatched before the frame's `requestAnimationFrame` callbacks, so nothing flashes.
- Skip the reveal when a pointer is down (focus from pressing a link): moving the card between press and release loses the click.
- Scope the focus pause to the track, not the whole region. A clicked arrow keeps focus, and a region-level focus pause then holds the strip still after the mouse has left.
- The loop length is `cards / 2 × stride`. Half the track's `scrollWidth` is half a gap short of that, which shows as a small jump once per lap.
- Measure the stride from the DOM (`children[1].offsetLeft - children[0].offsetLeft`, again on resize) when the card width is responsive. Server code that sizes the loop cannot measure, so it assumes the narrowest stride.
- Card width that follows the strip: `@container` on the clipping box and `w-[min(20rem,100cqw)]` on the card. `100vw` includes a classic scrollbar, so it overshoots on desktop at high zoom.
- A step's tween progress needs clamping at 0 as well as 1: a frame's timestamp is the frame start, which can precede the click that started the step.

**Accessible names built from visible text**
- `sr-only` is `position: absolute`, so the span is block-level for name computation: Chrome's accessibility tree puts a space on both sides of it ("Store , 28 ratings"). A hidden span that starts with a comma therefore reads with a space before the comma; wording that starts with a word avoids it.
- `toHaveAccessibleName` (dom-accessibility-api) does the opposite and drops the spaces at the edges of nested elements, so it disagrees with every browser. In unit tests compare the element's text with `aria-hidden` subtrees removed, and read the real name in a headless browser through CDP `Accessibility.getPartialAXTree`.

**Unit tests of the animation loop**
- In jsdom the timestamp passed to a `requestAnimationFrame` callback and `performance.now()` do not share an origin. Code that compares the two (a tween start, a "resume at" time) misbehaves only in tests. `vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })` puts both on one clock; advance with `vi.advanceTimersByTime` inside `act`.
- `-parseFloat('0')` is `-0`, and `toBe(0)` fails on it.

**Headless checks of a strip that never stops moving**
- Playwright's `scrollIntoViewIfNeeded` waits for the element to be stable and times out; use `el.scrollIntoView()` through `evaluate`.
- An element screenshot taller than the viewport resizes the viewport while it is taken. Coordinates read right after are stale: take such screenshots last.

**Verifying a Suspense boundary really streams**
- A Node `http.get` that records the arrival time of each chunk shows the fallback inside `<!--$?--><template id="B:0">` in the first chunk and the real content later, in a hidden `<div hidden id="S:0">` followed by `$RC("B:0","S:0")`. Check once with `Accept-Encoding: identity` and once compressed.
- With the fetch cache warm everything arrives in one flush, which proves the structure but not the timing. A request carrying `Cache-Control: no-cache` makes a development server skip its fetch cache, which gives the cold path without clearing anything.
- A browser context with JavaScript disabled never runs the swap script, so the fallback stays on screen: use it for screenshots and to read the fallback's boxes, then compare with the loaded page. A `PerformanceObserver` for `layout-shift`, registered in an init script, catches any movement at the swap.
- In development the browser adds the fallback to the DOM later than the first byte arrives (render-blocking dev assets), so time-to-first-byte is the figure to compare, not time-to-DOM.
- Next 16 refuses a second `next dev` in the same directory ("Another next dev server is already running"). `next build` writes outside `.next/dev`, but a local production build loads `.env.production`.

**A placeholder with the same dimensions as what replaces it**
- Share the box classes through a plain module. A server component importing a value from a `'use client'` module gets a client reference, not the value.
- For text-sized placeholders render the expected text with `color: transparent` on a pulsing background: the bar then wraps exactly where the real label wraps (a fixed-width bar was one line short at 390px).
- `REVIEWS_DELAY_MS` holds the section's data back on a development server only (`devReviewsDelayMs` in `lib/storeRatings.ts`), to look at the placeholder.
