/**
 * The plan-change confirmation (usePlanChange): a change the server schedules for the end of the
 * period (no refund) is confirmed here first, and nothing is sent on Cancel; every upgrade, own-key
 * prices included, goes straight to Stripe's own confirm page. Covers the dialog, cancel (button
 * and Escape, with focus back on the opener), the results, the error codes and the portal path.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }))

const PERIOD_END = '2026-11-30T12:00:00.000Z'
const ACCOUNT_URL = 'https://tabmerger.example/account'

async function load() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
  return {
    ...(await import('@/components/pricing/PricingCard')),
    ...(await import('@/components/account/SwitchAiModeButton')),
  }
}

const cardProps = {
  name: 'Pro',
  monthlyPrice: 3.99,
  yearlyPrice: 42.99,
  features: [],
  interval: 'monthly' as const,
  tier: 'pro',
  installHref: 'https://store.example/tabmerger',
}

function respond(status: number, body: unknown) {
  vi.mocked(global.fetch).mockResolvedValueOnce({ status, ok: status >= 200 && status < 300, json: async () => body } as Response)
}

function lastRequest() {
  const [input, init] = vi.mocked(global.fetch).mock.calls.at(-1)!
  return { path: String(input), body: JSON.parse(String((init as RequestInit).body)) }
}

let originalLocation: Location
beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  global.fetch = vi.fn()
  originalLocation = window.location
  delete (window as { location?: Location }).location
  ;(window as unknown as { location: { href: string } }).location = { href: '' }
})
afterEach(() => {
  vi.unstubAllEnvs()
  ;(window as unknown as { location: Location }).location = originalLocation
})

describe('downgrade: confirmed, then scheduled for the end of the period', () => {
  it('Pro AI → Pro says when, that the current plan stays until then, and that nothing is refunded', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(
      <PricingCard {...cardProps} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" currentPeriodEnd={PERIOD_END} />
    )
    await user.click(screen.getByRole('button', { name: 'Downgrade to Pro' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirm plan change' })
    expect(dialog).toHaveTextContent(
      'Your plan changes to Pro, billed monthly on November 30, 2026. You keep your current plan until then. No refund for the rest of this period.'
    )
    expect(global.fetch).not.toHaveBeenCalled()

    respond(200, { applied: 'end_of_period', effectiveAt: PERIOD_END, url: ACCOUNT_URL })
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { tier: 'pro', interval: 'monthly' } })
    expect(await screen.findByRole('status')).toHaveTextContent('Done. Your plan changes to Pro, billed monthly on November 30, 2026.')
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('TabMerger → You (own key) from the account page is a downgrade too', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" interval="yearly" periodEnd={PERIOD_END} returnPath="/account" />)
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Your plan changes to Pro AI with you handling setup, billed yearly on November 30, 2026.'
    )
    respond(200, { applied: 'end_of_period', effectiveAt: PERIOD_END, url: ACCOUNT_URL })
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { aiMode: 'byok' } })
    expect(await screen.findByRole('status')).toHaveTextContent('Done. Your plan changes to Pro AI with you handling setup, billed yearly')
  })

  it('a shorter interval is confirmed as an end-of-period change, then follows the portal URL', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(<PricingCard {...cardProps} currentTier="pro" currentInterval="yearly" currentPeriodEnd={PERIOD_END} />)
    await user.click(screen.getByRole('button', { name: 'Switch to monthly billing' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Your plan changes to Pro, billed monthly on November 30, 2026.')
    respond(200, { url: 'https://billing.stripe.com/p/session/x' })
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-interval', body: { interval: 'monthly' } })
    expect(window.location.href).toBe('https://billing.stripe.com/p/session/x')
  })

  it('says "at the end of this billing period" when the period end is unknown', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" interval="monthly" returnPath="/account" />)
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Your plan changes to Pro AI with you handling setup, billed monthly at the end of this billing period.'
    )
  })
})

describe('own-key upgrades: straight to Stripe, no dialog of ours', () => {
  it('You → TabMerger posts at once and follows the portal confirm page', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="byok" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    respond(200, { url: 'https://billing.stripe.com/p/session/m' })
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { aiMode: 'managed' } })
    expect(window.location.href).toBe('https://billing.stripe.com/p/session/m')
  })

  it('Pro → Pro AI on your own key from the pricing card goes to the portal confirm page', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(
      <PricingCard {...cardProps} tier="proAi" name="Pro AI" currentTier="pro" currentInterval="monthly" currentPeriodEnd={PERIOD_END}
        aiOptions={{
          managed: { monthlyPrice: 7.99, yearlyPrice: 85.99, features: [] },
          byok: { monthlyPrice: 5.99, yearlyPrice: 64.49, features: [] },
        }}
      />
    )
    await user.click(screen.getByRole('radio', { name: 'You' }))
    respond(200, { url: 'https://billing.stripe.com/p/session/b' })
    await user.click(screen.getByRole('button', { name: 'Upgrade to Pro AI' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { tier: 'proAi', interval: 'monthly', aiMode: 'byok' } })
    expect(window.location.href).toBe('https://billing.stripe.com/p/session/b')
  })
})

describe('cancel', () => {
  it('Cancel sends nothing, closes the dialog and returns focus to the button that opened it', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    const opener = screen.getByRole('button', { name: 'Handle setup yourself' })
    await user.click(opener)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
  })

  it('Escape cancels too, from the keyboard alone', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    const opener = screen.getByRole('button', { name: 'Handle setup yourself' })
    opener.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
  })
})

describe('errors and the portal path', () => {
  it.each([
    [409, 'cancel_scheduled', 'Your plan is set to end at the end of this billing period. Renew it in Manage billing before changing it.'],
    [409, 'already_scheduled', 'A plan change is already scheduled for the end of this billing period.'],
    [409, 'already_on_price', "You're already on that plan."],
    [400, 'no_billing_account', "We couldn't find your billing account."],
    [403, 'no_paid_plan', "You don't have a paid plan to change."],
    [503, 'price_unavailable', "That plan isn't available to switch to right now."],
    [500, 'switch_failed', "Stripe couldn't start the change."],
  ])('a %s with code %s gets its own message', async (status, code, message) => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))
    respond(status, { error: 'English text from the server', code })
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('an error without a known code gets the generic message', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))
    respond(500, { error: 'Failed', code: 'something_new' })
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start the switch. Try Manage billing on your account page.")
  })

  it('says the option is not available yet on a 503 ai_disabled', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="byok" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    respond(503, { error: 'ai_disabled' })
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That Pro AI option isn't available yet.")
  })

  it('an upgrade the Billing Portal confirms itself is posted straight away, with no dialog', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(<PricingCard {...cardProps} tier="proAi" name="Pro AI" currentTier="pro" currentInterval="monthly" currentPeriodEnd={PERIOD_END} />)
    respond(200, { url: 'https://billing.stripe.com/p/session/y' })
    await user.click(screen.getByRole('button', { name: 'Upgrade to Pro AI' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { tier: 'proAi', interval: 'monthly', aiMode: 'managed' } })
    expect(window.location.href).toBe('https://billing.stripe.com/p/session/y')
  })
})

describe('recovery: the plan had already ended at Stripe', () => {
  const upgrade = async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(<PricingCard {...cardProps} tier="proAi" name="Pro AI" currentTier="pro" currentInterval="monthly" currentPeriodEnd={PERIOD_END} />)
    await user.click(screen.getByRole('button', { name: 'Upgrade to Pro AI' }))
  }
  const DRIFT = {
    error: 'No paid plan to switch',
    code: 'no_paid_plan',
    checkout: { tier: 'proAi', interval: 'monthly', aiMode: 'managed' },
  }

  it('goes straight to a checkout for the plan the server names, with no dead-end message', async () => {
    respond(403, DRIFT)
    respond(200, { url: 'https://checkout.stripe.com/c/pay/new' })
    await upgrade()

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/new'))
    expect(vi.mocked(global.fetch).mock.calls.map(([path]) => String(path))).toEqual([
      '/api/billing/switch-plan',
      '/api/checkout',
    ])
    expect(lastRequest()).toEqual({ path: '/api/checkout', body: DRIFT.checkout })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says there is no paid plan and refreshes the page when the checkout cannot start', async () => {
    respond(403, DRIFT)
    respond(500, { error: 'Failed to create checkout session' })
    await upgrade()

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have a paid plan to change. Choose a plan to subscribe instead.")
    expect(refresh).toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('says the option is not available when the checkout answers ai_disabled', async () => {
    respond(403, DRIFT)
    respond(503, { error: 'ai_disabled' })
    await upgrade()

    expect(await screen.findByRole('alert')).toHaveTextContent("That Pro AI option isn't available yet.")
  })

  it('sends a signed-out user to sign in', async () => {
    respond(403, DRIFT)
    respond(401, { error: 'Unauthorized' })
    await upgrade()

    await waitFor(() => expect(push).toHaveBeenCalledWith('/auth/sign-in?redirectTo=/pricing'))
  })

  it.each([
    ['an unknown tier', { tier: 'enterprise', interval: 'monthly' }],
    ['an AI option on Pro', { tier: 'pro', interval: 'monthly', aiMode: 'byok' }],
    ['no interval', { tier: 'proAi' }],
  ])('ignores a checkout target with %s and shows the message', async (_label, target) => {
    respond(403, { ...DRIFT, checkout: target })
    await upgrade()

    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have a paid plan to change.")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
