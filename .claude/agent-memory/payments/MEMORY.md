# Payments Agent Memory

- [AI-disabled checkout convention](ai-disabled-checkout-convention.md) — checkout routes must use ai-guard.ts's 503/AI_DISABLED_ERROR, not inline 403; tests need vi.stubEnv
- [Promotion codes at checkout](promotion-codes-checkout.md) — verified Stripe rules: free orders, coupon duration vs plan switch, portal setting is separate
- [Webhook matching by subscription id](webhook-subscription-id-matching.md) — lookup order for later events, 409 `already_subscribed`, mock shapes, invoice sub id by API version
- [Webhook stored statuses and retries](webhook-stored-statuses-and-retries.md) — updates write Stripe's retrieved state, not the event's; unstored status and canceled → canceled/free; failed DB call or Stripe read → 500; test helpers
- [Payments learnings](payments-learnings.md) — AI coming-soon flag gating in checkout routes; `proAi` wire tier vs `pro_ai` DB tier; shared flag helper location
- [AI allowance and credit packs](ai-allowance-and-credit-packs.md) — ai_monthly_credits from money paid; once coupons, customer discounts, source.coupon, Adaptive Pricing fields
- [Checkout funnel analytics](checkout-funnel-analytics.md) — expired webhook analytics-only; no user_id, random client id, HMAC keyed by webhook secret; after() test mock
- [Refund policy and plan changes](refund-policy-plan-changes.md) — scheduled downgrades, upgrades via per-target portal config; flow sessions can't be locked; archived prices rejected
- [Plan switch: ended-plan resync](plan-switch-ended-plan-resync.md) — row says paid, Stripe says ended: id-keyed correction + checkout target; list hides canceled; resource_missing is 400 on list
- [Checkout asks Stripe first](checkout-stripe-guard.md) — live/open/failed/missing-customer outcomes, upward row write, expiring other open subscription checkouts, test setup
