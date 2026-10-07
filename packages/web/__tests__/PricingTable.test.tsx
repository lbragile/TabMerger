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

  it('computes the toggle badge from the prices instead of a fixed number', () => {
    render(<PricingTable installHref="https://store.example/tabmerger" />)
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

  it('uses a responsive 1-col-mobile / 3-col-desktop grid, not an unconditional 3-column layout', () => {
    const { container } = render(<PricingTable installHref="https://store.example/tabmerger" />)
    const gridEl = container.querySelector('.grid') as HTMLElement
    expect(gridEl).not.toBeNull()
    expect(gridEl.className).toMatch(/grid-cols-1/)
    expect(gridEl.className).toMatch(/md:\[grid-template-columns:1fr_1\.1fr_1fr\]/)
  })
})
