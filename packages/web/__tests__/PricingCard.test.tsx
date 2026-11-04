import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PricingCard as PricingCardType } from '@/components/pricing/PricingCard'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

const toastInfo = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    info: (...args: unknown[]) => toastInfo(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const baseProps = {
  name: 'Pro',
  monthlyPrice: 4,
  yearlyPrice: 38,
  features: [
    { text: 'Feature A', inherited: false },
    { text: 'Feature B', inherited: false },
  ],
  interval: 'monthly' as const,
  tier: 'pro',
  installHref: 'https://store.example/tabmerger',
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
    refresh.mockClear()
    toastInfo.mockClear()
    toastError.mockClear()
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
      <PricingCard {...baseProps} features={[{ text: 'Everything in Free', inherited: true }, ...baseProps.features]} />
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
    await user.click(screen.getByRole('button', { name: 'Get Pro' }))

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
    await user.click(screen.getByRole('button', { name: 'Get Pro' }))
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

  it('signed-out visitor (no currentTier) sees "Get …" with no "Current"/"Downgrade" labels (AI enabled)', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
    // Nothing to upgrade from: "Get", not "Upgrade to".
    expect(screen.getByRole('button', { name: 'Get Pro AI' })).toBeInTheDocument()
    expect(screen.queryByText(/Upgrade to/)).not.toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
    expect(screen.queryByText(/Downgrade/)).not.toBeInTheDocument()
  })

  it('hides "Recommended" on the highlighted (Pro) card when it is the current plan', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} highlighted currentTier="pro" />)
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
  })

  it('shows a neutral, high-contrast "Current" badge (the brand color stays on Recommended)', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(<PricingCard {...baseProps} currentTier="pro" />)
    const badge = screen.getByText('Current')
    expect(badge.className).toMatch(/bg-foreground\b/)
    expect(badge.className).toMatch(/text-background\b/)
    expect(badge.className).not.toMatch(/bg-primary\b/)
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/border-foreground\/30/)
    expect(card.className).not.toMatch(/border-primary\/40/)
  })

  it('shows "Current" as the same top-edge pill the home teaser uses, not beside the plan name', async () => {
    const PricingCard = await loadPricingCard(true)
    const { container } = render(<PricingCard {...baseProps} highlighted currentTier="pro" />)
    const badge = screen.getByText('Current')
    const card = container.firstChild as HTMLElement
    expect(card.className).toMatch(/\brelative\b/)
    expect(card).toContainElement(badge)
    expect(badge.className).toMatch(/\babsolute\b/)
    expect(badge.className).toMatch(/-translate-y-1\/2/)
    expect(badge.className).toMatch(/rounded-none/)
    // On the card's own edge, not inside the plan name's heading.
    expect(badge.parentElement).toBe(card)
    expect(screen.getByRole('heading', { name: 'Pro' })).not.toContainElement(badge)
    // One pill at a time: Current wins, and the sparkle is gone.
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent('✦')
  })

  it('uses a check for "Everything in" lines and a + for added ones', async () => {
    const PricingCard = await loadPricingCard(true)
    const features = [
      { text: 'Everything in Free', inherited: true },
      { text: 'Added thing', inherited: false },
    ]
    render(<PricingCard {...baseProps} features={features} />)
    const [first, second] = screen.getAllByRole('listitem')
    expect(first.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-check/)
    expect(second.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-plus/)
  })

  // The monthly credit allowance is one of Pro AI's feature lines (from PRICING_TIERS, see
  // tierFeatures), so the card adds no credits line of its own.
  it('adds no AI credits line of its own to the Pro AI card, only the features it is given', async () => {
    const PricingCard = await loadPricingCard(true)
    render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" />)
    expect(screen.queryByText(/AI credits/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Feature A', 'Feature B'])
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

  // The brand emphasis goes with the Recommended badge: not on the plan the visitor has, nor on one
  // below it. The roomier side padding stays, so the card's content width never changes.
  describe('emphasis on the highlighted (Pro) card', () => {
    const emphasis = /shadow-sh3|border-primary\/30/

    it.each([
      ['a signed-out visitor', undefined],
      ['a free account', 'free'],
    ])('is emphasised for %s', async (_label, currentTier) => {
      const PricingCard = await loadPricingCard(true)
      const { container } = render(<PricingCard {...baseProps} highlighted currentTier={currentTier} />)
      const card = container.firstChild as HTMLElement
      expect(card.className).toMatch(emphasis)
      expect(card.className).toMatch(/\bpx-7\b/)
    })

    it.each([
      ['Pro (its current plan)', 'pro'],
      ['Pro AI (a plan above it)', 'pro_ai'],
    ])('is not emphasised for a subscriber on %s, and keeps its padding', async (_label, currentTier) => {
      const PricingCard = await loadPricingCard(true)
      const { container } = render(
        <PricingCard {...baseProps} highlighted currentTier={currentTier} currentInterval="monthly" signedIn />
      )
      const card = container.firstChild as HTMLElement
      expect(card.className).not.toMatch(emphasis)
      expect(card.className).toMatch(/\bpx-7\b/)
    })
  })

  // A current plan has no button (the badge says Current), but its button row keeps a button's
  // height so the card's bottom block lines up with its neighbours'.
  describe('button row on the current plan', () => {
    it('keeps a hidden placeholder the height of a single-line button where the CTA would be', async () => {
      const PricingCard = await loadPricingCard(true)
      render(<PricingCard {...baseProps} currentTier="pro" />)
      const placeholder = screen.getByTestId('cta-placeholder')
      expect(placeholder).toHaveAttribute('aria-hidden', 'true')
      expect(placeholder.className).toMatch(/\bmin-h-10\b/)
      expect(placeholder).toBeEmptyDOMElement()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('puts the Pro AI setup switch above the placeholder, as it sits above a button', async () => {
      const PricingCard = await loadPricingCard(true)
      render(
        <PricingCard
          {...baseProps}
          tier="proAi"
          name="Pro AI"
          currentTier="pro_ai"
          currentAiMode="managed"
          aiOptions={{
            managed: { monthlyPrice: 7.99, yearlyPrice: 85.99, features: [] },
            byok: { monthlyPrice: 5.99, yearlyPrice: 64.49, features: [] },
          }}
        />
      )
      const placeholder = screen.getByTestId('cta-placeholder')
      const setupSwitch = screen.getByRole('group', { name: /who handles setup/i })
      // Same bottom block (mt-auto) as a card with a button: switch first, then the button's row.
      expect(placeholder.parentElement).toBe(setupSwitch.parentElement)
      expect(placeholder.parentElement?.className).toMatch(/\bmt-auto\b/)
      expect(setupSwitch.compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('has no placeholder on a card with a button', async () => {
      const PricingCard = await loadPricingCard(true)
      render(<PricingCard {...baseProps} tier="pro" currentTier="pro_ai" />)
      expect(screen.getByRole('button', { name: 'Downgrade to Pro' })).toBeInTheDocument()
      expect(screen.queryByTestId('cta-placeholder')).not.toBeInTheDocument()
    })
  })

  // An account holds one subscription: checkout starts the first one, and every later plan
  // change happens in the billing portal.
  describe('plan changes for an existing subscriber go to the billing portal', () => {
    /** Answers each endpoint from a map and records where the browser was sent. */
    function mockEndpoints(responses: Record<string, { status: number; body: unknown }>) {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const response = responses[String(input)]
        if (!response) throw new Error(`unexpected request to ${String(input)}`)
        return { status: response.status, json: async () => response.body } as Response
      })
      delete (window as any).location
      ;(window as any).location = { href: '' }
    }

    function requestedPaths() {
      return vi.mocked(global.fetch).mock.calls.map(([input]) => String(input))
    }

    it('a Pro subscriber choosing Pro AI changes the plan through switch-plan (the portal confirms it) and never calls checkout', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/billing/switch-plan': { status: 200, body: { url: 'https://billing.example.com/portal' } } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" currentTier="pro" currentInterval="monthly" />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro AI' }))

      expect(requestedPaths()).toEqual(['/api/billing/switch-plan'])
      expect(window.location.href).toBe('https://billing.example.com/portal')
    })

    it('without a known interval, a plan change still opens the billing portal', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/billing-portal': { status: 200, body: { url: 'https://billing.example.com/portal' } } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" currentTier="pro" />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro AI' }))

      expect(requestedPaths()).toEqual(['/api/billing-portal'])
    })

    it('a signed-in free user still starts checkout', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/checkout': { status: 200, body: { url: 'https://checkout.example.com' } } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      expect(requestedPaths()).toEqual(['/api/checkout'])
      expect(window.location.href).toBe('https://checkout.example.com')
      expect(toastInfo).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it('sends the user to the billing portal, with a short message, when checkout answers 409 already_subscribed', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({
        '/api/checkout': { status: 409, body: { error: 'already_subscribed' } },
        '/api/billing-portal': { status: 200, body: { url: 'https://billing.example.com/portal' } },
      })

      const user = userEvent.setup()
      // The page still shows the user as free (e.g. it was loaded before the purchase).
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      expect(requestedPaths()).toEqual(['/api/checkout', '/api/billing-portal'])
      expect(window.location.href).toBe('https://billing.example.com/portal')
      expect(toastInfo).toHaveBeenCalledTimes(1)
      expect(toastInfo).toHaveBeenCalledWith(expect.stringMatching(/already have a plan/i))
      // Not a failure: no error is shown.
      expect(toastError).not.toHaveBeenCalled()
    })

    it('refreshes the page, with a short message, when the 409 says the account now shows the plan', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/checkout': { status: 409, body: { error: 'already_subscribed', recorded: true } } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      // The server recorded the plan Stripe has: the refreshed page shows it with its switches.
      expect(requestedPaths()).toEqual(['/api/checkout'])
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(toastInfo).toHaveBeenCalledWith('You already have a plan. This page now shows it, so you can change it here.')
      expect(window.location.href).toBe('')
      expect(toastError).not.toHaveBeenCalled()
    })

    it('asks to wait a few minutes when checkout answers 429 rate_limited', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/checkout': { status: 429, body: { error: 'rate_limited', code: 'rate_limited' } } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      expect(requestedPaths()).toEqual(['/api/checkout'])
      expect(toastError).toHaveBeenCalledWith('Too many billing requests in a short time. Please wait a few minutes and try again.')
      expect(window.location.href).toBe('')
    })

    it('says to pay or resume the open plan when checkout answers 409 pay_or_resume', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/checkout': { status: 409, body: { error: 'pay_or_resume' } } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      expect(requestedPaths()).toEqual(['/api/checkout'])
      // No live plan, so the account page has no Manage billing: support is the way forward.
      expect(toastError).toHaveBeenCalledWith(
        `Your plan is waiting for a payment or is paused, so it can't be changed yet. Email ${SUPPORT_EMAIL} and we'll help you sort it out.`
      )
      expect(window.location.href).toBe('')
    })

    it.each([
      [503, { error: 'billing_check_failed' }],
      [500, { error: 'Failed to create checkout session' }],
    ])('says checkout could not start on a %i', async (status, body) => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/checkout': { status, body } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      expect(toastError).toHaveBeenCalledWith("Couldn't start checkout. Please try again in a moment.")
      expect(window.location.href).toBe('')
      expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).not.toBeDisabled()
    })

    it('says where to change the plan when the portal cannot be opened after a 409', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({
        '/api/checkout': { status: 409, body: { error: 'already_subscribed' } },
        '/api/billing-portal': { status: 400, body: { error: 'No billing account found' } },
      })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      expect(window.location.href).toBe('')
      // The portal failing usually means the account page can't show Manage billing either.
      expect(toastError).toHaveBeenCalledWith(
        `Couldn't open billing. Please try again, or email ${SUPPORT_EMAIL} to change your plan.`
      )
      // The button is usable again.
      expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).not.toBeDisabled()
    })

    it('does not open the portal for a 409 with any other error code', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/checkout': { status: 409, body: { error: 'something_else' } } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} currentTier="free" signedIn />)
      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))

      expect(requestedPaths()).toEqual(['/api/checkout'])
      expect(window.location.href).toBe('')
      expect(toastInfo).not.toHaveBeenCalled()
    })

    it('sends a signed-out session to sign-in when the portal answers 401', async () => {
      const PricingCard = await loadPricingCard(true)
      mockEndpoints({ '/api/billing-portal': { status: 401, body: {} } })

      const user = userEvent.setup()
      render(<PricingCard {...baseProps} tier="pro" name="Pro" currentTier="pro_ai" />)
      await user.click(screen.getByRole('button', { name: 'Downgrade to Pro' }))

      expect(push).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/pricing')
      expect(toastError).not.toHaveBeenCalled()
    })
  })

  describe('AI coming-soon flag (AI_ENABLED off)', () => {
    it('still renders the real price on the Pro AI card, not a placeholder', async () => {
      const PricingCard = await loadPricingCard(false)
      render(<PricingCard {...baseProps} tier="proAi" name="Pro AI" monthlyPrice={7} />)
      expect(screen.getByText('$7.00')).toBeInTheDocument()
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
      const cta = screen.getByRole('button', { name: 'Get Pro' })
      expect(cta).not.toBeDisabled()
    })
  })

  describe('switching billing interval on the current plan', () => {
    it('offers "Switch to yearly billing" on a monthly current plan, in the primary style', async () => {
      const PricingCard = await loadPricingCard(true)
      render(<PricingCard {...baseProps} currentTier="pro" currentInterval="monthly" />)
      const button = screen.getByRole('button', { name: 'Switch to yearly billing' })
      expect(button.className).toContain('bg-primary')
      expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument()
    })

    it.each([
      ['monthly', 'Switch to yearly billing'],
      ['yearly', 'Switch to monthly billing'],
    ] as const)('shows no "Billed %s" label above the switch button', async (currentInterval, switchLabel) => {
      const PricingCard = await loadPricingCard(true)
      render(<PricingCard {...baseProps} currentTier="pro" currentInterval={currentInterval} />)
      expect(screen.queryByText(/^Billed (monthly|yearly)$/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: switchLabel })).toBeInTheDocument()
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
      // A shorter interval is deferred by Stripe's own confirm page: posted at once, no dialog of ours.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
