---
name: mobile-horizontal-overflow
description: Stopping sideways panning on phones - overflow-x clip vs hidden with the sticky navbar, fixed left+right elements that look like the culprit, Tailwind v4 grid-cols-N = minmax(0,1fr), and probing past the clip safety net
metadata:
  type: reference
---

The web app must stay exactly viewport-wide at every width from 320px up, in every locale. Real
offenders only show up at 320px in locales with long words (German, Russian, Korean URLs, `en-XA`).

**`overflow-x: clip` on `body` only; `html` stays `visible`** (safety net in `app/globals.css`).
While `html` is visible, body's overflow propagates to the viewport (`clip` lands there as
`hidden`), which blocks sideways panning exactly as if it were set on `html`. Any overflow on
`html`, even `clip`, stops that propagation. Then Radix's scroll lock (react-remove-scroll, used by
dropdowns, dialogs and the account menu) sets `body { overflow: hidden }`, body becomes its own
scroll container, and the navbar's `sticky top-0` sticks to body. Opening the language picker
at scrollY 1500 put the header at top -1500 and the menu at -1446, both off screen; with
body-only clip they sit at 0 and 54. On body, use `clip` rather than `hidden`, because `hidden`
would always make body a scroll container. The reviews carousel's own `overflow: hidden` viewport
and its touch drag (`touch-pan-y` + pointer events) still work under it.

**Misleading symptom: a fixed `left-0 right-0` element shows up as the offender.** When something
else makes the page wider than the screen, the layout viewport grows to that width, and a fixed
element anchored to both edges (the cookie consent banner) stretches with it. Overflow probes then
list the banner as poking past the screen edge. It's a symptom, not the cause: look for the element
that actually overflows (a long single word in a heading, a `whitespace-nowrap` button label or
`<code>`, a bare URL link).

**Tailwind v4 `grid-cols-N` is `repeat(N, minmax(0, 1fr))`.** Columns never grow to fit their
content (about 120px each for the footer's `grid-cols-2 gap-8` at 320px), so an unbreakable word
spills out of its column into the page instead of widening the column. Fix with wrapping or
hyphenation, not wider columns.

**Root-cause fixes used:**
- `body { overflow-wrap: break-word }` breaks only words that can't fit, so English layouts and
  visual baselines don't change. Unlike `anywhere`, it doesn't change min-content sizing.
- `:root:not(:lang(en)) :where(h1, h2, h3) { hyphens: auto }`: German compounds break as
  "Änderungs-protokoll". English is left out because Blink would add hyphens where wrapping at
  spaces already works. `:lang(en)` also matches the `en-XA` pseudo-locale.
- `size="lg"` CTA buttons inherit `whitespace-nowrap` from `components/ui/button.tsx`. A translated
  label needs `h-auto min-h-11 max-w-full whitespace-normal py-2 text-center` (as in Hero, FinalCta
  and the features page) so it wraps and stays 44px tall while it fits. PricingCard's full-width
  buttons use `CTA_CLASS` (`min-h-10`).
- Never wrap a too-wide table or row in `overflow-x-auto`: an inner horizontal scroller is the same
  sideways movement. Let it wrap instead (e.g. drop `whitespace-nowrap` from the Stripe test card
  numbers so the 4-digit groups wrap at their spaces).

**Probing:** `document.documentElement.scrollWidth` reads as the viewport width once the clip safety
net is on, so an overflow probe has to inject
`html,body{overflow-x:visible!important}` after each `goto` to see real offenders. Check that the
override works by appending a 400px div and confirming scrollWidth reports 400. Expand every
collapsible (`details`, `aria-expanded="false"` buttons in `main`) before measuring, because the
beta page's test area only overflowed once expanded.

Related: [[navbar-streamed-data-and-width-budget]], [[reviews-carousel-and-streaming]], [[rtl-layout-tailwind-v4]].
