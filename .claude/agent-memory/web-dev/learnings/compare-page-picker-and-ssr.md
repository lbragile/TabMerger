---
name: compare-page-picker-and-ssr
description: /compare column picker - Radix Select shows its placeholder (not children) while value is '', breakpoint default without JS via data-chosen="auto" + CSS, a two-branch Tailwind v4 @custom-variant, next-intl rich values can't be elements, and checking marketing copy against the extension's real flow
metadata:
  type: reference
---

Built for `/compare` (`components/compare/CompetitorPicker.tsx`, `ComparisonTable.tsx`).

**Breakpoint-dependent default that works without JS.** The server can't know the width, so the
wrapper renders `data-chosen="auto"` and CSS decides (all columns from `md`, one below). Only an
explicit pick sets a competitor id. `useSyncExternalStore(subscribe, () => matchMedia(q).matches,
() => null)` gives "unknown" on the server and during hydration without a mismatch warning, then
the real value. An option that only makes sense on wide screens ("All tools") is rendered only
when that value is `true`; picking it maps back to `auto`.

**Radix Select with no value yet.** With `value=''` Radix renders the `placeholder`, not
`<SelectValue>` children, so the server HTML (and a no-JS page) had an empty trigger. Pass the
same node as `placeholder` and as children. A breakpoint-dependent label = two spans with
`max-md:hidden` / `md:hidden`; `textContent` then contains both words, so assert on visibility,
not on text. Radix flips the popper above the trigger when there is little room below.

**Hiding columns from a wrapper.** `[&[data-chosen=toby]_[data-col]:not([data-col=toby])]:hidden`
on the wrapper beats any class on the cell (higher specificity). Don't pass such a string through
`cn()`: tailwind-merge may treat arbitrary-variant classes as conflicts; use `className={RULES}`.

**A layout that applies "below md OR in state X"** is one Tailwind v4 custom variant with two
`@slot` branches in `globals.css`:
`@custom-variant compare-stacked { @media (width < 48rem) { @slot; } &:where([data-compare-layout="stacked"] *) { @slot; } }`.
Stacks with others (`md:compare-stacked:max-w-[48rem]`).

**next-intl `t.rich`.** Plain placeholders accept only string/number/Date; a JSX element is a
type error. To wrap a value in markup (a real `<time>`), make it a tag in the message:
`"Checked on <time>{date}</time>"` with `{ date: formatted, time: (c) => <time dateTime=…>{c}</time> }`.
Every locale must keep the tag (the catalog test compares tags).

**`inline-flex` on a sentence** turns its text runs into flex items and drops the space before an
inline element ("Checked on" + `<time>`). Use `inline-block` for a bordered stamp.

**Sticky header/column/footer in a table that can also "stack".** In table layout, put
`sticky top-0` on the header `th` cells and `sticky bottom-0` on the `tfoot` `td`, not on
`thead`/`tfoot` (cell sticky is the widely supported form). Use `border-separate border-spacing-0`:
with `border-collapse` the borders stay behind while the sticky cells move. Once the table is
re-laid out as blocks/grid rows (the stacked view), a sticky cell only sticks inside its own grid
row, so there the `thead` (now a block/flex item of the table) gets the sticky instead. A tinted
sticky cell needs an opaque background; keep the tint with
`bg-background shadow-[inset_0_0_0_100rem_hsl(var(--primary)/0.08)]`. A label inside a
`colSpan` row stays visible during sideways scroll as an `inline-block` with `sticky inset-s-*`.
To move the legend above the rows on phones, make the stacked table `flex flex-col` and give
`tfoot` `max-md:-order-1`. No inner scroll box below md: it traps touch scrolling.
An `overflow: auto` box only clips absolute descendants whose containing block is inside it.
The cells' `sr-only` spans (absolute) escaped a non-positioned box and widened the page by
428px (`window.scrollX` could move even with body `overflow-x: clip`). Add `relative` to the
scroll box; check with `documentElement.scrollWidth` and by trying `scrollTo(500, y)`.

**Scroll arrows over a sticky table** (`CompareScrollBox.tsx`). Measure everything from the DOM
with `getBoundingClientRect` relative to the box's inline-start edge (`rtl ? box.right - el.right
: el.left - box.left`). That one helper handles RTL, where Chrome's `scrollLeft` runs negative:
scroll with `scrollBy({ left: rtl ? -delta : delta })`. "Next column" = the first column header
whose start is past the pinned edge (the end of TabMerger's sticky header cell), delta = start minus
pinned. "Next section" = the first `th[scope=colgroup]` below the sticky header's height. Put the
overlays in a positioned wrapper outside the scroll box, with `z-40`. The box isn't a stacking
context, so they must beat the sticky cells' z-30. Put the section control inside the legend bar
height so it never covers a cell. Render controls only after hydration
(`useSyncExternalStore(() => () => {}, () => true, () => false)`). jsdom has no
`ResizeObserver`, so guard it.

**Copy that describes the extension must match its UI.** The approved mockup said "pick OneTab,
paste"; the extension imports OneTab from a `.txt` file via Settings → Data → Import (the
separate Import/Export modal is not opened from anywhere). Grep `packages/extension/src` (the
handler and `locales/<lng>/settings.json` for the real labels per language) before writing steps.

Related: [[rtl-findby-hangs-on-duplicate-text]], [[rtl-layout-tailwind-v4]], [[i18n-next-intl]].
