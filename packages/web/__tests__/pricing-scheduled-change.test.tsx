/**
 * The pricing page while a subscriber's plan change is already scheduled for the period end (read
 * on the server with getCurrentPlan({ withPendingChange })): the card the change moves to says
 * "Starts {date}" instead of a button, and every other change (other plans, the interval switch,
 * the Pro AI option switch) is replaced by a note pointing to the account page, so nothing offers a
 * change the server would refuse with 409 `already_scheduled`. Free's install link stays.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledPlanChange } from '@/components/pricing/PricingCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/pricing',
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const INSTALL = 'https://store.example/tabmerger'
const DATE = 'November 26, 2026'
const NOTE = `You have a change scheduled for ${DATE}. Manage it on your account page.`

async function load() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
  return import('@/components/pricing/PricingTable')
}

/** The three cards in page order: Free, Pro, Pro AI. */
function cards() {
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-tier]'))
  const byTier = (tier: string) => all.find((el) => el.dataset.tier === tier)!
  return { free: byTier('free'), pro: byTier('pro'), proAi: byTier('proAi') }
}

function expectNote(card: HTMLElement) {
  const note = within(card).getByTestId('cta-scheduled-note')
  expect(note).toHaveTextContent(NOTE)
  expect(within(note).getByRole('link', { name: 'Manage it on your account page.' })).toHaveAttribute('href', '/account')
}

const PRO_MONTHLY: ScheduledPlanChange = { plan: { tierKey: 'pro', interval: 'monthly', aiMode: null }, date: DATE }

beforeEach(() => {
  global.fetch = vi.fn()
})
afterEach(() => vi.unstubAllEnvs())

describe('a scheduled Pro AI → Pro change', () => {
  it('Pro says when it starts instead of "Downgrade to Pro", and Pro AI offers no change', async () => {
    const { PricingTable } = await load()
    render(
      <PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" scheduledChange={PRO_MONTHLY} />
    )
    const { free, pro, proAi } = cards()

    expect(within(pro).getByTestId('cta-scheduled')).toHaveTextContent(`Starts ${DATE}`)
    expect(within(pro).queryByRole('button', { name: /Downgrade to Pro/ })).not.toBeInTheDocument()
    expect(within(pro).queryByTestId('cta-scheduled-note')).not.toBeInTheDocument()

    // The current plan's "Switch to yearly billing" is replaced by the note.
    expect(within(proAi).queryByRole('button', { name: 'Switch to yearly billing' })).not.toBeInTheDocument()
    expectNote(proAi)

    // Free still offers the install link (not a plan change).
    expect(within(free).getByRole('button', { name: 'Install free' })).toBeInTheDocument()
    expect(within(free).queryByTestId('cta-scheduled-note')).not.toBeInTheDocument()
  })

  it('the Pro AI option switch is replaced by the note too, and no click sends anything', async () => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    render(
      <PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" scheduledChange={PRO_MONTHLY} />
    )
    await user.click(screen.getByRole('radio', { name: 'You' }))
    const { proAi } = cards()
    expect(within(proAi).queryByRole('button', { name: 'Handle setup yourself' })).not.toBeInTheDocument()
    expectNote(proAi)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('Pro on the other interval is not the target: the note, not "Starts"', async () => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    render(
      <PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" scheduledChange={PRO_MONTHLY} />
    )
    await user.click(screen.getByRole('button', { name: /^Yearly/ }))
    const { pro } = cards()
    expect(within(pro).queryByTestId('cta-scheduled')).not.toBeInTheDocument()
    expectNote(pro)
  })
})

describe('other scheduled changes', () => {
  it('TabMerger → own key: the Pro AI card on "You" says when it starts; Pro gets the note', async () => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    render(
      <PricingTable
        installHref={INSTALL}
        currentTier="pro_ai"
        currentInterval="monthly"
        currentAiMode="managed"
        scheduledChange={{ plan: { tierKey: 'proAi', interval: 'monthly', aiMode: 'byok' }, date: DATE }}
      />
    )
    // On "Us" (the current option) the card is the current plan with its interval switch: the note.
    expectNote(cards().proAi)
    await user.click(screen.getByRole('radio', { name: 'You' }))
    expect(within(cards().proAi).getByTestId('cta-scheduled')).toHaveTextContent(`Starts ${DATE}`)
    expectNote(cards().pro)
  })

  it('yearly → monthly on Pro: the Pro card on Monthly says when it starts', async () => {
    const { PricingTable } = await load()
    render(
      <PricingTable installHref={INSTALL} currentTier="pro" currentInterval="yearly" scheduledChange={PRO_MONTHLY} />
    )
    const { pro, proAi } = cards()
    expect(within(pro).getByTestId('cta-scheduled')).toHaveTextContent(`Starts ${DATE}`)
    expect(within(pro).queryByRole('button', { name: 'Switch to monthly billing' })).not.toBeInTheDocument()
    expect(within(proAi).queryByRole('button', { name: /Upgrade to Pro AI/ })).not.toBeInTheDocument()
    expectNote(proAi)
  })

  it('a change to a price this deployment does not sell: every change gets the note, no card says "Starts"', async () => {
    const { PricingTable } = await load()
    render(
      <PricingTable
        installHref={INSTALL}
        currentTier="pro_ai"
        currentInterval="monthly"
        currentAiMode="managed"
        scheduledChange={{ plan: null, date: DATE }}
      />
    )
    const { pro, proAi } = cards()
    expect(screen.queryByTestId('cta-scheduled')).not.toBeInTheDocument()
    expectNote(pro)
    expectNote(proAi)
  })
})

describe('the pricing page', () => {
  it('reads the scheduled change with the plan and passes it down with its date formatted', async () => {
    vi.resetModules()
    vi.doMock('next/headers', () => ({ headers: async () => new Headers() }))
    const getCurrentPlan = vi.fn(async () => ({
      signedIn: true,
      tier: 'pro_ai' as const,
      interval: 'monthly' as const,
      aiMode: 'managed' as const,
      periodEnd: '2026-11-26T12:00:00.000Z',
      pendingChange: { plan: PRO_MONTHLY.plan, effectiveAt: '2026-11-26T12:00:00.000Z' },
    }))
    vi.doMock('@/lib/currentPlan', () => ({ getCurrentPlan }))
    const { default: PricingPage } = await import('@/app/[locale]/(marketing)/pricing/page')
    render(await PricingPage())

    expect(getCurrentPlan).toHaveBeenCalledWith({ withPendingChange: true })
    expect(within(cards().pro).getByTestId('cta-scheduled')).toHaveTextContent(`Starts ${DATE}`)
    expectNote(cards().proAi)
    vi.doUnmock('@/lib/currentPlan')
    vi.doUnmock('next/headers')
  })
})

describe('without a scheduled change, or without a paid plan', () => {
  it('a subscriber sees the usual buttons', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" />)
    const { pro, proAi } = cards()
    expect(within(pro).getByRole('button', { name: 'Downgrade to Pro' })).toBeInTheDocument()
    expect(within(proAi).getByRole('button', { name: 'Switch to yearly billing' })).toBeInTheDocument()
    expect(screen.queryByTestId('cta-scheduled-note')).not.toBeInTheDocument()
  })

  it('a free account ignores a stray scheduled change', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="free" signedIn scheduledChange={PRO_MONTHLY} />)
    const { pro } = cards()
    expect(within(pro).getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
    expect(screen.queryByTestId('cta-scheduled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cta-scheduled-note')).not.toBeInTheDocument()
  })
})
