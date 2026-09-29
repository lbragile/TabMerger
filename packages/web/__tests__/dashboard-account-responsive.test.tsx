import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Both pages are async server components — mock their data dependencies and child
// components so we can `await` and render just the layout markup under test.

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: vi.fn() } }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com', created_at: '2024-01-01' } } }),
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
      // Non-`.single()` queries (e.g. groups/sessions lists) resolve when awaited directly.
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: [] })
      return builder
    },
  }),
}))

vi.mock('@/lib/stripe', () => ({
  createBillingPortalSession: async () => 'https://billing.example.com',
}))

vi.mock('@/components/dashboard/StatsOverview', () => ({ StatsOverview: () => <div>stats</div> }))
vi.mock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div>sub</div> }))
vi.mock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div>sessions</div> }))
vi.mock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div>groups</div> }))
vi.mock('@/components/dashboard/OrganizeProposal', () => ({ OrganizeProposal: () => <div>organize</div> }))
vi.mock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div>onboarding</div> }))

describe('DashboardPage responsive layout', () => {
  it('does not use a fixed-width container that would overflow on mobile', async () => {
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    const jsx = await DashboardPage({ searchParams: Promise.resolve({}) })
    const { container } = render(jsx as React.ReactElement)

    // The outer wrapper should be a fluid flex/gap container, never a hardcoded px width.
    const root = container.firstElementChild as HTMLElement
    expect(root.style.width).toBeFalsy()

    // Stats grid area (rendered by StatsOverview normally, but check page-level grids too)
    // — no element in the page markup should carry an unconditional multi-column class
    // without a responsive prefix.
    const badGrids = Array.from(container.querySelectorAll('[class*="grid-cols-"]')).filter(
      (el) => /(?:^|\s)grid-cols-[2-9]/.test(el.className) && !/\b(sm|md|lg|xl):grid-cols-/.test(el.className)
    )
    expect(badGrids).toHaveLength(0)
  })
})

describe('AccountPage responsive layout', () => {
  it('constrains width with a responsive max-w utility and stacks the stats grid on mobile', async () => {
    // The usage-summary grid only renders for accounts with cloud sync (or AI enabled) — use a
    // Pro/active subscription here so the grid this test targets actually renders.
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com', created_at: '2024-01-01' } } }),
          getSession: async () => ({ data: { session: null } }),
        },
        from: () => {
          const builder: Record<string, unknown> = {}
          const chain = () => builder
          builder.select = chain
          builder.eq = chain
          builder.order = chain
          builder.limit = chain
          builder.single = async () => ({ data: { tier: 'pro', status: 'active', created_at: '2024-01-01' } })
          builder.then = (resolve: (v: unknown) => void) => resolve({ data: [] })
          return builder
        },
      }),
    }))
    vi.resetModules()
    const { default: AccountPage } = await import('@/app/(app)/account/page')
    const jsx = await AccountPage()
    const { container } = render(jsx as React.ReactElement)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/max-w-/)

    // The 4-column stats grid (`grid-cols-4`) is unconditional today and will squish/overflow
    // on phones — it must gain a responsive prefix (e.g. grid-cols-2 sm:grid-cols-4).
    const statsGrid = container.querySelector('.grid') as HTMLElement | null
    expect(statsGrid).not.toBeNull()
    expect(statsGrid?.className).not.toMatch(/^grid grid-cols-4\b/)
    expect(statsGrid?.className).toMatch(/\b(sm|md|lg):grid-cols-/)
  })
})
