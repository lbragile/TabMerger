import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
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

  describe('beta guide link', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    function stubDeployment(vercelEnv: string) {
      vi.stubEnv('VERCEL_ENV', vercelEnv)
      vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', vercelEnv)
    }

    it.each([
      ['the preview deployment', 'preview'],
      ['local development (no Vercel environment)', ''],
    ])('links to the beta page under Public on %s', (_label, vercelEnv) => {
      stubDeployment(vercelEnv)
      render(<Footer />)
      const publicColumn = screen.getByRole('heading', { name: 'Public' }).parentElement as HTMLElement
      const link = within(publicColumn).getByRole('link', { name: 'Beta' })
      expect(link).toHaveAttribute('href', '/beta')
    })

    it('has no beta link on the production deployment, where the guide is not served', () => {
      stubDeployment('production')
      render(<Footer />)
      expect(screen.queryByRole('link', { name: 'Beta' })).not.toBeInTheDocument()
      expect(document.querySelector('a[href^="/beta"]')).toBeNull()
      // The rest of the Public column is unaffected.
      expect(screen.getByRole('link', { name: 'Shared group demo' })).toHaveAttribute('href', '/share/demo')
    })
  })
})
