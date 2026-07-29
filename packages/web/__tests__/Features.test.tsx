import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Features } from '@/components/marketing/Features'

describe('Features', () => {
  it('renders the lead feature cards', () => {
    render(<Features />)
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0)
  })

  it('uses a responsive grid class instead of an unconditional 3-column layout', () => {
    // grid-cols-3 with no sm:/md: prefix forces 3 columns on mobile.
    const { container } = render(<Features />)
    const gridEl = container.querySelector('.grid') as HTMLElement | null
    expect(gridEl).not.toBeNull()
    expect(gridEl?.className).not.toMatch(/^grid grid-cols-3\b/)
    expect(gridEl?.className).toMatch(/\b(sm|md|lg):grid-cols-/)
  })

  it('renders all three numbered rows with number span and title', () => {
    render(<Features />)
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('02')).toBeInTheDocument()
    expect(screen.getByText('03')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI files the mess for you' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Close everything, lose nothing' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The same tabs on every machine' })).toBeInTheDocument()
  })

  it('renders the main heading', () => {
    render(<Features />)
    expect(
      screen.getByRole('heading', { name: 'Built for the moment you have ninety tabs open.' })
    ).toBeInTheDocument()
  })

  it('renders a "See all features" link pointing to /features', () => {
    render(<Features />)
    const link = screen.getByRole('link', { name: /see all features/i })
    expect(link).toHaveAttribute('href', '/features')
  })

  it('renders illustration content for each row', () => {
    render(<Features />)
    expect(screen.getByText(/24 tabs → 3 groups/)).toBeInTheDocument()
    expect(screen.getByText('Morning Research')).toBeInTheDocument()
    expect(screen.getByText(/Synced 4 minutes ago/)).toBeInTheDocument()
  })
})
