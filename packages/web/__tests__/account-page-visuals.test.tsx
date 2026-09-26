import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn() } }),
}))

function mockSupabase(tier: string, usedCount = 53, purchases: { credits: number }[] = []) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com', created_at: '2024-01-01' } } }),
      },
      from: (table: string) => {
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        builder.select = chain
        builder.eq = chain
        builder.order = chain
        builder.limit = chain
        builder.single = async () =>
          table === 'subscriptions'
            ? { data: { tier, status: 'active', current_period_end: null } }
            : { data: { created_at: '2024-01-01' } }
        builder.maybeSingle = async () => ({ data: { credits_used: usedCount } })
        // device_sessions + ai_credit_purchases queries are awaited directly (no .single()) —
        // make the builder thenable so `await` resolves to a multi-row result.
        builder.then = (resolve: (v: { data: unknown }) => void) =>
          resolve({ data: table === 'ai_credit_purchases' ? purchases : [] })
        return builder
      },
    }),
  }))
  vi.doMock('@/lib/stripe', () => ({
    createBillingPortalSession: async () => 'https://billing.example.com',
  }))
}

describe('AccountPage — usage summary cards (visual restyle)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows 0 AI calls left and no accent styling for a free-tier user', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    mockSupabase('free')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    const label = screen.getByText('AI credits left')
    const card = label.closest('div')
    expect(card?.textContent).toContain('0')
    expect(card?.className).not.toMatch(/border-primary/)
  })

  it('shows 47 AI calls left with accent styling for a pro_ai-tier user', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    mockSupabase('pro_ai')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    const label = screen.getByText('AI credits left')
    const card = label.closest('div')
    expect(card?.textContent).toContain('247')
    expect(card?.className).toMatch(/border-primary/)
  })

  it('adds purchased credit packs to the cap when computing AI calls left', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    mockSupabase('pro_ai', 100, [{ credits: 50 }, { credits: 50 }])
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    render((await AccountPage()) as React.ReactElement)

    // 300 base + 100 purchased - 100 used
    expect(screen.getByText('AI credits left').closest('div')?.textContent).toContain('300')
  })

  it('splices the "AI credits left" stat card out entirely when NEXT_PUBLIC_AI_ENABLED is off', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    mockSupabase('pro_ai')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    render((await AccountPage()) as React.ReactElement)

    expect(screen.queryByText('AI credits left')).not.toBeInTheDocument()
  })
})

describe('AccountPage — buy more AI calls', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows a "Get more" CTA for a pro_ai user who has exhausted their monthly cap', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com', created_at: '2024-01-01' } } }),
        },
        from: (table: string) => {
          const builder: Record<string, unknown> = {}
          const chain = () => builder
          builder.select = chain
          builder.eq = chain
          builder.order = chain
          builder.limit = chain
          builder.single = async () => {
            if (table === 'subscriptions') return { data: { tier: 'pro_ai', status: 'active', current_period_end: null } }
            if (table === 'ai_usage') return { data: { credits_used: 300 } }
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

    expect(screen.getByRole('button', { name: /get more/i })).toBeInTheDocument()
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
