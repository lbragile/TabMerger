import { ANALYTICS_EVENTS, getPricingTier } from '@tabmerger/shared'
import { DEFAULT_LOCALE, localizedPath } from '@/i18n/locales'
import { trackEvent } from './analytics'

/**
 * Client-side checkout-funnel analytics: `begin_checkout` when a checkout starts and
 * `checkout_canceled` when Stripe sends the buyer back through `cancel_url`. The server-side
 * half (`purchase`, `checkout_abandoned`) lives in the Stripe webhook. Safe to import from
 * client components: no server-only modules.
 */

/** The paid plans checkout sells, as the checkout API and the pricing cards name them. */
export const CHECKOUT_TIERS = ['pro', 'proAi'] as const
export type CheckoutTier = (typeof CHECKOUT_TIERS)[number]

export const CHECKOUT_INTERVALS = ['monthly', 'yearly'] as const
export type CheckoutInterval = (typeof CHECKOUT_INTERVALS)[number]

/** Query parameters `cancel_url` carries back to the pricing page. */
export const CHECKOUT_RETURN_PARAMS = {
  /** Marker: `checkout=canceled`. */
  status: 'checkout',
  tier: 'tier',
  interval: 'interval',
} as const

/** The only value of `?checkout=` that means "came back from a canceled checkout". */
export const CHECKOUT_CANCELED = 'canceled'

/** ISO 4217 code for every price we sell: Stripe Prices are USD-only (see PRICING_TIERS). */
export const CHECKOUT_CURRENCY = 'USD'

/** Analytics tier name: the database's (`pro_ai`), so client and webhook events agree. */
export function analyticsTier(tier: CheckoutTier): 'pro' | 'pro_ai' {
  return tier === 'proAi' ? 'pro_ai' : 'pro'
}

/** The list price in USD of one plan at one interval, from the shared PRICING_TIERS. */
export function checkoutValue(tier: CheckoutTier, interval: CheckoutInterval): number {
  const pricing = getPricingTier(analyticsTier(tier))
  return interval === 'monthly' ? pricing.monthlyPrice : pricing.yearlyPrice
}

/**
 * The pricing-page path (with query) Stripe returns a canceled checkout to, in the buyer's
 * locale (`/pricing` for the default locale, `/<locale>/pricing` otherwise). `locale` must
 * already be validated (isAppLocale()).
 */
export function checkoutCancelPath(
  tier: CheckoutTier,
  interval: CheckoutInterval,
  locale: string = DEFAULT_LOCALE
): string {
  const query = new URLSearchParams({
    [CHECKOUT_RETURN_PARAMS.status]: CHECKOUT_CANCELED,
    [CHECKOUT_RETURN_PARAMS.tier]: tier,
    [CHECKOUT_RETURN_PARAMS.interval]: interval,
  })
  return `${localizedPath(locale, '/pricing')}?${query.toString()}`
}

function isCheckoutTier(value: string | null): value is CheckoutTier {
  return (CHECKOUT_TIERS as readonly string[]).includes(value ?? '')
}

function isCheckoutInterval(value: string | null): value is CheckoutInterval {
  return (CHECKOUT_INTERVALS as readonly string[]).includes(value ?? '')
}

/**
 * Reads a canceled-checkout return from the URL's query. Returns null unless `checkout` is
 * exactly `canceled`. The tier and interval come from the address bar, so anyone can type
 * anything there: each is kept only when it is one of the known values, and is null otherwise.
 */
export function parseCanceledCheckout(
  params: Pick<URLSearchParams, 'get'>
): { tier: CheckoutTier | null; interval: CheckoutInterval | null } | null {
  if (params.get(CHECKOUT_RETURN_PARAMS.status) !== CHECKOUT_CANCELED) return null
  const tier = params.get(CHECKOUT_RETURN_PARAMS.tier)
  const interval = params.get(CHECKOUT_RETURN_PARAMS.interval)
  return {
    tier: isCheckoutTier(tier) ? tier : null,
    interval: isCheckoutInterval(interval) ? interval : null,
  }
}

/**
 * The query string with the canceled-checkout parameters removed (no leading `?`), so the
 * address bar can be rewritten and a refresh doesn't count the cancel again.
 */
export function withoutCheckoutReturnParams(params: URLSearchParams): string {
  const rest = new URLSearchParams(params)
  for (const key of Object.values(CHECKOUT_RETURN_PARAMS)) rest.delete(key)
  return rest.toString()
}

/** GA4 e-commerce params for one plan: value, currency and the single-item `items` array. */
function ecommerceParams(tier: CheckoutTier, interval: CheckoutInterval) {
  const value = checkoutValue(tier, interval)
  return {
    tier: analyticsTier(tier),
    billing_interval: interval,
    value,
    currency: CHECKOUT_CURRENCY,
    items: [
      {
        item_id: analyticsTier(tier),
        item_name: getPricingTier(analyticsTier(tier)).name,
        item_variant: interval,
        price: value,
        quantity: 1,
      },
    ],
  }
}

/** Sends one event to GA4 (gtag) and mirrors it to PostHog when PostHog is loaded. */
function sendClientEvent(name: string, params: Record<string, unknown>) {
  trackEvent(name, params)
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
  void import('posthog-js')
    .then(({ default: posthog }) => {
      if (posthog.__loaded) posthog.capture(name, params)
    })
    .catch(() => {}) // analytics never breaks checkout
}

/**
 * `begin_checkout`: a checkout CTA was clicked and the checkout-session request is starting.
 * `source` is the page and `component` the UI element that started it.
 */
export function trackBeginCheckout({
  tier,
  interval,
  source,
  component,
}: {
  tier: CheckoutTier
  interval: CheckoutInterval
  source: string
  component: string
}) {
  sendClientEvent(ANALYTICS_EVENTS.beginCheckout, {
    ...ecommerceParams(tier, interval),
    source,
    component,
  })
}

/**
 * `checkout_canceled`: Stripe sent the buyer back through `cancel_url`. A tier or interval that
 * didn't validate is left out; value and currency are sent only when both are known.
 */
export function trackCheckoutCanceled({
  tier,
  interval,
}: {
  tier: CheckoutTier | null
  interval: CheckoutInterval | null
}) {
  const params: Record<string, unknown> =
    tier && interval
      ? ecommerceParams(tier, interval)
      : {
          ...(tier ? { tier: analyticsTier(tier) } : {}),
          ...(interval ? { billing_interval: interval } : {}),
        }
  sendClientEvent(ANALYTICS_EVENTS.checkoutCanceled, params)
}
