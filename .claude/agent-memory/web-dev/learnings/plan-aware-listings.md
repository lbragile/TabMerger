---
name: plan-aware-listings
description: How plan listings (pricing page, home teaser) learn the visitor's plan - getCurrentPlan + planCardStatus, streaming the plan into the teaser, and why switch-route check order decides which error copy users see
metadata:
  type: reference
---

**One lookup, one rule.** `lib/currentPlan.ts` `getCurrentPlan()` is the server read of the
visitor's plan (paid tier only while `hasCloudSync` says the status is entitled, else `free`;
`signedIn` separates guests from free accounts). `components/pricing/planStatus.ts`
`planCardStatus()` is the Current / below-current / Recommended rule; PricingCard and
PricingTeaser both call it. Don't re-derive tier ranks in a component.

**Streaming the plan into a marketing section.** The home page is per-request anyway (`headers()`
for the visitor browser, Navbar reads cookies), so no static rendering is lost. The page starts
`getCurrentPlan().catch(() => GUEST_PLAN)` un-awaited and passes the promise to
`PricingTeaserForVisitor`, which wraps `use(promise)` in its own `<Suspense fallback={<PricingTeaser />}>`.
- The fallback is the guest view, so guests see no change and subscribers only see a badge swap
  (the badge is absolutely positioned: no layout shift).
- Keep the Suspense inside the component: `home-page.test.tsx` asserts the page has exactly one
  top-level Suspense (the reviews strip).
- The `.catch` matters in tests too: page tests mock `next/headers` without `cookies`, so the
  Supabase server client throws; uncaught, that would reject inside `use()`.
- Pass the teaser `currentTier` only for a paid plan: with `'free'` the Free card would gain a
  "Current" badge for guests and free accounts.
- RTL: render inside `await act(async () => { render(...); await promise })` before asserting, or
  you assert against the fallback (which looks like the guest view and passes wrongly).

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
