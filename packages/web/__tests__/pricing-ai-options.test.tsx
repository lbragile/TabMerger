/**
 * Pro AI's two options on the pricing page ("Who handles setup": TabMerger = managed, You = own
 * key) under each launch state of the AI flags. `AI_AVAILABILITY` is computed once at import from
 * NEXT_PUBLIC_AI_ENABLED / NEXT_PUBLIC_AI_BYOK_ENABLED, so every case stubs the env, resets the
 * module registry and imports the components fresh.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_AI_MODEL,
  PRICING_TIERS,
  PRO_AI_MONTHLY_CREDITS,
  estimateAiCredits,
} from '@tabmerger/shared'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const INSTALL = 'https://store.example/tabmerger'
const PRO_AI = PRICING_TIERS.find((t) => t.id === 'pro_ai')!
const OWN_KEY = PRO_AI.byok!

type Flags = { managed: boolean; byok: boolean }

async function loadWithFlags({ managed, byok }: Flags) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', managed ? 'true' : 'false')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', byok ? 'true' : 'false')
  return {
    ...(await import('@/components/pricing/PricingTable')),
    ...(await import('@/components/marketing/PricingTeaser')),
    ...(await import('@/components/pricing/aiOptions')),
  }
}

/** The Pro AI card: the nearest card around the "Who handles setup" group. */
function proAiCard() {
  return screen.getByRole('group', { name: 'Who handles setup?' }).closest('div.rounded-2xl') as HTMLElement
}

// Skips an aria-hidden element itself (not its descendants: those are checked with closest()).
const shown = { ignore: '[aria-hidden="true"]' }

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

function mockCheckout() {
  vi.mocked(global.fetch).mockResolvedValue({
    status: 200,
    json: async () => ({ url: 'https://checkout.example.com' }),
  } as Response)
}

function checkoutBody() {
  const call = vi.mocked(global.fetch).mock.calls.find(([input]) => String(input) === '/api/checkout')
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null
}

describe('Pro AI option switch on the pricing page', () => {
  it('asks "Who handles setup" with two radio options, You and Us (TabMerger)', async () => {
    const { PricingTable } = await loadWithFlags({ managed: true, byok: true })
    render(<PricingTable installHref={INSTALL} />)
    const group = screen.getByRole('group', { name: 'Who handles setup?' })
    const options = within(group).getAllByRole('radio')
    expect(options.map((o) => o.closest('label')?.textContent)).toEqual(['You', 'Us'])
  })

  it('lists "You" first but still opens on TabMerger when both options are on sale', async () => {
    const { PricingTable, PricingTeaser } = await loadWithFlags({ managed: true, byok: true })
    for (const ui of [<PricingTable key="table" installHref={INSTALL} />, <PricingTeaser key="teaser" />]) {
      const { unmount } = render(ui)
      const options = within(screen.getByRole('group', { name: 'Who handles setup?' })).getAllByRole('radio')
      expect(options[0]).toHaveAccessibleName('You')
      expect(options[0]).not.toBeChecked()
      expect(screen.getByRole('radio', { name: 'Us' })).toBeChecked()
      unmount()
    }

    // On the pricing page, the feature list on show is TabMerger's, though its list now comes second.
    render(<PricingTable installHref={INSTALL} />)
    const creditLines = within(proAiCard()).getAllByText(/AI credits a month/)
    expect(creditLines.some((line) => line.closest('[aria-hidden="true"]') === null)).toBe(true)
    expect(within(proAiCard()).getByText('Use your own AI provider').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('styles the switch with theme radius tokens only, never a hard-coded radius', async () => {
    const { PricingTable } = await loadWithFlags({ managed: true, byok: true })
    render(<PricingTable installHref={INSTALL} />)
    const group = screen.getByRole('group', { name: 'Who handles setup?' })
    const track = group.querySelector('div') as HTMLElement
    expect(track.className).toMatch(/\brounded-lg\b/)
    for (const label of group.querySelectorAll('label')) expect(label.className).toMatch(/\brounded-md\b/)
    expect(group.innerHTML).not.toMatch(/rounded-\[/)
  })

  describe('only the own-key flag on (the launch state)', () => {
    const flags = { managed: false, byok: true }

    it('opens on "You", with the own-key price and a working buy button', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      mockCheckout()
      const user = userEvent.setup()
      render(<PricingTable installHref={INSTALL} />)

      expect(screen.getByRole('radio', { name: 'You' })).toBeChecked()
      const card = proAiCard()
      expect(within(card).getByText(`$${OWN_KEY.monthlyPrice}`)).toBeInTheDocument()
      expect(within(card).queryByText('Coming soon')).not.toBeInTheDocument()

      const buy = within(card).getByRole('button', { name: 'Get Pro AI' })
      expect(buy).toBeEnabled()
      await user.click(buy)
      expect(checkoutBody()).toEqual({ tier: 'proAi', interval: 'monthly', aiMode: 'byok' })
      expect(window.location.href).toBe('https://checkout.example.com')
    })

    it('shows "Coming soon" only on the TabMerger option, whose button sends nothing', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      const user = userEvent.setup()
      render(<PricingTable installHref={INSTALL} />)

      await user.click(screen.getByRole('radio', { name: 'Us' }))
      const card = proAiCard()
      expect(within(card).getByText(`$${PRO_AI.monthlyPrice}`)).toBeInTheDocument()
      const cta = within(card).getByRole('button', { name: 'Coming soon' })
      expect(cta).toBeDisabled()
      await user.click(cta).catch(() => {})
      expect(global.fetch).not.toHaveBeenCalled()

      await user.click(screen.getByRole('radio', { name: 'You' }))
      expect(within(proAiCard()).queryByText('Coming soon')).not.toBeInTheDocument()
    })

    it('lists the own-key features and its note, with no dollar figure per use', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      render(<PricingTable installHref={INSTALL} />)
      const card = proAiCard()
      expect(within(card).getByText('Use your own AI provider', shown)).toBeInTheDocument()
      // The TabMerger option's list is still in the DOM (it reserves the height), but only hidden.
      for (const line of within(card).getAllByText(/AI credits a month/)) {
        expect(line.closest('[aria-hidden="true"]')).not.toBeNull()
      }
      const note = within(card).getByText('You add an API key from a provider. They bill you directly based on your usage.', shown)
      expect(note.textContent).not.toMatch(/\$/)
    })
  })

  describe('both flags off', () => {
    it('opens on TabMerger and shows "Coming soon" for both options', async () => {
      const { PricingTable } = await loadWithFlags({ managed: false, byok: false })
      const user = userEvent.setup()
      render(<PricingTable installHref={INSTALL} />)
      expect(screen.getByRole('radio', { name: 'Us' })).toBeChecked()
      expect(within(proAiCard()).getByRole('button', { name: 'Coming soon' })).toBeDisabled()
      await user.click(screen.getByRole('radio', { name: 'You' }))
      expect(within(proAiCard()).getByRole('button', { name: 'Coming soon' })).toBeDisabled()
    })
  })

  describe('both flags on', () => {
    const flags = { managed: true, byok: true }

    it('opens on TabMerger and buys either option with its own aiMode', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      mockCheckout()
      const user = userEvent.setup()
      render(<PricingTable installHref={INSTALL} />)

      expect(screen.getByRole('radio', { name: 'Us' })).toBeChecked()
      await user.click(within(proAiCard()).getByRole('button', { name: 'Get Pro AI' }))
      expect(checkoutBody()).toEqual({ tier: 'proAi', interval: 'monthly', aiMode: 'managed' })

      vi.mocked(global.fetch).mockClear()
      mockCheckout()
      await user.click(screen.getByRole('radio', { name: 'You' }))
      await user.click(within(proAiCard()).getByRole('button', { name: 'Get Pro AI' }))
      expect(checkoutBody()).toEqual({ tier: 'proAi', interval: 'monthly', aiMode: 'byok' })
    })

    it('shows the monthly credits and what they measure, with no organize count or dollar figure', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      render(<PricingTable installHref={INSTALL} />)
      const card = proAiCard()
      const credits = PRO_AI_MONTHLY_CREDITS.toLocaleString('en-US')
      expect(within(card).getByText(`${credits} AI credits a month`, shown)).toBeInTheDocument()
      const note = within(card).getByText('Credits measure AI use: bigger jobs and stronger models use more.', shown)
      expect(note.closest('[aria-hidden="true"]')).toBeNull()
      expect(card.textContent).not.toMatch(/organizes?|\$0\./)
    })

    it('switches price and yearly line with the option, and keeps the hidden option out of the accessibility tree', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      const user = userEvent.setup()
      render(<PricingTable installHref={INSTALL} />)
      await user.click(screen.getByRole('button', { name: /Yearly/ }))
      await user.click(screen.getByRole('radio', { name: 'You' }))

      const card = proAiCard()
      expect(within(card).getByText(`$${OWN_KEY.yearlyPrice}`)).toBeInTheDocument()
      const perMonth = (OWN_KEY.yearlyPrice / 12).toFixed(2)
      expect(within(card).getByText(`$${perMonth}/mo billed yearly · save 10%`)).toBeInTheDocument()
      // The TabMerger option's features stay in the DOM to reserve the height, hidden from readers.
      const hidden = within(card).getByText(/AI credits a month/)
      expect(hidden.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(hidden.closest('.invisible')).not.toBeNull()
    })

    it('offers a Pro AI subscriber the other option as a plan switch, not a second checkout', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ applied: 'end_of_period', effectiveAt: '2026-11-30T12:00:00.000Z', url: 'https://x.example/account' }),
      } as Response)
      const user = userEvent.setup()
      render(<PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" />)

      expect(screen.getByRole('radio', { name: 'Us' })).toBeChecked()
      expect(within(proAiCard()).getByText('Current')).toBeInTheDocument()

      await user.click(screen.getByRole('radio', { name: 'You' }))
      expect(within(proAiCard()).queryByText('Current')).not.toBeInTheDocument()
      await user.click(within(proAiCard()).getByRole('button', { name: 'Handle setup yourself' }))
      // A downgrade, scheduled for the end of the period: confirmed first (see plan-change-confirm.test.tsx).
      expect(global.fetch).not.toHaveBeenCalled()
      await user.click(await screen.findByRole('button', { name: 'Confirm' }))

      const [input, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(String(input)).toBe('/api/billing/switch-plan')
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ aiMode: 'byok' })
      expect(await within(proAiCard()).findByText(/^Done\. Your plan changes to Pro AI with you handling setup/)).toBeInTheDocument()
    })

    it('opens a subscriber on their own option', async () => {
      const { PricingTable } = await loadWithFlags(flags)
      render(<PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="yearly" currentAiMode="byok" />)
      expect(screen.getByRole('radio', { name: 'You' })).toBeChecked()
      expect(within(proAiCard()).getByRole('button', { name: 'Switch to monthly billing' })).toBeInTheDocument()
    })
  })
})

describe('Pro AI option switch on the landing page teaser', () => {
  const card = () => screen.getByRole('group', { name: 'Who handles setup?' }).closest('div.rounded-2xl') as HTMLElement

  it('with only the own-key flag on, opens on "You" at the own-key price, not "Coming soon"', async () => {
    const { PricingTeaser } = await loadWithFlags({ managed: false, byok: true })
    const user = userEvent.setup()
    render(<PricingTeaser />)
    expect(screen.getByRole('radio', { name: 'You' })).toBeChecked()
    expect(within(card()).getByText(`$${OWN_KEY.monthlyPrice}`)).toBeInTheDocument()
    expect(within(card()).queryByText('Coming soon')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Us' }))
    expect(within(card()).getByText(`$${PRO_AI.monthlyPrice}`)).toBeInTheDocument()
    expect(within(card()).getByText('Coming soon')).toBeInTheDocument()
  })

  it('shows the own-key yearly line when "You" is picked on Yearly', async () => {
    const { PricingTeaser } = await loadWithFlags({ managed: true, byok: true })
    const user = userEvent.setup()
    render(<PricingTeaser />)
    await user.click(screen.getByRole('button', { name: /yearly/i }))
    await user.click(screen.getByRole('radio', { name: 'You' }))
    const perMonth = (OWN_KEY.yearlyPrice / 12).toFixed(2)
    expect(within(card()).getByText(`$${perMonth}/mo billed yearly · save 10%`, shown)).toBeInTheDocument()
  })
})

describe('aiOptions helpers', () => {
  it('opens on the first option on sale, TabMerger before You, and on a subscriber’s own option', async () => {
    let mod = await loadWithFlags({ managed: true, byok: true })
    // Display order and default preference are separate lists: "You" shows first, TabMerger is preferred.
    expect(mod.AI_OPTION_ORDER).toEqual(['byok', 'managed'])
    expect(mod.AI_OPTION_DEFAULT_PREFERENCE).toEqual(['managed', 'byok'])
    expect(mod.initialAiMode()).toBe('managed')
    expect(mod.initialAiMode('byok')).toBe('byok')
    mod = await loadWithFlags({ managed: false, byok: true })
    expect(mod.initialAiMode()).toBe('byok')
    expect(mod.isAiOptionAvailable('managed')).toBe(false)
    expect(mod.isAiOptionAvailable('byok')).toBe(true)
    mod = await loadWithFlags({ managed: false, byok: false })
    expect(mod.initialAiMode()).toBe('managed')
    expect(mod.otherAiMode('managed')).toBe('byok')
    expect(mod.otherAiMode('byok')).toBe('managed')
  })

  it('counts organizes from credits, never below zero', async () => {
    const { organizesFor, ORGANIZE_EXAMPLE_TABS } = await loadWithFlags({ managed: true, byok: true })
    const perOrganize = estimateAiCredits(AUTO_AI_MODEL.organize, 'organize', ORGANIZE_EXAMPLE_TABS)
    expect(organizesFor()).toBe(Math.floor(PRO_AI_MONTHLY_CREDITS / perOrganize))
    expect(organizesFor(perOrganize * 3 + 1)).toBe(3)
    expect(organizesFor(0)).toBe(0)
    expect(organizesFor(-5)).toBe(0)
  })
})
