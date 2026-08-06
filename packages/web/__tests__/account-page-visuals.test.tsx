import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn() } }),
}))

function mockSupabase(tier: string) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com', created_at: '2024-01-01' } } }),
      },
      from: (table: string) => {
        const builder: Record<string, unknown> & PromiseLike<{ data: unknown }> = {} as never
        const chain = () => builder
        builder.select = chain
        builder.eq = chain
        builder.order = chain
        builder.limit = chain
        builder.single = async () =>
          table === 'subscriptions'
            ? { data: { tier, status: 'active', current_period_end: null } }
            : { data: { created_at: '2024-01-01' } }
        // device_sessions query is awaited directly (no .single()) — make the builder thenable
        // so `await` resolves it to an empty result, same as a real empty Supabase response.
        builder.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: [] })
        return builder
      },
    }),
  }))
  vi.doMock('@/lib/stripe', () => ({
    createBillingPortalSession: async () => 'https://billing.example.com',
  }))
}

describe('AccountPage — usage summary cards (visual restyle)', () => {
  it('shows 0 AI calls left and no accent styling for a free-tier user', async () => {
    vi.resetModules()
    mockSupabase('free')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    const label = screen.getByText('AI calls left')
    const card = label.closest('div')
    expect(card?.textContent).toContain('0')
    expect(card?.className).not.toMatch(/border-primary/)
  })

  it('shows 47 AI calls left with accent styling for a pro_ai-tier user', async () => {
    vi.resetModules()
    mockSupabase('pro_ai')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    const label = screen.getByText('AI calls left')
    const card = label.closest('div')
    expect(card?.textContent).toContain('47')
    expect(card?.className).toMatch(/border-primary/)
  })
})

// NOT YET IMPLEMENTED: page.tsx doesn't render a "Buy more AI calls" button yet.
describe('AccountPage — buy more AI calls (not yet implemented)', () => {
  it('shows a "Buy more AI calls" button for a pro_ai user who has exhausted their monthly cap', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com', created_at: '2024-01-01' } } }),
        },
        from: (table: string) => {
          const builder: Record<string, unknown> & PromiseLike<{ data: unknown }> = {} as never
          const chain = () => builder
          builder.select = chain
          builder.eq = chain
          builder.order = chain
          builder.limit = chain
          builder.single = async () => {
            if (table === 'subscriptions') return { data: { tier: 'pro_ai', status: 'active', current_period_end: null } }
            if (table === 'ai_usage') return { data: { request_count: 100 } }
            return { data: { created_at: '2024-01-01' } }
          }
          builder.maybeSingle = builder.single
          builder.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: [] })
          return builder
        },
      }),
    }))
    vi.doMock('@/lib/stripe', () => ({
      createBillingPortalSession: async () => 'https://billing.example.com',
    }))
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    expect(screen.getByRole('button', { name: /buy more ai calls/i })).toBeInTheDocument()
  })
})

describe('AccountPage — dev-only device mock fallback', () => {
  it('does not show mock devices when NODE_ENV is not development (production behavior)', async () => {
    vi.resetModules()
    mockSupabase('pro')
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { default: AccountPage } = await import('@/app/(app)/account/page')
      const jsx = await AccountPage()
      render(jsx as React.ReactElement)
      expect(screen.getByText('No devices yet.')).toBeInTheDocument()
      expect(screen.queryByText('MacBook Pro')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
