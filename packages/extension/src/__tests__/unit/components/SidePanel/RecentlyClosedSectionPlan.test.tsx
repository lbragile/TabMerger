import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import type { Group } from '@/lib/types'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import { SIDEBAR_SECTION } from '@/lib/sidebarSections'

// The section with the REAL useRecentlyClosed: the header count, the day rows and the Free note
// come from one plan-limited list, and the confirmed-Free prune is asked for once.

const h = vi.hoisted(() => ({
  entries: [] as RecentlyClosedEntry[],
  tier: 'free' as string,
  loading: false,
  trim: vi.fn(),
}))

vi.mock('@/lib/recentlyClosedDb', () => ({
  getRecentlyClosedEntries: async () => h.entries,
  notifyRecentlyClosedChanged: vi.fn(),
}))
vi.mock('@/lib/recentlyClosedPlan', () => ({ trimRecentlyClosedIfFree: h.trim }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: h.tier, loading: h.loading }) }))
vi.mock('@/hooks/useRecentlyClosedActions', () => ({ useRecentlyClosedActions: () => ({ removeDay: vi.fn() }) }))
vi.mock('@/hooks/useAppSettings', () => ({ APP_SETTINGS_QUERY_KEY: ['appSettings'], useAppSettings: () => ({ data: { rememberClosedTabs: true } }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined) }))

import { RecentlyClosedSection } from '@/components/SidePanel/RecentlyClosedSection'

const NOW = Date.now()
const daysAgo = (back: number, hour = 12) => {
  const d = new Date(NOW)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, hour).getTime()
}
const entry = (id: string, closedAt: number, clearedAt?: number): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'tab',
  tabs: [{ url: `https://${id}.example/`, title: id }],
  ...(clearedAt !== undefined ? { clearedAt } : {}),
})

const groups: Group[] = [
  { id: 'now', name: 'Now Open', color: 'c', updatedAt: 1, windows: [], permanent: true },
  { id: 'work', name: 'Work', color: 'c', updatedAt: 1, windows: [] },
]

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <RecentlyClosedSection groups={groups} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

const rows = () => within(screen.getByTestId('recently-closed-days')).queryAllByRole('listitem')

beforeEach(() => {
  h.tier = 'free'
  h.loading = false
  h.trim.mockReset().mockResolvedValue(0)
  // no close today; three stored days (yesterday, 2 and 5 days ago), as in the reported screenshot
  h.entries = [entry('y1', daysAgo(1, 9)), entry('y2', daysAgo(1, 15)), entry('d2', daysAgo(2)), entry('d5', daysAgo(5))]
  vi.stubGlobal('chrome', { runtime: {} })
  useUIStore.setState({ openSidebarSection: SIDEBAR_SECTION.recentlyClosed, mainView: GROUP_VIEW, mainViewReturnGroupId: null, activeGroupIndex: 1, selectionMode: false })
})

describe('RecentlyClosedSection: the list the plan keeps', () => {
  it('Free with 3 stored days lists its 2 newest; the header count equals the rows; the Free note stays', async () => {
    renderSection()
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Recently closed (2)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show tabs closed yesterday' })).toHaveAccessibleDescription('2 tabs')
    expect(screen.queryByRole('button', { name: /^Show tabs closed on / })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Show tabs closed / })).toHaveLength(2)
    expect(screen.getByTestId('recently-closed-free-note')).toHaveTextContent('Free keeps your last 2 days.')
    expect(h.trim).toHaveBeenCalledTimes(1)
  })

  it('a day whose entries are all cleared does not count toward Free\'s 2 days', async () => {
    h.entries = [entry('y1', daysAgo(1), NOW - 1000), entry('d2', daysAgo(2)), entry('d5', daysAgo(5)), entry('d8', daysAgo(8))]
    renderSection()
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Recently closed (2)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show tabs closed yesterday' })).not.toBeInTheDocument()
  })

  it('Pro lists every stored day and never asks for the prune', async () => {
    h.tier = 'pro'
    renderSection()
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.getByRole('button', { name: 'Recently closed (3)' })).toBeInTheDocument()
    expect(screen.queryByTestId('recently-closed-free-note')).not.toBeInTheDocument()
    expect(h.trim).not.toHaveBeenCalled()
  })

  it('while the plan is loading: every day, no prune', async () => {
    h.loading = true
    renderSection()
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.getByRole('button', { name: 'Recently closed (3)' })).toBeInTheDocument()
    expect(h.trim).not.toHaveBeenCalled()
  })
})
