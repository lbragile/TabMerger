---
name: sonner-pseudo-elements
description: sonner's injected CSS owns ::after (hover gap filler) and ::before (swipe/remove hit areas) on toasts; custom pseudo-element styling must out-specify it
metadata:
  type: reference
---

Sonner (2.x) styles both pseudo-elements of `[data-sonner-toast]` in its runtime-injected sheet:
- `::after` with `[data-expanded='true']`: invisible hover gap filler (`bottom:100%; height: calc(var(--gap) + 1px)`) so the stack stays expanded while the pointer crosses the gap between toasts.
- `::before` with `[data-swiping='true']` and with `[data-swiping='false'][data-removed='true']`: swipe/removal hit areas.

The injected sheet comes after ours, so a rule of equal specificity loses in those states. The countdown bar in `globals.css` is on `::after`, so its rules are scoped under `[data-sonner-toaster]` with full geometry pinned (top/bottom/left/right/width/height), and the gap filler is re-created on `::before` only for `[data-swiping='false'][data-removed='false']`.

`data-swiping`, `data-removed`, `data-expanded`, `data-front` render as the strings "true"/"false".

Testing: `getComputedStyle(el, '::after').bottom` in e2e; when measuring toast boxes after hover, poll until the gap is > 0 because sonner animates the stack open (~400ms). Removing the `::before` filler makes a pointer move into the 14px gap collapse the stack (`data-expanded` → "false"), which the toasts e2e spec checks.
