import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { PricingTeaser } from '@/components/marketing/PricingTeaser'

describe('PricingTeaser', () => {
  it('renders free/pro/proAi tier names and monthly prices by default', () => {
    render(<PricingTeaser />)
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Pro AI')).toBeInTheDocument()
    expect(screen.getByText('$0')).toBeInTheDocument()
    expect(screen.getByText('$3.99')).toBeInTheDocument()
    expect(screen.getByText('$7.99')).toBeInTheDocument()
  })

  it('shows the Recommended badge on Pro only', () => {
    render(<PricingTeaser />)
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getAllByText('Recommended')).toHaveLength(1)
  })

  it('switches displayed prices to yearly values on toggle, and back on switching back', async () => {
    const user = userEvent.setup()
    render(<PricingTeaser />)

    await user.click(screen.getByRole('button', { name: /yearly/i }))
    expect(screen.getByText('$42.99')).toBeInTheDocument()
    expect(screen.getByText('$85.99')).toBeInTheDocument()
    expect(screen.queryByText('$3.99')).not.toBeInTheDocument()
    expect(screen.queryByText('$7.99')).not.toBeInTheDocument()
    // free tier always $0 regardless of toggle
    expect(screen.getByText('$0')).toBeInTheDocument()
    expect(screen.getByText('forever')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /monthly/i }))
    expect(screen.getByText('$3.99')).toBeInTheDocument()
    expect(screen.getByText('$7.99')).toBeInTheDocument()
    expect(screen.queryByText('$42.99')).not.toBeInTheDocument()
    expect(screen.queryByText('$85.99')).not.toBeInTheDocument()
  })

  it('renders a one-sentence blurb summarizing who each tier is for', () => {
    render(<PricingTeaser />)
    expect(screen.getByText('For casual users trying it out')).toBeInTheDocument()
    expect(screen.getByText('For users who want extra premium features')).toBeInTheDocument()
    expect(screen.getByText('For power users who want AI related features')).toBeInTheDocument()
  })

  it('renders "No credit card required" once, under the Free tier card only', () => {
    render(<PricingTeaser />)
    const notes = screen.getAllByText('No credit card required')
    expect(notes).toHaveLength(1)
    const freeCard = screen.getByText('Free').closest('div.rounded-2xl')
    expect(freeCard).toContainElement(notes[0])
  })

  it('keeps the title centered while the Recommended badge sits to the right', () => {
    render(<PricingTeaser />)
    const badge = screen.getByText('Recommended')
    // 3-column grid (spacer / centered title / badge) instead of a 2-up justify-between row,
    // so the title stays visually centered regardless of the badge's presence.
    expect(badge.parentElement?.className).toMatch(/grid-cols-\[1fr_auto_1fr\]/)
    expect(badge.className).toMatch(/justify-self-end/)
  })

  it('renders the cancellation note text', () => {
    render(<PricingTeaser />)
    expect(
      screen.getByText('Cancel anytime from your account — no lock-in, no questions asked.')
    ).toBeInTheDocument()
  })

  it('notes once that the listed prices are US dollars', () => {
    render(<PricingTeaser />)
    expect(screen.getByText('All prices are in US dollars (USD).')).toBeInTheDocument()
  })

  it('renders a "See full pricing" link pointing to /pricing', () => {
    render(<PricingTeaser />)
    const link = screen.getByRole('link', { name: /see full pricing/i })
    expect(link).toHaveAttribute('href', '/pricing')
  })
})
