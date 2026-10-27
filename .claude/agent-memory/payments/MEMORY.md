# Payments Agent Memory

- [AI-disabled checkout convention](ai-disabled-checkout-convention.md) — checkout routes must use ai-guard.ts's 503/AI_DISABLED_ERROR, not inline 403; tests need vi.stubEnv
- [Promotion codes at checkout](promotion-codes-checkout.md) — verified Stripe rules: free orders, coupon duration vs plan switch, portal setting is separate
- [Webhook matching by subscription id](webhook-subscription-id-matching.md) — lookup order for later events, 409 `already_subscribed`, mock shapes, invoice sub id by API version
- [Webhook stored statuses and retries](webhook-stored-statuses-and-retries.md) — updates write Stripe's retrieved state, not the event's; unstored status and canceled → canceled/free; failed DB call or Stripe read → 500; test helpers
- [Payments learnings](payments-learnings.md) — AI flag gating in checkout routes; `proAi` vs `pro_ai`; web-only checkout codes stay out of AI_ERROR_CODES
- [AI allowance and credit packs](ai-allowance-and-credit-packs.md) — allowance from money paid, upgrade share, failed upgrade = pending update, basil line discounts
- [Checkout funnel analytics](checkout-funnel-analytics.md) — expired webhook analytics-only; no user_id, random client id, HMAC keyed by webhook secret; after() test mock
- [Refund policy and plan changes](refund-policy-plan-changes.md) — timing matrix, v3 config + feature checks, list omits products, preview guard, 1 s schedule
- [Plan switch: ended-plan resync](plan-switch-ended-plan-resync.md) — row says paid, Stripe says ended: id-keyed correction + checkout target; list hides canceled; resource_missing is 400 on list
- [Checkout asks Stripe first](checkout-stripe-guard.md) — live/open/failed/missing-customer outcomes, upward row write, expiring other open subscription checkouts, test setup
- [Portal deferral matrix](portal-deferral-matrix.md) — measured: when the confirm page defers (same vs cross product), the 1-second schedule, discounts kept, cancel lock vs cancel flow, events, what customers see
- [Cancel with a pending schedule](cancel-with-pending-schedule.md) — subscription_cancel flow releases + cancels; own config, ownership, i18n client namespace
- [Plan-change alarm](plan-change-alarm.md) — webhook PLAN_CHANGE_ALARM (log + Sentry, try/catch): event-object schedule vs retrieved invoice, blind spots
