import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { PricingTable } from '@/components/pricing/PricingTable'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('PricingTable', () => {
  it('defaults to monthly pricing and switches to yearly on toggle click', async () => {
    const user = userEvent.setup()
    render(<PricingTable installHref="https://store.example/tabmerger" />)

    expect(screen.getByText('$3.99')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Yearly/ }))

    expect(screen.getByText('$42.99')).toBeInTheDocument()
    expect(screen.queryByText('$3.99')).not.toBeInTheDocument()
  })

  it('shows the monthly equivalent and saving under each yearly price', async () => {
    const user = userEvent.setup()
    render(<PricingTable installHref="https://store.example/tabmerger" />)
    await user.click(screen.getByRole('button', { name: /Yearly/ }))

    // $42.99 / 12 and $85.99 / 12, against 12 x $3.99 and 12 x $7.99
    expect(screen.getByText('$3.58/mo billed yearly · save 10%')).toBeInTheDocument()
    expect(screen.getByText('$7.17/mo billed yearly · save 10%')).toBeInTheDocument()
  })

  it('says once, in a footnote, that the listed prices are US dollars', () => {
    render(<PricingTable installHref="https://store.example/tabmerger" />)
    expect(screen.getByText('All prices are in US dollars (USD).')).toBeInTheDocument()
    // The footnote covers the currency, so the listed prices themselves stay a plain "$".
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument()
  })

  it('opens the toggle on Monthly for a yearly subscriber, who is still offered the switch to monthly', () => {
    render(<PricingTable installHref="https://store.example/tabmerger" currentTier="pro" currentInterval="yearly" />)

    expect(screen.getByRole('button', { name: /Monthly/ }).className).toMatch(/bg-background/)
    expect(screen.getByRole('button', { name: /Yearly/ }).className).not.toMatch(/bg-background/)
    expect(screen.getByText('$3.99')).toBeInTheDocument()
    expect(screen.getByText('$7.99')).toBeInTheDocument()
    expect(screen.queryByText('$42.99')).not.toBeInTheDocument()
    expect(screen.queryByText('$85.99')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to monthly billing' })).toBeInTheDocument()
  })

  it('opens the toggle on Monthly for a monthly subscriber too', () => {
    render(<PricingTable installHref="https://store.example/tabmerger" currentTier="pro" currentInterval="monthly" />)

    expect(screen.getByRole('button', { name: /Monthly/ }).className).toMatch(/bg-background/)
    expect(screen.getByText('$3.99')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to yearly billing' })).toBeInTheDocument()
  })

  it('shows the shared advertised yearly discount on the toggle badge', () => {
    render(<PricingTable installHref="https://store.example/tabmerger" />)
    // YEARLY_DISCOUNT_PERCENT from @tabmerger/shared: every yearly price saves 10% to 11%.
    expect(screen.getByRole('button', { name: /Yearly/ })).toHaveTextContent('−10%')
  })

  it('applies active pill styling (bg-background) to the selected toggle option', async () => {
    const user = userEvent.setup()
    render(<PricingTable installHref="https://store.example/tabmerger" />)

    const monthlyBtn = screen.getByRole('button', { name: /Monthly/ })
    expect(monthlyBtn.className).toMatch(/bg-background/)

    await user.click(screen.getByRole('button', { name: /Yearly/ }))
    const yearlyBtn = screen.getByRole('button', { name: /Yearly/ })
    expect(yearlyBtn.className).toMatch(/bg-background/)
    expect(monthlyBtn.className).not.toMatch(/bg-background/)
  })

  // Side by side the cards are as tall as the tallest and every CTA sits on the same line (checked
  // in a browser: jsdom has no layout, so this pins the classes that make it so).
  it('stretches the cards to one height with each button pinned to the bottom', () => {
    const { container } = render(<PricingTable installHref="https://store.example/tabmerger" />)
    const grid = container.querySelector('.grid') as HTMLElement
    expect(grid.className).toMatch(/\bitems-stretch\b/)
    expect(grid.className).not.toMatch(/\bitems-center\b/)

    const cards = [...grid.querySelectorAll<HTMLElement>('div.rounded-2xl')]
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(card.className).toMatch(/\bflex\b/)
      expect(card.className).toMatch(/\bflex-col\b/)
      expect(card.className).toMatch(/\bh-full\b/)
      // The CTA's wrapper takes the free space above it.
      expect(card.lastElementChild?.className).toMatch(/\bmt-auto\b/)
      // Equal top and bottom padding: the highlighted card is roomier on the sides only, so the
      // title rows and the buttons line up.
      expect(card.className).toMatch(/\bp-6\b/)
      expect(card.className).not.toMatch(/\b(p|pt|pb|py)-7\b/)
    }
  })

  it('gives every plan name the same larger title size, smaller than its price', () => {
    render(<PricingTable installHref="https://store.example/tabmerger" />)
    const titles = screen.getAllByRole('heading', { level: 2 })
    expect(titles.map((h) => h.textContent)).toEqual(['Free', 'Pro', 'Pro AI'])
    for (const title of titles) {
      expect(title.className).toMatch(/\btext-xl\b/)
      expect(title.className).toMatch(/\bfont-semibold\b/)
    }
    // The price figures stay larger (text-4xl, or 2.75rem on the highlighted card).
    expect(screen.getByText('$3.99').className).toMatch(/text-\[2\.75rem\]/)
    expect(screen.getByText('$0').className).toMatch(/\btext-4xl\b/)
  })

  it('uses a responsive 1-col-mobile / 3-col-desktop grid, not an unconditional 3-column layout', () => {
    const { container } = render(<PricingTable installHref="https://store.example/tabmerger" />)
    const gridEl = container.querySelector('.grid') as HTMLElement
    expect(gridEl).not.toBeNull()
    expect(gridEl.className).toMatch(/grid-cols-1/)
    expect(gridEl.className).toMatch(/md:\[grid-template-columns:1fr_1\.1fr_1fr\]/)
  })
})
