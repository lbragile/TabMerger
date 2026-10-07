import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FinalCta } from '@/components/marketing/FinalCta'
import { BETA_STORE_LINKS } from '@/lib/storeLinks'

describe('FinalCta', () => {
  it('renders the install CTA link pointing to the Chrome listing for this deployment', () => {
    render(<FinalCta />)
    const link = screen.getByRole('link', { name: /install for chrome/i })
    // No Vercel environment in tests, so this is the beta listing (see install-links.test.tsx).
    expect(link).toHaveAttribute('href', BETA_STORE_LINKS.chrome)
  })

  it('renders the FAQ link pointing to /faq', () => {
    render(<FinalCta />)
    const link = screen.getByRole('link', { name: /have questions\? see the faq/i })
    expect(link).toHaveAttribute('href', '/faq')
  })
})
