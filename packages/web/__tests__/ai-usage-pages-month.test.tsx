import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The dashboard and account pages must read `ai_usage` and `ai_credit_purchases` on the month key
 * the server meters with (the subscription's billing period, migration 030), or the bar shows a
 * bucket the reservation isn't using.
 */
const months: Array<[string, unknown]> = []

function mockSupabase() {
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
        builder.is = chain
        builder.order = chain
        builder.limit = chain
        builder.eq = (column: string, value: unknown) => {
          if (column === 'month') months.push([table, value])
          return builder
        }
        const row = async () => {
          if (table === 'subscriptions') {
            return {
              data: {
                tier: 'pro_ai',
                status: 'active',
                ai_mode: 'managed',
                ai_monthly_credits: 2500,
                // A monthly period in the past keeps its key, whatever today's date.
                ai_period_start: '2020-01-31T10:00:00+00:00',
                ai_period_end: '2020-02-29T10:00:00+00:00',
              },
            }
          }
          if (table === 'ai_usage') return { data: { credits_used: 100 } }
          return { data: { created_at: '2024-01-01' } }
        }
        builder.single = row
        builder.maybeSingle = row
        builder.then = (resolve: (v: unknown) => void) => resolve({ data: [] })
        return builder
      },
    }),
  }))
  vi.doMock('@/lib/stripe', () => ({ createBillingPortalSession: async () => 'https://billing.example.com' }))
  vi.doMock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div /> }))
  vi.doMock('@/components/dashboard/SessionList', () => ({ SessionList: () => <div /> }))
  vi.doMock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div /> }))
  vi.doMock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div /> }))
}

beforeEach(() => {
  months.length = 0
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  mockSupabase()
})
afterEach(() => vi.unstubAllEnvs())

describe('usage displays use the billing-period key', () => {
  it('the dashboard reads the row of the period, not of the calendar month', async () => {
    const { default: DashboardPage } = await import('@/app/[locale]/(app)/dashboard/page')
    render((await DashboardPage({ searchParams: Promise.resolve({}) })) as React.ReactElement)

    expect(new Set(months.map(([, month]) => month))).toEqual(new Set(['2020-01']))
    expect(new Set(months.map(([table]) => table))).toEqual(new Set(['ai_usage', 'ai_credit_purchases']))
  })

  it('the account page reads the row of the period, not of the calendar month', async () => {
    const { default: AccountPage } = await import('@/app/[locale]/(app)/account/page')
    render((await AccountPage()) as React.ReactElement)

    expect(new Set(months.map(([, month]) => month))).toEqual(new Set(['2020-01']))
    expect(new Set(months.map(([table]) => table))).toEqual(new Set(['ai_usage', 'ai_credit_purchases']))
  })
})
