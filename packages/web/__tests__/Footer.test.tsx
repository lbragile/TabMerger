import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Footer } from '@/components/layout/Footer'

describe('Footer', () => {
  it('renders a Public column with a Shared group demo link', () => {
    render(<Footer />)
    expect(screen.getByRole('heading', { name: 'Public' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Shared group demo' })
    expect(link).toHaveAttribute('href', '/share/demo')
  })

  it('still renders the existing Product/Account/Legal columns', () => {
    render(<Footer />)
    expect(screen.getByRole('heading', { name: 'Product' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Legal' })).toBeInTheDocument()
  })

  it('links to the beta page under Public', () => {
    render(<Footer />)
    const publicColumn = screen.getByRole('heading', { name: 'Public' }).parentElement as HTMLElement
    const link = within(publicColumn).getByRole('link', { name: 'Beta' })
    expect(link).toHaveAttribute('href', '/beta')
  })
})
