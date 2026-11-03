/**
 * The pricing page while a subscriber's plan is set to end (cancelled at the period end; the row's
 * `cancel_at_period_end`, which the webhook also sets for Stripe's `cancel_at` at the period end):
 * every change on the paid cards (another plan, the interval switch, the Pro AI option switch) is
 * replaced by "Your plan ends on {date}. Keep your plan to change it.", linking to the account
 * page, so nothing offers a change the server would refuse with 409 `cancel_scheduled`. Free's
 * install link stays. Also covers getCurrentPlan()'s `setToEnd` and the page wiring.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/pricing',
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const INSTALL = 'https://store.example/tabmerger'
const DATE = 'November 26, 2026'
const NOTE = `Your plan ends on ${DATE}. Keep your plan to change it.`

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

function expectNote(card: HTMLElement, text = NOTE) {
  const note = within(card).getByTestId('cta-plan-ends-note')
  expect(note).toHaveTextContent(text)
  expect(within(note).getByRole('link', { name: 'Keep your plan' })).toHaveAttribute('href', '/account')
}

beforeEach(() => {
  global.fetch = vi.fn()
})
afterEach(() => vi.unstubAllEnvs())

describe('a Pro AI plan set to end', () => {
  it('offers no downgrade, no interval switch and no option switch: the note instead', async () => {
    const { PricingTable } = await load()
    const user = userEvent.setup()
    render(
      <PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" planEnds={{ date: DATE }} />
    )
    const { free, pro, proAi } = cards()

    expect(within(pro).queryByRole('button', { name: /Downgrade to Pro/ })).not.toBeInTheDocument()
    expectNote(pro)
    expect(within(proAi).queryByRole('button', { name: 'Switch to yearly billing' })).not.toBeInTheDocument()
    expectNote(proAi)

    // The other Pro AI option: no "Handle setup yourself" either.
    await user.click(screen.getByRole('radio', { name: 'You' }))
    expect(within(cards().proAi).queryByRole('button', { name: 'Handle setup yourself' })).not.toBeInTheDocument()
    expectNote(cards().proAi)

    // Free still offers the install link (not a plan change).
    expect(within(free).getByRole('button', { name: 'Install free' })).toBeInTheDocument()
    expect(within(free).queryByTestId('cta-plan-ends-note')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('wins over a stray scheduled change (cancelling releases the schedule)', async () => {
    const { PricingTable } = await load()
    render(
      <PricingTable
        installHref={INSTALL}
        currentTier="pro_ai"
        currentInterval="monthly"
        currentAiMode="managed"
        planEnds={{ date: DATE }}
        scheduledChange={{ plan: { tierKey: 'pro', interval: 'monthly', aiMode: null }, date: DATE }}
      />
    )
    expectNote(cards().pro)
    expect(screen.queryByTestId('cta-scheduled-note')).not.toBeInTheDocument()
  })
})

describe('a Pro plan set to end', () => {
  it('offers no upgrade and no interval switch', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="pro" currentInterval="yearly" planEnds={{ date: DATE }} />)
    const { pro, proAi } = cards()
    expect(within(proAi).queryByRole('button', { name: /Upgrade to Pro AI/ })).not.toBeInTheDocument()
    expectNote(proAi)
    // Shown on Monthly: the current yearly plan's card is a switch target, so the note too.
    expect(within(pro).queryByRole('button', { name: 'Switch to monthly billing' })).not.toBeInTheDocument()
    expectNote(pro)
  })

  it('says the plan is set to end, without a date, when the period end is unknown', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="pro" currentInterval="monthly" planEnds={{ date: null }} />)
    expectNote(cards().proAi, 'Your plan is set to end. Keep your plan to change it.')
  })

  it('keeps the placeholder on a current plan with nothing to switch to (unknown interval)', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="pro" planEnds={{ date: DATE }} />)
    const { pro } = cards()
    expect(within(pro).getByTestId('cta-placeholder')).toBeInTheDocument()
    expect(within(pro).queryByTestId('cta-plan-ends-note')).not.toBeInTheDocument()
  })
})

describe('without a plan set to end, or without a paid plan', () => {
  it('a renewing subscriber sees the usual buttons', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" planEnds={null} />)
    expect(within(cards().pro).getByRole('button', { name: 'Downgrade to Pro' })).toBeInTheDocument()
    expect(screen.queryByTestId('cta-plan-ends-note')).not.toBeInTheDocument()
  })

  it('a free account ignores a stray planEnds', async () => {
    const { PricingTable } = await load()
    render(<PricingTable installHref={INSTALL} currentTier="free" signedIn planEnds={{ date: DATE }} />)
    expect(within(cards().pro).getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
    expect(screen.queryByTestId('cta-plan-ends-note')).not.toBeInTheDocument()
  })
})

describe('the pricing page', () => {
  it('passes a plan set to end down with its date formatted on the server', async () => {
    vi.resetModules()
    vi.doMock('next/headers', () => ({ headers: async () => new Headers() }))
    vi.doMock('@/lib/currentPlan', () => ({
      getCurrentPlan: vi.fn(async () => ({
        signedIn: true,
        tier: 'pro_ai' as const,
        interval: 'monthly' as const,
        aiMode: 'managed' as const,
        periodEnd: '2026-11-26T12:00:00.000Z',
        setToEnd: true,
        pendingChange: null,
      })),
    }))
    const { default: PricingPage } = await import('@/app/[locale]/(marketing)/pricing/page')
    render(await PricingPage())

    expectNote(cards().pro)
    expectNote(cards().proAi)
    vi.doUnmock('@/lib/currentPlan')
    vi.doUnmock('next/headers')
  })
})

describe('getCurrentPlan', () => {
  function mockRow(row: Record<string, unknown>) {
    const selects: string[] = []
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
        from: () => {
          const builder: Record<string, unknown> = {}
          builder.select = (columns: string) => {
            selects.push(columns)
            return builder
          }
          builder.eq = () => builder
          builder.order = () => builder
          builder.limit = () => builder
          builder.maybeSingle = async () => ({ data: row })
          return builder
        },
      }),
    }))
    vi.doMock('@/lib/stripe', () => ({ getPendingPlanChange: vi.fn(async () => null) }))
    return selects
  }

  afterEach(() => {
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('@/lib/stripe')
  })

  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])('cancel_at_period_end %s -> setToEnd %s', async (flag, expected) => {
    vi.resetModules()
    const selects = mockRow({
      id: 'sub_1',
      tier: 'pro',
      status: 'active',
      stripe_price_id: null,
      current_period_end: '2026-11-26T12:00:00.000Z',
      cancel_at_period_end: flag,
    })
    const { getCurrentPlan } = await import('@/lib/currentPlan')
    const plan = await getCurrentPlan()
    expect(plan.setToEnd).toBe(expected)
    expect(selects[0]).toContain('cancel_at_period_end')
  })
})
