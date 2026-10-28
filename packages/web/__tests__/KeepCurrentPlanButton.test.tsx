import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

/**
 * "Keep my current plan" on the account page (KeepCurrentPlanButton) and the scheduled-change
 * notice around it (ScheduledChangeNotice): the button asks the server to undo the scheduled
 * change, refreshes the page on success, is disabled while it waits and shows an error per code;
 * the notice stays mounted across that refresh and says the plan stays.
 */
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}))

const { KeepCurrentPlanButton } = await import('@/components/account/KeepCurrentPlanButton')
const { ScheduledChangeNotice } = await import('@/components/account/ScheduledChangeNotice')

const answer = (ok: boolean, body: unknown) => vi.fn(async () => ({ ok, json: async () => body }))

describe('KeepCurrentPlanButton', () => {
  beforeEach(() => {
    refresh.mockClear()
    vi.stubGlobal('fetch', answer(true, { ok: true }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs with no body, then reports success and refreshes the page, with no dialog', async () => {
    const onKept = vi.fn()
    const user = userEvent.setup()
    render(<KeepCurrentPlanButton onKept={onKept} />)

    await user.click(screen.getByRole('button', { name: 'Keep my current plan' }))

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/billing/keep-current-plan', { method: 'POST' })
    expect(onKept).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is disabled while the request is pending, so a second click sends nothing', async () => {
    let resolve: (value: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (resolve = r))))
    const user = userEvent.setup()
    render(<KeepCurrentPlanButton />)

    const button = screen.getByRole('button', { name: 'Keep my current plan' })
    await user.click(button)
    expect(button).toBeDisabled()
    await user.click(button)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    resolve({ ok: false, json: async () => ({ code: 'keep_plan_failed' }) })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(button).toBeEnabled()
  })

  it.each([
    ['no_billing_account', `This plan isn't linked to a billing account. Email ${SUPPORT_EMAIL} and we'll sort it out for you.`],
    ['no_subscription', `We couldn't find your subscription. Reload the page, or email ${SUPPORT_EMAIL}.`],
    ['no_scheduled_change', 'No plan change is scheduled anymore. Reload the page to see your plan.'],
    ['keep_plan_failed', `Couldn't keep your current plan. Please try again, or email ${SUPPORT_EMAIL}.`],
  ])('shows the message for %s and stays on the page without refreshing', async (code, message) => {
    vi.stubGlobal('fetch', answer(false, { code, error: 'x' }))
    const onKept = vi.fn()
    const user = userEvent.setup()
    render(<KeepCurrentPlanButton onKept={onKept} />)

    await user.click(screen.getByRole('button', { name: 'Keep my current plan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(onKept).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown code', answer(false, { code: 'teapot' })],
    ['a 200 without ok: true', answer(true, { url: 'https://example.com' })],
    ['a body that is not JSON', vi.fn(async () => ({ ok: false, json: async () => { throw new Error('not json') } }))],
    ['a network error', vi.fn(async () => { throw new Error('offline') })],
  ])('shows the generic message with the support address for %s', async (_label, fetchMock) => {
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<KeepCurrentPlanButton />)

    await user.click(screen.getByRole('button', { name: 'Keep my current plan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(`Couldn't keep your current plan. Please try again, or email ${SUPPORT_EMAIL}.`)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('ScheduledChangeNotice', () => {
  const notice = { message: 'Changes to Pro, billed monthly on Nov 26, 2026.', note: 'Cancelling keeps your current plan.' }

  beforeEach(() => {
    refresh.mockClear()
    vi.stubGlobal('fetch', answer(true, { ok: true }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the change with both actions', () => {
    render(<ScheduledChangeNotice notice={notice} currentPlan="Pro AI, billed monthly" />)
    expect(screen.getByText(notice.message)).toBeInTheDocument()
    expect(screen.getByText(notice.note)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep my current plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument()
  })

  it('renders nothing without a scheduled change', () => {
    const { container } = render(<ScheduledChangeNotice notice={null} currentPlan="Pro AI, billed monthly" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says the plan stays, focused, and keeps saying it after the refresh drops the notice', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ScheduledChangeNotice notice={notice} currentPlan="Pro AI, billed monthly" />)

    await user.click(screen.getByRole('button', { name: 'Keep my current plan' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Your plan stays Pro AI, billed monthly.')
    expect(status).toHaveFocus()
    expect(screen.queryByText(notice.message)).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)

    // What the refreshed page sends: nothing scheduled any more.
    rerender(<ScheduledChangeNotice notice={null} currentPlan="Pro AI, billed monthly" />)
    expect(screen.getByRole('status')).toHaveTextContent('Your plan stays Pro AI, billed monthly.')
  })

  it("names no plan when the current price isn't one this deployment sells", async () => {
    const user = userEvent.setup()
    render(<ScheduledChangeNotice notice={notice} currentPlan={null} />)
    await user.click(screen.getByRole('button', { name: 'Keep my current plan' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Your current plan stays.')
  })
})
