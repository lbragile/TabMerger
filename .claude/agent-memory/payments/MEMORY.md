# Payments Agent Memory

- [AI-disabled checkout convention](ai-disabled-checkout-convention.md) — checkout routes must use ai-guard.ts's 503/AI_DISABLED_ERROR, not inline 403; tests need vi.stubEnv
- [Promotion codes at checkout](promotion-codes-checkout.md) — verified Stripe rules: free orders, coupon duration vs plan switch, portal setting is separate
- [Payments learnings](payments-learnings.md) — AI coming-soon flag gating in checkout routes; `proAi` wire tier vs `pro_ai` DB tier; shared flag helper location
