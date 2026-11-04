/**
 * The plan-change confirmation (usePlanChange): only an `end_of_period` change, which the server
 * schedules on the POST itself with no Stripe page after it (the interval shortens together with
 * another change, or the current price is one this deployment doesn't sell), is confirmed in our
 * dialog first, and nothing is sent on Cancel. Every change the Billing Portal handles goes straight
 * to Stripe's own confirm page with no dialog of ours: a `portal_end_of_period` downgrade or shorter
 * interval (Stripe's page says "Updates on {date}"; TabMerger → own key on Pro AI is one of these)
 * and every upgrade. Covers the dialog, cancel (button and Escape, with focus back on the opener),
 * the results, the error codes and the portal path.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

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

const proAiCard = {
  ...cardProps,
  tier: 'proAi',
  name: 'Pro AI',
  aiOptions: {
    managed: { monthlyPrice: 7.99, yearlyPrice: 85.99, features: [] },
    byok: { monthlyPrice: 5.99, yearlyPrice: 64.49, features: [] },
  },
}

type PricingCardComponent = Awaited<ReturnType<typeof load>>['PricingCard']

/** Pro yearly → Pro AI monthly: the interval shortens with another change, so the server schedules it. */
function renderShorterAndUpgrade(PricingCard: PricingCardComponent, periodEnd: string | null = PERIOD_END) {
  render(<PricingCard {...proAiCard} currentTier="pro" currentInterval="yearly" currentPeriodEnd={periodEnd} />)
  return screen.getByRole('button', { name: 'Upgrade to Pro AI' })
}

describe('end_of_period: confirmed in our dialog, then scheduled by the server', () => {
  it('Pro yearly → Pro AI monthly says when, that the current plan stays until then, and that nothing is refunded', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    await user.click(renderShorterAndUpgrade(PricingCard))

    const dialog = await screen.findByRole('dialog', { name: 'Confirm plan change' })
    expect(dialog).toHaveTextContent(
      'Your plan changes to Pro AI with TabMerger handling setup, billed monthly on November 30, 2026. You keep your current plan until then. No refund for the rest of this period.'
    )
    expect(dialog).not.toHaveTextContent(/credit/i)
    expect(global.fetch).not.toHaveBeenCalled()

    respond(200, { applied: 'end_of_period', effectiveAt: PERIOD_END, url: ACCOUNT_URL })
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(lastRequest()).toEqual({
      path: '/api/billing/switch-plan',
      body: { tier: 'proAi', interval: 'monthly', aiMode: 'managed' },
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Done. Your plan changes to Pro AI with TabMerger handling setup, billed monthly on November 30, 2026.'
    )
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('Pro AI yearly → Pro monthly is confirmed the same way', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(
      <PricingCard {...cardProps} currentTier="pro_ai" currentInterval="yearly" currentAiMode="managed" currentPeriodEnd={PERIOD_END} />
    )
    await user.click(screen.getByRole('button', { name: 'Downgrade to Pro' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Your plan changes to Pro, billed monthly on November 30, 2026.')
    expect(global.fetch).not.toHaveBeenCalled()
    respond(200, { applied: 'end_of_period', effectiveAt: PERIOD_END, url: ACCOUNT_URL })
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { tier: 'pro', interval: 'monthly' } })
  })

  it('says "at the end of this billing period" when the period end is unknown', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    await user.click(renderShorterAndUpgrade(PricingCard, null))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Your plan changes to Pro AI with TabMerger handling setup, billed monthly at the end of this billing period.'
    )
  })

  it('a current price this deployment does not sell (interval unknown) is confirmed, as the server schedules it', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" returnPath="/account" />)
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Your plan changes to Pro AI with you handling setup at the end of this billing period.'
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('an upgrade from an unknown current price is confirmed too (the server schedules it as well)', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="byok" periodEnd={PERIOD_END} returnPath="/account" />)
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Your plan changes to Pro AI with TabMerger handling setup on November 30, 2026.'
    )
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('portal_end_of_period: straight to Stripe, whose confirm page defers it', () => {
  it('Pro AI → Pro posts at once, with no dialog of ours, and follows the portal confirm page', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(
      <PricingCard {...cardProps} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" currentPeriodEnd={PERIOD_END} />
    )
    respond(200, { url: 'https://billing.stripe.com/p/session/down' })
    await user.click(screen.getByRole('button', { name: 'Downgrade to Pro' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { tier: 'pro', interval: 'monthly' } })
    await waitFor(() => expect(window.location.href).toBe('https://billing.stripe.com/p/session/down'))
  })

  it('a shorter interval on the same plan posts at once to switch-interval', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(<PricingCard {...cardProps} currentTier="pro" currentInterval="yearly" currentPeriodEnd={PERIOD_END} />)
    respond(200, { url: 'https://billing.stripe.com/p/session/x' })
    await user.click(screen.getByRole('button', { name: 'Switch to monthly billing' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-interval', body: { interval: 'monthly' } })
    await waitFor(() => expect(window.location.href).toBe('https://billing.stripe.com/p/session/x'))
  })

  it('TabMerger → own key from the account page posts at once and follows the portal confirm page', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="managed" interval="yearly" periodEnd={PERIOD_END} returnPath="/account" />)
    respond(200, { url: 'https://billing.stripe.com/p/session/own' })
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { aiMode: 'byok' } })
    await waitFor(() => expect(window.location.href).toBe('https://billing.stripe.com/p/session/own'))
  })

  it('TabMerger → own key from the pricing card: the same', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    render(
      <PricingCard {...proAiCard} currentTier="pro_ai" currentInterval="monthly" currentAiMode="managed" currentPeriodEnd={PERIOD_END} />
    )
    await user.click(screen.getByRole('radio', { name: 'You' }))
    respond(200, { url: 'https://billing.stripe.com/p/session/own' })
    await user.click(screen.getByRole('button', { name: 'Handle setup yourself' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastRequest()).toEqual({ path: '/api/billing/switch-plan', body: { aiMode: 'byok' } })
    await waitFor(() => expect(window.location.href).toBe('https://billing.stripe.com/p/session/own'))
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
    const { PricingCard } = await load()
    const user = userEvent.setup()
    const opener = renderShorterAndUpgrade(PricingCard)
    await user.click(opener)
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
  })

  it('Escape cancels too, from the keyboard alone', async () => {
    const { PricingCard } = await load()
    const user = userEvent.setup()
    const opener = renderShorterAndUpgrade(PricingCard)
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
    [409, 'pay_or_resume', `Your plan is waiting for a payment or is paused, so it can't be changed yet. Email ${SUPPORT_EMAIL} and we'll help you sort it out.`],
    [400, 'no_billing_account', `This plan isn't linked to a billing account, so it can't be changed here. Email ${SUPPORT_EMAIL} and we'll change it for you.`],
    [403, 'no_paid_plan', "You don't have a paid plan to change."],
    [503, 'price_unavailable', "That plan isn't available to switch to right now."],
    [500, 'switch_failed', `Stripe couldn't start the change. Please try again, use Manage billing on your account page, or email ${SUPPORT_EMAIL}.`],
    [429, 'rate_limited', 'Too many billing requests in a short time. Please wait a few minutes and try again.'],
  ])('a %s with code %s gets its own message', async (status, code, message) => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="byok" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    respond(status, { error: 'English text from the server', code })
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(refresh).not.toHaveBeenCalled()
  })

  // A plan with no Stripe customer (granted by hand or by migration) has no Manage billing on the
  // account page, so these never send the user there.
  it.each([
    [400, 'no_billing_account'],
    [409, 'pay_or_resume'],
    [500, 'something_new'],
  ])('a %s %s offers the support address, not Manage billing', async (status, code) => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="byok" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    respond(status, { error: 'English text from the server', code })
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(`${SUPPORT_EMAIL}`)
    expect(alert).not.toHaveTextContent(/Manage billing/)
  })

  it('an error without a known code gets the generic message', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="byok" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    respond(500, { error: 'Failed', code: 'something_new' })
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Couldn't start the switch. Please try again, or email ${SUPPORT_EMAIL} if it keeps happening.`
    )
  })

  it('a network failure gets the generic message too', async () => {
    const { SwitchAiModeButton } = await load()
    const user = userEvent.setup()
    render(<SwitchAiModeButton current="byok" interval="monthly" periodEnd={PERIOD_END} returnPath="/account" />)
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(screen.getByRole('button', { name: 'Let TabMerger handle setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start the switch. Please try again")
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

  it('says checkout could not start and refreshes the page when the checkout fails', async () => {
    respond(403, DRIFT)
    respond(500, { error: 'Failed to create checkout session' })
    await upgrade()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start checkout. Please try again in a moment.")
    expect(refresh).toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it.each([
    [409, { error: 'pay_or_resume' }, `Your plan is waiting for a payment or is paused, so it can't be changed yet. Email ${SUPPORT_EMAIL}`],
    [409, { error: 'already_subscribed', recorded: true }, 'You already have a plan. This page now shows it, so you can change it here.'],
    [409, { error: 'already_subscribed', recorded: false }, `Couldn't start the switch. Please try again, or email ${SUPPORT_EMAIL} if it keeps happening.`],
    [503, { error: 'billing_check_failed' }, "Couldn't start checkout. Please try again in a moment."],
    [429, { error: 'rate_limited', code: 'rate_limited' }, 'Too many billing requests in a short time. Please wait a few minutes and try again.'],
    [400, { error: 'Invalid tier' }, "You don't have a paid plan to change. Choose a plan to subscribe instead."],
  ])('a checkout %i %j shows its message and refreshes the page', async (status, body, message) => {
    respond(403, DRIFT)
    respond(status, body)
    await upgrade()

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
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
