import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PricingCard } from '@/components/pricing/PricingCard'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const baseProps = {
  name: 'Pro',
  monthlyPrice: 4,
  yearlyPrice: 38,
  features: ['Feature A', 'Feature B'],
  interval: 'monthly' as const,
  tier: 'pro',
}

describe('PricingCard', () => {
  beforeEach(() => {
    push.mockClear()
    global.fetch = vi.fn()
  })

  it('renders free tier with outline install button and no highlight styling', () => {
    const { container } = render(
      <PricingCard {...baseProps} tier="free" name="Free" monthlyPrice={0} yearlyPrice={0} />
    )
    expect(screen.getByText('Install free')).toBeInTheDocument()
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/bg-surface/)
    expect(card.className).not.toMatch(/feat-bg/)
  })

  it('renders highlighted (Pro) card with the same bg-surface as other tiers, distinguished by shadow/border', () => {
    const { container } = render(<PricingCard {...baseProps} highlighted />)
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/bg-surface\b/)
    expect(card.className).not.toMatch(/feat-bg/)
    expect(card.className).toMatch(/shadow-sh3/)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
  })

  it('renders non-highlighted paid tier with border-border/bg-surface treatment', () => {
    const { container } = render(<PricingCard {...baseProps} tier="proAi" name="Pro + AI" />)
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/border-border/)
    expect(card.className).toMatch(/bg-surface\b/)
  })

  it('renders a Check icon for "Everything in X" lines and Plus icons for the rest', () => {
    const { container } = render(
      <PricingCard {...baseProps} features={['Everything in Free', 'Feature A', 'Feature B']} />
    )
    expect(container.querySelectorAll('.lucide-check').length).toBe(1)
    expect(container.querySelectorAll('.lucide-plus').length).toBe(2)
  })

  it('renders Plus icons for every feature when none is an "Everything in X" line (e.g. Free tier)', () => {
    const { container } = render(<PricingCard {...baseProps} />)
    expect(container.querySelectorAll('.lucide-plus').length).toBe(baseProps.features.length)
    expect(container.querySelectorAll('.lucide-check').length).toBe(0)
  })

  it('shows "Current" badge and no CTA button when tier matches currentTier', () => {
    render(<PricingCard {...baseProps} currentTier="pro" />)
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('POSTs to /api/checkout and redirects to returned url on click', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ url: 'https://checkout.example.com' }),
    })
    delete (window as any).location
    ;(window as any).location = { href: '' }

    const user = userEvent.setup()
    render(<PricingCard {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /Upgrade to Pro/ }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/checkout',
      expect.objectContaining({ method: 'POST' })
    )
    expect(window.location.href).toBe('https://checkout.example.com')
  })

  it('redirects to sign-in when checkout returns 401', async () => {
    ;(global.fetch as any).mockResolvedValue({ status: 401, json: async () => ({}) })
    const user = userEvent.setup()
    render(<PricingCard {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /Upgrade to Pro/ }))
    expect(push).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/pricing')
  })

  it('recognizes "proAi" tier prop as current plan when currentTier is the DB value "pro_ai"', () => {
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" currentTier="pro_ai" />)
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows "Upgrade to X" for a tier above the current tier', () => {
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" currentTier="pro" />)
    expect(screen.getByRole('button', { name: /Upgrade to Pro AI/ })).toBeInTheDocument()
  })

  it('shows "Downgrade to X" for a paid tier below the current tier, not "Upgrade"', () => {
    render(<PricingCard {...baseProps} tier="pro" name="Pro" currentTier="pro_ai" />)
    expect(screen.getByRole('button', { name: 'Downgrade to Pro' })).toBeInTheDocument()
    expect(screen.queryByText(/Upgrade to Pro/)).not.toBeInTheDocument()
  })

  it('POSTs to /api/billing-portal (not /api/checkout) and redirects when the downgrade CTA is clicked', async () => {
    ;(global.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ url: 'https://billing.example.com/portal' }),
    })
    delete (window as any).location
    ;(window as any).location = { href: '' }

    const user = userEvent.setup()
    render(<PricingCard {...baseProps} tier="pro" name="Pro" currentTier="pro_ai" />)
    await user.click(screen.getByRole('button', { name: 'Downgrade to Pro' }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/billing-portal',
      expect.objectContaining({ method: 'POST' })
    )
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/checkout',
      expect.anything()
    )
    expect(window.location.href).toBe('https://billing.example.com/portal')
  })

  it('free card still says "Install free" (not "Upgrade"/"Downgrade") for a paid user, since free is never above current tier', () => {
    render(<PricingCard {...baseProps} tier="free" name="Free" monthlyPrice={0} yearlyPrice={0} currentTier="pro" />)
    expect(screen.getByText('Install free')).toBeInTheDocument()
  })

  it('free card keeps its "Install free" CTA even when free is the current plan (no CTA suppression, unlike paid tiers)', () => {
    render(<PricingCard {...baseProps} tier="free" name="Free" monthlyPrice={0} yearlyPrice={0} currentTier="free" />)
    expect(screen.getByRole('button', { name: 'Install free' })).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
  })

  it('signed-out visitor (no currentTier) sees default CTAs with no "Current"/"Downgrade" labels', () => {
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
    expect(screen.getByRole('button', { name: /Upgrade to Pro AI/ })).toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
    expect(screen.queryByText(/Downgrade/)).not.toBeInTheDocument()
  })

  it('hides "Recommended" on the highlighted (Pro) card when it is the current plan', () => {
    render(<PricingCard {...baseProps} highlighted currentTier="pro" />)
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
  })

  it('shows a solid, high-contrast primary-branded "Current" badge on the card matching currentTier', () => {
    const { container } = render(<PricingCard {...baseProps} currentTier="pro" />)
    const badge = screen.getByText('Current')
    expect(badge.className).toMatch(/bg-primary\b/)
    expect(badge.className).toMatch(/text-primary-foreground/)
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/border-primary\/40/)
  })

  it('shows the AI monthly request quota as a feature line on the Pro AI card only', () => {
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
    expect(screen.getByText(/AI credits \/ month/)).toBeInTheDocument()
  })

  it('does not show the AI quota line on the Pro card', () => {
    render(<PricingCard {...baseProps} tier="pro" />)
    expect(screen.queryByText(/AI credits \/ month/)).not.toBeInTheDocument()
  })

  it('hides "Recommended" on the highlighted (Pro) card when the user is on a higher tier (Pro AI)', () => {
    render(<PricingCard {...baseProps} highlighted currentTier="pro_ai" />)
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
  })

  it('still shows "Recommended" on the highlighted (Pro) card for a free user', () => {
    render(<PricingCard {...baseProps} highlighted currentTier="free" />)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
  })

  it('still shows "Recommended" on the highlighted (Pro) card for a signed-out visitor', () => {
    render(<PricingCard {...baseProps} highlighted />)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
  })
})
