---
name: buy-button-visibility-review-method
description: Auditing a change to when a purchase CTA (credit pack, plan switch) shows: which server gate takes the money vs which gates the use, and what the old condition really covered
metadata:
  type: reference
---

When a diff widens or narrows when a purchase button shows, check three things:

1. **Which route takes the money, and what it refuses.** The credit-pack checkout and the AI routes
   gate different things: the AI routes (`hasProAi()` in lib/ai-usage.ts: tier `pro_ai` plus an
   entitled status) decide who can *spend* credits; the pack checkout decides who can *buy*. A UI
   change only "widens nothing" if the buying route enforces the same rule. If it doesn't, the
   risk is selling something unusable (refund requests), not an entitlement bypass.
2. **What the old condition effectively covered.** `getEffectiveCap()` counts the monthly
   allowance only for an entitled managed `pro_ai` row, so a non-entitled `pro_ai` row (e.g.
   status `incomplete`, a stored status that keeps its tier) shows 0 credits left. An old
   "show at 0 left" rule therefore already showed the button to those rows; the widening is
   smaller than it looks.
3. **Pages that compute the same flag differently.** The account page derives paid-ness with
   `hasCloudSync()`; the dashboard keys AI cards on `tier === 'pro_ai'` alone. Rows written as
   `canceled` always get tier `free` (`toStoredState()` in lib/subscriptionSync.ts), so the only
   tier-without-entitlement rows are `incomplete` (and any legacy rows).

For a dialog removed from a plan change: the server's timing comes from `planChangeTiming()` on the
Stripe price the subscription is actually on (`createPlanSwitchSession()`), never from the client,
so a client confirm is UX only. Check the reverse direction still has a confirmation (an upgrade
goes to Stripe's own confirm page).

Related: [[pre-checkout-stripe-guard-review-method]], [[mocked-gate-return-values]]
