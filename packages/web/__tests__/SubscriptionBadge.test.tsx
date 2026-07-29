import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SubscriptionBadge } from '@/components/dashboard/SubscriptionBadge'

// Regression coverage for the "no renewal date visible" bug: prior tests only ever
// rendered SubscriptionBadge behind a vi.mock(), so a real prop-shape regression
// (wrong field name, gated-out status, etc.) would never fail CI. These hit the
// real component with data shaped exactly like a `subscriptions` row.
describe('SubscriptionBadge — billing date visibility', () => {
  it('renders the renewal date and price for an active paid subscription', () => {
    render(
      <SubscriptionBadge
        tier="pro"
        status="active"
        currentPeriodEnd="2026-08-19T00:00:00.000Z"
        priceId="price_pro_monthly_test"
      />
    )

    expect(screen.getByText(/Renews/)).toBeInTheDocument()
    expect(screen.getByText(/Aug (18|19), 2026/)).toBeInTheDocument()
  })

  it('still shows the renewal date when status is past_due', () => {
    render(
      <SubscriptionBadge
        tier="pro"
        status="past_due"
        currentPeriodEnd="2026-08-19T00:00:00.000Z"
        priceId={null}
      />
    )

    expect(screen.getByText(/Renews/)).toBeInTheDocument()
  })

  it('does not show a renewal date once the subscription is canceled', () => {
    render(
      <SubscriptionBadge
        tier="free"
        status="canceled"
        currentPeriodEnd="2026-08-19T00:00:00.000Z"
        priceId={null}
      />
    )

    expect(screen.queryByText(/Renews/)).not.toBeInTheDocument()
  })

  it('omits the price when priceId does not match a known Stripe price (legacy/discontinued price)', () => {
    render(
      <SubscriptionBadge
        tier="pro"
        status="active"
        currentPeriodEnd="2026-08-19T00:00:00.000Z"
        priceId="price_unknown_legacy"
      />
    )

    expect(screen.getByText(/Renews/)).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })
})
