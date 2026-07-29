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
    render(<PricingTable />)

    expect(screen.getByText('$3.99')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Yearly/ }))

    expect(screen.getByText('$34.99')).toBeInTheDocument()
    expect(screen.queryByText('$3.99')).not.toBeInTheDocument()
  })

  it('applies active pill styling (bg-background) to the selected toggle option', async () => {
    const user = userEvent.setup()
    render(<PricingTable />)

    const monthlyBtn = screen.getByRole('button', { name: /Monthly/ })
    expect(monthlyBtn.className).toMatch(/bg-background/)

    await user.click(screen.getByRole('button', { name: /Yearly/ }))
    const yearlyBtn = screen.getByRole('button', { name: /Yearly/ })
    expect(yearlyBtn.className).toMatch(/bg-background/)
    expect(monthlyBtn.className).not.toMatch(/bg-background/)
  })

  it('uses a responsive 1-col-mobile / 3-col-desktop grid, not an unconditional 3-column layout', () => {
    const { container } = render(<PricingTable />)
    const gridEl = container.querySelector('.grid') as HTMLElement
    expect(gridEl).not.toBeNull()
    expect(gridEl.className).toMatch(/grid-cols-1/)
    expect(gridEl.className).toMatch(/md:\[grid-template-columns:1fr_1\.1fr_1fr\]/)
  })
})
