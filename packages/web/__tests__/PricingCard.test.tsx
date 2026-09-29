import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PricingCard as PricingCardType } from '@/components/pricing/PricingCard'

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

/**
 * `AI_ENABLED` in `@/lib/aiFlag` is a module-level const computed once from
 * `process.env.NEXT_PUBLIC_AI_ENABLED` at import time. To exercise both flag states in the
 * same test file we must reset the module registry and re-import the component fresh after
 * stubbing the env var — a static top-level import would always see whichever value was
 * live at first import.
 */
async function loadPricingCard(aiEnabled: boolean): Promise<typeof PricingCardType> {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', aiEnabled ? 'true' : 'false')
  const mod = await import('@/components/pricing/PricingCard')
  return mod.PricingCard
}

describe('PricingCard', () => {
  beforeEach(() => {
    push.mockClear()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders free tier with outline install button and no highlight styling', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(
      <PricingCard {...baseProps} tier="free" name="Free" monthlyPrice={0} yearlyPrice={0} />
    )
    expect(screen.getByText('Install free')).toBeInTheDocument()
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/bg-surface/)
    expect(card.className).not.toMatch(/feat-bg/)
  })

  it('renders highlighted (Pro) card with the same bg-surface as other tiers, distinguished by shadow/border', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(<PricingCard {...baseProps} highlighted />)
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/bg-surface\b/)
    expect(card.className).not.toMatch(/feat-bg/)
    expect(card.className).toMatch(/shadow-sh3/)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
  })

  it('renders non-highlighted paid tier with border-border/bg-surface treatment', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(<PricingCard {...baseProps} tier="proAi" name="Pro + AI" />)
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/border-border/)
    expect(card.className).toMatch(/bg-surface\b/)
  })

  it('renders a Check icon for "Everything in X" lines and Plus icons for the rest', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(
      <PricingCard {...baseProps} features={['Everything in Free', 'Feature A', 'Feature B']} />
    )
    expect(container.querySelectorAll('.lucide-check').length).toBe(1)
    expect(container.querySelectorAll('.lucide-plus').length).toBe(2)
  })

  it('renders Plus icons for every feature when none is an "Everything in X" line (e.g. Free tier)', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(<PricingCard {...baseProps} />)
    expect(container.querySelectorAll('.lucide-plus').length).toBe(baseProps.features.length)
    expect(container.querySelectorAll('.lucide-check').length).toBe(0)
  })

  it('shows "Current" badge and no CTA button when tier matches currentTier', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} currentTier="pro" />)
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('POSTs to /api/checkout and redirects to returned url on click', async () => {
    const PricingCard = await loadPricingCard(true)
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
    const PricingCard = await loadPricingCard(true)
    ;(global.fetch as any).mockResolvedValue({ status: 401, json: async () => ({}) })
    const user = userEvent.setup()
    render(<PricingCard {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /Upgrade to Pro/ }))
    expect(push).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/pricing')
  })

  it('recognizes "proAi" tier prop as current plan when currentTier is the DB value "pro_ai" (AI enabled)', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" currentTier="pro_ai" />)
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows "Upgrade to X" for a tier above the current tier (AI enabled)', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" currentTier="pro" />)
    expect(screen.getByRole('button', { name: /Upgrade to Pro AI/ })).toBeInTheDocument()
  })

  it('shows "Downgrade to X" for a paid tier below the current tier, not "Upgrade"', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="pro" name="Pro" currentTier="pro_ai" />)
    expect(screen.getByRole('button', { name: 'Downgrade to Pro' })).toBeInTheDocument()
    expect(screen.queryByText(/Upgrade to Pro/)).not.toBeInTheDocument()
  })

  it('POSTs to /api/billing-portal (not /api/checkout) and redirects when the downgrade CTA is clicked', async () => {
    const PricingCard = await loadPricingCard(true)
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

  it('free card still says "Install free" (not "Upgrade"/"Downgrade") for a paid user, since free is never above current tier', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="free" name="Free" monthlyPrice={0} yearlyPrice={0} currentTier="pro" />)
    expect(screen.getByText('Install free')).toBeInTheDocument()
  })

  it('free card keeps its "Install free" CTA even when free is the current plan (no CTA suppression, unlike paid tiers)', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="free" name="Free" monthlyPrice={0} yearlyPrice={0} currentTier="free" />)
    expect(screen.getByRole('button', { name: 'Install free' })).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
  })

  it('signed-out visitor (no currentTier) sees default CTAs with no "Current"/"Downgrade" labels (AI enabled)', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
    expect(screen.getByRole('button', { name: /Upgrade to Pro AI/ })).toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
    expect(screen.queryByText(/Downgrade/)).not.toBeInTheDocument()
  })

  it('hides "Recommended" on the highlighted (Pro) card when it is the current plan', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} highlighted currentTier="pro" />)
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
  })

  it('shows a solid, high-contrast primary-branded "Current" badge on the card matching currentTier', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(<PricingCard {...baseProps} currentTier="pro" />)
    const badge = screen.getByText('Current')
    expect(badge.className).toMatch(/bg-primary\b/)
    expect(badge.className).toMatch(/text-primary-foreground/)
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/border-primary\/40/)
  })

  it('shows the AI monthly request quota as a feature line on the Pro AI card only (AI enabled)', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
    expect(screen.getByText(/AI credits \/ month/)).toBeInTheDocument()
  })

  it('does not show the AI quota line on the Pro card', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="pro" />)
    expect(screen.queryByText(/AI credits \/ month/)).not.toBeInTheDocument()
  })

  it('hides "Recommended" on the highlighted (Pro) card when the user is on a higher tier (Pro AI)', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} highlighted currentTier="pro_ai" />)
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
  })

  it('still shows "Recommended" on the highlighted (Pro) card for a free user', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} highlighted currentTier="free" />)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
  })

  it('still shows "Recommended" on the highlighted (Pro) card for a signed-out visitor', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} highlighted />)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
  })

  describe('AI coming-soon flag (AI_ENABLED off)', () => {
    it('still renders the real price on the Pro AI card, not a placeholder', async () => {
      const PricingCard = await loadPricingCard(false)
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" monthlyPrice={7} />)
      expect(screen.getByText('$7')).toBeInTheDocument()
    })

    it('shows a "Coming soon" badge and disables the CTA with aria-disabled', async () => {
      const PricingCard = await loadPricingCard(false)
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
      expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0)
      const cta = screen.getByRole('button', { name: 'Coming soon' })
      expect(cta).toBeDisabled()
      expect(cta).toHaveAttribute('aria-disabled', 'true')
    })

    it('does not show the AI credits quota line when AI is disabled', async () => {
      const PricingCard = await loadPricingCard(false)
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
      expect(screen.queryByText(/AI credits \/ month/)).not.toBeInTheDocument()
    })

    it('clicking the disabled CTA does not trigger a checkout call', async () => {
      const PricingCard = await loadPricingCard(false)
      const user = userEvent.setup()
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
      const cta = screen.getByRole('button', { name: 'Coming soon' })
      await user.click(cta).catch(() => {})
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('leaves the Pro (non-AI) card CTA fully functional', async () => {
      const PricingCard = await loadPricingCard(false)
      render(<PricingCard {...baseProps} tier="pro" name="Pro" />)
      const cta = screen.getByRole('button', { name: /Upgrade to Pro/ })
      expect(cta).not.toBeDisabled()
    })
  })

  describe('switching billing interval on the current plan', () => {
    it('offers "Switch to yearly billing" on a monthly current plan, in the primary style', async () => {
      const PricingCard = await loadPricingCard(true)
      render(<PricingCard {...baseProps} currentTier="pro" currentInterval="monthly" />)
      expect(screen.getByText('Billed monthly')).toBeInTheDocument()
      const button = screen.getByRole('button', { name: 'Switch to yearly billing' })
      expect(button.className).toContain('bg-primary')
      expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument()
    })

    it('offers "Switch to monthly billing" on a yearly current plan, whichever interval the toggle shows', async () => {
      const PricingCard = await loadPricingCard(true)
      render(<PricingCard {...baseProps} interval="monthly" currentTier="pro" currentInterval="yearly" />)
      expect(screen.getByRole('button', { name: 'Switch to monthly billing' })).toBeInTheDocument()
    })

    it('shows no switch without a known interval, or on a card that is not the current plan', async () => {
      const PricingCard = await loadPricingCard(true)
      const { unmount } = render(<PricingCard {...baseProps} currentTier="pro" />)
      expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument()
      unmount()
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" currentTier="pro" currentInterval="monthly" />)
      expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument()
    })

    it('posts the target interval and sends the user to the Stripe confirmation page', async () => {
      const PricingCard = await loadPricingCard(true)
      const user = userEvent.setup()
      const assign = vi.fn()
      const original = window.location
      Object.defineProperty(window, 'location', { configurable: true, value: { ...original, set href(v: string) { assign(v) } } })
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/x' }), { status: 200 })
      )
      try {
        render(<PricingCard {...baseProps} currentTier="pro" currentInterval="monthly" />)
        await user.click(screen.getByRole('button', { name: 'Switch to yearly billing' }))
        expect(global.fetch).toHaveBeenCalledWith('/api/billing/switch-interval', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ interval: 'yearly' }),
        }))
        expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/x')
      } finally {
        Object.defineProperty(window, 'location', { configurable: true, value: original })
      }
    })

    it('shows an error when the switch cannot start', async () => {
      const PricingCard = await loadPricingCard(true)
      const user = userEvent.setup()
      vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 500 }))
      render(<PricingCard {...baseProps} currentTier="pro" currentInterval="monthly" />)
      await user.click(screen.getByRole('button', { name: 'Switch to yearly billing' }))
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start the switch")
    })

    it("shows the server's own message for a 409 (e.g. a switch already scheduled)", async () => {
      const PricingCard = await loadPricingCard(true)
      const user = userEvent.setup()
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: 'A billing change is already scheduled for the end of this term.' }), { status: 409 })
      )
      render(<PricingCard {...baseProps} currentTier="pro" currentInterval="yearly" />)
      await user.click(screen.getByRole('button', { name: 'Switch to monthly billing' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('already scheduled for the end of this term')
    })

    it('sends a signed-out session to sign-in', async () => {
      const PricingCard = await loadPricingCard(true)
      const user = userEvent.setup()
      vi.mocked(global.fetch).mockResolvedValue(new Response('{}', { status: 401 }))
      render(<PricingCard {...baseProps} currentTier="pro" currentInterval="monthly" />)
      await user.click(screen.getByRole('button', { name: 'Switch to yearly billing' }))
      expect(push).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/pricing')
    })
  })
})
