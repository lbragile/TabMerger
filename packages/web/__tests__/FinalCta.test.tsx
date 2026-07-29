import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FinalCta } from '@/components/marketing/FinalCta'

describe('FinalCta', () => {
  it('renders the install CTA link pointing to the Chrome Web Store', () => {
    render(<FinalCta />)
    const link = screen.getByRole('link', { name: /install for chrome/i })
    expect(link).toHaveAttribute('href', 'https://chrome.google.com/webstore')
  })

  it('renders the FAQ link pointing to /faq', () => {
    render(<FinalCta />)
    const link = screen.getByRole('link', { name: /have questions\? see the faq/i })
    expect(link).toHaveAttribute('href', '/faq')
  })
})
