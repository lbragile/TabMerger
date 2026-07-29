import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ShareInstallCta } from '@/components/ShareInstallCta'

describe('ShareInstallCta', () => {
  it('renders an install link to the Chrome Web Store', () => {
    render(<ShareInstallCta />)
    const link = screen.getByRole('link', { name: /install free/i })
    expect(link).toHaveAttribute('href', 'https://chrome.google.com/webstore')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
