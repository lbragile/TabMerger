import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CancelSubscriptionButton } from '@/components/account/CancelSubscriptionButton'

/**
 * The account page's "Cancel subscription" while a plan change is scheduled: it asks the server for
 * Stripe's cancel page and goes there (Stripe's page is the confirmation), or says what went wrong.
 */
describe('CancelSubscriptionButton', () => {
  const location = { href: '' }

  beforeEach(() => {
    location.href = ''
    vi.stubGlobal('location', location)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://billing.stripe.com/p/session/cancel' }) }))
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs with no body and goes to the returned Stripe page, with no dialog of its own', async () => {
    const user = userEvent.setup()
    render(<CancelSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: 'Cancel subscription' }))

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/billing/cancel-subscription', { method: 'POST' })
    expect(location.href).toBe('https://billing.stripe.com/p/session/cancel')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the message for a known error code and stays on the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ code: 'already_canceling', error: 'x' }) }))
    )
    const user = userEvent.setup()
    render(<CancelSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: 'Cancel subscription' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your plan is already set to end at the end of this billing period.')
    expect(location.href).toBe('')
    expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeEnabled()
  })

  it('shows the generic message with the support address for an unknown answer or a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const user = userEvent.setup()
    render(<CancelSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: 'Cancel subscription' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't open the cancellation page\. Please try again, or email .+@.+/)
  })
})
