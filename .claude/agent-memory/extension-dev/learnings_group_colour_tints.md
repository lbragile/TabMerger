---
name: learnings-group-colour-tints
description: Tinting UI with a group's colour — the one withAlpha helper in lib/color.ts, inline style over static fallback classes, full-bleed band inside a padded card, and why computed style and position need e2e assertions
metadata:
  type: reference
---

Translucent variants of a group colour come from `withAlpha(color, alpha)` in `src/lib/color.ts` (used by the tab "renamed" pill and the window card's incognito strip). Group colours are stored as `rgba(R, G, B, 1)`, so it swaps the alpha and returns a plain `rgba(...)` string, which jsdom keeps on `element.style` and unit tests can assert on. Any other CSS colour falls back to `color-mix(in srgb, <color> N%, transparent)`.

Pattern for "follow the group colour, else keep the theme look": leave the static Tailwind classes (`bg-primary/10` on the band, `text-primary` on the icon) on the element as the fallback and add an inline `style` only when a colour is passed. Inline beats the classes, no class toggling is needed for the coloured parts, and nothing depends on drag state (see the native-drag notes).

Testing: jsdom only sees the inline declarations, not that they win over the classes. Assert the real result with Playwright `toHaveCSS` on `background-color` / `color` (the alpha survives in the computed value, e.g. `rgba(239, 68, 68, 0.1)`), seeding two groups with different colours.

Full-bleed band inside a padded card (the incognito strip): cancel the card's `p-1` on the band only with `-mx-1 -mt-1` instead of touching the card's padding, then restore the content inset with `px-2.5` (card `p-1` + header `px-1.5`) so the icon lines up with the header's grip. Negative margins only eat the padding, so the band stays inside the card's border, including the starred card's `border-l-2`. Class names prove nothing about position in jsdom: the e2e test compares the band's `getBoundingClientRect()` with the card's rect minus its computed border widths (within 1px), for a plain and a starred card.

Contrast maths for a window card: `cn()` is tailwind-merge, so an incognito card's `bg-muted/30` replaces `bg-card` rather than layering on it. Composite tint over `muted` at 30% over `background` when computing ratios.

Playwright's file filter is a substring match: `windows.spec` also runs `removeAllWindows.spec.ts`.
