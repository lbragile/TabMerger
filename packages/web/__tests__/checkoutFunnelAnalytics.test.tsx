/**
 * Checkout-funnel analytics on the client: `begin_checkout` from the pricing card, and
 * `checkout_canceled` when Stripe's cancel_url lands on /pricing. Pins the GA4 params, that a
 * cancel counts once (React's double effects, a re-render, the URL rewrite), and that query
 * values from the address bar are validated against the known tiers/intervals.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ANALYTICS_EVENTS } from '@tabmerger/shared'

const { push, toastInfo, nav } = vi.hoisted(() => ({
  push: vi.fn(),
  toastInfo: vi.fn(),
  nav: { search: '', pathname: '/pricing' },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))

vi.mock('sonner', () => ({
  toast: { info: (...args: unknown[]) => toastInfo(...args), error: vi.fn() },
}))

import { CheckoutCanceledTracker } from '@/components/pricing/CheckoutCanceledTracker'
import { PricingCard } from '@/components/pricing/PricingCard'
import {
  checkoutCancelPath,
  parseCanceledCheckout,
  withoutCheckoutReturnParams,
} from '@/lib/checkoutAnalytics'

const gtag = vi.fn()

/** The gtag('event', …) calls for one event name. */
function eventsNamed(name: string) {
  return gtag.mock.calls.filter((call) => call[0] === 'event' && call[1] === name)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.gtag = gtag
  nav.search = ''
  nav.pathname = '/pricing'
})

afterEach(() => {
  delete (window as { gtag?: unknown }).gtag
})

describe('checkoutCancelPath / parseCanceledCheckout', () => {
  it('round-trips a tier and interval through the cancel_url query', () => {
    const path = checkoutCancelPath('proAi', 'yearly')
    expect(path).toBe('/pricing?checkout=canceled&tier=proAi&interval=yearly')
    const params = new URL(`https://x.test${path}`).searchParams
    expect(parseCanceledCheckout(params)).toEqual({ tier: 'proAi', interval: 'yearly' })
  })

  it('prefixes a non-default locale, so the buyer returns to the page in their language', () => {
    expect(checkoutCancelPath('pro', 'monthly', 'fr')).toBe('/fr/pricing?checkout=canceled&tier=pro&interval=monthly')
    expect(checkoutCancelPath('pro', 'monthly', 'en')).toBe('/pricing?checkout=canceled&tier=pro&interval=monthly')
  })

  it('returns null unless checkout is exactly "canceled"', () => {
    expect(parseCanceledCheckout(new URLSearchParams(''))).toBeNull()
    expect(parseCanceledCheckout(new URLSearchParams('checkout=Canceled&tier=pro'))).toBeNull()
    expect(parseCanceledCheckout(new URLSearchParams('checkout=success&tier=pro'))).toBeNull()
  })

  it('drops tier and interval values that are not known ones', () => {
    for (const bad of ['<script>', 'pro_ai', 'PRO', 'free', 'enterprise', '']) {
      expect(
        parseCanceledCheckout(new URLSearchParams({ checkout: 'canceled', tier: bad, interval: 'weekly' }))
      ).toEqual({ tier: null, interval: null })
    }
  })

  it('strips only the checkout return params', () => {
    expect(
      withoutCheckoutReturnParams(new URLSearchParams('checkout=canceled&tier=pro&interval=monthly&ref=x'))
    ).toBe('ref=x')
  })
})

describe('begin_checkout', () => {
  const baseProps = {
    name: 'Pro',
    monthlyPrice: 3.99,
    yearlyPrice: 42.99,
    features: [{ text: 'Feature A', inherited: false }],
    interval: 'yearly' as const,
    tier: 'pro',
    installHref: 'https://store.example/tabmerger',
  }

  it('fires once with tier, interval, value, currency, items and source when the checkout request starts', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    global.fetch = vi.fn(() => new Promise((resolve) => (resolveFetch = resolve))) as typeof fetch
    render(<PricingCard {...baseProps} currentTier="free" signedIn />)

    await userEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))

    // Sent before the response arrives: the request has only started.
    expect(global.fetch).toHaveBeenCalledWith('/api/checkout', expect.anything())
    const calls = eventsNamed(ANALYTICS_EVENTS.beginCheckout)
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toEqual({
      tier: 'pro',
      billing_interval: 'yearly',
      value: 42.99,
      currency: 'USD',
      items: [{ item_id: 'pro', item_name: 'Pro', item_variant: 'yearly', price: 42.99, quantity: 1 }],
      source: 'pricing_page',
      component: 'pricing_card',
      environment: expect.any(String),
    })
    resolveFetch({ status: 200, json: async () => ({}) })
  })

  it('does not fire for a subscriber, whose click opens the billing portal instead of checkout', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({}) })
    render(<PricingCard {...baseProps} tier="pro" currentTier="pro_ai" />)

    await userEvent.click(screen.getByRole('button', { name: /downgrade to pro/i }))

    expect(global.fetch).toHaveBeenCalledWith('/api/billing-portal', expect.anything())
    expect(eventsNamed(ANALYTICS_EVENTS.beginCheckout)).toHaveLength(0)
  })

  it('does not fire for the Free card', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<PricingCard {...baseProps} tier="free" name="Free" monthlyPrice={0} yearlyPrice={0} />)

    await userEvent.click(screen.getByRole('button', { name: /install free/i }))

    expect(eventsNamed(ANALYTICS_EVENTS.beginCheckout)).toHaveLength(0)
    open.mockRestore()
  })
})

describe('checkout_canceled', () => {
  // The tracker rewrites the URL with history.replaceState (a router call from a mount effect can
  // run before the App Router is initialized). The spy keeps jsdom's real URL untouched.
  let replace: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  })
  afterEach(() => {
    replace.mockRestore()
  })

  it('fires once on landing, tells the user, and strips the marker with history.replaceState', async () => {
    nav.search = 'checkout=canceled&tier=pro&interval=monthly'
    render(
      <StrictMode>
        <CheckoutCanceledTracker />
      </StrictMode>
    )

    await waitFor(() => expect(replace).toHaveBeenCalled())
    const calls = eventsNamed(ANALYTICS_EVENTS.checkoutCanceled)
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toEqual(
      expect.objectContaining({ tier: 'pro', billing_interval: 'monthly', value: 3.99, currency: 'USD' })
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(null, '', '/pricing')
    expect(toastInfo).toHaveBeenCalledWith("Checkout canceled. You weren't charged.")
  })

  it('keeps the locale prefix and unrelated params when it rewrites the URL', async () => {
    nav.pathname = '/fr/pricing'
    nav.search = 'utm_source=mail&checkout=canceled&tier=proAi&interval=yearly'
    render(<CheckoutCanceledTracker />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith(null, '', '/fr/pricing?utm_source=mail'))
  })

  it('keeps the hash and never goes through the router', async () => {
    nav.search = 'checkout=canceled&tier=pro&interval=monthly'
    window.location.hash = '#compare'
    render(<CheckoutCanceledTracker />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith(null, '', '/pricing#compare'))
    expect(push).not.toHaveBeenCalled()
    window.location.hash = ''
  })

  it('does not fire again on a re-render, or once the marker is gone (a refresh after the rewrite)', async () => {
    nav.search = 'checkout=canceled&tier=pro&interval=monthly'
    const { rerender } = render(<CheckoutCanceledTracker />)
    await waitFor(() => expect(replace).toHaveBeenCalled())

    rerender(<CheckoutCanceledTracker />)
    nav.search = ''
    rerender(<CheckoutCanceledTracker />)

    expect(eventsNamed(ANALYTICS_EVENTS.checkoutCanceled)).toHaveLength(1)
  })

  it('sends nothing without the marker', () => {
    nav.search = 'tier=pro&interval=monthly'
    render(<CheckoutCanceledTracker />)

    expect(eventsNamed(ANALYTICS_EVENTS.checkoutCanceled)).toHaveLength(0)
    expect(replace).not.toHaveBeenCalled()
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it('sanitizes bad tier/interval values: the cancel is counted, the bad values are not sent', async () => {
    nav.search = `checkout=canceled&tier=${encodeURIComponent('"><img src=x>')}&interval=forever`
    render(<CheckoutCanceledTracker />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith(null, '', '/pricing'))
    const calls = eventsNamed(ANALYTICS_EVENTS.checkoutCanceled)
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toEqual({ environment: expect.any(String) })
  })

  it('keeps a valid tier when only the interval is bad, without a made-up value', async () => {
    nav.search = 'checkout=canceled&tier=proAi&interval=weekly'
    render(<CheckoutCanceledTracker />)

    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(eventsNamed(ANALYTICS_EVENTS.checkoutCanceled)[0][2]).toEqual({
      tier: 'pro_ai',
      environment: expect.any(String),
    })
  })
})
