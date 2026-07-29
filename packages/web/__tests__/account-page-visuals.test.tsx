import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

function mockSupabase(tier: string) {
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
