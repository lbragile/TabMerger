import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Dashboard page is an async server component — mock its data dependencies and heavy
// child components so we can `await` it and render just the header markup under test.

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'u1', email: 'jane.doe@example.com', created_at: '2024-01-01' } },
      }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: () => {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.order = chain
      builder.limit = chain
      builder.single = async () => ({
        data: { tier: 'pro', status: 'active', created_at: '2024-01-01' },
      })
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: [] })
      return builder
    },
  }),
}))

vi.mock('@/components/dashboard/StatsOverview', () => ({ StatsOverview: () => <div>stats</div> }))
vi.mock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div>sub</div> }))
vi.mock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div>sessions</div> }))
vi.mock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div>groups</div> }))
vi.mock('@/components/dashboard/OrganizeProposal', () => ({ OrganizeProposal: () => <div>organize</div> }))
vi.mock('@/components/dashboard/OnboardingChecklist', () => ({
  OnboardingChecklist: ({ installHref }: { installHref: string }) => (
    <div data-testid="onboarding" data-install-href={installHref}>onboarding</div>
  ),
}))

describe('DashboardPage header restyle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('greets the user with "Good morning, {FirstName}" derived from the email local-part', async () => {
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    // email local-part "jane.doe" capitalized -> "Jane.doe"
    expect(screen.getByText('Good morning, Jane.doe')).toBeInTheDocument()
    expect(screen.queryByText(/Welcome back,/)).not.toBeInTheDocument()
  })

  it('renders an "AI organise" button with an accessible name', async () => {
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.getByRole('button', { name: /AI organise/i })).toBeInTheDocument()
  })

  it('has no "New group" button: groups are created in the extension only', async () => {
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.queryByRole('button', { name: /New group/i })).not.toBeInTheDocument()
    // Still a synced Pro account, so the groups section itself stays.
    expect(screen.getByRole('heading', { name: 'Tab Groups' })).toBeInTheDocument()
  })

  it('does not duplicate sync status text outside of the SyncIndicator pill', async () => {
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    const { container } = render(jsx as React.ReactElement)

    // No redundant standalone "Synced"/"Syncing" text node outside a dedicated sync indicator.
    const syncTextNodes = Array.from(container.querySelectorAll('p, span')).filter((el) =>
      /^(synced|syncing|sync status)/i.test(el.textContent ?? '')
    )
    expect(syncTextNodes).toHaveLength(0)
  })

  // The checklist is a client component, so the page (server) resolves its install link.
  it.each([
    ['the stable Chrome listing on production', 'production', 'https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc'],
    ['the Chrome BETA listing on preview', 'preview', 'https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd'],
  ])('hands the onboarding checklist %s', async (_label, vercelEnv, expectedHref) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.getByTestId('onboarding')).toHaveAttribute('data-install-href', expectedHref)
  })

  it('hides the "AI organise" button entirely when NEXT_PUBLIC_AI_ENABLED is off', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.queryByRole('button', { name: /AI organise/i })).not.toBeInTheDocument()
    // Unrelated UI stays intact when the flag is off.
    expect(screen.getByText('Good morning, Jane.doe')).toBeInTheDocument()
  })
})

describe('DashboardPage — free account (no cloud sync)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: 'u1', email: 'jane.doe@example.com', created_at: '2024-01-01' } },
          }),
          getSession: async () => ({ data: { session: null } }),
        },
        from: () => {
          const builder: Record<string, unknown> = {}
          const chain = () => builder
          builder.select = chain
          builder.eq = chain
          builder.order = chain
          builder.limit = chain
          builder.single = async () => ({
            data: { tier: 'free', status: null, created_at: '2024-01-01' },
          })
          builder.then = (resolve: (v: unknown) => void) => resolve({ data: [] })
          return builder
        },
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not render "New group", "Tab Groups", or "Saved Sessions"', async () => {
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.queryByRole('button', { name: /New group/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tab Groups' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Saved Sessions' })).not.toBeInTheDocument()
    expect(screen.queryByText('groups')).not.toBeInTheDocument()
    expect(screen.queryByText('sessions')).not.toBeInTheDocument()
  })

  it('passes showSyncStats=false to StatsOverview by not rendering sync-dependent stats', async () => {
    vi.doMock('@/components/dashboard/StatsOverview', () => ({
      StatsOverview: ({ showSyncStats }: { showSyncStats?: boolean }) => (
        <div>stats:{String(showSyncStats)}</div>
      ),
    }))
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.getByText('stats:false')).toBeInTheDocument()
  })

  it('an incomplete/unpaid Pro subscription is treated the same as free', async () => {
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: 'u1', email: 'jane.doe@example.com', created_at: '2024-01-01' } },
          }),
          getSession: async () => ({ data: { session: null } }),
        },
        from: () => {
          const builder: Record<string, unknown> = {}
          const chain = () => builder
          builder.select = chain
          builder.eq = chain
          builder.order = chain
          builder.limit = chain
          builder.single = async () => ({
            data: { tier: 'pro', status: 'incomplete', created_at: '2024-01-01' },
          })
          builder.then = (resolve: (v: unknown) => void) => resolve({ data: [] })
          return builder
        },
      }),
    }))
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.queryByRole('button', { name: /New group/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tab Groups' })).not.toBeInTheDocument()
  })
})
