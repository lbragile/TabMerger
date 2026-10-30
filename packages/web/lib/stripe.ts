import Stripe from 'stripe'
import { isEntitledSubscriptionStatus, type AiMode } from '@tabmerger/shared'
import type { CheckoutInterval, CheckoutTier } from './checkoutAnalytics'
import { describeStripeError } from './stripeErrors'
import { CheckoutRaceLostError } from './checkoutErrors'

/**
 * True when a real Stripe secret key was supplied. False in any environment missing
 * `STRIPE_SECRET_KEY` (CI builds, a fresh checkout before `.env.local` is populated) — every
 * exported operation below checks this and throws a clear config error before calling Stripe,
 * instead of either crashing at import time or sending a real request with a placeholder key.
 */
export const isStripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY)

// ponytail: `new Stripe(undefined)` throws "Neither apiKey nor config.authenticator provided" at
// construction time -- same bug class as the extension's supabase.ts crash (commit d45989c).
// `next build` evaluates every route module (including app/api/billing-portal, app/api/checkout,
// app/api/checkout/credits, app/api/webhooks/stripe) during "Collecting page data" to statically
// analyze it, even though the route handler itself never runs during build -- so a missing
// STRIPE_SECRET_KEY killed the *entire* build, not just disabled billing. The placeholder string
// keeps construction safe; it is never used for a real request because every operation below
// refuses to run without isStripeConfigured, so a fake key can't silently no-op a real charge.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_not_configured', {
  apiVersion: '2025-06-30.basil' as Stripe.LatestApiVersion,
  typescript: true,
})

/**
 * Checkout Sessions are created with Adaptive Pricing on: the customer sees and pays the
 * price in their local currency, with Stripe's conversion fee built into that amount (the
 * customer pays it), while we're credited the USD price. Our Prices stay USD-only.
 *
 * Adaptive Pricing for SUBSCRIPTIONS needs API version 2026-03-25.dahlia or later, so the
 * Checkout calls alone use it (per-request `apiVersion`); the client above stays on basil so
 * nothing else (portal, subscriptions, webhooks) changes shape. Stripe decides per session
 * whether to convert (location, currency support), so a session can still show USD.
 */
const CHECKOUT_API_VERSION = '2026-03-25.dahlia'
const LOCAL_CURRENCY_CHECKOUT = { adaptive_pricing: { enabled: true } } as const

// Re-export client-safe tier constants from their own module so that
// client components can import TIERS without pulling in the Stripe SDK.
export { TIERS, getStripePriceId, getPlanForPriceId, getPlanPriceIds } from './tiers'
export type { TierKey, BillingInterval } from './tiers'
import { getPlanForPriceId } from './tiers'
import { planChangeTiming } from './planChangeTiming'

/**
 * Shown next to the pay button of the credit-pack checkout (`custom_text.submit`, at most 1,200
 * characters). The terms page (section 3) says the same.
 */
export const CREDIT_PACK_REFUND_NOTICE =
  'AI credit packs are non-refundable, including if you cancel your subscription. Credits are for the current month and are never exchanged for money.'

export async function createCheckoutSession({
  userId,
  priceId,
  customerEmail,
  customerId,
  successUrl,
  cancelUrl,
  tier,
  interval,
  aiMode,
}: {
  userId: string
  priceId: string
  customerEmail?: string
  customerId?: string
  successUrl: string
  cancelUrl: string
  /** Plan and interval, already validated by the route; stamped on the session for analytics. */
  tier?: CheckoutTier
  interval?: CheckoutInterval
  /** Pro AI's option (TabMerger's key or the customer's own), validated by the route; analytics only. */
  aiMode?: AiMode
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    ...(customerId
      ? { customer: customerId }
      : customerEmail
        ? { customer_email: customerEmail }
        : {}),
    line_items: [{ price: priceId, quantity: 1 }],
    // Subscriptions already save the card to charge renewals automatically, but with
    // allow_redisplay: 'limited' (usable only for this subscription's own charges).
    // This opt-in checkbox lets the customer explicitly allow it to be prefilled for
    // other purchases too (e.g. an AI credit-pack top-up) instead of typing a card in
    // again — same mechanism as the credit-pack checkout in createCreditPackCheckoutSession.
    saved_payment_method_options: { payment_method_save: 'enabled' },
    // Shows Stripe's "Add promotion code" field. The codes are created and restricted in the
    // Stripe Dashboard, not here: the coupon sets the discount, how long it lasts and which
    // products it applies to; the promotion code on top sets redemption limits and expiry.
    // Stripe validates the code on its own page, so nothing on our side decides a price.
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    // user_id on session metadata is a fallback readable from session object directly.
    // tier/interval/ai_mode let the checkout.session.expired webhook report which plan was
    // abandoned without another Stripe call. The webhook re-validates them; none is ever trusted
    // for billing (the subscription's tier and AI option come from its price).
    metadata: {
      user_id: userId,
      ...(tier ? { tier } : {}),
      ...(interval ? { interval } : {}),
      ...(aiMode ? { ai_mode: aiMode } : {}),
    },
    // user_id on subscription_data metadata travels with the subscription object
    subscription_data: {
      metadata: { user_id: userId },
    },
    ...LOCAL_CURRENCY_CHECKOUT,
  }, { apiVersion: CHECKOUT_API_VERSION })

  if (!session.url) throw new Error('Failed to create checkout session')

  // Only the newest subscription checkout of a customer can be paid: one opened in another tab is
  // expired, so two of them can't both complete into two subscriptions. Throws
  // CheckoutRaceLostError (this session expired, no URL) when another one was paid meanwhile.
  if (customerId) await expireOtherOpenSubscriptionCheckouts(customerId, session.id)

  return session.url
}

/**
 * Expires the customer's other open subscription-mode Checkout Sessions (not credit-pack ones),
 * keeping `keepSessionId`. At most one page (100) is read.
 *
 * Best effort, with one exception. A session that completes or expires just before its turn can't
 * be expired any more (Stripe refuses). The failure is logged and that session is read again: if
 * it has completed as a subscription, a plan went live during this checkout, so `keepSessionId` is
 * expired too and CheckoutRaceLostError is thrown (the route answers 409 `already_subscribed`; the
 * completed session's own webhook records the plan). Any other failure (the list, an expire for
 * another reason, the re-read) is logged and the new checkout goes ahead.
 */
export async function expireOtherOpenSubscriptionCheckouts(
  customerId: string,
  keepSessionId: string
): Promise<void> {
  let open: Stripe.ApiList<Stripe.Checkout.Session>
  try {
    open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 })
  } catch (err) {
    console.error(`Checkout: listing open sessions to expire failed: ${describeStripeError(err)}`)
    return
  }
  for (const session of open.data) {
    if (session.id === keepSessionId || session.mode !== 'subscription') continue
    try {
      await stripe.checkout.sessions.expire(session.id)
    } catch (err) {
      console.warn(`Checkout: expiring open session ${session.id} failed: ${describeStripeError(err)}`)
      if (await completedAsSubscription(session.id)) {
        try {
          await stripe.checkout.sessions.expire(keepSessionId)
        } catch (expireErr) {
          // Its URL is never handed out, so it can't be paid even if it stays open.
          console.error(`Checkout: expiring new session ${keepSessionId} failed: ${describeStripeError(expireErr)}`)
        }
        console.warn(
          `Checkout: session ${session.id} completed while a new checkout started; new session ${keepSessionId} withdrawn`
        )
        throw new CheckoutRaceLostError(session.id)
      }
    }
  }
}

/** Whether a Checkout Session has completed in subscription mode. False when it can't be read. */
async function completedAsSubscription(sessionId: string): Promise<boolean> {
  try {
    const current = await stripe.checkout.sessions.retrieve(sessionId)
    return current.status === 'complete' && current.mode === 'subscription'
  } catch (err) {
    console.warn(`Checkout: reading session ${sessionId} after a failed expire failed: ${describeStripeError(err)}`)
    return false
  }
}

/** Pages read by listCustomerSubscriptions() (100 each) before it gives up. */
const MAX_SUBSCRIPTION_PAGES = 5

/**
 * Every subscription of the customer that isn't canceled (Stripe's list without a status), all
 * pages. A failure on the first page is thrown as Stripe threw it (`resource_missing` with param
 * `customer` for an unknown customer). A failure on a later page is thrown as a plain Error with
 * no Stripe code: the customer exists (page one was read), so it must never read as "no such
 * customer" (a bad cursor is also `resource_missing`, with param `starting_after`). More than
 * MAX_SUBSCRIPTION_PAGES pages is an Error too, so a caller deciding what may be sold fails closed
 * instead of deciding on part of the list.
 */
export async function listCustomerSubscriptions(customerId: string): Promise<Stripe.Subscription[]> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')
  const all: Stripe.Subscription[] = []
  let startingAfter: string | undefined
  for (let page = 0; page < MAX_SUBSCRIPTION_PAGES; page++) {
    let listed: Stripe.ApiList<Stripe.Subscription>
    try {
      listed = await stripe.subscriptions.list({
        customer: customerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
    } catch (err) {
      if (page === 0) throw err
      throw new Error(`Listing subscriptions page ${page + 1} failed: ${describeStripeError(err)}`)
    }
    all.push(...listed.data)
    if (!listed.has_more) return all
    startingAfter = listed.data.at(-1)?.id
    if (!startingAfter) break
  }
  throw new Error(`More subscriptions than ${MAX_SUBSCRIPTION_PAGES} pages for one customer; not read`)
}

/**
 * Creates a one-time (mode: 'payment') Checkout Session for the AI credit pack top-up.
 * user_id is stamped on session metadata (not subscription_data — there's no subscription
 * here) since it's the only place the webhook can recover the buyer for a one-time payment.
 */
export async function createCreditPackCheckoutSession({
  userId,
  quantity = 50,
  customerEmail,
  customerId,
  successUrl,
  cancelUrl,
}: {
  userId: string
  quantity?: number
  customerEmail?: string
  customerId?: string
  successUrl: string
  cancelUrl: string
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const priceId = process.env.STRIPE_AI_CREDIT_PACK_PRICE_ID
  if (!priceId) throw new Error('STRIPE_AI_CREDIT_PACK_PRICE_ID not configured')

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    ...(customerId
      ? { customer: customerId }
      : customerEmail
        ? { customer_email: customerEmail, customer_creation: 'always' }
        : {}),
    // adjustable_quantity lets the customer change the pack size on Stripe's own Checkout
    // page, not just before landing there — mirrors the same 50-500 clamp the
    // /api/checkout/credits route already enforces server-side on `quantity`. One unit is
    // $0.05, so the smallest pack is $2.50, clear of Stripe's $0.50 minimum charge. The
    // credits granted are not the quantity: the webhook converts the USD amount actually paid
    // with creditsForPayment() ($2.50 funds 820 credits).
    line_items: [{ price: priceId, quantity, adjustable_quantity: { enabled: true, minimum: 50, maximum: 500 } }],
    // Shows an opt-in "Save my payment method for future purchases" checkbox on
    // Checkout — the customer chooses, nothing is saved silently. Requires an
    // actual Customer object (either the existing one, or a freshly created one
    // via customer_creation above when we only had an email).
    saved_payment_method_options: { payment_method_save: 'enabled' },
    // Same "Add promotion code" field as the subscription checkout; codes are created and
    // restricted in the Stripe Dashboard. A coupon that isn't limited to specific products
    // works here too, so limit subscription coupons to the plan's product. The webhook grants
    // credits from the USD amount paid, so a discounted pack grants proportionally fewer
    // credits and a free one grants none.
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: userId, type: 'ai_credit_pack' },
    // The refund policy, where the pack is bought: packs are never refunded (cancelling the
    // subscription included) and unused credits don't turn into money.
    custom_text: { submit: { message: CREDIT_PACK_REFUND_NOTICE } },
    ...LOCAL_CURRENCY_CHECKOUT,
  }, { apiVersion: CHECKOUT_API_VERSION })

  if (!session.url) throw new Error('Failed to create checkout session')
  return session.url
}

/**
 * Language/format for every Billing Portal session. With Stripe's default ("auto") the portal
 * shows our USD prices as a bare "$42.99", which a Canadian reads as CAD. en-CA makes Stripe
 * write "US$42.99" for everyone, so the currency is never ambiguous. The site is English-only.
 */
const PORTAL_LOCALE = 'en-CA' satisfies Stripe.BillingPortal.SessionCreateParams.Locale

export async function createBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string
  returnUrl: string
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: PORTAL_LOCALE,
  })

  return session.url
}

/**
 * A plan change waiting in the subscription's schedule: the price the next phase moves to and when
 * (unix seconds). Made by Stripe's confirm page (a deferred downgrade) or by our server
 * (`scheduleChangeAtPeriodEnd()`).
 */
export interface PendingPlanChange {
  priceId: string
  effectiveAt: number
}

/**
 * The plan change pending on `subscriptionId`, read from Stripe, or null when there is none (no
 * schedule, a schedule that has ended or been released, or a next phase on the same price). Only
 * the caller's own subscription is read: one on another customer is treated as none.
 */
export async function getPendingPlanChange({
  customerId,
  subscriptionId,
}: {
  customerId: string
  subscriptionId: string
}): Promise<PendingPlanChange | null> {
  if (!isStripeConfigured) return null
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['schedule'] })
  if (idOf(subscription.customer) !== customerId) return null
  const pending = pendingChangeOf(subscription)
  return pending ? { priceId: pending.priceId, effectiveAt: pending.effectiveAt } : null
}

/**
 * The plan change pending in a subscription retrieved with `expand: ['schedule']`, with the
 * schedule that holds it, or null: no schedule, one that has ended or been released, or a next
 * phase on the current price. Shared by the account page's notice (getPendingPlanChange()) and
 * keepCurrentPlan(), so the change released is the one the page showed.
 */
function pendingChangeOf(
  subscription: Stripe.Subscription
): (PendingPlanChange & { schedule: Stripe.SubscriptionSchedule }) | null {
  const schedule = subscription.schedule
  if (!schedule || typeof schedule === 'string') return null
  if (schedule.status !== 'active' && schedule.status !== 'not_started') return null
  const currentPriceId = subscription.items.data[0]?.price.id
  const currentEnd = schedule.current_phase?.end_date ?? subscription.items.data[0]?.current_period_end
  const next = schedule.phases.find((phase) => phase.start_date >= currentEnd)
  const priceId = idOf(next?.items[0]?.price)
  if (!next || !priceId || priceId === currentPriceId) return null
  return { priceId, effectiveAt: next.start_date, schedule }
}

/**
 * Why a scheduled plan change couldn't be undone; the route maps each to a status code.
 *
 * - `not_found`: the subscription doesn't exist at Stripe or isn't this customer's.
 * - `no_scheduled_change`: nothing is scheduled on it (never was, already undone by an earlier
 *   click, already landed, or a schedule that isn't this subscription's own).
 */
export class KeepCurrentPlanError extends Error {
  constructor(readonly reason: 'not_found' | 'no_scheduled_change') {
    super(reason)
  }
}

/**
 * Undoes the plan change scheduled on the customer's subscription (a downgrade the Billing Portal
 * deferred, or one our server scheduled), so the subscription renews on its current price. The
 * only write is `subscriptionSchedules.release()`: it detaches the schedule and leaves the
 * subscription exactly as it is (price, period, discounts), so nothing is prorated, invoiced,
 * charged or credited (verified on test clocks, 2026-10-27: no invoice, no invoice items, balance
 * unchanged, renewal on the current price). The webhook records the update Stripe sends.
 *
 * The subscription is read from Stripe again here, never taken from the client. Ownership: it must
 * belong to `customerId` (the caller's own customer, from their profile), else `not_found`; and the
 * schedule released must be the one attached to that subscription, for that customer, and still
 * hold a pending change (the same reading as the account page's notice), else
 * `no_scheduled_change`. A release that fails because the schedule was released meanwhile (a
 * second click) is `no_scheduled_change` too; any other failure is rethrown.
 *
 * Returns the kept plan's renewal (date, and the amount from Stripe's preview of the next invoice
 * when that preview works), or null when the subscription is set to end. See renewalAfterRelease().
 */
export async function keepCurrentPlan({
  customerId,
  subscriptionId,
}: {
  customerId: string
  subscriptionId: string
}): Promise<KeptPlanRenewal | null> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  const read = async () => {
    try {
      return await stripe.subscriptions.retrieve(subscriptionId, { expand: ['schedule'] })
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === 'resource_missing') throw new KeepCurrentPlanError('not_found')
      throw err
    }
  }

  const subscription = await read()
  if (idOf(subscription.customer) !== customerId) throw new KeepCurrentPlanError('not_found')
  const pending = pendingChangeOf(subscription)
  if (!pending) throw new KeepCurrentPlanError('no_scheduled_change')
  const { schedule } = pending
  if (idOf(schedule.subscription) !== subscription.id || idOf(schedule.customer) !== customerId) {
    console.warn(
      `Keep current plan: schedule ${schedule.id} on subscription ${subscription.id} names another subscription or customer, so it is not released`
    )
    throw new KeepCurrentPlanError('no_scheduled_change')
  }

  try {
    await stripe.subscriptionSchedules.release(schedule.id)
  } catch (err) {
    // A double click, or Stripe releasing it as the change landed: it is gone either way.
    const again = await read().catch(() => null)
    if (again && !pendingChangeOf(again)) throw new KeepCurrentPlanError('no_scheduled_change')
    throw err
  }

  return renewalAfterRelease(customerId, subscription)
}

/**
 * When the kept plan renews and what that renewal will charge, for the account page's "Your plan
 * stays ..." message. `at` is the end of the current period (unix seconds). `amount` (in the
 * currency's major unit, e.g. 42.99) and `currency` (ISO 4217, upper case) come from Stripe's
 * preview of the next invoice, so discounts, tax and any account credit are included; both are
 * absent when the preview fails.
 */
export interface KeptPlanRenewal {
  at: number
  amount?: number
  currency?: string
}

/**
 * Stripe's zero- and three-decimal currencies (docs.stripe.com/currencies): their API amounts are in
 * 1 and 1/1000 of the unit. Every other currency's are in 1/100, including ISK and UGX, which Stripe
 * still represents with two decimals.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
])
const THREE_DECIMAL_CURRENCIES = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd'])

/** A Stripe amount (minor units) in the currency's major unit: 4299 USD -> 42.99, 500 JPY -> 500. */
export function fromStripeAmount(amount: number, currency: string): number {
  const code = currency.toLowerCase()
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return amount
  return amount / (THREE_DECIMAL_CURRENCIES.has(code) ? 1000 : 100)
}

/**
 * The renewal of `subscription` (as read before the release) once its schedule is released, or
 * null when it won't renew (set to end). The amount is previewed after the release, so it is the
 * current price's; a failed preview is logged and leaves the amount out, never failing the caller,
 * since the plan has already been kept.
 */
async function renewalAfterRelease(
  customerId: string,
  subscription: Stripe.Subscription
): Promise<KeptPlanRenewal | null> {
  if (subscription.cancel_at_period_end || subscription.cancel_at) return null
  const at = subscription.items.data[0]?.current_period_end
  if (typeof at !== 'number') return null
  try {
    const preview = await stripe.invoices.createPreview({ customer: customerId, subscription: subscription.id })
    if (typeof preview.amount_due !== 'number' || typeof preview.currency !== 'string') return { at }
    return {
      at,
      amount: fromStripeAmount(preview.amount_due, preview.currency),
      currency: preview.currency.toUpperCase(),
    }
  } catch (err) {
    console.warn(
      `Keep current plan: previewing the renewal invoice of subscription ${subscription.id} failed, so only its date is shown: ${describeStripeError(err)}`
    )
    return { at }
  }
}

/**
 * Why a cancellation flow couldn't start; the route maps each to a status code.
 *
 * - `not_found`: the subscription doesn't exist at Stripe or isn't this customer's.
 * - `not_entitled`: it has ended, or isn't paid up (nothing to cancel at the period end).
 * - `already_canceling`: it is already set to end.
 */
export class CancelSubscriptionError extends Error {
  constructor(readonly reason: 'not_found' | 'not_entitled' | 'already_canceling') {
    super(reason)
  }
}

/**
 * Every active Billing Portal configuration other than the account's default, read page by page
 * to the end of the list. Each one's `features.subscription_update.products` is expanded: Stripe
 * leaves it out of a list otherwise (checked in test mode, 2026-10-26), and the lookups below check
 * it. The list has no metadata filter, so callers match in code.
 */
async function listActivePortalConfigurations(): Promise<Stripe.BillingPortal.Configuration[]> {
  const all: Stripe.BillingPortal.Configuration[] = []
  let startingAfter: string | undefined
  for (;;) {
    const page = await stripe.billingPortal.configurations.list({
      active: true,
      is_default: false,
      limit: 100,
      expand: ['data.features.subscription_update.products'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    all.push(...page.data)
    if (!page.has_more || page.data.length === 0) return all
    startingAfter = page.data[page.data.length - 1].id
  }
}

/**
 * True when a configuration's cancellation can't refund or credit: at the end of the period, with
 * no proration. Both of our configurations allow cancelling, so both check this.
 */
function cancelsAtPeriodEndWithoutProration(config: Stripe.BillingPortal.Configuration): boolean {
  const cancel = config.features?.subscription_cancel
  return cancel?.enabled === true && cancel.mode === 'at_period_end' && cancel.proration_behavior === 'none'
}

/**
 * Logs a configuration found by our metadata whose features no longer match what this code makes
 * (edited in the Dashboard, or made by an older build). It isn't used; a new one is made instead.
 */
function logMismatchedPortalConfiguration(kind: string, config: Stripe.BillingPortal.Configuration): void {
  console.warn(
    `Billing portal: configuration ${config.id} (${kind}) has the expected metadata but different features, so it is not used and a new one is made`
  )
}

/**
 * How long a portal configuration id found or made below is reused before it is looked up again.
 * The lookup re-checks the configuration's features (one edited in the Dashboard is skipped and a
 * new one made), so an edit is caught within this time rather than only on a cold start.
 */
export const PORTAL_CONFIGURATION_TTL_MS = 10 * 60 * 1000

/** Configuration ids per cache key, with when each must be looked up again (per server instance). */
const portalConfigurationCache = new Map<string, { id: string; expiresAt: number }>()
/** Lookups in progress per cache key, shared by concurrent callers on this instance. */
const portalConfigurationLookups = new Map<string, Promise<string>>()

/**
 * The configuration id cached under `key`, or the result of `lookUp()` (then cached for
 * PORTAL_CONFIGURATION_TTL_MS). Concurrent callers on one instance share a single lookup, so a
 * burst of first requests can't make several identical configurations. A failed lookup caches
 * nothing and is retried by the next call. Separate instances still look up independently; two
 * cold starts at the same moment can each make one (harmless: both are correct, and later lookups
 * use the first one listed).
 */
async function cachedPortalConfiguration(key: string, lookUp: () => Promise<string>): Promise<string> {
  const cached = portalConfigurationCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.id
  const inFlight = portalConfigurationLookups.get(key)
  if (inFlight) return inFlight
  const lookup = lookUp()
    .then((id) => {
      portalConfigurationCache.set(key, { id, expiresAt: Date.now() + PORTAL_CONFIGURATION_TTL_MS })
      return id
    })
    .finally(() => portalConfigurationLookups.delete(key))
  portalConfigurationLookups.set(key, lookup)
  return lookup
}

/** Bump when the configuration below changes. */
const CANCEL_CONFIGURATION_VERSION = 'v1'
const CANCEL_METADATA_KEY = 'tabmerger_cancel'

/** True when `config` is the cancellation configuration cancelPortalConfiguration() makes. */
function isCancelConfiguration(config: Stripe.BillingPortal.Configuration): boolean {
  return cancelsAtPeriodEndWithoutProration(config) && config.features?.subscription_update?.enabled === false
}

/**
 * The Billing Portal configuration the cancellation flow uses: cancellation at the end of the
 * period with no proration (no refund, no credit), payment methods and invoices, and no plan
 * switching. Passed explicitly rather than relying on the account's default configuration, which
 * is edited in the Dashboard. Found by metadata (`tabmerger_cancel: v1`) among the active
 * configurations, and used only when its features still say the above (one edited in the
 * Dashboard is skipped and a new one made); then cached for PORTAL_CONFIGURATION_TTL_MS, like the
 * plan-change configurations (cachedPortalConfiguration()).
 */
function cancelPortalConfiguration(): Promise<string> {
  return cachedPortalConfiguration(`cancel:${CANCEL_CONFIGURATION_VERSION}`, lookUpCancelPortalConfiguration)
}

async function lookUpCancelPortalConfiguration(): Promise<string> {
  const tagged = (await listActivePortalConfigurations()).filter(
    (c) => c.metadata?.[CANCEL_METADATA_KEY] === CANCEL_CONFIGURATION_VERSION
  )
  const found = tagged.find(isCancelConfiguration)
  if (found) return found.id
  for (const config of tagged) logMismatchedPortalConfiguration('cancellation', config)
  const created = await stripe.billingPortal.configurations.create({
    name: `TabMerger cancellation (${CANCEL_CONFIGURATION_VERSION})`,
    metadata: { [CANCEL_METADATA_KEY]: CANCEL_CONFIGURATION_VERSION },
    features: {
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: { enabled: false },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
    },
  })
  return created.id
}

/**
 * Opens Stripe's own "cancel plan" page for the customer's subscription
 * (`flow_data.type: subscription_cancel`): the customer confirms there, the plan ends at the end of
 * the paid period, and nothing is refunded or credited. Works while a plan change is scheduled,
 * which the portal's home page doesn't offer: confirming releases the schedule (the subscription
 * keeps its current price) and sets `cancel_at_period_end` (verified in test mode, 2026-10-26).
 * Our server changes nothing itself; the webhook records the result.
 *
 * Ownership is checked here, at Stripe: the subscription must belong to `customerId` (the caller's
 * own customer, from their profile), or it is `not_found`.
 */
export async function createCancelSubscriptionSession({
  customerId,
  subscriptionId,
  returnUrl,
}: {
  customerId: string
  subscriptionId: string
  returnUrl: string
}): Promise<string> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 'resource_missing') throw new CancelSubscriptionError('not_found')
    throw err
  }
  if (idOf(subscription.customer) !== customerId) throw new CancelSubscriptionError('not_found')
  if (!isEntitledSubscriptionStatus(subscription.status)) throw new CancelSubscriptionError('not_entitled')
  if (subscription.cancel_at_period_end || subscription.cancel_at) {
    throw new CancelSubscriptionError('already_canceling')
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: PORTAL_LOCALE,
    configuration: await cancelPortalConfiguration(),
    flow_data: {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: subscription.id },
      after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
    },
  })
  return session.url
}

/**
 * Why a plan switch couldn't start; the route maps each to a status code.
 *
 * - `no_customer`: Stripe has no such customer in this account and mode (`resource_missing`).
 * - `no_entitled_subscription`: the customer has no entitled subscription at Stripe at all (every
 *   one has ended, or there never was one), checked across all of them. The database row may still
 *   show a plan when a webhook delivery was missed: lib/planSwitch.ts corrects it.
 * - `open_subscription`: no entitled subscription either, but one that can still come back
 *   (OPEN_SUBSCRIPTION_STATUSES: an unpaid invoice, paused, or a first payment not yet made).
 *   Paying or resuming it makes it live again, so a new checkout would leave two plans billing.
 * - `no_subscription`: no entitled subscription on one of the plan's prices, while one that can't be
 *   read as this plan may exist (a live subscription on a price this deployment doesn't know, with
 *   several items, or more subscriptions than one page lists). Nothing is corrected for it.
 * - `would_credit`: an upgrade whose invoice, previewed at Stripe, comes out below zero (a coupon on
 *   the subscription that discounts the new price more than the old one). Applying it would leave
 *   the customer a balance credit, which no plan change may do, so it isn't offered.
 */
export class PlanSwitchError extends Error {
  constructor(
    readonly reason:
      | 'no_customer'
      | 'no_entitled_subscription'
      | 'open_subscription'
      | 'no_subscription'
      | 'already_on_price'
      | 'already_scheduled'
      | 'cancel_scheduled'
      | 'price_unavailable'
      | 'would_credit'
  ) {
    super(reason)
  }
}

/**
 * What a plan switch did (see `planChangeTiming()` in lib/planChangeTiming.ts):
 * - `portal`: the customer confirms on Stripe's "confirm plan change" page at `url`;
 * - `scheduled`: the change takes effect at `effectiveAt` (unix seconds, the end of the paid
 *   period), with no proration.
 */
export type PlanSwitchResult =
  | { kind: 'portal'; url: string }
  | { kind: 'scheduled'; effectiveAt: number }

/**
 * Statuses of a subscription that isn't entitled now but becomes live again once its invoice is
 * paid or it is resumed (`incomplete` until it expires after about a day). `incomplete_expired` and
 * `canceled` are final.
 */
export const OPEN_SUBSCRIPTION_STATUSES: readonly string[] = ['unpaid', 'paused', 'incomplete']

const idOf = (value: string | { id: string } | null | undefined): string | undefined =>
  typeof value === 'string' ? value : value?.id

/**
 * Moves the customer's paid subscription (one whose price is in `planPriceIds`) to
 * `targetPriceId`, following the refund policy (docs/PAYMENTS.md, "Refund policy"):
 *
 * - **Upgrades** (nothing gets cheaper or shorter, own key → managed included) are confirmed by
 *   the customer on the Billing Portal's "confirm plan change" page, which shows the amount and the
 *   card, and are charged now, prorated against the unused time (`always_invoice`). Their invoice
 *   is previewed first: one that would come out below zero (a coupon) is refused (`would_credit`).
 * - **Changes the portal defers** (`portal_end_of_period`: yearly → monthly on the same plan and
 *   option, and downgrades whose interval doesn't shorten: Pro AI → Pro, managed → own key, own
 *   key → Pro) go to the same page, and the configuration's `decreasing_item_amount` /
 *   `shortening_interval` conditions make Stripe schedule them for the end of the period, with no
 *   credit. Across products that is undocumented Stripe behaviour (see lib/planChangeTiming.ts);
 *   the webhook's plan-change alarm reports it if it ever applies at once.
 * - **Downgrades with a shorter interval** (yearly → monthly together with another change) are
 *   scheduled here for the end of the paid period with no proration: a subscription schedule whose
 *   current phase ends with the period and whose next phase, on the new price, lasts one second
 *   before the schedule releases the subscription. Nothing is refunded
 *   or credited, and access to the current plan lasts until then.
 *
 * Stripe fires `customer.subscription.updated` when the price actually changes (now, or when the
 * schedule's next phase starts), and the webhook records the new tier, interval, AI option and
 * credit allowance, so nothing is written to the database here.
 *
 * Each portal session uses a configuration that lists the target price and nothing else
 * (`planChangePortalConfiguration()`), so the session can't be used for any other change.
 */
export async function createPlanSwitchSession({
  customerId,
  targetPriceId,
  planPriceIds,
  returnUrl,
}: {
  customerId: string
  targetPriceId: string
  planPriceIds: readonly string[]
  returnUrl: string
}): Promise<PlanSwitchResult> {
  if (!isStripeConfigured) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)')

  // Without a status filter Stripe lists every subscription that isn't canceled.
  let listed: Stripe.ApiList<Stripe.Subscription>
  try {
    listed = await stripe.subscriptions.list({ customer: customerId, limit: 10 })
  } catch (err) {
    // A customer id from another account or mode, or one that was deleted. Stripe answers this
    // list with code resource_missing and HTTP 400 (not 404), so only the code is checked.
    if ((err as { code?: unknown } | null)?.code === 'resource_missing') throw new PlanSwitchError('no_customer')
    throw err
  }
  const entitled = listed.data.filter((s) => isEntitledSubscriptionStatus(s.status))
  const subscription = entitled.find(
    (s) => s.items.data.length === 1 && planPriceIds.includes(s.items.data[0].price.id)
  )
  if (!subscription) {
    // "No plan at all" only when the whole list was seen; a live subscription on an unknown price
    // (or one past the first page) must never read as an ended plan.
    if (entitled.length > 0 || listed.has_more === true) throw new PlanSwitchError('no_subscription')
    // A plan that can still be paid or resumed is never treated as ended: that would send the
    // customer to a second subscription.
    throw new PlanSwitchError(
      listed.data.some((s) => OPEN_SUBSCRIPTION_STATUSES.includes(s.status))
        ? 'open_subscription'
        : 'no_entitled_subscription'
    )
  }

  const item = subscription.items.data[0]
  if (item.price.id === targetPriceId) throw new PlanSwitchError('already_on_price')
  // A deferred change (ours, or the portal's yearly→monthly) is a subscription schedule. While it
  // is pending, Stripe won't take another update, so say so instead of failing.
  if (subscription.schedule) throw new PlanSwitchError('already_scheduled')
  // A subscription set to end can't be given a schedule, and changing it would undo nothing the
  // customer asked for. They renew it in the portal first.
  if (subscription.cancel_at_period_end || subscription.cancel_at) {
    throw new PlanSwitchError('cancel_scheduled')
  }

  // An archived Price can't be switched to (a portal configuration rejects it, and a schedule
  // would fail at the period end). Say so instead of a generic failure.
  const targetPrice = await stripe.prices.retrieve(targetPriceId)
  if (!targetPrice.active) throw new PlanSwitchError('price_unavailable')

  // One rule for the server and the client's confirmation step (lib/planChangeTiming.ts):
  // usePlanChange shows its own dialog only for `end_of_period`, scheduled here with no Stripe page
  // after it, and sends the portal changes straight to Stripe's confirm page.
  const to = getPlanForPriceId(targetPriceId)
  const timing = planChangeTiming(getPlanForPriceId(item.price.id), to)

  if (timing === 'end_of_period') {
    return scheduleChangeAtPeriodEnd(subscription, targetPriceId, idOf(targetPrice.product))
  }
  // 'portal' (an upgrade: charged now, prorated) or 'portal_end_of_period' (a change the confirm
  // page defers to the period end through the configuration's conditions). The target price may be
  // on another product (each option is its own): the confirm flow accepts that.
  if (timing === 'portal') await refuseUpgradeThatCredits(customerId, subscription.id, item.id, targetPriceId)

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    locale: PORTAL_LOCALE,
    configuration: await planChangePortalConfiguration(targetPriceId, idOf(targetPrice.product)),
    flow_data: {
      type: 'subscription_update_confirm',
      subscription_update_confirm: {
        subscription: subscription.id,
        items: [{ id: item.id, price: targetPriceId, quantity: 1 }],
      },
      after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
    },
  })

  return { kind: 'portal', url: session.url }
}

/**
 * Previews, at Stripe, the invoice the confirm page would make for an upgrade (`always_invoice`:
 * the new price prorated, minus the unused time of the old one, with the subscription's and the
 * customer's discounts applied) and refuses the switch (`would_credit`) when its total is below
 * zero. At list prices an upgrade always costs more than the time it replaces
 * (__tests__/refundPolicy.test.ts), but a coupon that discounts only the new price (or only the
 * old one less) can turn it into a balance credit, and no plan change may leave one. Fails closed:
 * when the preview itself fails, the error is logged and rethrown, so the route answers
 * `switch_failed` and no portal session is made.
 */
async function refuseUpgradeThatCredits(
  customerId: string,
  subscriptionId: string,
  itemId: string,
  targetPriceId: string
): Promise<void> {
  let preview: Stripe.Invoice
  try {
    preview = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscriptionId,
      subscription_details: {
        items: [{ id: itemId, price: targetPriceId, quantity: 1 }],
        proration_behavior: 'always_invoice',
      },
    })
  } catch (err) {
    console.error(
      `Plan switch: previewing the upgrade invoice of subscription ${subscriptionId} failed, so the switch is refused: ${describeStripeError(err)}`
    )
    throw err
  }
  if (preview.total < 0) {
    console.warn(
      `Plan switch: refused an upgrade of subscription ${subscriptionId} to ${targetPriceId}: the previewed invoice total is ${preview.total} (a credit)`
    )
    throw new PlanSwitchError('would_credit')
  }
}

/** Bump when the configuration below changes, so new sessions get a configuration made from it. */
const PLAN_CHANGE_CONFIGURATION_VERSION = 'v3'
const PLAN_CHANGE_METADATA_KEY = 'tabmerger_plan_change'

/**
 * The Billing Portal configuration a plan-change flow to `targetPriceId` uses: subscription
 * updates to that one price only, charged now and prorated (`always_invoice`) unless the change
 * lowers the price or shortens the interval: `decreasing_item_amount` and `shortening_interval`
 * make the confirm page schedule those for the end of the period instead (no proration, no
 * credit); cancellation at period end with no proration. Version history: v1 had
 * `shortening_interval` only, which applied every cheaper cross-product switch at once with a
 * balance credit; v2 (2026-10-26) adds `decreasing_item_amount`. In test mode it never deferred
 * monthly → yearly within one product, and across products it deferred only when the yearly
 * price is cheaper per month (a downgrade); upgrades stayed immediate. v3 (2026-10-26) turns off
 * promotion codes (`default_allowed_updates: ['price']`): a code entered on the confirm page could
 * discount the new price below the unused time it is netted against and leave a credit, and no
 * plan change may leave one.
 *
 * Why one per target: a flow session (`flow_data`) only hides the rest of the portal, and Stripe
 * offers no way to limit a session to its confirm page (`after_completion` only chooses where the
 * customer goes after confirming). Its configuration is what a customer
 * could use from the generic "update plan" page, so a configuration listing several plans would
 * let them pick a downgrade there, applied at once with a proration credit. Listing only the
 * target leaves nothing else to switch to. Stripe doesn't need the subscription's current price
 * listed for `subscription_update_confirm` (checked in test mode, 2026-10-23).
 *
 * Made on first use and found again by metadata (`tabmerger_plan_change: v3:<price>`) among the
 * active configurations (deactivated ones are never reused), so no per-environment setup is
 * needed; the id is cached in memory for PORTAL_CONFIGURATION_TTL_MS (cachedPortalConfiguration()), so
 * the features are re-checked that often. A configuration found that way is used only when its
 * features still match what this code makes (isPlanChangeConfiguration()); one edited in the
 * Dashboard is skipped and a new one made. Stripe can't delete a portal configuration; older
 * versions are no longer looked up and are deactivated by hand (docs/PAYMENTS.md runbook).
 */
function planChangePortalConfiguration(targetPriceId: string, product: string | undefined): Promise<string> {
  const key = `${PLAN_CHANGE_CONFIGURATION_VERSION}:${targetPriceId}`
  return cachedPortalConfiguration(`plan_change:${key}`, () => lookUpPlanChangePortalConfiguration(key, targetPriceId, product))
}

async function lookUpPlanChangePortalConfiguration(
  key: string,
  targetPriceId: string,
  product: string | undefined
): Promise<string> {
  const tagged = (await listActivePortalConfigurations()).filter((c) => c.metadata?.[PLAN_CHANGE_METADATA_KEY] === key)
  const found = tagged.find((c) => isPlanChangeConfiguration(c, targetPriceId, product))
  if (found) return found.id
  for (const config of tagged) logMismatchedPortalConfiguration('plan change', config)

  if (!product) throw new Error(`Price ${targetPriceId} has no product`)

  const created = await stripe.billingPortal.configurations.create({
    name: `TabMerger plan change to ${targetPriceId} (${PLAN_CHANGE_CONFIGURATION_VERSION})`,
    metadata: { [PLAN_CHANGE_METADATA_KEY]: key },
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'always_invoice',
        schedule_at_period_end: {
          conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }],
        },
        products: [{ product, prices: [targetPriceId], adjustable_quantity: { enabled: false } }],
      },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
    },
  })
  return created.id
}

/** The conditions planChangePortalConfiguration() sets, in any order. */
const PLAN_CHANGE_CONDITIONS = ['decreasing_item_amount', 'shortening_interval']

/**
 * True when `config` still has the features planChangePortalConfiguration() makes for
 * `targetPriceId`: subscription updates on, prices only (no promotion codes, no quantities),
 * `always_invoice`, both deferral conditions, one product entry listing the target price and
 * nothing else (on `product`, when known), and cancellation at period end with no proration.
 */
function isPlanChangeConfiguration(
  config: Stripe.BillingPortal.Configuration,
  targetPriceId: string,
  product: string | undefined
): boolean {
  const update = config.features?.subscription_update
  if (!update?.enabled || update.proration_behavior !== 'always_invoice') return false
  const allowed = update.default_allowed_updates ?? []
  if (allowed.length !== 1 || allowed[0] !== 'price') return false
  const conditions = (update.schedule_at_period_end?.conditions ?? []).map((c) => c.type as string).sort()
  if (conditions.join() !== [...PLAN_CHANGE_CONDITIONS].sort().join()) return false
  const products = update.products ?? []
  if (products.length !== 1) return false
  const [entry] = products
  if (entry.prices.length !== 1 || entry.prices[0] !== targetPriceId) return false
  if (product && entry.product !== product) return false
  if (entry.adjustable_quantity?.enabled) return false
  return cancelsAtPeriodEndWithoutProration(config)
}

/**
 * The subscription's own discounts (subscription-level, not the customer's) whose coupon also
 * applies to `targetProduct`: no `applies_to` restriction, or one that lists the product. A
 * schedule phase that leaves `discounts` out drops the subscription's discounts (only the
 * customer's discount is inherited), so the target phase passes these back by id. A coupon
 * restricted to other products is left behind: it wouldn't discount the new price anyway.
 * Throws when a discount or coupon can't be read (the caller releases the schedule).
 */
async function discountsForTarget(
  subscription: Stripe.Subscription,
  targetProduct: string | undefined
): Promise<string[]> {
  if (!subscription.discounts || subscription.discounts.length === 0) return []
  const { discounts } = await stripe.subscriptions.retrieve(subscription.id, { expand: ['discounts'] })
  const carried: string[] = []
  for (const discount of discounts) {
    if (typeof discount === 'string') throw new Error(`Discount ${discount} was not expanded`)
    // `source.coupon` on current API versions, a top-level `coupon` on older ones; id or object.
    const legacy = discount as unknown as { coupon?: string | Stripe.Coupon | null }
    const couponId = idOf(discount.source?.coupon ?? legacy.coupon ?? null)
    if (!couponId) continue
    // `applies_to` is only returned when expanded.
    const coupon = await stripe.coupons.retrieve(couponId, { expand: ['applies_to'] })
    const products = coupon.applies_to?.products
    if (!products || (targetProduct !== undefined && products.includes(targetProduct))) carried.push(discount.id)
  }
  return carried
}

/**
 * Schedules a change for the end of the current paid period, with no proration (Stripe's
 * documented "schedule a downgrade for an existing subscription": a schedule made from the
 * subscription, then updated with the current phase kept as is and a next phase on the new
 * price). The next phase lasts one second, as the Billing Portal's own deferred changes do:
 * Stripe changes the price at the period boundary, then the schedule ends and
 * `end_behavior: 'release'` leaves the subscription running on the new price, with no schedule
 * attached. A longer phase would keep the subscription locked (a subscription with a schedule
 * can't be changed or cancelled in the portal) for a whole period after the change. The
 * subscription's discounts that apply to the new price are carried into that phase, so they stay
 * on the subscription after the release. If the update fails, the half-made schedule is released
 * so the subscription isn't left locked.
 */
async function scheduleChangeAtPeriodEnd(
  subscription: Stripe.Subscription,
  targetPriceId: string,
  targetProduct: string | undefined
): Promise<PlanSwitchResult> {
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id })
  try {
    const current = schedule.phases[0]
    if (!current) throw new Error('Subscription schedule has no current phase')

    // Stripe unsets any phase field an update leaves out, so the current phase is passed back
    // with its items, discounts, tax rates and metadata.
    const discounts = current.discounts.flatMap((d): Stripe.SubscriptionScheduleUpdateParams.Phase.Discount[] => {
      const discount = idOf(d.discount)
      if (discount) return [{ discount }]
      const coupon = idOf(d.coupon)
      if (coupon) return [{ coupon }]
      const promotionCode = idOf(d.promotion_code)
      return promotionCode ? [{ promotion_code: promotionCode }] : []
    })
    const taxRates = (current.default_tax_rates ?? []).map((rate) => idOf(rate)).filter(Boolean) as string[]
    const targetDiscounts = await discountsForTarget(subscription, targetProduct)

    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        {
          items: current.items.map((phaseItem) => ({
            price: idOf(phaseItem.price)!,
            quantity: phaseItem.quantity ?? 1,
          })),
          start_date: current.start_date,
          end_date: current.end_date,
          proration_behavior: 'none',
          ...(discounts.length > 0 ? { discounts } : {}),
          ...(taxRates.length > 0 ? { default_tax_rates: taxRates } : {}),
          ...(current.metadata && Object.keys(current.metadata).length > 0
            ? { metadata: current.metadata }
            : {}),
        },
        {
          items: [{ price: targetPriceId, quantity: 1 }],
          // No credit for the period that just ended and no charge beyond the new price's own
          // renewal: the change lands exactly on the period boundary, and the schedule is released
          // one second later.
          proration_behavior: 'none',
          end_date: current.end_date + 1,
          ...(targetDiscounts.length > 0 ? { discounts: targetDiscounts.map((discount) => ({ discount })) } : {}),
          ...(taxRates.length > 0 ? { default_tax_rates: taxRates } : {}),
        },
      ],
    })

    return { kind: 'scheduled', effectiveAt: current.end_date }
  } catch (err) {
    await stripe.subscriptionSchedules.release(schedule.id).catch((releaseErr: unknown) => {
      console.error(`Plan switch: releasing unfinished schedule ${schedule.id} failed`, releaseErr)
    })
    throw err
  }
}
