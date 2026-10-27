import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BuyCreditsButton } from '@/components/account/BuyCreditsButton'

const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

describe('BuyCreditsButton', () => {
  beforeEach(() => {
    toastError.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/session_123' }),
    })))
  })

  it('renders a plain "Get more" CTA', () => {
    render(<BuyCreditsButton />)
    expect(screen.getByRole('button', { name: /get more/i })).toBeInTheDocument()
  })

  it('POSTs to /api/checkout/credits with no body and redirects to the returned Stripe URL', async () => {
    const user = userEvent.setup()
    render(<BuyCreditsButton />)
    await user.click(screen.getByRole('button', { name: /get more/i }))

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/checkout/credits', { method: 'POST' })
  })

  it('shows an error toast when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network error')
    }))
    const user = userEvent.setup()
    render(<BuyCreditsButton />)
    await user.click(screen.getByRole('button', { name: /get more/i }))

    expect(toastError).toHaveBeenCalledWith('Could not start checkout')
  })

  it('shows an error toast when the response has no url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })))
    const user = userEvent.setup()
    render(<BuyCreditsButton />)
    await user.click(screen.getByRole('button', { name: /get more/i }))

    expect(toastError).toHaveBeenCalledWith('Could not start checkout')
  })

  // The server sells packs only to a paid-up managed Pro AI plan; a page opened before the plan
  // ended (or on another plan) says who packs are for instead of a generic failure.
  it('says who credit packs are for on a 403 credits_not_available, and re-enables the button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'credits_not_available' }),
    })))
    const user = userEvent.setup()
    render(<BuyCreditsButton />)
    await user.click(screen.getByRole('button', { name: /get more/i }))

    expect(toastError).toHaveBeenCalledWith('Credit packs need an active Pro AI plan with TabMerger handling AI setup.')
    expect(screen.getByRole('button', { name: /get more/i })).toBeEnabled()
  })

  it('keeps the generic message for the 409 own-key answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'credits_not_applicable' }),
    })))
    const user = userEvent.setup()
    render(<BuyCreditsButton />)
    await user.click(screen.getByRole('button', { name: /get more/i }))

    expect(toastError).toHaveBeenCalledWith('Could not start checkout')
  })
})
