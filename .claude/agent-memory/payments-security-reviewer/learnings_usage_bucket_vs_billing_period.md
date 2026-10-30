---
name: usage-bucket-vs-billing-period
description: Audit question for metered AI allowances - count how many usage buckets one payment can touch when the counter is keyed by calendar month but the plan is paid per billing period; plus dunning and pre-check upstream calls
metadata:
  type: reference
---

When an allowance is enforced by a counter keyed by calendar month (`ai_usage (user_id, month)`)
while the plan is paid per Stripe billing period:

1. **Buckets per payment.** A monthly period that doesn't start on the 1st spans two calendar
   months, so one payment can fund two full buckets. Subscribe on the last day, use both, cancel,
   repeat. Yearly plans touch 13 buckets for 12 months. Compare the worst case with the cost-share
   target (`creditsForPayment`), not the average subscriber.
2. **Dunning.** If the status during payment retries (`past_due`) counts as entitled in the
   reserve function, a failed renewal funds another bucket with no payment. Check what the webhook
   writes on `invoice.payment_failed` (status only, or the allowance too) and Stripe's "after all
   retries fail" setting.
3. **Proportional grants** (upgrade shares) have the same doubling when the share runs to the period
   end but the bucket resets on the 1st.
4. **Free upstream calls before the balance check.** A pre-flight call on the owner's key (for
   example Anthropic `count_tokens`) that runs before a refusal costs no money, but it has its own
   org-wide rate limit. A user with 0 credits can loop it and block every other managed user unless
   there's a cheap balance pre-check or a per-user rate limit.

Fixes to suggest: key the bucket by the subscription's `current_period_start` (or a rolling
window), give `past_due` no new managed bucket (keep packs usable), and put a per-user limiter
plus a remaining > 0 pre-check ahead of the token count.

Related: [[reserve-settle-bound-review-method]], [[prorated-option-switch-review-method]]
