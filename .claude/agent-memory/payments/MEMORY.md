# Payments Agent Memory

- [AI-disabled checkout convention](ai-disabled-checkout-convention.md) — checkout routes must use ai-guard.ts's 503/AI_DISABLED_ERROR, not inline 403; tests need vi.stubEnv
- [Promotion codes at checkout](promotion-codes-checkout.md) — verified Stripe rules: free orders, coupon duration vs plan switch, portal setting is separate
- [Webhook matching by subscription id](webhook-subscription-id-matching.md) — lookup order for later events, 409 `already_subscribed`, mock shapes, invoice sub id by API version
- [Webhook stored statuses and retries](webhook-stored-statuses-and-retries.md) — updates write Stripe's retrieved state, not the event's; unstored status and canceled → canceled/free; failed DB call or Stripe read → 500; test helpers
- [Payments learnings](payments-learnings.md) — AI coming-soon flag gating in checkout routes; `proAi` wire tier vs `pro_ai` DB tier; shared flag helper location
