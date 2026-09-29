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

describe('AccountPage — free vs Pro sync UI', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides Devices card, device list, and sync-stat cards for a free account', async () => {
    vi.resetModules()
    mockSupabase('free')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    expect(screen.queryByText('Devices')).not.toBeInTheDocument()
    expect(screen.queryByText('Groups synced')).not.toBeInTheDocument()
    expect(screen.queryByText('Tabs saved')).not.toBeInTheDocument()
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument()
    // No hard-coded placeholder numbers anywhere on the page.
    expect(screen.queryByText('24')).not.toBeInTheDocument()
    expect(screen.queryByText('847')).not.toBeInTheDocument()
    expect(screen.queryByText('12')).not.toBeInTheDocument()
  })

  it('still offers "Sign out of all devices" for a free account (moved into Profile)', async () => {
    vi.resetModules()
    mockSupabase('free')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('shows the Devices card and real (non-placeholder) sync-stat cards for an active Pro account', async () => {
    vi.resetModules()
    mockSupabase('pro')
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    render(jsx as React.ReactElement)

    expect(screen.getByText('Devices')).toBeInTheDocument()
    expect(screen.getByText('Groups synced')).toBeInTheDocument()
    expect(screen.getByText('Tabs saved')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.queryByText('24')).not.toBeInTheDocument()
    expect(screen.queryByText('847')).not.toBeInTheDocument()
    expect(screen.queryByText('12')).not.toBeInTheDocument()
    // Only one "Sign out" control — not duplicated between Profile and Devices cards.
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1)
  })

  it('treats an incomplete Pro subscription the same as free (no sync UI, no Manage billing)', async () => {
    vi.resetModules()
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
              ? { data: { tier: 'pro', status: 'incomplete', current_period_end: null } }
              : { data: { created_at: '2024-01-01' } }
          builder.maybeSingle = async () => ({ data: { credits_used: 0 } })
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

    expect(screen.queryByText('Devices')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Manage billing/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Upgrade/i })).toBeInTheDocument()
  })

  it('a trialing Pro subscription gets the same sync UI as active (entitled status)', async () => {
    vi.resetModules()
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
              ? { data: { tier: 'pro', status: 'trialing', current_period_end: null } }
              : { data: { created_at: '2024-01-01' } }
          builder.maybeSingle = async () => ({ data: { credits_used: 0 } })
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

    expect(screen.getByText('Devices')).toBeInTheDocument()
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
