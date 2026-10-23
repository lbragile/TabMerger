import type Stripe from 'stripe'
import { monthlyAllowanceForPayment, type AiMode } from '@tabmerger/shared'
import type { PlanPrice } from './tiers'

/**
 * The managed Pro AI allowance of a Stripe subscription (`subscriptions.ai_monthly_credits`) and
 * its AI option (`subscriptions.ai_mode`). One implementation, used by the Stripe webhook on every
 * subscription write and by the one-off re-sync script (scripts/resync-ai-allowance.ts), so the
 * two can never disagree. Relative imports only: the script runs outside Next.js.
 *
 * The allowance keeps AI spend within the share of revenue the shared economics allow
 * (`monthlyAllowanceForPayment()` in `@tabmerger/shared`), so it is worked out from what the
 * subscription actually pays per period, never from the list price alone:
 *
 * - BYOK, and any tier other than `pro_ai`: 0 (TabMerger pays for no AI).
 * - `trialing`: 0 (nothing has been paid yet).
 * - Otherwise the USD list price of the subscription's Price (PRICING_TIERS, via `plan`), less:
 *   1. the discounts that apply to its next invoices: the item's, then the subscription's, or the
 *      customer's when the subscription has none of its own. `percent_off` is applied;
 *      `amount_off` only when its currency is USD. A discount that can't be priced in USD (another
 *      currency, an unknown shape, a coupon that can't be read) counts as 100% off;
 *   2. and never more than the latest invoice actually charged after its discounts (as a share of
 *      its subtotal, so the invoice's currency doesn't matter). This catches a "once" coupon, which
 *      Stripe removes from the subscription as soon as the first invoice is finalized: a 100%-off
 *      first month funds no credits, the full-price second month funds the full allowance.
 */

/**
 * What a subscription read must expand for subscriptionAiColumns(): the discounts on the
 * subscription and its item, the latest invoice and the customer. Each path is at most three
 * levels deep (Stripe allows four) and exists on the API version the client is pinned to.
 */
export const SUBSCRIPTION_EXPAND = [
  'discounts',
  'items.data.discounts',
  'latest_invoice',
  'customer',
] as const

/** The coupon fields a discount is priced from. */
export type CouponPricing = Pick<Stripe.Coupon, 'percent_off' | 'amount_off' | 'currency'>

export interface AiAllowanceDeps {
  /**
   * Reads a coupon by id, for a discount whose coupon wasn't expanded. Resolves null when Stripe
   * has no such coupon; throws for any other failure (the caller decides whether to retry).
   */
  retrieveCoupon(id: string): Promise<CouponPricing | null>
  /** Called once with a payload-free reason when a discount can't be priced in USD. */
  onUnpriceableDiscount(reason: string): void
}

export interface AiColumns {
  aiMode: AiMode
  monthlyCredits: number
}

type DiscountRef = string | Stripe.Discount | null | undefined

/** The discounts that apply to the subscription's next invoices, in the order Stripe applies them. */
function applicableDiscounts(subscription: Stripe.Subscription): DiscountRef[] {
  const own: DiscountRef[] = [
    ...(subscription.items?.data?.[0]?.discounts ?? []),
    ...(subscription.discounts ?? []),
  ]
  if (own.length) return dedupe(own)

  // "When a subscription has no discounts, the customer-level discount, if any, applies."
  const customer = subscription.customer
  if (customer && typeof customer === 'object' && !('deleted' in customer && customer.deleted)) {
    const customerDiscount = (customer as Stripe.Customer).discount
    if (customerDiscount) return [customerDiscount]
  }
  return []
}

function dedupe(discounts: DiscountRef[]): DiscountRef[] {
  const seen = new Set<string>()
  return discounts.filter((d) => {
    const id = typeof d === 'string' ? d : d?.id
    if (!id) return true
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/**
 * The coupon behind a discount, or a reason it can't be read. Reads `source.coupon` (current API
 * versions) or the older top-level `coupon`, expanded or as an id.
 */
async function couponOf(
  discount: DiscountRef,
  deps: AiAllowanceDeps
): Promise<CouponPricing | { unpriceable: string }> {
  if (!discount || typeof discount === 'string') return { unpriceable: 'discount not expanded' }
  const legacy = discount as unknown as { coupon?: string | Stripe.Coupon | null }
  const ref = discount.source?.coupon ?? legacy.coupon ?? null
  if (!ref) return { unpriceable: 'discount without a coupon' }
  if (typeof ref !== 'string') return ref
  const coupon = await deps.retrieveCoupon(ref)
  return coupon ?? { unpriceable: 'coupon not found' }
}

/** `cents` after one coupon, or null when the coupon can't be priced in USD. */
function applyCoupon(cents: number, coupon: CouponPricing): number | null {
  if (typeof coupon.percent_off === 'number') {
    const percent = Math.min(100, Math.max(0, coupon.percent_off))
    return Math.floor((cents * (100 - percent)) / 100)
  }
  if (typeof coupon.amount_off === 'number') {
    if (coupon.currency?.toLowerCase() !== 'usd') return null
    return Math.max(0, cents - coupon.amount_off)
  }
  return null
}

/**
 * The share (0..1) of its subtotal the latest invoice charged after its discounts. 1 when there is
 * no expanded invoice or its subtotal isn't positive (a proration credit, a $0 trial invoice).
 */
function latestInvoiceChargedShare(invoice: Stripe.Subscription['latest_invoice']): number {
  if (!invoice || typeof invoice === 'string') return 1
  const subtotal = invoice.subtotal
  if (typeof subtotal !== 'number' || subtotal <= 0) return 1
  const discounted = (invoice.total_discount_amounts ?? []).reduce(
    (sum, d) => sum + (typeof d.amount === 'number' ? d.amount : 0),
    0
  )
  return Math.min(1, Math.max(0, (subtotal - discounted) / subtotal))
}

/**
 * The `ai_mode` and `ai_monthly_credits` to store for a subscription. `plan` is its Price
 * (getPlanForPriceId(), null for a price we don't sell) and `storedTier` the tier the row is
 * written with (`free` for an ended subscription). See the module comment for the rules.
 */
export async function subscriptionAiColumns(
  subscription: Stripe.Subscription,
  plan: PlanPrice | null,
  storedTier: string,
  deps: AiAllowanceDeps
): Promise<AiColumns> {
  const aiMode: AiMode = plan?.aiMode ?? 'managed'
  if (!plan || storedTier !== 'pro_ai' || plan.tier !== 'pro_ai' || aiMode !== 'managed') {
    return { aiMode, monthlyCredits: 0 }
  }
  if (subscription.status === 'trialing') return { aiMode, monthlyCredits: 0 }

  const listCents = Math.round(plan.amount * 100)
  let cents = listCents
  for (const discount of applicableDiscounts(subscription)) {
    const coupon = await couponOf(discount, deps)
    const priced = 'unpriceable' in coupon ? null : applyCoupon(cents, coupon)
    if (priced === null) {
      const reason =
        'unpriceable' in coupon
          ? coupon.unpriceable
          : typeof coupon.amount_off === 'number'
            ? `amount_off in ${coupon.currency ?? 'unknown currency'}`
            : 'coupon with no percent_off or amount_off'
      deps.onUnpriceableDiscount(reason)
      cents = 0
      break
    }
    cents = priced
  }

  cents = Math.min(cents, Math.floor(listCents * latestInvoiceChargedShare(subscription.latest_invoice)))

  const months = plan.interval === 'yearly' ? 12 : 1
  return { aiMode, monthlyCredits: monthlyAllowanceForPayment(cents / 100, months) }
}
