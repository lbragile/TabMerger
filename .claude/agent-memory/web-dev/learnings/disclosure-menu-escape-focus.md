---
name: disclosure-menu-escape-focus
description: MobileNavToggle disclosure pattern — aria-controls only while the conditionally rendered panel exists, Escape scoped to focus inside the menu, focus return on close, and the Enter-presses-the-toggle test trap
metadata:
  type: reference
---

`components/layout/MobileNavToggle.tsx` renders its `<nav>` only while open, so:

- **`aria-controls` only when open** (`aria-controls={open ? id : undefined}`): it must name an
  element that exists. Keeping the panel mounted with `hidden` was rejected because the panel's
  GitHub row calls `use(starsPromise)` and would suspend while closed.
- **Escape** is a `document` keydown listener added only while open, ignored when
  `defaultPrevented` or when focus is on an element outside the menu container (body counts as
  inside). Without that scope, Escape meant for another header layer (a Radix dropdown) would also
  close the panel and pull focus away from that layer.
- **Focus return:** one `close()` sets open false and focuses the toggle ref; every panel link and
  the sign-out button use it, because the focused element unmounts with the panel and focus would
  otherwise drop to `<body>`.
- Don't export a non-component constant (like the panel id) from this `'use client'` module; see
  [[backdrop-pointer-glow]] for why. Tests use the literal id.

**Test trap:** after `user.click(toggle)` the toggle keeps focus, so `user.keyboard('{Enter}')` (or
Space) presses it and closes the panel. Use `{ArrowDown}` or a letter for an "other keys are ignored"
check.

Segmented Monthly/Yearly toggles (PricingTable, PricingTeaser) are `role="group"` with
`aria-label={t('billingPeriod')}` and `aria-pressed` per option; tests find them via
`getByRole('group', { name: 'Billing period' })`.
