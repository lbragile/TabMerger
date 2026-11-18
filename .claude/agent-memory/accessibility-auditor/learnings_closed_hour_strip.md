---
name: closed-hour-strip-a11y
description: Contrast math and checks for colour-filled chart bars from AUTO_ITEM_COLORS; dimming by opacity, forced-colors, aria-hidden li markers
metadata:
  type: reference
---

- Bars filled with AUTO_ITEM_COLORS on the light theme background (white): orange, yellow, green, cyan, teal are below 3:1 (about 2.8, 1.9, 2.3, 2.4, 2.5); red, blue, indigo, purple, pink pass. Any day-colour fill used as a control needs a neutral 1px border (e.g. muted-foreground), not just the fill.
- Dimming a control with `opacity-40` drops every palette colour under 3:1 in both themes (about 1.5 light, 1.7-2.5 dark). The dimmed items are still operable, so the 1.4.11 inactive exemption does not apply. Dim the fill only and keep a non-dimmed border.
- A span that is only a `background-color` vanishes in Windows forced-colors mode; add a border or `forced-color-adjust: none`.
- `<li aria-hidden>` inside a `<ul>` is fine in Chromium/Firefox: it leaves the accessibility tree, so the "list of N" count excludes it. role="none" would not hide its text.
- A roving-tabindex group of aria-pressed buttons is valid (radiogroup is wrong when deselect is allowed); `role="toolbar"` is the better fit because it makes screen readers switch to forms mode so arrow keys reach the app.
