import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de'
import { CreditsResetNote } from '@/components/account/CreditsResetNote'

/**
 * "Credits reset on {date}" beside the credit balance and "Get more" on the account page and the
 * dashboard: only for an active Pro AI plan on TabMerger's key whose reset date is known
 * (`managedAiCreditsResetAt()`), never a guess.
 */
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }),
}))

const NOW = new Date('2026-11-15T12:00:00Z')
/** A monthly period around NOW whose end is late on Nov 30 UTC (already Dec 1 east of UTC). */
const PERIOD = { ai_period_start: '2026-10-31T23:30:00+00:00', ai_period_end: '2026-11-30T23:30:00+00:00' }
const MANAGED_ACTIVE = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ai_monthly_credits: 2500, current_period_end: null, ...PERIOD }

function mockSupabase(subscription: Record<string, unknown>) {
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
          return { data: { created_at: '2024-01-01' } }
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
    getPendingPlanChange: async () => null,
  }))
  vi.doMock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div /> }))
  vi.doMock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div /> }))
  vi.doMock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div /> }))
  vi.doMock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div /> }))
  vi.doMock('@/components/dashboard/BackupsSection', () => ({ BackupsSection: () => <div /> }))
  vi.doMock('@/components/account/DevicesSection', () => ({ DevicesSection: () => <div /> }))
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
    const card = screen.getByRole('button', { name: 'Get more' }).closest('.rounded-lg') as HTMLElement
    expect(within(card).getByTestId('ai-credits-reset')).toBe(note)
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
        <CreditsResetNote resetsAt={new Date('2026-11-30T23:30:00Z')} />
      </NextIntlClientProvider>
    )
    expect(screen.getByTestId('ai-credits-reset').textContent).toBe('Credits werden am 30.11.2026 zurückgesetzt')
  })

  it('renders nothing without a date', () => {
    const { container } = render(<CreditsResetNote resetsAt={null} />)
    expect(container.textContent).toBe('')
  })
})
