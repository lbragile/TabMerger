---
name: ai-credit-month-key
description: How ai_usage/ai_credit_purchases month keys work since migration 030 (billing period, not calendar month), the hold until a renewal is paid (invoice.paid), measured Stripe period and invoice facts, packs during the hold, write order for the freeze, and how SQL and TS are kept in agreement
metadata:
  type: reference
---

`month` stays 'YYYY-MM' text but means "the UTC month the current allowance month started in":
`aiAllowanceMonth()` (`packages/shared/src/utils/aiAllowanceMonth.ts`) and `ai_allowance_month()`
(030). Period up to 32 days: month of the start, whatever the clock. Longer: latest anniversary
of the start that has passed and lies before the end. No stored period: calendar month.

**Span, not the price, tells monthly from yearly.** SQL can't map a price id (env), and an
anniversary rule applied to a monthly period is wrong: Feb 28 to Mar 31 has an anniversary on Mar 28,
which would give that period two buckets. Stripe's `cancel_at` can shorten a period, so a longer
period isn't necessarily 12 months: the "before the end" cap handles it.

**Stripe test clock, 2026-11-01** (monthly Price, anchor Oct 31 10:00 UTC): period starts Oct 31,
Nov 30, Dec 31, Jan 31, Feb 28, Mar 31, always the same time of day. 30 seconds after a period end
the item's period has already moved, `status` is `active`, and `latest_invoice` is a `draft`
`subscription_cycle`; 2 hours later that invoice is `paid`. A cycle invoice's own `period_start` and
`period_end` are the period just ended (a `subscription_create` invoice has them equal). With
`pm_card_chargeCustomerFail`: `past_due` + `open` at 2 hours; `invoices.pay` with a good card gives
`active` + `paid` on the same period.

**The hold.** Decision: a renewal's period and allowance are stored once paid
(`findUnpaidRenewal()`: `active`/`past_due`, a `subscription_cycle` invoice for this period start,
not `paid`, `amount_due` not 0). `past_due` holds too, so packs stay spendable through dunning.
`invoice.paid` writes by id, never inserts. The self-heal: a held write stores the unpaid invoice's own
period when a paid invoice ends where it starts, so a missed `invoice.paid` costs one period.

**`latest_invoice` alone isn't enough (test clock, 2026-11-01).** `past_due` + open renewal + a paid
upgrade: `active`, latest `subscription_update`, renewal still open. An upgrade paid in the draft hour:
stays `active` after the renewal's charge fails. So when the latest isn't a cycle invoice, the `draft`
and `open` invoices are listed too; a failed list fails the event.

**Retries running out (test clock, 2026-11-01).** Plain `past_due`: open, then by +15 days the renewal
is `uncollectible` and the subscription `canceled`. With a paid upgrade on top: the renewal goes
`uncollectible` but the subscription stays `active` until the next renewal also fails (+40 days). So
`createPlanSwitchSession()` refuses while findUnpaidRenewal() finds a renewal, and written-off invoices
are listed too. With a good default card the retry collects the open renewal by +4 days.

**`pause_collection: void` (test clock):** each cycle invoice is a `draft` for the hour, then `void`,
status stays `active`. So a draft's prior period may be one nobody paid for: hence the paid check
rather than only excluding `void`/`uncollectible`.

**Deferred landings (test clock):** Pro, Pro yearly, own key yearly and Pro AI yearly to managed monthly,
through a schedule, land as `subscription_cycle`, draft at 30 min, paid at 2 h, so the hold covers them.

**Migration split.** One transaction with ACCESS EXCLUSIVE on subscriptions and then ai_credit_purchases
deadlocks with ai_credits_exhausted (reads purchases, then subscriptions): reproduced locally. So 029 adds
the column alone, 030 the rest.

**Order of writes.** One webhook write can set a new period and an allowance of 0 together, so the
freeze reads the row's OLD period (AFTER trigger's `old.*`) and stamps the key the money was spent
under. A BEFORE trigger (`subscriptions_keep_ai_period`) refuses a same-id start that moves back or
clears: handlers write what they retrieved, and a slow handler can write after a newer one. Upserts
fire `UPDATE OF` triggers; a new subscription id taking over the row brings its own period.

**Packs.** `ai_grant_credit_pack` reads the buyer's key under FOR SHARE on the row and inserts, so a
grant can't land on the old key after the carry. During a hold that is the old key, so the pack is
spendable at once; `subscriptions_carry_ai_packs` moves the unspent part on advance, and every pack
when the period was cut short (same id or a new one). Pack rows are locked before the headroom is read,
so a concurrent revoke can't inflate it. A pack on the
next key instead wouldn't be spendable until the payment cleared, and counting it on both would give
back what was spent. With no period the calendar month is never behind the key the row later gets, so
a pack can be delayed but not lost.

**Keeping SQL and TS together.** pgTAP isn't in CI. The case table in
`supabase/tests/030_ai_billing_period_credits.test.sql` is parsed by
`packages/web/__tests__/aiAllowanceMonthSqlDrift.test.ts` (shared has no node types, so it can't live
there), so one table proves both sides. `ai_credit_cap()` (030) holds the cap expression;
`entitledStatusesSqlDrift.test.ts` checks its allowance filter now, not `ai_reserve_credits`'s body.

Testing webhook paths: the Stripe mock needs `invoices.list` as soon as a subscription's latest invoice
is a plan change's or a renewal; pack grants go through `rpc('ai_grant_credit_pack')` (`mockRpc` in
`stripeWebhook.test.ts`). To reset a row in a script, change its id first: the keep trigger refuses
clearing a period on the same id.

Related: [[ai-allowance-and-credit-packs]], [[disputes-and-past-due-allowance]],
[[webhook-stored-statuses-and-retries]].
