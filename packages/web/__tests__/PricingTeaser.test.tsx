import { render, screen, within } from '@testing-library/react'
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
    const cardOf = (name: string) => screen.getByText(name).closest('[data-tier]') as HTMLElement

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

    it('keeps the cards aligned: shared subgrid rows side by side, no stretched empty space when stacked', () => {
      const { container } = render(<PricingTeaser />)
      // Stacked cards size to their own content (no equal-height stretch).
      expect(container.querySelector('.grid.grid-cols-1')?.className).not.toMatch(/auto-rows-fr/)
      for (const name of ['Free', 'Pro', 'Pro AI']) {
        // Side by side every card spans the same rows, so prices and blurbs line up.
        expect(cardOf(name).className).toMatch(/sm:grid-rows-subgrid/)
        // The name, the price, one note line and the blurb.
        expect(cardOf(name).querySelectorAll('p')).toHaveLength(4)
      }
    })

    it('puts the Pro AI setup switch after the price and blurb, so it cannot push the price down', () => {
      render(<PricingTeaser />)
      const groups = screen.getAllByRole('group', { name: /who handles setup/i })
      expect(groups).toHaveLength(1)
      expect(cardOf('Pro AI')).toContainElement(groups[0])
      const price = screen.getByText('$7.99')
      expect(price.compareDocumentPosition(groups[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('lists highlights per card, with the Pro AI one following the chosen option', async () => {
      const user = userEvent.setup()
      render(<PricingTeaser />)
      expect(within(cardOf('Free')).getAllByRole('listitem')).toHaveLength(4)
      expect(within(cardOf('Free')).getByText('Up to 5 groups')).toBeInTheDocument()
      expect(within(cardOf('Pro')).getByText('Cloud sync across devices')).toBeInTheDocument()
      const proAi = within(cardOf('Pro AI'))
      expect(proAi.getAllByRole('listitem')).toHaveLength(3)
      await user.click(proAi.getByLabelText('You'))
      expect(proAi.getByText('Use your own AI provider')).toBeInTheDocument()
      expect(proAi.queryByText(/AI credits a month/)).not.toBeInTheDocument()
      await user.click(proAi.getByLabelText('TabMerger'))
      expect(proAi.getByText(/AI credits a month/)).toBeInTheDocument()
      expect(proAi.queryByText('Use your own AI provider')).not.toBeInTheDocument()
    })
  })

  // The badge is the shared advertised discount; every paid option (Pro, and Pro AI either way
  // it's set up) really saves at least that much, so it is true for each.
  it('shows the shared yearly discount on the Yearly toggle', async () => {
    const { YEARLY_SAVINGS, YEARLY_DISCOUNT_PERCENT } = await import('@/lib/tiers')
    render(<PricingTeaser />)
    expect(screen.getByRole('button', { name: /yearly/i })).toHaveTextContent('−10%')
    expect(YEARLY_DISCOUNT_PERCENT).toBe(10)
    for (const savings of Object.values(YEARLY_SAVINGS)) expect(savings.percent).toBeGreaterThanOrEqual(10)
  })

  it('renders a one-line blurb saying what each tier gives', () => {
    render(<PricingTeaser />)
    expect(screen.getByText('Tidy your tabs on one device. No account needed.')).toBeInTheDocument()
    expect(screen.getByText('Your tabs without limits, synced and backed up.')).toBeInTheDocument()
    expect(screen.getByText('Let AI sort your tabs into named groups.')).toBeInTheDocument()
  })

  it('renders "No credit card required" once, under the Free tier card only', () => {
    render(<PricingTeaser />)
    const notes = screen.getAllByText('No credit card required')
    expect(notes).toHaveLength(1)
    const freeCard = screen.getByText('Free').closest('[data-tier]')
    expect(freeCard).toContainElement(notes[0])
  })

  it('sits the Recommended badge on the top edge of the Pro card, so it never shifts the title', () => {
    render(<PricingTeaser />)
    const badge = screen.getByText('Recommended')
    const pro = screen.getByText('Pro').closest('[data-tier]')
    expect(pro).toContainElement(badge)
    // Out of flow, centered on the edge: the title's block has no badge beside it.
    expect(badge.className).toMatch(/\babsolute\b/)
    expect(badge.className).toMatch(/-translate-y-1\/2/)
    expect(screen.getByText('Pro').parentElement).not.toContainElement(badge)
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
