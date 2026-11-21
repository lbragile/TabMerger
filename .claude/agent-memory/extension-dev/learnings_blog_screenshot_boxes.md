---
name: blog-screenshot-boxes
description: Measuring annotation boxes from the live DOM for blog screenshots (scripts/blog-screenshots) — Edge web components hide roles, Radix menus aria-hide the popup, Chrome radio boxes are only the disc
metadata:
  type: reference
---

Blog screenshot boxes (`scripts/blog-screenshots/`, README "How boxes.json is made") are measured
at capture time with `locator.boundingBox()` and mapped through the convert crop/scale. Gotchas
found while making the locators:

- **Edge internal pages (`edge://favorites`, `edge://settings`) are Fluent web components** whose
  roles live in ElementInternals. `getByRole` and `ariaSnapshot()` don't see them (no radios, no
  treeitems; the folder shows as an unnamed `group`). Use the component tag filtered by the
  visible name: `fluent-tree-item` (innermost, `hasNot` a nested tree item) and
  `settings-radio-row ... div.box`. `edge://history`'s sidebar does expose `treeitem`.
- **Chrome `cr-radio-button`**: the element with `role=radio` is only the 16px disc; union it with
  `getByText(label, { exact: true })` to box the whole option. CSS/text locators pierce the shadow
  DOM; XPath (`xpath=..`) does not.
- **An open Radix DropdownMenu sets `aria-hidden` on the rest of the popup**, so `getByRole` finds
  nothing behind it (sidebar rows, the menu trigger) unless `includeHidden: true`.
- **Full-width sidebar rows start at x=0**: a padded box around the layout box is clipped by the
  image edge. Measure what the row draws instead (text ranges, svg/img, painted leaf elements;
  the root's own highlight excluded) — `fit: 'content'` in `boxes.mjs`.
- A union box around a column of differently sized tags cuts through the shorter rows' text;
  one box per tag reads better.
- `recordBoxes` throws on a match count of 0 or an unexpected >1, so a renamed control fails the
  run instead of boxing the wrong thing; `BLOG_ARIA_DUMP=1` on `native.mjs` dumps each page's
  accessibility tree for finding new locators.
- Running a Playwright persistent context in a function that throws leaves the browser open and
  the node process hanging: close the context in `finally`.

Related: [[visual-regression-determinism]] (frozen-clock captures), [[keyboard-move-list-mode]]
(full-size popup screenshot trick).
