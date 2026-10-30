---
name: cancel-with-pending-schedule
description: How a subscriber cancels while a plan change is scheduled - Stripe's subscription_cancel portal flow on an explicit tabmerger_cancel config (route /api/billing/cancel-subscription), what Stripe does on confirm, ownership checks, test gotchas
metadata:
  type: reference
---

The portal home hides cancel while a subscription has a schedule (portal-made or server-made). A
session with `flow_data: { type: 'subscription_cancel', subscription_cancel: { subscription } }`
is accepted anyway, and confirming its "Cancel plan" page **releases the schedule** (current price
kept) and sets `cancel_at_period_end`. Verified on test clocks 2026-10-26: at period end the sub is
`canceled`, no renewal invoice, balance 0, no credit notes.

Decision: use Stripe's flow, not a hand-rolled release + update (Stripe's pages for billing
actions). `createCancelSubscriptionSession()` (lib/stripe.ts) passes its own configuration (metadata
`tabmerger_cancel: v1`, `at_period_end` + `proration_behavior: none`, `subscription_update`
disabled), found among active non-default configs like the plan-change ones, `after_completion`
redirect to /account. Ownership: the route ignores the body, reads the caller's newest
`subscriptions` row, and Stripe's `subscription.customer` must equal the profile's customer, else
404. `already_canceling` 409 makes a second click harmless. A failed Supabase read (anything but
`.single()`'s PGRST116 "no row") is 500 `cancel_failed` with a one-line log of the code, never
400/404. Its config is found only if its features still match (cancel at_period_end + none,
subscription_update off). `getPendingPlanChange()` reads the
schedule's next phase for the account page ("Changes to {plan} on {date}").

i18n: a client component's `useTranslations` namespace must be in `CLIENT_NAMESPACES`
(i18n/messages.ts), checked by i18n-infrastructure.test; give client strings their own small
namespace (`account.cancelSubscription`) instead of exposing a whole server one. Hebrew one-letter
prefixes before a placeholder take a hyphen (`ל-{plan}`), checked by i18n-catalogs.test.

Page tests that `vi.mock('@/lib/stripe')` without a new export throw synchronously on access, so the
account page wraps each Stripe lookup in an async IIFE inside `Promise.allSettled`.

Related: [[portal-deferral-matrix]], [[refund-policy-plan-changes]].
