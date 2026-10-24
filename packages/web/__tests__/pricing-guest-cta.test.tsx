/**
 * The paid plans' button label by who is looking. The pricing page passes `currentTier="free"` to
 * signed-out visitors and free accounts alike, so `signedIn` is what tells them apart:
 * - a guest has nothing to upgrade from: "Get Pro" / "Get Pro AI" (the click still signs in first);
 * - a signed-in free account: "Upgrade to …";
 * - a subscriber: the existing switch / upgrade / downgrade wording, never "Get …".
 * The AI flags are read once at import, so each case stubs the env and imports the components fresh.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const INSTALL = 'https://store.example/tabmerger'

async function load({ managed = true, byok = true } = {}) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', managed ? 'true' : 'false')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', byok ? 'true' : 'false')
  return {
    ...(await import('@/components/pricing/PricingTable')),
    ...(await import('@/components/marketing/PricingTeaser')),
  }
}

/** A plan's card on the pricing page, found from its title. */
function card(name: string) {
  return screen.getByRole('heading', { name, level: 2 }).closest('div.rounded-2xl') as HTMLElement
}

let originalLocation: Location
beforeEach(() => {
  push.mockClear()
  global.fetch = vi.fn()
  originalLocation = window.location
  delete (window as { location?: Location }).location
  ;(window as unknown as { location: { href: string } }).location = { href: '' }
})
afterEach(() => {
  vi.unstubAllEnvs()
  ;(window as unknown as { location: Location }).location = originalLocation
})

describe('PricingTable: paid-plan button for a signed-out visitor', () => {
  it.each(['Monthly', 'Yearly'])('says "Get Pro" and "Get Pro AI", never "Upgrade" (%s)', async (interval) => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    // What the page renders for a guest: the Free tier, not signed in.
    render(<PricingTable installHref={INSTALL} currentTier="free" />)
    if (interval === 'Yearly') await user.click(screen.getByRole('button', { name: /Yearly/ }))

    expect(within(card('Pro')).getByRole('button', { name: 'Get Pro' })).toBeEnabled()
    expect(within(card('Pro AI')).getByRole('button', { name: 'Get Pro AI' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Upgrade to/ })).not.toBeInTheDocument()
    // The Free card keeps its install button.
    expect(within(card('Free')).getByRole('button', { name: 'Install free' })).toBeInTheDocument()
  })

  it('says "Get Pro AI" on both setup options', async () => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    render(<PricingTable installHref={INSTALL} currentTier="free" />)

    for (const option of ['TabMerger', 'You']) {
      await user.click(screen.getByRole('radio', { name: option }))
      expect(within(card('Pro AI')).getByRole('button', { name: 'Get Pro AI' })).toBeEnabled()
    }
  })

  it('also says "Get …" with no currentTier at all', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} />)
    expect(screen.getByRole('button', { name: 'Get Pro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get Pro AI' })).toBeInTheDocument()
  })

  it('still starts checkout on click and sends the guest to sign-in when it answers 401', async () => {
    const { PricingTable } = await load()
    vi.mocked(global.fetch).mockResolvedValue({ status: 401, json: async () => ({}) } as Response)
    const user = userEvent.setup()
    render(<PricingTable installHref={INSTALL} currentTier="free" />)

    await user.click(screen.getByRole('button', { name: 'Get Pro' }))
    expect(global.fetch).toHaveBeenCalledWith('/api/checkout', expect.objectContaining({ method: 'POST' }))
    expect(push).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/pricing')
  })

  it('keeps "Coming soon" on a Pro AI option that is not on sale', async () => {
    const { PricingTable } = await load({ managed: false, byok: false })
    render(<PricingTable installHref={INSTALL} currentTier="free" />)

    expect(within(card('Pro AI')).getByRole('button', { name: 'Coming soon' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Get Pro AI' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get Pro' })).toBeEnabled()
  })
})

describe('PricingTable: paid-plan button for a signed-in account', () => {
  it.each(['Monthly', 'Yearly'])('a free account sees "Upgrade to Pro" and "Upgrade to Pro AI" (%s)', async (interval) => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    render(<PricingTable installHref={INSTALL} currentTier="free" signedIn />)
    if (interval === 'Yearly') await user.click(screen.getByRole('button', { name: /Yearly/ }))

    expect(within(card('Pro')).getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
    for (const option of ['TabMerger', 'You']) {
      await user.click(screen.getByRole('radio', { name: option }))
      expect(within(card('Pro AI')).getByRole('button', { name: 'Upgrade to Pro AI' })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /^Get / })).not.toBeInTheDocument()
  })

  it('a Pro subscriber keeps the switch and upgrade wording', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="pro" currentInterval="monthly" signedIn />)

    expect(within(card('Pro')).getByRole('button', { name: 'Switch to yearly billing' })).toBeInTheDocument()
    expect(within(card('Pro AI')).getByRole('button', { name: 'Upgrade to Pro AI' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Get / })).not.toBeInTheDocument()
  })

  it('a Pro AI subscriber keeps the downgrade, interval and setup-option switch wording', async () => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    render(
      <PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" signedIn />
    )

    expect(within(card('Pro')).getByRole('button', { name: 'Downgrade to Pro' })).toBeInTheDocument()
    expect(within(card('Pro AI')).getByRole('button', { name: 'Switch to yearly billing' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'You' }))
    expect(within(card('Pro AI')).getByRole('button', { name: 'Handle setup yourself' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Get / })).not.toBeInTheDocument()
  })

  it('a paid plan reads as signed in even without the prop', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="pro" currentInterval="monthly" />)
    expect(screen.getByRole('button', { name: 'Upgrade to Pro AI' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Get / })).not.toBeInTheDocument()
  })
})

describe('PricingTeaser (home page): no per-plan buy button for anyone', () => {
  it.each([
    { managed: true, byok: true },
    { managed: false, byok: false },
  ])('only links to the full pricing page, with no "Upgrade to …" or "Get …" (flags %o)', async (flags) => {
    const { PricingTeaser } = await load(flags)
    const user = userEvent.setup()
    render(<PricingTeaser />)

    for (const interval of ['Monthly', 'Yearly']) {
      await user.click(screen.getByRole('button', { name: new RegExp(interval) }))
      for (const option of ['TabMerger', 'You']) {
        await user.click(screen.getByRole('radio', { name: option }))
        expect(screen.queryByText(/Upgrade to/)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^Get / })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /^Get / })).not.toBeInTheDocument()
      }
    }
    expect(screen.getByRole('link', { name: /See full pricing/ })).toHaveAttribute('href', '/pricing')
  })
})
