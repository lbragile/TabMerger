---
name: plan-change-client-confirmation
description: Which step confirms a plan change on the web (our dialog only for end_of_period, Stripe's page otherwise), the unknown-current-price trap, and how the pricing page shows an already-scheduled change
metadata:
  type: reference
---

Decision (2026-10-26): `usePlanChange` (components/pricing/usePlanChange.tsx) shows its own
"Confirm plan change" dialog only for `end_of_period`, where `/api/billing/switch-plan` schedules
the change on the POST and no Stripe page follows. `portal` and `portal_end_of_period` POST at once:
Stripe's confirm page is the confirmation ("Updates on {date}" for a deferred change). Used by
PricingCard and SwitchAiModeButton (account page + dashboard); they share the hook, so one edit
covers all three entry points. See [[refund-policy-plan-changes]].

Trap: when the current price isn't one this deployment sells (the client's `current.interval` is
undefined), the server's `getPlanForPriceId()` gives `from = null`, so `planChangeTiming()` returns
`end_of_period` and the server schedules it, even for an "upgrade". The hook must pass `from = null`
too, not a stand-in interval: a stand-in classified the change as a portal one and would have sent a
server-scheduled change with no confirmation. The stand-in interval is only for the label.

Pricing page with a change already scheduled (switch routes would answer 409 `already_scheduled`):
- `getCurrentPlan({ withPendingChange: true })` (lib/currentPlan.ts) reuses `getPendingPlanChange()`
  with the user's own profile customer id; opt-in so the home teaser makes no Stripe call; a failed
  read is "none".
- The date is formatted on the server (the page, `formatDate(iso, locale)`, as the account page
  does), not in the client card: client formatting of an SSR'd date can differ by time zone and
  break hydration.
- The target card matches tier + the interval on show + (Pro AI) the option on show; it says
  "Starts {date}" (`data-testid="cta-scheduled"`); every other change button on paid cards becomes a
  note linking to /account (`cta-scheduled-note`). The "Who handles setup" radio stays enabled (a
  view toggle, not a change), so the target option's "Starts" stays reachable.
- PricingCard's root carries `data-tier` for tests (the teaser uses the same attribute).
