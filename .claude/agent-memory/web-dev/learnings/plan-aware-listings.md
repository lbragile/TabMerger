---
name: plan-aware-listings
description: How plan listings (pricing page, home teaser) learn the visitor's plan - getCurrentPlan + planCardStatus, read in the browser via GET /api/plan, and why switch-route check order decides which error copy users see
metadata:
  type: reference
---

**One lookup, one rule.** `lib/currentPlan.ts` `getCurrentPlan()` is the server read of the
visitor's plan (paid tier only while `hasCloudSync` says the status is entitled, else `free`;
`signedIn` separates guests from free accounts). `components/pricing/planStatus.ts`
`planCardStatus()` is the Current / below-current / Recommended rule; PricingCard and
PricingTeaser both call it. Don't re-derive tier ranks in a component.

**The plan is read in the browser.** The pricing page and the home teaser read no session on the
server (so the proxy skips the Supabase refresh for `/` and `/pricing`): `useVisitorPlan`
(`components/pricing/useVisitorPlan.ts`) returns `undefined` while loading, the guest plan at once
without a session cookie, else what `GET /api/plan[?pendingChange=1]` (`getCurrentPlan` on the
server) answers. `PricingTableForVisitor` shows busy same-size CTA skeletons on the paid cards
meanwhile (badges as for a guest); the teaser keeps its guest view until a paid plan arrives (the
badge is absolutely positioned: no layout shift). See [[proxy-session-and-client-plan]].
- Pass the teaser `currentTier` only for a paid plan: with `'free'` the Free card would gain a
  "Current" badge for guests and free accounts.
- RTL: mock `@/components/pricing/useVisitorPlan` with a hoisted value to test a listing; to test
  the hook itself, mock `@/lib/supabase/client` (`auth.getSession`) and stub `fetch`. Assert after
  the plan resolves, or you assert against the loading view (guest-looking, passes wrongly).

**Plan-switch route check order decides the copy.** `startPlanSwitch` once answered a plain 400
"interval is required" (no `code`) before checking `profiles.stripe_customer_id`. A plan granted by
hand has no Stripe price, so the interval was unknown and the client fell to the generic
`switchFailed` instead of `no_billing_account`. Decision: the billing-account check runs right after
the no-paid-plan check. Any new early return in that route needs a `code` from
`PLAN_SWITCH_ERROR_CODES`, or the user gets the generic message.

**Where Manage billing really exists.** The account page shows it only for an entitled plan with a
Stripe customer whose portal session was created. `no_billing_account`, `pay_or_resume` (the row is
not entitled by then), `portalFailed` and the generic `switchFailed` therefore offer
`SUPPORT_EMAIL` via an `{email}` ICU argument instead (plain text, so the same message works in a
sonner toast and in a `role="alert"`).
