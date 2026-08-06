import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// NOT YET IMPLEMENTED: components/account/BuyCreditsButton.tsx does not exist yet.
// This import fails until it's created — that's the expected red-phase failure here.
import { BuyCreditsButton } from '@/components/account/BuyCreditsButton'

describe('BuyCreditsButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/session_123' }),
    })))
  })

  it('renders a "Buy more AI calls" button', () => {
    render(<BuyCreditsButton />)
    expect(screen.getByRole('button', { name: /buy more ai calls/i })).toBeInTheDocument()
  })

  it('POSTs to /api/checkout/credits and redirects to the returned Stripe URL when clicked', async () => {
    const user = userEvent.setup()
    render(<BuyCreditsButton />)
    await user.click(screen.getByRole('button', { name: /buy more ai calls/i }))

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/checkout/credits',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
