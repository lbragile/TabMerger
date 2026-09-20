/**
 * Regression test: lib/stripe.ts must not throw at import time when STRIPE_SECRET_KEY is
 * unset, and its operations must refuse clearly instead of proceeding.
 *
 * Unlike stripeLib.test.ts (which mocks the `stripe` package entirely, so its constructor
 * can never throw), this file deliberately does NOT mock `stripe` — the bug this guards
 * against is `new Stripe(undefined)` throwing "Neither apiKey nor config.authenticator
 * provided" at module-evaluation time. `next build` evaluates every route module (including
 * app/api/billing-portal, app/api/checkout, app/api/checkout/credits) during "Collecting page
 * data" to statically analyze it, even though the handler itself never runs at build time — so
 * a missing STRIPE_SECRET_KEY (CI has none) took down the entire `next build`, not just billing.
 * A mocked Stripe class (as stripeLib.test.ts uses) cannot catch this — a mock constructor
 * never validates its arguments the way the real SDK does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

describe('lib/stripe — env degradation (real Stripe constructor)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('imports cleanly and reports isStripeConfigured=false when STRIPE_SECRET_KEY is unset', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.resetModules()

    const mod = await import('@/lib/stripe')

    expect(mod.isStripeConfigured).toBe(false)
    expect(mod.stripe).toBeDefined()
    expect(mod.stripe.checkout).toBeDefined()
  })

  it('reports isStripeConfigured=true when STRIPE_SECRET_KEY is present', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    vi.resetModules()

    const mod = await import('@/lib/stripe')

    expect(mod.isStripeConfigured).toBe(true)
  })

  it('createCheckoutSession refuses without ever calling Stripe when unconfigured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.resetModules()

    const { createCheckoutSession } = await import('@/lib/stripe')

    await expect(
      createCheckoutSession({
        userId: 'user-1',
        priceId: 'price_123',
        successUrl: 'https://app/success',
        cancelUrl: 'https://app/cancel',
      })
    ).rejects.toThrow('Stripe is not configured')
  })

  it('createCreditPackCheckoutSession refuses when unconfigured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_AI_CREDIT_PACK_PRICE_ID', 'price_credit_pack')
    vi.resetModules()

    const { createCreditPackCheckoutSession } = await import('@/lib/stripe')

    await expect(
      createCreditPackCheckoutSession({
        userId: 'user-1',
        successUrl: 'https://app/success',
        cancelUrl: 'https://app/cancel',
      })
    ).rejects.toThrow('Stripe is not configured')
  })

  it('createBillingPortalSession refuses when unconfigured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.resetModules()

    const { createBillingPortalSession } = await import('@/lib/stripe')

    await expect(
      createBillingPortalSession({
        customerId: 'cus_1',
        returnUrl: 'https://app/account',
      })
    ).rejects.toThrow('Stripe is not configured')
  })
})
