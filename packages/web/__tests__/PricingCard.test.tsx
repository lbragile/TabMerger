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
    expect(card.className).toMatch(/shadow-\[var\(--sh3\)\]/)
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

  it('disables and labels button "Current plan" when tier matches currentTier', () => {
    render(<PricingCard {...baseProps} currentTier="pro" />)
    const btn = screen.getByRole('button', { name: 'Current plan' })
    expect(btn).toBeDisabled()
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
})
