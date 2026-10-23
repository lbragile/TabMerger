/**
 * Pro AI's setup option (`subscriptions.ai_mode`: TabMerger = managed, You = own key) on the
 * dashboard and account pages, under each launch state of the AI flags. Managed subscribers see
 * credits; own-key subscribers see who handles setup and no credits or credit packs; the switch to
 * the other option appears only while that option is on sale.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } }),
}))
const push = vi.fn()
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}))

type Flags = { managed: boolean; byok: boolean }

function stubFlags({ managed, byok }: Flags) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', managed ? 'true' : 'false')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', byok ? 'true' : 'false')
}

function mockSupabase(subscription: Record<string, unknown>, creditsUsed = 100) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'a@example.com', created_at: '2024-01-01' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      from: (table: string) => {
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        for (const m of ['select', 'eq', 'order', 'limit']) builder[m] = chain
        builder.single = async () => {
          if (table === 'subscriptions') return { data: subscription }
          if (table === 'ai_usage') return { data: { credits_used: creditsUsed } }
          return { data: { created_at: '2024-01-01' } }
        }
        builder.maybeSingle = builder.single
        builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0 })
        return builder
      },
    }),
  }))
  vi.doMock('@/lib/stripe', () => ({ createBillingPortalSession: async () => 'https://billing.example.com' }))
  vi.doMock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div /> }))
  vi.doMock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div /> }))
  vi.doMock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div /> }))
  vi.doMock('@/components/dashboard/BackupsSection', () => ({ BackupsSection: () => <div /> }))
  vi.doMock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div /> }))
  vi.doMock('@/components/account/DevicesSection', () => ({ DevicesSection: () => <div /> }))
}

const MANAGED = { tier: 'pro_ai', status: 'active', ai_mode: 'managed', ai_monthly_credits: 2500 }
const OWN_KEY = { tier: 'pro_ai', status: 'active', ai_mode: 'byok', ai_monthly_credits: 0 }

async function renderDashboard() {
  const { default: DashboardPage } = await import('@/app/[locale]/(app)/dashboard/page')
  render((await DashboardPage({ searchParams: Promise.resolve({}) })) as React.ReactElement)
}

async function renderAccount() {
  const { default: AccountPage } = await import('@/app/[locale]/(app)/account/page')
  render((await AccountPage()) as React.ReactElement)
}

beforeEach(() => {
  push.mockClear()
  global.fetch = vi.fn()
})
afterEach(() => vi.unstubAllEnvs())

describe('dashboard', () => {
  it('own key, only the own-key flag on: says who handles setup, no credits, no switch to an unreleased option', async () => {
    stubFlags({ managed: false, byok: true })
    mockSupabase(OWN_KEY)
    await renderDashboard()
    const card = screen.getByText('AI setup').closest('[data-slot="card"], .rounded-xl, div') as HTMLElement
    expect(screen.getByText('AI setup')).toBeInTheDocument()
    expect(screen.getByText('Your own API key: your AI provider bills you directly, with no credit limit')).toBeInTheDocument()
    expect(card).toBeTruthy()
    expect(screen.queryByText('AI credits this month')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Let TabMerger handle setup' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get more' })).not.toBeInTheDocument()
    // The AI organise entry point is shown once any AI option is live.
    expect(screen.getByRole('button', { name: /AI organise/ })).toBeInTheDocument()
  })

  it('own key, both flags on: offers the switch to TabMerger handling setup', async () => {
    stubFlags({ managed: true, byok: true })
    mockSupabase(OWN_KEY)
    await renderDashboard()
    expect(screen.getByRole('button', { name: 'Let TabMerger handle setup' })).toBeInTheDocument()
  })

  it('managed: credits used of the limit, what is left, and the switch to the own-key option', async () => {
    stubFlags({ managed: true, byok: true })
    mockSupabase(MANAGED, 100)
    await renderDashboard()
    expect(screen.getByText('100/2,500')).toBeInTheDocument()
    expect(screen.getByText(/2,400 left, about \d+ organizes of 300 tabs/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Handle setup yourself' })).toBeInTheDocument()
  })

  it('both flags off: no AI card at all', async () => {
    stubFlags({ managed: false, byok: false })
    mockSupabase(OWN_KEY)
    await renderDashboard()
    expect(screen.queryByText('AI setup')).not.toBeInTheDocument()
    expect(screen.queryByText('AI credits this month')).not.toBeInTheDocument()
  })
})

describe('account page', () => {
  it('own key: "You" handle setup, no credits or packs, and no switch while TabMerger setup is not on sale', async () => {
    stubFlags({ managed: false, byok: true })
    mockSupabase(OWN_KEY)
    await renderAccount()
    const stat = screen.getAllByText('Who handles AI setup')[0].closest('div') as HTMLElement
    expect(within(stat).getByText('You')).toBeInTheDocument()
    expect(screen.getByText(/^You: your own API key, billed directly by your AI provider/)).toBeInTheDocument()
    expect(screen.queryByText('AI credits left')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get more' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Let TabMerger handle setup' })).not.toBeInTheDocument()
  })

  it('managed: credits left of the limit, and a confirmed switch to the own key', async () => {
    stubFlags({ managed: true, byok: true })
    mockSupabase(MANAGED, 100)
    vi.mocked(global.fetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ applied: 'end_of_period', effectiveAt: '2026-11-30T12:00:00.000Z', url: 'https://x.example/account' }),
    } as Response)
    const original = window.location
    delete (window as { location?: Location }).location
    ;(window as unknown as { location: { href: string } }).location = { href: '' }
    try {
      await renderAccount()
      expect(screen.getByText('TabMerger: 2,400 of 2,500 AI credits left this month.')).toBeInTheDocument()
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))
      await user.click(await screen.findByRole('button', { name: 'Confirm' }))
      const [input, init] = vi.mocked(global.fetch).mock.calls[0]
      expect(String(input)).toBe('/api/billing/switch-plan')
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ aiMode: 'byok' })
      expect(await screen.findByText(/^Done\. Your plan changes to Pro AI with you handling setup/)).toBeInTheDocument()
    } finally {
      ;(window as unknown as { location: Location }).location = original
    }
  })

  it('managed, out of credits, only the own-key flag on: no credit packs (they are TabMerger setup only)', async () => {
    stubFlags({ managed: false, byok: true })
    mockSupabase(MANAGED, 2500)
    await renderAccount()
    expect(screen.queryByRole('button', { name: 'Get more' })).not.toBeInTheDocument()
  })
})

describe('SwitchAiModeButton', () => {
  it('shows the server’s explanation on a 409, and sends an expired session to sign-in', async () => {
    stubFlags({ managed: true, byok: true })
    const { SwitchAiModeButton } = await import('@/components/account/SwitchAiModeButton')
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 409,
      json: async () => ({ error: 'A billing change is already scheduled for the end of this term.' }),
    } as Response)
    const user = userEvent.setup()
    // Interval unknown (a price this deployment doesn't list): still confirmed, the plan named without it.
    render(<SwitchAiModeButton current="byok" returnPath="/account" />)
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Your plan changes to Pro AI with TabMerger handling setup now.')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A billing change is already scheduled')

    vi.mocked(global.fetch).mockResolvedValueOnce({ status: 401, json: async () => ({}) } as Response)
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(push).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/account')
  })

  it('shows the generic failure when the request itself fails', async () => {
    stubFlags({ managed: true, byok: true })
    const { SwitchAiModeButton } = await import('@/components/account/SwitchAiModeButton')
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'))
    render(<SwitchAiModeButton current="managed" interval="monthly" returnPath="/dashboard" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start the switch")
  })

  it('renders nothing while the other option is not on sale', async () => {
    stubFlags({ managed: false, byok: true })
    const { SwitchAiModeButton } = await import('@/components/account/SwitchAiModeButton')
    const { container } = render(<SwitchAiModeButton current="byok" returnPath="/account" />)
    expect(container).toBeEmptyDOMElement()
  })
})
