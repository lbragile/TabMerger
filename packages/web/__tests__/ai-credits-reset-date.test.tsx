import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de'
import { CreditsResetNote } from '@/components/account/CreditsResetNote'

/**
 * "Credits reset on {date}" (or "Credits end on {date}" when no managed Pro AI period follows)
 * beside the credit balance and "Get more" on the account page and the dashboard: only for an
 * active Pro AI plan on TabMerger's key whose date is known (`managedAiCreditsDate()`), never a guess.
 */
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }),
}))

const NOW = new Date('2026-11-15T12:00:00Z')
/** A monthly period around NOW whose end is late on Nov 30 UTC (already Dec 1 east of UTC). */
const PERIOD = { ai_period_start: '2026-10-31T23:30:00+00:00', ai_period_end: '2026-11-30T23:30:00+00:00' }
const MANAGED_ACTIVE = {
  id: 'sub_1',
  tier: 'pro_ai',
  status: 'active',
  ai_mode: 'managed',
  ai_monthly_credits: 2500,
  cancel_at_period_end: false,
  current_period_end: PERIOD.ai_period_end,
  ...PERIOD,
}
/** Stripe's scheduled change at the period end (getPendingPlanChange()), to the price given. */
const changeTo = (priceId: string) => async () => ({ priceId, effectiveAt: Date.parse(PERIOD.ai_period_end) / 1000 })

type PendingRead = () => Promise<unknown>

function mockSupabase(subscription: Record<string, unknown>, pending: PendingRead = async () => null) {
  const getPendingPlanChange = vi.fn(pending)
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'a@example.com', created_at: '2024-01-01' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      from: (table: string) => {
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        for (const m of ['select', 'eq', 'is', 'order', 'limit']) builder[m] = chain
        const row = async () => {
          if (table === 'subscriptions') return { data: subscription }
          if (table === 'ai_usage') return { data: { credits_used: 100 } }
          return { data: { created_at: '2024-01-01', stripe_customer_id: 'cus_1' } }
        }
        builder.single = row
        builder.maybeSingle = row
        builder.then = (resolve: (v: unknown) => void) => resolve({ data: [] })
        return builder
      },
    }),
  }))
  vi.doMock('@/lib/stripe', () => ({
    createBillingPortalSession: async () => 'https://billing.example.com',
    getPendingPlanChange,
  }))
  vi.doMock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div /> }))
  vi.doMock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div /> }))
  vi.doMock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div /> }))
  vi.doMock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div /> }))
  vi.doMock('@/components/dashboard/BackupsSection', () => ({ BackupsSection: () => <div /> }))
  vi.doMock('@/components/account/DevicesSection', () => ({ DevicesSection: () => <div /> }))
  return getPendingPlanChange
}

async function renderAccount() {
  const { default: AccountPage } = await import('@/app/[locale]/(app)/account/page')
  render((await AccountPage()) as React.ReactElement)
}

async function renderDashboard() {
  const { default: DashboardPage } = await import('@/app/[locale]/(app)/dashboard/page')
  render((await DashboardPage({ searchParams: Promise.resolve({}) })) as React.ReactElement)
}

const pages = [
  ['account page', renderAccount],
  ['dashboard', renderDashboard],
] as const

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe.each(pages)('%s: when AI credits reset', (_name, renderPage) => {
  it('an active managed plan sees the date in UTC, in the credits card beside "Get more"', async () => {
    mockSupabase(MANAGED_ACTIVE)
    await renderPage()

    const note = screen.getByTestId('ai-credits-reset')
    // 23:30 UTC on Nov 30 is Nov 30 whatever the test machine's zone
    expect(note.textContent).toBe('Credits reset on Nov 30, 2026')
    expect(note.getAttribute('data-kind')).toBe('reset')
    const card = screen.getByRole('button', { name: 'Get more' }).closest('.rounded-lg') as HTMLElement
    expect(within(card).getByTestId('ai-credits-reset')).toBe(note)
  })

  it('set to cancel at period end: "Credits end on" the same date', async () => {
    mockSupabase({ ...MANAGED_ACTIVE, cancel_at_period_end: true })
    await renderPage()
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits end on Nov 30, 2026')
    expect(screen.getByTestId('ai-credits-reset').getAttribute('data-kind')).toBe('end')
  })

  it.each([
    ['a downgrade to Pro', 'price_pro_m'],
    ['a switch to an own key', 'price_byok_m'],
  ])('%s scheduled at the date: "Credits end on"', async (_case, priceId) => {
    const read = mockSupabase(MANAGED_ACTIVE, changeTo(priceId))
    await renderPage()
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits end on Nov 30, 2026')
    expect(read).toHaveBeenCalledWith({ customerId: 'cus_1', subscriptionId: 'sub_1' })
  })

  it('a scheduled change that stays on managed Pro AI (yearly to monthly) still resets', async () => {
    mockSupabase(MANAGED_ACTIVE, changeTo('price_ai_y'))
    await renderPage()
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits reset on Nov 30, 2026')
  })

  it('a failed read of the scheduled change still renders the card, from the row alone', async () => {
    mockSupabase({ ...MANAGED_ACTIVE, cancel_at_period_end: true }, async () => {
      throw new Error('stripe down')
    })
    await renderPage()
    expect(screen.getByText(/^AI credits/)).toBeInTheDocument()
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits end on Nov 30, 2026')
  })

  it.each([
    ['an own-key plan', { ai_mode: 'byok' }],
    ['a free account', { tier: 'free', ai_monthly_credits: 0 }],
    ['a past_due plan (renewal held until paid)', { status: 'past_due' }],
    ['a period that has ended (the next one is not stored yet)', { ai_period_end: '2026-11-14T23:30:00+00:00' }],
    ['no stored period', { ai_period_start: null, ai_period_end: null }],
  ])('%s sees no date', async (_case, change) => {
    mockSupabase({ ...MANAGED_ACTIVE, ...change })
    await renderPage()
    expect(screen.queryByTestId('ai-credits-reset')).toBeNull()
    expect(screen.queryByText(/Credits reset on/)).toBeNull()
  })

  it("shows no date while TabMerger's AI is off and only the own-key option is on sale", async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    mockSupabase(MANAGED_ACTIVE)
    await renderPage()
    expect(screen.queryByTestId('ai-credits-reset')).toBeNull()
  })
})

describe('CreditsResetNote', () => {
  it("writes the sentence and the date in the page's locale, still in UTC", () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <CreditsResetNote credits={{ at: new Date('2026-11-30T23:30:00Z'), kind: 'reset' }} />
      </NextIntlClientProvider>
    )
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits werden am 30.11.2026 zurückgesetzt')
  })

  it('says the credits end, in the locale too', () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <CreditsResetNote credits={{ at: new Date('2026-11-30T23:30:00Z'), kind: 'end' }} />
      </NextIntlClientProvider>
    )
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits verfallen am 30.11.2026')
  })

  it('renders nothing without a date', () => {
    const { container } = render(<CreditsResetNote credits={null} />)
    expect(container.textContent).toBe('')
  })
})

describe('dashboard: the scheduled-change read', () => {
  it('never runs for an account that sees no date', async () => {
    for (const change of [{ ai_mode: 'byok' }, { tier: 'free' }, { status: 'past_due' }, { ai_period_end: '2026-11-14T23:30:00+00:00' }]) {
      vi.resetModules()
      const read = mockSupabase({ ...MANAGED_ACTIVE, ...change }, changeTo('price_pro_m'))
      await renderDashboard()
      expect(read).not.toHaveBeenCalled()
    }
  })

  it("never runs while TabMerger's AI is off", async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    const read = mockSupabase(MANAGED_ACTIVE, changeTo('price_pro_m'))
    await renderDashboard()
    expect(read).not.toHaveBeenCalled()
  })

  it('a read slower than the timeout is dropped: the card renders with the row alone', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    // A read that never answers (mocked before the module that calls it is imported)
    const read = mockSupabase(MANAGED_ACTIVE, () => new Promise(() => {}))
    const { SCHEDULED_CHANGE_TIMEOUT_MS } = await import('@/lib/aiCreditsDate')
    const page = renderDashboard()
    await vi.advanceTimersByTimeAsync(SCHEDULED_CHANGE_TIMEOUT_MS)
    await page
    expect(read).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits reset on Nov 30, 2026')
  })
})
