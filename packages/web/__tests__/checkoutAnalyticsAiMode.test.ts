/**
 * Pro AI's two options in the checkout-funnel analytics helpers (lib/checkoutAnalytics.ts): the
 * own-key option has its own price and item name; everything else keeps its existing shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ANALYTICS_EVENTS } from '@tabmerger/shared'
import {
  analyticsItem,
  analyticsItemName,
  checkoutCancelPath,
  checkoutValue,
  parseCanceledCheckout,
  trackBeginCheckout,
  trackCheckoutCanceled,
  withoutCheckoutReturnParams,
} from '@/lib/checkoutAnalytics'

const gtag = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.gtag = gtag
})

afterEach(() => {
  delete (window as { gtag?: unknown }).gtag
})

describe('Pro AI options in checkout analytics', () => {
  it('prices each option from PRICING_TIERS; aiMode is ignored for Pro', () => {
    expect(checkoutValue('proAi', 'monthly')).toBe(7.99)
    expect(checkoutValue('proAi', 'monthly', 'byok')).toBe(5.99)
    expect(checkoutValue('proAi', 'yearly', 'byok')).toBe(64.49)
    expect(checkoutValue('pro', 'yearly', 'byok')).toBe(42.99)
  })

  it('names the own-key item "Pro AI (own key)" and keeps item_id the tier', () => {
    expect(analyticsItemName('proAi')).toBe('Pro AI')
    expect(analyticsItemName('proAi', 'byok')).toBe('Pro AI (own key)')
    expect(analyticsItemName('pro', 'byok')).toBe('Pro')
    expect(analyticsItem('proAi', 'yearly', 'byok')).toEqual({
      item_id: 'pro_ai',
      item_name: 'Pro AI (own key)',
      item_variant: 'yearly',
      price: 64.49,
      quantity: 1,
    })
  })

  it('marks only the own-key option on the cancel_url, and reads it back', () => {
    expect(checkoutCancelPath('proAi', 'monthly', 'en', 'managed')).toBe(
      '/pricing?checkout=canceled&tier=proAi&interval=monthly'
    )
    const path = checkoutCancelPath('proAi', 'monthly', 'en', 'byok')
    expect(path).toBe('/pricing?checkout=canceled&tier=proAi&interval=monthly&aiMode=byok')
    expect(parseCanceledCheckout(new URL(`https://x.test${path}`).searchParams)).toEqual({
      tier: 'proAi',
      interval: 'monthly',
      aiMode: 'byok',
    })
    // Pro never carries the option, and an unknown value is dropped.
    expect(checkoutCancelPath('pro', 'monthly', 'en', 'byok')).not.toContain('aiMode')
    expect(
      parseCanceledCheckout(new URLSearchParams('checkout=canceled&tier=proAi&interval=monthly&aiMode=evil'))
    ).toEqual({ tier: 'proAi', interval: 'monthly' })
    expect(
      parseCanceledCheckout(new URLSearchParams('checkout=canceled&tier=pro&interval=monthly&aiMode=byok'))
    ).toEqual({ tier: 'pro', interval: 'monthly' })
    expect(withoutCheckoutReturnParams(new URLSearchParams(path.split('?')[1] + '&ref=x'))).toBe('ref=x')
  })

  it('begin_checkout and checkout_canceled carry the own-key price and item name', () => {
    trackBeginCheckout({ tier: 'proAi', interval: 'monthly', aiMode: 'byok', source: 'pricing', component: 'card' })
    trackCheckoutCanceled({ tier: 'proAi', interval: 'yearly', aiMode: 'byok' })

    const [begin, canceled] = gtag.mock.calls.filter((c) => c[0] === 'event')
    expect(begin[1]).toBe(ANALYTICS_EVENTS.beginCheckout)
    expect(begin[2]).toMatchObject({ value: 5.99, items: [expect.objectContaining({ item_name: 'Pro AI (own key)' })] })
    expect(canceled[1]).toBe(ANALYTICS_EVENTS.checkoutCanceled)
    expect(canceled[2]).toMatchObject({ value: 64.49, items: [expect.objectContaining({ item_name: 'Pro AI (own key)' })] })
  })
})
