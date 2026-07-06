import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { InstallButtons } from '@/components/marketing/InstallButtons'

describe('InstallButtons', () => {
  it('renders all three browser install links', () => {
    render(<InstallButtons />)
    // getByRole('link') — links are accessible interactive elements
    expect(screen.getByRole('link', { name: /Add to Chrome/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add to Firefox/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add to Edge/i })).toBeInTheDocument()
  })

  it('Chrome link points to the Chrome Web Store', () => {
    render(<InstallButtons />)
    expect(screen.getByRole('link', { name: /Add to Chrome/i })).toHaveAttribute(
      'href',
      expect.stringContaining('chrome.google.com')
    )
  })

  it('renders a View pricing link', () => {
    render(<InstallButtons />)
    expect(screen.getByRole('link', { name: /View pricing/i })).toBeInTheDocument()
  })

  it('browser icons have accessible names via role="img"', () => {
    render(<InstallButtons />)
    // SVGs use role="img" + aria-label, so getByRole is still the top-priority query
    expect(screen.getByRole('img', { name: 'Chrome' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Firefox' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Edge' })).toBeInTheDocument()
  })
})
