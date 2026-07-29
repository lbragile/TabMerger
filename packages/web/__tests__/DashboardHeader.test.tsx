import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

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
      builder.single = async () => ({ data: { tier: 'free', created_at: '2024-01-01' } })
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
vi.mock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div>onboarding</div> }))

describe('DashboardPage header restyle', () => {
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

  it('renders a "New group" button with an accessible name', async () => {
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    render(jsx as React.ReactElement)

    expect(screen.getByRole('button', { name: /New group/i })).toBeInTheDocument()
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
})
