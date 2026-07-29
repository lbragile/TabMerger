import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type React from 'react'

function mockSupabase() {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
      }),
    }),
  }))
}

const SAMPLE_QUESTION = 'Is TabMerger really free?'

describe('/faq page', () => {
  it(
    'renders the FAQ list and its own heading',
    async () => {
      const { default: FaqPage } = await import('@/app/(marketing)/faq/page')
      render(<FaqPage />)
      expect(screen.getByRole('heading', { name: 'Frequently asked' })).toBeInTheDocument()
      expect(screen.getByText(SAMPLE_QUESTION)).toBeInTheDocument()
    },
    // ponytail: dynamic import + first render is slow under v8 coverage instrumentation, default 5s is too tight
    15000
  )
})

describe('Home page', () => {
  it('no longer renders FAQ content', async () => {
    const { default: HomePage } = await import('@/app/(marketing)/page')
    render(<HomePage />)
    expect(screen.queryByText(SAMPLE_QUESTION)).not.toBeInTheDocument()
  })
})

describe('Pricing page', () => {
  it('no longer renders FAQ content, links to /faq instead', async () => {
    vi.resetModules()
    mockSupabase()
    const { default: PricingPage } = await import('@/app/(marketing)/pricing/page')
    const jsx = await PricingPage()
    render(jsx as React.ReactElement)
    expect(screen.queryByText(SAMPLE_QUESTION)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq')
  })
})
