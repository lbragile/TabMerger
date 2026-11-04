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
 * - Any status other than `active`: 0. `trialing` has paid nothing yet; `past_due` (a renewal
 *   payment is failing, Stripe is retrying) keeps sync and the rest of Pro but earns no managed
 *   credits until the payment succeeds, so a period that starts during dunning brings no fresh
 *   allowance. What the allowance had already paid for this month stays paid for: when the
 *   column drops to 0, migration 027's trigger records it (`ai_usage.allowance_spent`) and
 *   `ai_reserve_credits` keeps that much, so credit packs stay spendable. Once the payment
 *   recovers the subscription is `active` again and the rules below apply as usual.
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
 *   allowance back, in the same step as the new usage month (aiWriteColumns(), when that renewal is
 *   paid), so on a monthly plan the share caps one bucket and never applies twice. Credit packs are separate grants and aren't touched. While that upgrade's
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

/** The invoice list {@link findUnpaidRenewal} reads. */
export type InvoiceLister = { list(params: Stripe.InvoiceListParams): PromiseLike<{ data: Stripe.Invoice[]; has_more?: boolean }> }

/** A renewal that hasn't been paid, and whether the period it follows was paid for. */
export interface UnpaidRenewal {
  /** Null when the listing was too long to tell which invoice it is: held all the same. */
  invoice: Stripe.Invoice | null
  /** The period just ended (the invoice's own period) was paid for, so a row behind it can catch up. */
  priorPeriodPaid: boolean
}

/** The statuses of an invoice that hasn't been paid. */
const UNPAID_INVOICE_STATUSES = ['draft', 'open', 'uncollectible', 'void'] as const

/** Stripe's largest page. */
const INVOICE_PAGE = 100

/** An unpaid renewal with something to pay: `subscription_cycle`, not `paid`, `amount_due` not 0. */
function isUnpaidCycleInvoice(invoice: Stripe.Invoice): boolean {
  return invoice.billing_reason === 'subscription_cycle' && invoice.status !== 'paid' && invoice.amount_due !== 0
}

/**
 * The renewal a subscription is waiting on, or null. Stripe moves the item's period as soon as it
 * drafts the renewal invoice, about an hour before it charges it (test clock, 2026-11-01: 30 seconds
 * after the period end the period had moved, status `active`, invoice `draft`), so storing that period
 * would open a new credit bucket for a card that may then fail.
 *
 * Only an `active` or `past_due` subscription can hold, on a renewal invoice:
 * - The latest invoice normally tells. A renewal that isn't paid holds, unless it has nothing to pay (a
 *   100% coupon, a $0 price, a balance that covers it), which can't fail. A paid one doesn't.
 * - A newer invoice can hide it. A plan change paid while the renewal is open makes the subscription
 *   `active` with that invoice as the latest (test clock, 2026-11-01: `past_due` + open renewal, then a
 *   paid upgrade: `active`, latest `subscription_update`, renewal still open; and an upgrade paid in
 *   the draft hour stayed `active` after the renewal's charge failed). So when the latest invoice isn't
 *   a renewal, the subscription's unpaid invoices (`draft`, `open`, `uncollectible`, `void`) are read
 *   too, and one for this period start (`period_end === current_period_start`) holds: a written-off
 *   renewal paid for nothing, so it stays held until a later renewal is paid, which moves the period
 *   start and stops it matching. A list that has more pages and no match holds as well, because the
 *   renewal may be on one of them. Nothing else is listed: a first invoice (`subscription_create`) can
 *   have no renewal behind it, and a subscription with no expanded invoice isn't read this way.
 * - A yearly plan's monthly anniversaries aren't invoices, so they never hold.
 * - `collection_method: send_invoice` holds the same way until paid. Checkout never creates one.
 *
 * Any failed read throws (the caller retries): a hold must never be skipped because Stripe was down.
 */
export async function findUnpaidRenewal(
  subscription: Stripe.Subscription,
  invoices: InvoiceLister
): Promise<UnpaidRenewal | null> {
  if (subscription.status !== 'active' && subscription.status !== 'past_due') return null
  const latest = subscription.latest_invoice
  if (!latest || typeof latest === 'string' || latest.billing_reason === 'subscription_create') return null

  let renewal: Stripe.Invoice | undefined
  if (latest.billing_reason === 'subscription_cycle') {
    if (isUnpaidCycleInvoice(latest)) renewal = latest
  } else {
    const start = (subscription.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_start?: number }) | undefined)?.current_period_start
    let cutOff = false
    for (const status of UNPAID_INVOICE_STATUSES) {
      const page = await invoices.list({ subscription: subscription.id, status, limit: INVOICE_PAGE })
      renewal = page.data.find((invoice) => isUnpaidCycleInvoice(invoice) && invoice.period_end === start)
      if (renewal) break
      cutOff ||= page.has_more === true
    }
    if (!renewal && cutOff) return { invoice: null, priorPeriodPaid: false }
  }
  if (!renewal) return null

  return { invoice: renewal, priorPeriodPaid: await priorPeriodPaid(subscription.id, renewal, invoices) }
}

/**
 * Whether the period a renewal invoice follows was paid for, by a paid invoice ending where that
 * period starts. Only then may a row catch up to it. `void` and `uncollectible` renewals (for example
 * `pause_collection`) say nothing about it, and answer false without a read: a run of voided renewals
 * must not walk the row forward through periods nobody paid for.
 */
async function priorPeriodPaid(
  subscriptionId: string,
  renewal: Stripe.Invoice,
  invoices: InvoiceLister
): Promise<boolean> {
  if (renewal.status === 'void' || renewal.status === 'uncollectible') return false
  const { data } = await invoices.list({ subscription: subscriptionId, status: 'paid', limit: INVOICE_PAGE })
  return data.some((invoice) => invoice.period_end === renewal.period_start)
}

/** Stripe seconds as the ISO string a `timestamptz` column is written with. */
const toIso = (seconds: number): string => new Date(seconds * 1000).toISOString()

/**
 * The billing period to store (`ai_period_start`, `ai_period_end`, migration 030), which the month
 * key of the AI credits is computed from (`aiAllowanceMonth()` in `@tabmerger/shared`).
 *
 * Normally the item's current period. Both or neither: a subscription without both is written with
 * no stored period, and for a row already tracking this subscription the database keeps the stored
 * one (trigger subscriptions_keep_ai_period).
 *
 * While a renewal awaits payment the new period isn't stored. If the period that invoice follows (its
 * own `period_start` and `period_end`, the period just ended) was paid for, it is written: a row that
 * is up to date already holds it, so nothing changes, and a row left behind because the `invoice.paid`
 * of an earlier renewal never arrived catches up, so a missing endpoint event costs one period's delay
 * rather than credits that never reset again. Otherwise (nobody paid for it, or the invoice doesn't
 * line up with the item's period) no period is written at all.
 */
function aiPeriodColumns(
  subscription: Stripe.Subscription,
  unpaid: UnpaidRenewal | null
): {
  ai_period_start?: string | null
  ai_period_end?: string | null
} {
  const item = subscription.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_start?: number }) | undefined
  const start = item?.current_period_start
  const end = item?.current_period_end

  if (unpaid) {
    const { invoice, priorPeriodPaid: paid } = unpaid
    if (paid && invoice && invoice.period_end === start && typeof invoice.period_start === 'number' && invoice.period_start < invoice.period_end) {
      return { ai_period_start: toIso(invoice.period_start), ai_period_end: toIso(invoice.period_end) }
    }
    return {}
  }

  if (typeof start !== 'number' || typeof end !== 'number') return { ai_period_start: null, ai_period_end: null }
  return { ai_period_start: toIso(start), ai_period_end: toIso(end) }
}

/**
 * The credit columns of a subscription write, from what subscriptionAiColumns() worked out and
 * findUnpaidRenewal() found: the AI option, the allowance and the billing period. One function for the
 * webhook and the re-sync, so both apply the same hold. While a renewal of an `active` subscription
 * awaits payment the allowance is left out too (the row keeps what it has): a plan change landing at
 * that renewal, such as Pro to managed Pro AI, would otherwise bring credits on the old key before
 * anything was paid. `past_due` writes its 0 as usual, which is what freezes the allowance.
 * `invoice.paid`, or any later write that finds the invoice paid, writes the real figures.
 */
export function aiWriteColumns(
  subscription: Stripe.Subscription,
  ai: AiColumns,
  unpaid: UnpaidRenewal | null
): { ai_mode: AiMode; ai_monthly_credits?: number; ai_period_start?: string | null; ai_period_end?: string | null } {
  const held = subscription.status === 'active' && unpaid !== null
  return {
    ai_mode: ai.aiMode,
    ...(held ? {} : { ai_monthly_credits: ai.monthlyCredits }),
    ...aiPeriodColumns(subscription, unpaid),
  }
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
  if (subscription.status !== 'active') return { aiMode, monthlyCredits: 0 }

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
