# Payments & Subscriptions

## Pricing (canonical — match exactly in Stripe dashboard)

| Tier | Monthly | Yearly | Stripe tier value |
|---|---|---|---|
| Free | $0 | $0 | `free` |
| Pro | $3.99/mo | $34.99/yr | `pro` |
| Pro AI | $7.99/mo | $69.99/yr | `pro_ai` |

Yearly pricing: Pro saves 27%, Pro AI saves 27% vs monthly × 12.

---

## Stripe Setup (one-time)

1. Create two Products in Stripe dashboard: "TabMerger Pro" and "TabMerger Pro AI"
2. For each product, create two Prices: monthly recurring + yearly recurring
3. Copy the Price IDs into environment variables:
   ```
   STRIPE_PRO_MONTHLY_PRICE_ID=price_...
   STRIPE_PRO_YEARLY_PRICE_ID=price_...
   STRIPE_PRO_AI_MONTHLY_PRICE_ID=price_...
   STRIPE_PRO_AI_YEARLY_PRICE_ID=price_...
   ```
4. Configure the webhook in Stripe dashboard:
   - Endpoint: `https://tabmerger.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Copy the signing secret → `STRIPE_WEBHOOK_SECRET`

---

## Checkout Flow

```
User clicks "Upgrade" on pricing page
    → POST /api/checkout { priceId, userId }
    → Creates Stripe Checkout session
    → Redirects to stripe.com/checkout (hosted)
    → On success → redirects to /dashboard?upgraded=1
    → Stripe fires checkout.session.completed webhook
    → Webhook upserts subscriptions table in Supabase
    → Extension reads new tier via useEntitlements on next focus
```

Key: `metadata.user_id` is set on the checkout session so the webhook knows which user to update.

---

## Webhook Handler (`/api/webhooks/stripe/route.ts`)

**Critical:** Must use raw body (`req.text()`) before parsing — JSON parsing invalidates the Stripe signature.

Events handled:
- `checkout.session.completed` → upsert subscription with tier from price ID mapping
- `customer.subscription.updated` → update tier, status, current_period_end
- `customer.subscription.deleted` → set status = `canceled` (keep tier for grace period UI)
- `invoice.payment_failed` → set status = `past_due`

Price ID → tier mapping is in `packages/web/lib/stripe.ts`:
```typescript
function getTierFromPriceId(priceId: string): SubscriptionTier {
  if ([PRO_MONTHLY, PRO_YEARLY].includes(priceId)) return 'pro';
  if ([PRO_AI_MONTHLY, PRO_AI_YEARLY].includes(priceId)) return 'pro_ai';
  return 'free';
}
```

---

## Entitlement Enforcement

### In the extension (`useEntitlements.ts`)
```typescript
// Reads from Supabase subscriptions table
// Falls back to 'free' if offline or unauthenticated
const tier = useEntitlements(); // 'free' | 'pro' | 'pro_ai'

// Usage in components
if (tier === 'free' && groupCount >= 5) {
  showUpgradePrompt();
  return;
}
```

### In AI API routes (server-side)
Both `tier === 'pro_ai'` AND `status === 'active'` must be true. Status `'trialing'` also grants access.

---

## Billing Portal

Users can manage their subscription at `/account`. The "Manage Billing" button calls:
```typescript
const session = await stripe.billingPortal.sessions.create({
  customer: stripeCustomerId,
  return_url: `${APP_URL}/account`,
});
redirect(session.url);
```

This lets users cancel, update payment method, and view invoices without any custom UI.

---

## Testing Locally

Use Stripe CLI to forward webhooks to localhost:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use test card `4242 4242 4242 4242` with any future expiry and any CVC.

Test subscription cancellation:
```bash
stripe subscriptions cancel sub_xxx
```

---

## Revenue Tracking

Monitor in Stripe Dashboard → Reports. Key metrics:
- MRR (Monthly Recurring Revenue)
- Churn rate (subscriptions canceled / active)
- Upgrade rate (free → paid conversion)
- ARPU (average revenue per paid user)

Goal: $5,000 MRR by v2.4 (~500 Pro AI + ~250 Pro users).
