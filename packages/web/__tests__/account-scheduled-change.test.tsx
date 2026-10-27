import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

/**
 * The account page while a plan change is scheduled: it says what changes and when, and offers
 * "Cancel subscription" (Stripe's cancel page, through /api/billing/cancel-subscription), because
 * the Billing Portal's home page has no cancel control then. Without a pending change the usual
 * "cancel via Manage billing" note stays.
 */
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn() } }),
}))

const END = 1_795_757_962 // 2026-11-26

function mockServer(pending: { priceId: string; effectiveAt: number } | null) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com', created_at: '2024-01-01' } } }),
      },
      from: (table: string) => {
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        builder.select = chain
        builder.eq = chain
        builder.order = chain
        builder.limit = chain
        builder.single = async () =>
          table === 'subscriptions'
            ? {
                data: {
                  id: 'sub_1',
                  tier: 'pro_ai',
                  status: 'active',
                  current_period_end: new Date(END * 1000).toISOString(),
                  stripe_price_id: 'price_ai_m',
                  ai_mode: 'managed',
                },
              }
            : { data: { created_at: '2024-01-01', stripe_customer_id: 'cus_1' } }
        builder.maybeSingle = async () => ({ data: null })
        builder.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: [] })
        return builder
      },
    }),
  }))
  const getPendingPlanChange = vi.fn(async () => pending)
  vi.doMock('@/lib/stripe', () => ({
    createBillingPortalSession: async () => 'https://billing.example.com',
    getPendingPlanChange,
  }))
  return getPendingPlanChange
}

async function renderPage() {
  const { default: AccountPage } = await import('@/app/[locale]/(app)/account/page')
  render((await AccountPage()) as React.ReactElement)
}

describe('AccountPage — scheduled plan change', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
    vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
    vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('says what is scheduled and offers Cancel subscription instead of the Manage-billing cancel note', async () => {
    const lookup = mockServer({ priceId: 'price_pro_m', effectiveAt: END })
    await renderPage()

    expect(lookup).toHaveBeenCalledWith({ customerId: 'cus_1', subscriptionId: 'sub_1' })
    expect(screen.getByText(/^Changes to Pro, billed monthly on .*2026\.$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument()
    expect(screen.queryByText(/You can cancel anytime via/)).not.toBeInTheDocument()
    // What cancelling does to the scheduled change, and that renewing later doesn't bring it back.
    expect(
      screen.getByText(
        'Cancelling keeps your current plan until the end of this billing period and drops the scheduled change. No refund. Renewing later keeps your current plan.'
      )
    ).toBeInTheDocument()
    // Manage billing stays for cards and invoices.
    expect(screen.getByRole('link', { name: 'Manage billing' })).toHaveAttribute('href', 'https://billing.example.com')
  })

  it('names the date alone when the scheduled price is not one this deployment sells', async () => {
    mockServer({ priceId: 'price_legacy', effectiveAt: END })
    await renderPage()
    expect(screen.getByText(/^Your plan changes on .*2026\.$/)).toBeInTheDocument()
  })

  it('keeps the Manage-billing cancel note and no extra button without a pending change', async () => {
    mockServer(null)
    await renderPage()
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).not.toBeInTheDocument()
    expect(screen.getByText(/You can cancel anytime via/)).toBeInTheDocument()
    expect(screen.queryByText(/Renewing later keeps your current plan/)).not.toBeInTheDocument()
  })

  it('still renders the page when the lookup fails', async () => {
    const lookup = mockServer(null)
    lookup.mockRejectedValue(new Error('stripe down'))
    await renderPage()
    expect(screen.queryByRole('button', { name: 'Cancel subscription' })).not.toBeInTheDocument()
    expect(screen.getByText(/You can cancel anytime via/)).toBeInTheDocument()
  })
})
