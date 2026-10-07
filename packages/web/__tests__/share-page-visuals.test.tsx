import { render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { BETA_STORE_LINKS, STABLE_STORE_LINKS } from '@/lib/storeLinks'

// SharePage is an async server component — mock its data dependency.

function mockSupabase(data: Record<string, unknown> | null) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key'
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      from: () => {
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        builder.select = chain
        builder.eq = chain
        builder.single = async () => ({ data, error: data ? null : { code: 'PGRST116' } })
        return builder
      },
    }),
  }))
  vi.doMock('next/headers', () => ({
    headers: async () => new Map([['host', 'tabmerger.vercel.app']]),
  }))
}

describe('SharePage — visual restyle additions', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows the read-only badge pill above the heading', async () => {
    vi.resetModules()
    mockSupabase({
      slug: 'abc123',
      user_id: 'u1',
      created_at: '2024-01-01',
      expires_at: null,
      groups_snapshot: [],
    })
    const { default: SharePage } = await import('@/app/(marketing)/share/[slug]/page')
    const jsx = await SharePage({ params: Promise.resolve({ slug: 'abc123' }) })
    render(jsx as React.ReactElement)

    expect(screen.getByText(/shared collection/i)).toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('shows an expiry line when bundle.expiresAt is set', async () => {
    vi.resetModules()
    const future = new Date(Date.now() + 86400000).toISOString()
    mockSupabase({
      slug: 'abc123',
      user_id: 'u1',
      created_at: '2024-01-01',
      expires_at: future,
      groups_snapshot: [],
    })
    const { default: SharePage } = await import('@/app/(marketing)/share/[slug]/page')
    const jsx = await SharePage({ params: Promise.resolve({ slug: 'abc123' }) })
    render(jsx as React.ReactElement)

    expect(screen.getByText(/link expires/i)).toBeInTheDocument()
  })

  it('does not show an expiry line when bundle.expiresAt is null', async () => {
    vi.resetModules()
    mockSupabase({
      slug: 'abc123',
      user_id: 'u1',
      created_at: '2024-01-01',
      expires_at: null,
      groups_snapshot: [],
    })
    const { default: SharePage } = await import('@/app/(marketing)/share/[slug]/page')
    const jsx = await SharePage({ params: Promise.resolve({ slug: 'abc123' }) })
    render(jsx as React.ReactElement)

    expect(screen.queryByText(/link expires/i)).not.toBeInTheDocument()
  })

  it.each([
    ['the stable listing on the production deployment', 'production', STABLE_STORE_LINKS.chrome],
    ['the BETA listing on the preview deployment', 'preview', BETA_STORE_LINKS.chrome],
  ])('shows an "Install free" CTA linking to %s', async (_label, vercelEnv, expectedHref) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    vi.resetModules()
    mockSupabase({
      slug: 'abc123',
      user_id: 'u1',
      created_at: '2024-01-01',
      expires_at: null,
      groups_snapshot: [],
    })
    const { default: SharePage } = await import('@/app/(marketing)/share/[slug]/page')
    const jsx = await SharePage({ params: Promise.resolve({ slug: 'abc123' }) })
    render(jsx as React.ReactElement)

    const cta = screen.getByRole('link', { name: /install free/i })
    expect(cta).toHaveAttribute('href', expectedHref)
    expect(cta).toHaveAttribute('target', '_blank')
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
