import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Dashboard's AI usage card must show the *effective* cap (base 100 + purchased
 * credit packs for the month), matching what the server actually enforces.
 */
function mockDashboard(purchases: { credits: number }[]) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'a@example.com', created_at: '2024-01-01' } } }),
        getSession: async () => ({ data: { session: null } }),
      },
      from: (table: string) => {
        const builder: Record<string, unknown> = {}
        const chain = () => builder
        builder.select = chain
        builder.eq = chain
        builder.order = chain
        builder.limit = chain
        builder.single = async () => {
          if (table === 'subscriptions') return { data: { tier: 'pro_ai', status: 'active' } }
          if (table === 'ai_usage') return { data: { credits_used: 100 } }
          return { data: { created_at: '2024-01-01' } }
        }
        builder.then = (resolve: (v: unknown) => void) =>
          resolve({ data: table === 'ai_credit_purchases' ? purchases : [] })
        return builder
      },
    }),
  }))
  vi.doMock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div /> }))
  vi.doMock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div /> }))
  vi.doMock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div /> }))
  vi.doMock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div /> }))
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
})
afterEach(() => vi.unstubAllEnvs())

describe('DashboardPage — AI usage limit', () => {
  it('uses the base cap when the user has bought no credits', async () => {
    mockDashboard([])
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    render((await DashboardPage({ searchParams: Promise.resolve({}) })) as React.ReactElement)

    expect(screen.getByText('100/300')).toBeInTheDocument()
  })

  it('extends the displayed limit by purchased credit packs', async () => {
    mockDashboard([{ credits: 50 }, { credits: 50 }])
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    render((await DashboardPage({ searchParams: Promise.resolve({}) })) as React.ReactElement)

    expect(screen.getByText('100/400')).toBeInTheDocument()
  })

  it('hides the AI usage card entirely when NEXT_PUBLIC_AI_ENABLED is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    mockDashboard([])
    const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
    render((await DashboardPage({ searchParams: Promise.resolve({}) })) as React.ReactElement)

    expect(screen.queryByText(/^100\//)).not.toBeInTheDocument()
  })
})
