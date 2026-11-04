/**
 * A paid plan set to end (cancelled at the period end; the row's `cancel_at_period_end`, which the
 * webhook also sets for Stripe's `cancel_at` at the period end) on the account page and dashboard:
 *
 * - account page: "Your plan ends on {date}." with "Keep my plan" (POST
 *   /api/billing/resume-subscription), no Pro AI option switch and no "cancel anytime" note; the
 *   badge says "Ends {date}";
 * - dashboard: the Pro AI option switch becomes "Your plan ends on {date}. Keep your plan to change
 *   it.", linking to the account page;
 * - ResumeSubscriptionNotice: the success message (renewal date and amount) stays across the
 *   refresh, and each error code has its own message;
 * - usePlanChange refuses to send a change for a plan set to end.
 */
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } }),
}))
const refresh = vi.fn()
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
}))

const END_ISO = '2026-11-26T12:00:00.000Z'

const ROW = {
  id: 'sub_1',
  tier: 'pro_ai',
  status: 'active',
  ai_mode: 'managed',
  ai_monthly_credits: 2500,
  stripe_price_id: 'price_ai_m',
  current_period_end: END_ISO,
}

function mockServer(subscription: Record<string, unknown>) {
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
        builder.single = async () => {
          if (table === 'subscriptions') return { data: subscription }
          if (table === 'ai_usage') return { data: { credits_used: 100 } }
          return { data: { created_at: '2024-01-01', stripe_customer_id: 'cus_1' } }
        }
        builder.maybeSingle = builder.single
        builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0 })
        return builder
      },
    }),
  }))
  vi.doMock('@/lib/stripe', () => ({
    createBillingPortalSession: async () => 'https://billing.example.com',
    getPendingPlanChange: async () => null,
  }))
  vi.doMock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div /> }))
  vi.doMock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div /> }))
  vi.doMock('@/components/dashboard/BackupsSection', () => ({ BackupsSection: () => <div /> }))
  vi.doMock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div /> }))
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

beforeEach(() => {
  vi.resetModules()
  refresh.mockClear()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  global.fetch = vi.fn()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('account page', () => {
  it('a plan set to end: says when, offers Keep my plan, and no option switch or cancel note', async () => {
    mockServer({ ...ROW, cancel_at_period_end: true })
    await renderAccount()

    expect(screen.getByText(/^Your plan ends on .*2026\.$/)).toBeInTheDocument()
    expect(screen.getByText(/^It won't renew\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep my plan' })).toBeInTheDocument()
    expect(screen.getByText(/^Ends .*2026/)).toBeInTheDocument()
    expect(screen.queryByText(/^Renews /)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Handle setup yourself' })).not.toBeInTheDocument()
    expect(screen.queryByText(/You can cancel anytime via/)).not.toBeInTheDocument()
    // Manage billing stays, next to the notice.
    expect(screen.getByRole('link', { name: 'Manage billing' })).toHaveAttribute('href', 'https://billing.example.com')
  })

  it('a renewing plan: no notice, the option switch and the cancel note as before', async () => {
    mockServer({ ...ROW, cancel_at_period_end: false })
    await renderAccount()

    expect(screen.queryByRole('button', { name: 'Keep my plan' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Your plan ends on/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Handle setup yourself' })).toBeInTheDocument()
    expect(screen.getByText(/You can cancel anytime via/)).toBeInTheDocument()
  })

  it('Keep my plan resumes it here and says when it renews, and for how much', async () => {
    mockServer({ ...ROW, cancel_at_period_end: true })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, renewal: { at: END_ISO, amount: 7.99, currency: 'USD' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await renderAccount()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep my plan' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/billing/resume-subscription', { method: 'POST' })
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/^Your plan will renew on .*2026 for \$7\.99\.$/)
    expect(status).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Keep my plan' })).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('ResumeSubscriptionNotice', () => {
  const NOTICE = { message: 'Your plan ends on November 26, 2026.', note: 'It will not renew.' }

  async function renderNotice(response: { ok: boolean; body: unknown } | Error) {
    const fetchMock = vi.fn(async () => {
      if (response instanceof Error) throw response
      return { ok: response.ok, json: async () => response.body }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { ResumeSubscriptionNotice } = await import('@/components/account/ResumeSubscriptionNotice')
    render(<ResumeSubscriptionNotice notice={NOTICE} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep my plan' }))
    return fetchMock
  }

  it('renders nothing when the plan is not set to end', async () => {
    const { ResumeSubscriptionNotice } = await import('@/components/account/ResumeSubscriptionNotice')
    const { container } = render(<ResumeSubscriptionNotice notice={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a renewal without an amount gives the date only; without a renewal, that it will renew', async () => {
    await renderNotice({ ok: true, body: { ok: true, renewal: { at: END_ISO } } })
    expect(await screen.findByRole('status')).toHaveTextContent(/^Your plan will renew on .*2026\.$/)
  })

  it('no renewal in the answer: that it will renew', async () => {
    await renderNotice({ ok: true, body: { ok: true } })
    expect(await screen.findByRole('status')).toHaveTextContent('Your plan will renew.')
  })

  it.each([
    ['not_canceling', "Your plan isn't set to end anymore. Reload the page to see your plan.", true],
    ['not_entitled', 'This plan has already ended. Choose a plan on the pricing page.', true],
    ['ends_early', /^This plan's end date was set by our support team\. Email .+ to keep it\.$/, false],
    ['schedule_attached', /^This plan has changes set up by our support team\. Email .+ to keep it\.$/, false],
    ['rate_limited', 'Too many billing requests in a short time. Please wait a few minutes and try again.', false],
    ['no_subscription', /^We couldn't find your subscription\./, false],
    ['something_else', /^Couldn't keep your plan\. Please try again, or email .+\.$/, false],
  ])('%s: its own message under the button', async (code, message, refreshes) => {
    await renderNotice({ ok: false, body: { error: 'x', code } })
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Keep my plan' })).toBeEnabled()
    expect(refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0)
  })

  it('a network failure: the generic message', async () => {
    await renderNotice(new Error('offline'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't keep your plan\./)
  })
})

describe('dashboard', () => {
  it('a plan set to end: the option switch is a note pointing to the account page', async () => {
    mockServer({ ...ROW, cancel_at_period_end: true })
    await renderDashboard()

    expect(screen.queryByRole('button', { name: 'Handle setup yourself' })).not.toBeInTheDocument()
    const note = screen.getByTestId('switch-ai-mode-plan-ends')
    expect(note).toHaveTextContent(/^Your plan ends on .*2026\. Keep your plan to change it\.$/)
    expect(within(note).getByRole('link', { name: 'Keep your plan' })).toHaveAttribute('href', '/account')
    expect(screen.getByText(/^Ends .*2026/)).toBeInTheDocument()
  })

  it('a renewing plan keeps the switch', async () => {
    mockServer({ ...ROW, cancel_at_period_end: false })
    await renderDashboard()
    expect(screen.getByRole('button', { name: 'Handle setup yourself' })).toBeInTheDocument()
    expect(screen.queryByTestId('switch-ai-mode-plan-ends')).not.toBeInTheDocument()
  })
})

describe('SwitchAiModeButton and usePlanChange', () => {
  it('without a date the note says the plan is set to end', async () => {
    const { SwitchAiModeButton } = await import('@/components/account/SwitchAiModeButton')
    render(<SwitchAiModeButton current="managed" interval="monthly" returnPath="/dashboard" planEnds={{ date: null }} />)
    expect(screen.getByTestId('switch-ai-mode-plan-ends')).toHaveTextContent('Your plan is set to end. Keep your plan to change it.')
  })

  it('usePlanChange sends nothing for a plan set to end and says why', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { usePlanChange } = await import('@/components/pricing/usePlanChange')
    const { result } = renderHook(() =>
      usePlanChange({ tierKey: 'proAi', interval: 'monthly', aiMode: 'managed', setToEnd: true }, '/pricing')
    )

    act(() => result.current.start({ tier: 'pro' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/^Your plan is set to end at the end of this billing period\./)
  })
})
