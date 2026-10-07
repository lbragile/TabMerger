import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ShareInstallCta } from '@/components/ShareInstallCta'
import { BETA_STORE_LINKS } from '@/lib/storeLinks'

describe('ShareInstallCta', () => {
  it('renders an install link to the Chrome listing for this deployment', () => {
    render(<ShareInstallCta />)
    const link = screen.getByRole('link', { name: /install free/i })
    // No Vercel environment in tests, so this is the beta listing (see install-links.test.tsx).
    expect(link).toHaveAttribute('href', BETA_STORE_LINKS.chrome)
    expect(link).toHaveAttribute('target', '_blank')
  })
})
