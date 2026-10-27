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
 * - A mid-period upgrade into managed (own key → managed, Pro → Pro AI, charged now and prorated)
 *   gets, until the next renewal, the allowance scaled by the part of a month its proration
 *   charged for: the proration line of the new price on that upgrade's invoice covers the rest of
 *   the period, and that span, in months and capped at one, is the share (half a month left:
 *   about half the allowance; one day left: about 1/30). It is read from the latest invoice and
 *   the current period, never from the clock, so a redelivered event or a later update in the same
 *   period writes the same figure; the renewal's invoice (a `subscription_cycle`) brings the full
 *   allowance back. Credit packs are separate grants and aren't touched. While that upgrade's
 *   invoice isn't paid, the share is 0. Step 2 measures an upgrade's invoice on the new price's
 *   line alone, not on the subtotal that nets it against the old price's unused time.
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

/** A line of an expanded invoice, in either shape the pinned API version may return. */
type InvoiceLine = Stripe.InvoiceLineItem & {
  /** Older API versions. */
  proration?: boolean
  price?: { id?: string } | string | null
}

const sumAmounts = (amounts: ReadonlyArray<{ amount?: unknown }> | null | undefined): number =>
  (amounts ?? []).reduce((sum, d) => sum + (typeof d.amount === 'number' ? d.amount : 0), 0)

/** The share (0..1) of `amount` left after `discounted`; 1 when `amount` isn't positive. */
const shareAfter = (amount: unknown, discounted: number): number =>
  typeof amount !== 'number' || amount <= 0 ? 1 : Math.min(1, Math.max(0, (amount - discounted) / amount))

/**
 * The share (0..1) of its charge the latest invoice kept after its discounts. 1 when there is no
 * expanded invoice or nothing positive to measure (a proration credit, a $0 trial invoice).
 *
 * An upgrade's invoice (`subscription_update`, see upgradeLine()) is measured on the line of the
 * current price alone: its subtotal nets that charge against the credit for the old price's unused
 * time, and a coupon that discounts only the new price (a managed-only coupon) would otherwise
 * read as a much larger share of that small net figure and under-grant. Any other invoice is
 * measured on its subtotal and `total_discount_amounts`. On the pinned API version Stripe applies
 * the discount inside a proration line's `amount` and reports `discount_amounts` of 0 there (test
 * mode, 2026-10-26), so for those lines the subscription's discounts (step 1) do the pricing.
 */
function latestInvoiceChargedShare(subscription: Stripe.Subscription): number {
  const invoice = subscription.latest_invoice
  if (!invoice || typeof invoice === 'string') return 1
  const line = upgradeLine(subscription)?.line
  if (line) return shareAfter(line.amount, sumAmounts(line.discount_amounts))
  return shareAfter(invoice.subtotal, sumAmounts(invoice.total_discount_amounts))
}

function isProrationLine(line: InvoiceLine): boolean {
  const parent = line.parent as
    | { subscription_item_details?: { proration?: boolean } | null; invoice_item_details?: { proration?: boolean } | null }
    | null
    | undefined
  return Boolean(parent?.subscription_item_details?.proration ?? parent?.invoice_item_details?.proration ?? line.proration)
}

function linePriceId(line: InvoiceLine): string | undefined {
  const details = (line.pricing as { price_details?: { price?: string | { id?: string } } } | null | undefined)?.price_details
  const price = details?.price ?? line.price
  return typeof price === 'string' ? price : price?.id
}

const lineSpan = (line: InvoiceLine): number => (line.period?.end ?? 0) - (line.period?.start ?? 0)

/**
 * The line that charged for the subscription's current price on its latest invoice, when that
 * invoice is a plan change's own (`billing_reason: subscription_update`): the positive proration
 * line of the current price with the longest span (a mid-period upgrade, charged for the rest of
 * the period), else its positive full-price line (an upgrade that restarts the period, monthly →
 * yearly, or a deferred change landing at the renewal). Undefined when the invoice charged nothing
 * for the current price: a portal upgrade whose payment failed is a pending update (the old price
 * stays and the invoice lists the new one, test mode 2026-10-26), so its invoice never names the
 * current price with a positive amount.
 */
function upgradeLine(subscription: Stripe.Subscription): { line: InvoiceLine; proration: boolean } | undefined {
  const invoice = subscription.latest_invoice
  if (!invoice || typeof invoice === 'string' || invoice.billing_reason !== 'subscription_update') return undefined
  const priceId = subscription.items?.data?.[0]?.price?.id
  if (!priceId) return undefined

  let proration: InvoiceLine | undefined
  let full: InvoiceLine | undefined
  for (const line of (invoice.lines?.data ?? []) as InvoiceLine[]) {
    if (!(line.amount > 0) || linePriceId(line) !== priceId) continue
    if (isProrationLine(line)) {
      if (!proration || lineSpan(line) > lineSpan(proration)) proration = line
    } else if (!full) {
      full = line
    }
  }
  if (proration) return { line: proration, proration: true }
  if (full) return { line: full, proration: false }
  return undefined
}

/**
 * The share (0..1) of a month's allowance the current period earns after a plan change into it.
 *
 * - 0 while a mid-period upgrade's invoice (a positive proration line for the current price) isn't
 *   `paid`: the price was changed without its payment, which only a Dashboard or API update can do
 *   (the portal's confirm page keeps the old price until the payment succeeds, test mode
 *   2026-10-26). The row is written again when the subscription next changes (its status on a
 *   failed or retried payment, the renewal, a later update), which re-reads the invoice.
 * - Otherwise the span of that proration line (the time from the upgrade to the period end), in
 *   months of this price's period, capped at 1.
 * - 1 when the latest invoice has no such line: no plan change, or one that charged the whole
 *   period (monthly → yearly restarts it, a deferred change lands at the renewal). Those follow the
 *   renewal's rule: the allowance stands while Stripe collects, and a failed payment changes the
 *   subscription's status. See the module comment.
 */
function upgradePeriodShare(subscription: Stripe.Subscription, months: number): number {
  const upgrade = upgradeLine(subscription)
  if (!upgrade?.proration) return 1
  if ((subscription.latest_invoice as Stripe.Invoice).status !== 'paid') return 0

  const item = subscription.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_start?: number }) | undefined
  const start = item?.current_period_start
  const end = item?.current_period_end
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return 1
  const covered = lineSpan(upgrade.line)
  if (covered <= 0) return 1
  const monthSeconds = (end - start) / months
  return Math.min(1, covered / monthSeconds)
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

  cents = Math.min(cents, Math.floor(listCents * latestInvoiceChargedShare(subscription)))

  const months = plan.interval === 'yearly' ? 12 : 1
  const full = monthlyAllowanceForPayment(cents / 100, months)
  return { aiMode, monthlyCredits: Math.floor(full * upgradePeriodShare(subscription, months)) }
}
