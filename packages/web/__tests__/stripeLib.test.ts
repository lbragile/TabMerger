/**
 * Tests for lib/stripe.ts — thin wrapper around the Stripe SDK for checkout
 * and billing-portal session creation. The Stripe SDK itself is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCheckoutCreate = vi.fn()
const mockPortalCreate = vi.fn()

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: mockCheckoutCreate } }
    billingPortal = { sessions: { create: mockPortalCreate } }
  },
}))

describe('lib/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
  })

  it('createCheckoutSession uses customerId when provided', async () => {
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/s1' })
    const { createCheckoutSession } = await import('@/lib/stripe')

    const url = await createCheckoutSession({
      userId: 'user-1',
      priceId: 'price_123',
      customerId: 'cus_1',
      successUrl: 'https://app/success',
      cancelUrl: 'https://app/cancel',
    })

    expect(url).toBe('https://checkout.stripe.com/s1')
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', metadata: { user_id: 'user-1' } })
    )
  })

  it('createCheckoutSession falls back to customerEmail when no customerId', async () => {
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/s2' })
    const { createCheckoutSession } = await import('@/lib/stripe')

    await createCheckoutSession({
      userId: 'user-1',
      priceId: 'price_123',
      customerEmail: 'a@example.com',
      successUrl: 'https://app/success',
      cancelUrl: 'https://app/cancel',
    })

    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer_email: 'a@example.com' })
    )
  })

  it('createCheckoutSession throws when Stripe returns no url', async () => {
    mockCheckoutCreate.mockResolvedValue({ url: null })
    const { createCheckoutSession } = await import('@/lib/stripe')

    await expect(
      createCheckoutSession({
        userId: 'user-1',
        priceId: 'price_123',
        successUrl: 'https://app/success',
        cancelUrl: 'https://app/cancel',
      })
    ).rejects.toThrow('Failed to create checkout session')
  })

  it('createCreditPackCheckoutSession defaults to quantity 50', async () => {
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c1' })
    vi.stubEnv('STRIPE_AI_CREDIT_PACK_PRICE_ID', 'price_credit_pack')
    const { createCreditPackCheckoutSession } = await import('@/lib/stripe')

    await createCreditPackCheckoutSession({
      userId: 'user-1',
      successUrl: 'https://app/success',
      cancelUrl: 'https://app/cancel',
    })

    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_credit_pack', quantity: 50, adjustable_quantity: { enabled: true, minimum: 50, maximum: 500 } }]
      })
    )
  })

  it('createCreditPackCheckoutSession passes a custom quantity through to the line item', async () => {
    mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c2' })
    vi.stubEnv('STRIPE_AI_CREDIT_PACK_PRICE_ID', 'price_credit_pack')
    const { createCreditPackCheckoutSession } = await import('@/lib/stripe')

    await createCreditPackCheckoutSession({
      userId: 'user-1',
      quantity: 150,
      successUrl: 'https://app/success',
      cancelUrl: 'https://app/cancel',
    })

    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_credit_pack', quantity: 150, adjustable_quantity: { enabled: true, minimum: 50, maximum: 500 } }]
      })
    )
  })

  it('createBillingPortalSession returns the portal URL', async () => {
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p1' })
    const { createBillingPortalSession } = await import('@/lib/stripe')

    const url = await createBillingPortalSession({
      customerId: 'cus_1',
      returnUrl: 'https://app/account',
    })

    expect(url).toBe('https://billing.stripe.com/p1')
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://app/account',
    })
  })
})
