---
name: learnings-session-view-brackets
description: Session view "window brackets" layout - sticky group header + sticky window tile layering, one offset token, colour-mix theme tokens, edge fades hook, accname spaces, --view-primary for Restore, test/e2e gotchas
metadata:
  type: reference
---

The read-only session view (and the archived view's windows) use "window brackets":
`SessionView` (sticky group headers, `SessionGroup`), `ReadOnlyWindows` (gutter with number tile +
count, rail + foot), `ReadOnlyTabRow`, `FadedScrollArea` + `hooks/useScrollFades`.
`SectionViewHeader` grew optional props (`icon`, `prominent`, `primaryIcon`) instead of a fork;
ClosedDayView passes none of them.

- **Sticky layering:** group header `sticky top-0 z-[3]`, window tile block `sticky z-[2]` with
  `bg-background` (the rail passes behind it), fades `absolute z-[1]` OUTSIDE the scroller. The
  scroller itself must not create a stacking context, or the fades (siblings of the scroller) and
  the sticky headers stop interleaving. A top fade at `top-0` sits under the stuck header and is
  invisible: it starts at `top-[var(--section-group-header)]` instead.
- **One offset token:** `--section-group-header` (globals.css `:root`) sizes the header
  (`h-[var(--section-group-header)]`) and offsets the tiles
  (`top-[calc(var(--section-group-header)+0.5rem)]`). The archived view has no group header:
  `underGroupHeader` false -> `top-2`. A sticky element's range is its parent, so the tile block
  lives in the gutter column (flex stretch = the window's height).
- **Theme-dependent tints from a per-item colour:** set `--item-color` inline, and do the mixing in
  plain CSS classes (`.tm-session-tile`, `.tm-bracket-rail`) with
  `color-mix(in srgb, var(--item-color) var(--pct), hsl(var(--background)))`, the percentages being
  `:root`/`.dark` tokens. Mix with the opaque background (not `transparent`) so a unit test can
  compute exact ratios from the tokens (`__tests__/unit/styles/sessionViewContrast.test.ts`).
  Light theme: the icon is mixed into black (60%) to reach 3:1 for yellow/cyan/green on the tint.
  jsdom keeps custom properties: assert with `style.getPropertyValue('--item-color')`.
- **Number tile text:** `readableTextColor` (better of black/white) always reaches 4.5:1 for any
  colour, so the per-colour test is a guard, not a tuning knob.
- **Light-theme primary button is 3.04:1** (white on `--primary`, shadcn Button default variant):
  axe fails any 12px default Button in the light theme. The view header's primary uses its own
  `--view-primary` / `--view-primary-foreground` tokens (light 193 100% 28%, dark = --primary).
  Not reused from `--tooltip` so a tooltip restyle cannot recolour it.
- **Accessible name of flex rows:** spans in a flex row concatenate without a space in
  dom-accessibility-api ("Docsdocs.test"). A `{' '}` text node between them fixes the name and is
  invisible in a flex container.
- **Window accessible names** `"{{group}}, window {{number}}, {{tabs}}"` (+ `windowLabelNamed`)
  reuse the plural `common.tabCount`, so new strings need no plural families. The visible custom
  window name label is aria-hidden (it is already in the group's name). `customWindowName` ignores
  `DEFAULT_WINDOW_TITLE` ("temp window", what `createWindow` stores).
- **Dot-separated lines that may wrap:** `SeparatedText separator="·"` trims each part into a
  `whitespace-nowrap` span and puts real spaces around the aria-hidden dot, so a wrap never splits
  "20 tabs". The prominent header's meta is `line-clamp-2` (English already overflows one line
  beside Restore + two 2rem buttons).
- **e2e:** Playwright `getByRole('group', { name: 'Session group' })` is a substring match, so it
  also hits "Session group, window 1, 1 tab": use `exact: true`. Sticky checks: compare
  `boundingBox().y` with the scroller's y (header 0, tile header height + 8). With
  `reducedMotion: 'reduce'` the fades' opacity transition is off, so `toHaveCSS('opacity')` is exact.
- **Scratch screenshot spec:** Playwright refuses to load `e2e/extensionPath.ts` (`import.meta`)
  from a scratchpad spec unless the scratch folder has `package.json` `{"type":"module"}`.

Related: [[learnings-section-views-mainview]], [[learnings-recently-closed-hours]], [[learnings-rtl-layout]].
