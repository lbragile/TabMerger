---
name: equal-height-cards-reserved-line
description: Keeping a row of cards the same height across a toggle and when stacked - reserved hidden line, auto-rows-fr, and how to test and measure it
metadata:
  type: reference
---

Pattern used by the landing page's pricing teaser (`components/marketing/PricingTeaser.tsx`), where one line only shows in one toggle state.

- **Reserve the line with the real text, not a fixed height.** The line stays in the DOM in both states; in the state where it should not show it gets `invisible` plus `aria-hidden="true"`. A `min-h` for one line is not enough: at the narrow three-column widths (640 to about 760px) the line wraps to two, and a one-line reservation would make the row grow on toggle. The hidden copy wraps exactly like the visible one.
- **`auto-rows-fr` on the grid equalises stacked cards.** Side by side, the single grid row already stretches the cards. Stacked (`grid-cols-1`), each card is its own row, so any text that wraps makes that card taller; `auto-rows-fr` makes every row as tall as the tallest.
- **Wrapping is per string, not per width.** Two strings of the same length can wrap differently in a proportional font ("$7.17" is narrower than "$3.58"), so measure every card, at 320 and 375px as well as desktop.
- **RTL:** `getByText` does not skip `aria-hidden` nodes. Pass `{ ignore: '[aria-hidden="true"]' }` to query what is actually exposed, and assert the hidden copies separately (attribute plus class), since jsdom loads no Tailwind CSS and `toBeVisible()` would pass on an `invisible` element.
- **Measuring in a headless browser:** a Playwright locator for the card price needs a substring match (`locator('p', { hasText })`), because the price shares its `<p>` with the "/mo" span and `getByText(..., { exact: true })` never matches. An element screenshot taller than the viewport stitches the sticky navbar into the middle; resize the viewport to fit the section, scroll it below the navbar and use `page.screenshot({ clip })`.
- The yearly sub-line wording and the toggle's discount percent come from `yearlySubtext`, `YEARLY_SAVINGS` and `YEARLY_DISCOUNT_PERCENT` in `lib/tiers.ts`; both plan listings import them, so a new listing should too.
