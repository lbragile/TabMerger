---
name: pro-ai-option-switch-and-plan-change-confirm
description: Pro AI "Who handles setup" switch on the pricing cards (stacked option panels, radio segmented control, flag-dependent default) and the confirm-before-POST plan-change flow built on the shared planChangeTiming() rule; RTL ignore-option trap
metadata:
  type: reference
---

**Option switch (components/pricing/AiOptionSwitch.tsx, PricingCard `aiOptions`).**
- Segmented control = `<fieldset>` + visible `<legend>` + visually hidden native radios inside
  styled labels. The browser gives arrow keys, focus and the group name for free;
  `getByRole('group', { name: legend })` and `getByRole('radio', { name })` find it in tests.
  Focus ring via `has-[:focus-visible]:ring-2` on the label.
- Radii: theme tokens only (track `rounded-lg`, pill `rounded-md`). `--radius` is 0rem, and
  `--radius-md` is `calc(var(--radius) - 0.125rem)`, a negative and so invalid value, which
  renders as square. A hard-coded `rounded-[…]` is the only thing that shows rounded corners.
- Both options' feature lists and notes sit in one grid cell (`grid` + `[grid-area:1/1]` on
  each), and the hidden one gets `invisible` + `aria-hidden`. The card is as tall as the longer
  option, so the CTA never moves on toggle (see [[equal-height-cards-reserved-line]]).
- Equal-height plan cards: grid `items-stretch` plus card `h-full flex flex-col` plus CTA wrapper
  `mt-auto`. The highlighted card may differ in horizontal padding only. Its old `p-7` put the
  title row and the button 0.25rem off the other cards. Measure in a headless browser with
  `getBoundingClientRect()` (title top, button bottom); jsdom has no layout.
- Which option the card opens on depends on `AI_AVAILABILITY` (module constant). Tests stub
  both env vars, `vi.resetModules()`, and import the component fresh for each flag state.
- Copy for prospective buyers: no per-use dollar estimates and no "N organizes a month" counts.
  Subscribers' dashboard/account pages may show usage numbers.

**RTL `ignore` trap.** `getByText(x, { ignore: '[aria-hidden="true"]' })` skips only elements
that match the selector themselves, not descendants of an aria-hidden container. A line inside
the hidden panel still matches. Check `el.closest('[aria-hidden="true"]')` instead.

**Plan changes (components/pricing/usePlanChange.tsx).** `/api/billing/switch-plan` acts on the
POST itself: it applies own-key upgrades now with a prorated charge and schedules downgrades or
shorter intervals for the end of the period. The client therefore confirms before posting, and
the dialog text must match what the server will do. `lib/planChangeTiming.ts` is the single
pure rule (`end_of_period | portal_end_of_period | now | portal`). `createPlanSwitchSession()`
in lib/stripe.ts branches on it and the hook describes it. `__tests__/planChangeTiming.test.ts`
runs all 36 price pairs against the refund policy, written out independently. When adding a
price or option, extend that table rather than adding a client-side rule.
- If the current interval is unknown and the change keeps the interval, both sides get the same
  stand-in interval, so an option switch is still classified and confirmed (the plan is named
  without "billed …").
- `applied: 'now'` with a URL other than /account is an invoice to pay. Follow it. Otherwise
  show the result in a `role="status"` and call `router.refresh()`.
- Radix focus: the dialog is opened from state, not a `DialogTrigger`, so the hook stores the
  opener and refocuses it in `onCloseAutoFocus` (see [[dashboard-backups-section]]).
- Hook test mocks of `next/navigation` need `refresh` as well as `push`.
