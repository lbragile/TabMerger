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

  describe('monthly equivalent of the yearly price', () => {
    // The pricing page's exact wording (see PricingTable.test.tsx): $42.99 / 12 and $85.99 / 12.
    const PRO = '$3.58/mo billed yearly · save 10%'
    const PRO_AI = '$7.17/mo billed yearly · save 10%'
    // What a reader gets: the Monthly placeholder is aria-hidden, so it is left out.
    const shown = { ignore: '[aria-hidden="true"]' }
    const cardOf = (name: string) => screen.getByText(name).closest('div.rounded-2xl') as HTMLElement

    it('shows it on Yearly under Pro and Pro AI, as text that is read out', async () => {
      const user = userEvent.setup()
      render(<PricingTeaser />)
      await user.click(screen.getByRole('button', { name: /yearly/i }))

      const pro = screen.getByText(PRO, shown)
      const proAi = screen.getByText(PRO_AI, shown)
      expect(cardOf('Pro')).toContainElement(pro)
      expect(cardOf('Pro AI')).toContainElement(proAi)
      for (const line of [pro, proAi]) {
        expect(line).not.toHaveAttribute('aria-hidden')
        expect(line.className).not.toMatch(/\binvisible\b/)
        // Same muted token and size as the other lines under the price.
        expect(line.className).toBe(screen.getByText('No credit card required').className)
      }
    })

    it('comes after the price in each paid card', async () => {
      const user = userEvent.setup()
      render(<PricingTeaser />)
      await user.click(screen.getByRole('button', { name: /yearly/i }))

      for (const [price, line] of [['$42.99', PRO], ['$85.99', PRO_AI]]) {
        const position = screen.getByText(price).compareDocumentPosition(screen.getByText(line, shown))
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
    })

    it('shows none under Free, on either interval', async () => {
      const user = userEvent.setup()
      render(<PricingTeaser />)
      expect(cardOf('Free')).not.toHaveTextContent(/billed yearly/)

      await user.click(screen.getByRole('button', { name: /yearly/i }))
      expect(cardOf('Free')).not.toHaveTextContent(/billed yearly/)
      expect(cardOf('Free')).toHaveTextContent('No credit card required')
    })

    it('shows none on Monthly: the line only holds its space, hidden from sight and readers', async () => {
      const user = userEvent.setup()
      render(<PricingTeaser />)
      expect(screen.queryByText(/billed yearly/, shown)).not.toBeInTheDocument()

      // The reserved lines keep each paid card's height the same in both states.
      const reserved = screen.getAllByText(/billed yearly/)
      expect(reserved).toHaveLength(2)
      for (const line of reserved) {
        expect(line).toHaveAttribute('aria-hidden', 'true')
        expect(line.className).toMatch(/\binvisible\b/)
      }

      await user.click(screen.getByRole('button', { name: /yearly/i }))
      expect(screen.getAllByText(/billed yearly/, shown)).toHaveLength(2)

      await user.click(screen.getByRole('button', { name: /monthly/i }))
      expect(screen.queryByText(/billed yearly/, shown)).not.toBeInTheDocument()
    })

    it('keeps the cards the same height: the same lines in each, equal rows when stacked', () => {
      const { container } = render(<PricingTeaser />)
      // Equal row heights when the cards stack, whichever card's text wraps.
      expect(container.querySelector('.grid.grid-cols-1')?.className).toMatch(/\bauto-rows-fr\b/)
      for (const name of ['Free', 'Pro', 'Pro AI']) {
        // Title row's name, the price, the blurb and one note line.
        expect(cardOf(name).querySelectorAll('p')).toHaveLength(4)
      }
    })
  })

  it('keeps the −10% badge on the Yearly toggle, matching what each paid plan saves', async () => {
    const { YEARLY_SAVINGS, YEARLY_DISCOUNT_PERCENT } = await import('@/lib/tiers')
    render(<PricingTeaser />)
    expect(screen.getByRole('button', { name: /yearly/i })).toHaveTextContent('−10%')
    expect(YEARLY_DISCOUNT_PERCENT).toBe(10)
    expect(YEARLY_SAVINGS.pro.percent).toBe(10)
    expect(YEARLY_SAVINGS.proAi.percent).toBe(10)
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
