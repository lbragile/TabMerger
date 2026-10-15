import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AUTO_BACKUP_DOWNLOAD_LIMITS } from '@tabmerger/shared'

/**
 * The dashboard page reads the account's `sessions` rows (saved sessions and automatic backups)
 * for every account, so one that lost cloud sync still sees, read-only, what it saved before.
 * The read is bounded and newest first.
 */

const h = vi.hoisted(() => ({
  subscription: { tier: 'pro', status: 'active', created_at: '2024-01-01' } as Record<string, unknown>,
  sessionRows: [] as unknown[],
  /** What PostgREST's `count: 'exact'` returns; null means "not counted" (the page falls back to the row count). */
  sessionTotal: null as number | null,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', created_at: '2024-01-01' } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    rpc: (fn: string, ...args: unknown[]) => {
      h.calls.push({ table: '(rpc)', method: 'rpc', args: [fn, ...args] })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          h.calls.push({ table, method, args })
          return builder
        }
      }
      builder.single = async () => ({ data: table === 'subscriptions' ? h.subscription : null })
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(
          table === 'sessions'
            ? { data: h.sessionRows, error: null, count: h.sessionTotal }
            : { data: [], error: null }
        )
      return builder
    },
  }),
}))

vi.mock('@/components/dashboard/StatsOverview', () => ({
  StatsOverview: ({ sessionCount }: { sessionCount: number }) => <div>stats sessions={sessionCount}</div>,
}))
vi.mock('@/components/dashboard/SubscriptionBadge', () => ({ SubscriptionBadge: () => <div>sub</div> }))
vi.mock('@/components/dashboard/GroupGrid', () => ({ GroupGrid: () => <div>groups</div> }))
vi.mock('@/components/dashboard/OnboardingChecklist', () => ({ OnboardingChecklist: () => <div>onboarding</div> }))
vi.mock('@/components/dashboard/SessionsStat', () => ({ SessionsStatValue: () => null, SessionsStatDescription: () => null }))
vi.mock('@/components/dashboard/SavedSessionsProvider', () => ({
  SavedSessionsProvider: ({ sessions, children }: { sessions: unknown[]; children: React.ReactNode }) => (
    <div data-testid="provider" data-rows={sessions.length}>
      {children}
    </div>
  ),
}))
vi.mock('@/components/dashboard/SessionList', () => ({
  SessionList: ({ readOnly }: { readOnly?: boolean }) => <div>session-list readOnly={String(!!readOnly)}</div>,
}))
vi.mock('@/components/dashboard/BackupsSection', () => ({
  BackupsSection: ({ syncEnabled }: { syncEnabled: boolean }) => <div>backups syncEnabled={String(syncEnabled)}</div>,
}))

async function renderPage() {
  const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
  render((await DashboardPage({ searchParams: Promise.resolve({}) })) as React.ReactElement)
}

const sessionsCalls = () => h.calls.filter((c) => c.table === 'sessions')

beforeEach(() => {
  h.calls = []
  h.sessionRows = []
  h.sessionTotal = null
})

const sessionRow = (i: number) => ({ id: `s${i}`, name: '', description: null, groups: [], created_at: '2024-01-01' })

describe.each([
  ['an entitled (Pro, active) account', { tier: 'pro', status: 'active' }, true],
  ['a free account', { tier: 'free', status: null }, false],
  ['a Pro account whose payment is unpaid', { tier: 'pro', status: 'unpaid' }, false],
])('dashboard sessions read for %s', (_label, sub, entitled) => {
  beforeEach(() => {
    h.subscription = { ...sub, created_at: '2024-01-01' }
  })

  it('reads the own rows, newest first, at most AUTO_BACKUP_DOWNLOAD_LIMITS.rows', async () => {
    await renderPage()
    const calls = sessionsCalls()
    expect(calls).toContainEqual({ table: 'sessions', method: 'select', args: ['*', { count: 'exact' }] })
    expect(calls).toContainEqual({ table: 'sessions', method: 'eq', args: ['user_id', 'u1'] })
    expect(calls).toContainEqual({ table: 'sessions', method: 'order', args: ['created_at', { ascending: false }] })
    expect(calls).toContainEqual({ table: 'sessions', method: 'limit', args: [AUTO_BACKUP_DOWNLOAD_LIMITS.rows] })
    expect(AUTO_BACKUP_DOWNLOAD_LIMITS.rows).toBe(100)
  })

  it('never writes a row of any table', async () => {
    h.sessionRows = [{ id: 's1', name: '', description: null, groups: [], created_at: '2024-01-01' }]
    await renderPage()
    expect(h.calls.filter((c) => ['insert', 'update', 'upsert', 'delete', 'rpc'].includes(c.method))).toEqual([])
  })

  it('passes the rows on, and shows Saved Sessions read-only exactly when the account has no cloud sync', async () => {
    h.sessionRows = [{ id: 's1', name: '', description: null, groups: [], created_at: '2024-01-01' }]
    await renderPage()
    expect(screen.getByTestId('provider')).toHaveAttribute('data-rows', '1')
    expect(screen.getByRole('heading', { name: 'Saved Sessions' })).toBeInTheDocument()
    expect(screen.getByText(`session-list readOnly=${String(!entitled)}`)).toBeInTheDocument()
    expect(screen.getByText(`backups syncEnabled=${String(entitled)}`)).toBeInTheDocument()
  })

  it('shows the full row total in the Sessions stored stat, not the capped page of rows', async () => {
    h.sessionRows = Array.from({ length: AUTO_BACKUP_DOWNLOAD_LIMITS.rows }, (_, i) => sessionRow(i))
    h.sessionTotal = 150
    await renderPage()
    expect(screen.getByTestId('provider')).toHaveAttribute('data-rows', '100')
    expect(screen.getByText('stats sessions=150')).toBeInTheDocument()
  })

  it('falls back to the returned row count when no total comes back', async () => {
    h.sessionRows = [sessionRow(1), sessionRow(2)]
    await renderPage()
    expect(screen.getByText('stats sessions=2')).toBeInTheDocument()
  })

  it(entitled ? 'keeps Saved Sessions with no rows' : 'leaves Saved Sessions out with no rows', async () => {
    await renderPage()
    expect(!!screen.queryByRole('heading', { name: 'Saved Sessions' })).toBe(entitled)
    expect(screen.getByText(`backups syncEnabled=${String(entitled)}`)).toBeInTheDocument()
  })
})
