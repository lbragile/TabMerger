import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { FAQ } from '@/components/marketing/FAQ'

describe('FAQ', () => {
  it('renders the first question row expanded by default, others collapsed', () => {
    render(<FAQ />)
    const firstButton = screen.getByRole('button', { name: /Is TabMerger really free\?/ })
    expect(firstButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/up to 5 groups, 50 tabs/)).toBeInTheDocument()

    const secondButton = screen.getByRole('button', { name: /How does cloud sync work\?/ })
    expect(secondButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('toggles a collapsed item open and closed again on click', async () => {
    const user = userEvent.setup()
    render(<FAQ />)
    const button = screen.getByRole('button', { name: /How does cloud sync work\?/ })

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders the heading, subtext, and contact support link', () => {
    render(<FAQ />)
    expect(screen.getByRole('heading', { name: 'Frequently asked' })).toBeInTheDocument()
    expect(
      screen.getByText('Still unsure about something? We answer email in under a day.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact')
  })
})
