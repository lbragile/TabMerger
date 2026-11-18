import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import type { RecentlyClosedDay } from '@/lib/recentlyClosedDays'
import type { Group } from '@/lib/types'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import { SIDEBAR_SECTION } from '@/lib/sidebarSections'

const h = vi.hoisted(() => ({
  days: [] as RecentlyClosedDay[],
  settings: { rememberClosedTabs: true } as Record<string, unknown> | undefined,
  tier: 'pro' as string,
  planLoading: false,
  removeDay: vi.fn(),
  track: vi.fn(),
  openModal: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/hooks/useRecentlyClosed', () => ({ useRecentlyClosed: () => ({ days: h.days, entries: h.days.flatMap((d) => d.entries), isLoading: false }) }))
vi.mock('@/hooks/useRecentlyClosedActions', () => ({ useRecentlyClosedActions: () => ({ removeDay: h.removeDay }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: h.settings }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: h.tier, loading: h.planLoading }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: h.track }))
vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined) }))

import { RecentlyClosedSection } from '@/components/SidePanel/RecentlyClosedSection'

const entry = (id: string, kind: 'tab' | 'window' = 'tab', tabs = 1): RecentlyClosedEntry => ({
  id,
  closedAt: 1,
  kind,
  tabs: Array.from({ length: tabs }, (_, i) => ({ url: `https://e${i}.example`, title: `T${i}` })),
})

function day(key: string, kind: RecentlyClosedDay['kind'], label: string, entries: RecentlyClosedEntry[], color = 'rgba(239, 68, 68, 1)'): RecentlyClosedDay {
  return {
    key,
    kind,
    label,
    color,
    start: 0,
    end: 1,
    entries,
    tabCount: entries.filter((e) => e.kind === 'tab').length,
    windowCount: entries.filter((e) => e.kind === 'window').length,
    allTabCount: entries.reduce((n, e) => n + e.tabs.length, 0),
  }
}

const groups: Group[] = [
  { id: 'now', name: 'Now Open', color: 'c', updatedAt: 1, windows: [], permanent: true },
  { id: 'work', name: 'Work', color: 'c', updatedAt: 1, windows: [] },
]

function renderSection() {
  return render(
    <TooltipProvider>
      <RecentlyClosedSection groups={groups} />
    </TooltipProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.days = [
    day('2030-01-03', 'today', 'Today', [entry('a'), entry('b', 'window', 6)], 'rgba(59, 130, 246, 1)'),
    day('2030-01-02', 'yesterday', 'Yesterday', [entry('c')]),
    day('2029-12-30', 'date', 'Mon, Dec 30', [entry('d'), entry('e')]),
  ]
  h.settings = { rememberClosedTabs: true }
  h.tier = 'pro'
  h.planLoading = false
  h.removeDay.mockResolvedValue(true)
  vi.stubGlobal('chrome', { tabs: { create: h.create } })
  useUIStore.setState({ openSidebarSection: SIDEBAR_SECTION.recentlyClosed, mainView: GROUP_VIEW, mainViewReturnGroupId: null, activeGroupIndex: 1, selectionMode: false, openModal: h.openModal })
})

describe('RecentlyClosedSection', () => {
  it('starts collapsed when the popup opens (no section open by default)', () => {
    useUIStore.setState(useUIStore.getInitialState())
    expect(useUIStore.getState().openSidebarSection).toBeNull()
  })

  it('the expanded header is semibold, a collapsed one regular', async () => {
    const user = userEvent.setup()
    renderSection()
    const label = () => screen.getByRole('button', { name: /^recently closed \(/i }).querySelector('span.uppercase')!
    expect(label().className).toContain('font-semibold')
    await user.click(screen.getByRole('button', { name: /^recently closed \(/i }))
    expect(label().className).toContain('font-normal')
    expect(label().className).not.toContain('font-semibold')
  })

  it('header counts the day rows; each row has its label, tabs and windows, entry count and colour bar', () => {
    renderSection()
    // a plain row count, like the other sections ("Recently closed (3)", not "(3 days)")
    expect(screen.getByRole('button', { name: 'Recently closed (3)' })).toHaveAttribute('aria-expanded', 'true')
    const rows = within(screen.getByTestId('recently-closed-days')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    const today = screen.getByRole('button', { name: 'Show tabs closed today' })
    expect(today).toHaveAccessibleDescription('7 tabs · 1 window')
    expect(within(rows[0]).getByText('2')).toHaveAttribute('aria-hidden')
    expect(rows[0].style.borderInlineStart).toContain('rgba(59, 130, 246, 1)')
    expect(screen.getByRole('button', { name: 'Show tabs closed yesterday' })).toHaveAccessibleDescription('1 tab')
    expect(screen.getByRole('button', { name: 'Show tabs closed on Mon, Dec 30' })).toBeInTheDocument()
  })

  it('clicking a day opens it on the right; that row is the only current one (semibold, aria-current)', async () => {
    const user = userEvent.setup()
    renderSection()
    await user.click(screen.getByRole('button', { name: 'Show tabs closed yesterday' }))
    expect(useUIStore.getState().mainView).toEqual({ kind: 'closedDay', day: '2030-01-02' })
    expect(useUIStore.getState().mainViewReturnGroupId).toBe('work')
    expect(h.track).toHaveBeenCalledWith('recently_closed_opened')
    const current = screen.getByRole('button', { name: 'Show tabs closed yesterday' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current.querySelector('span')?.className).toContain('font-semibold')
    expect(screen.getByRole('button', { name: 'Show tabs closed today' })).not.toHaveAttribute('aria-current')
    expect(current.closest('li')?.className).toContain('bg-[var(--sidebar-current-bg)]')
  })

  it('nothing opens while selecting', async () => {
    useUIStore.setState({ selectionMode: true })
    const user = userEvent.setup()
    renderSection()
    const today = screen.getByRole('button', { name: 'Show tabs closed today' })
    expect(today).toHaveAttribute('aria-disabled', 'true')
    await user.click(today)
    expect(useUIStore.getState().mainView).toEqual(GROUP_VIEW)
  })

  it('the Remove button is a sibling of the open button and removes that day; focus moves to the next row', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSection()
    const remove = screen.getByRole('button', { name: "Remove yesterday's closed tabs from the list" })
    expect(remove.closest('button[data-closed-day-open]')).toBeNull()
    await user.click(remove)
    expect(h.removeDay).toHaveBeenCalledWith(h.days[1])
    // the day leaves the list
    h.days = [h.days[0], h.days[2]]
    rerender(
      <TooltipProvider>
        <RecentlyClosedSection groups={groups} />
      </TooltipProvider>
    )
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Show tabs closed on Mon, Dec 30' })).toHaveFocus())
  })

  it('removing the only day moves focus to the section toggle', async () => {
    h.days = [h.days[0]]
    const user = userEvent.setup()
    const { rerender } = renderSection()
    await user.click(screen.getByRole('button', { name: "Remove today's closed tabs from the list" }))
    h.days = []
    rerender(
      <TooltipProvider>
        <RecentlyClosedSection groups={groups} />
      </TooltipProvider>
    )
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /recently closed \(0\)/i })).toHaveFocus())
  })

  it('empty: says what will show up and for how long (the plan’s days)', () => {
    h.days = []
    renderSection()
    expect(screen.getByText('Nothing closed yet. Tabs you close show up here by day, for your last 30 days.')).toBeInTheDocument()
  })

  it('empty on Free says its rolling 2 days', () => {
    h.days = []
    h.tier = 'free'
    renderSection()
    expect(screen.getByText('Nothing closed yet. Tabs you close show up here by day, for your last 2 days.')).toBeInTheDocument()
  })

  it('off: the header says (off) and the body links to Settings → Data', async () => {
    h.settings = { rememberClosedTabs: false }
    const user = userEvent.setup()
    renderSection()
    expect(screen.getByRole('button', { name: 'Recently closed (off)' })).toBeInTheDocument()
    expect(screen.queryByTestId('recently-closed-days')).toBeNull()
    expect(screen.getByText(/Remembering closed tabs is off\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Turn on in Settings' }))
    expect(h.openModal).toHaveBeenCalledWith('settings', { tab: 'data' })
  })

  it('Free: a quiet line after the last day with a link to pricing; Pro has none', async () => {
    h.tier = 'free'
    const user = userEvent.setup()
    const { unmount } = renderSection()
    const note = screen.getByTestId('recently-closed-free-note')
    // both limits of both plans (RECENTLY_CLOSED_LIMITS), numbers formatted for the locale
    // both windows from RECENTLY_CLOSED_LIMITS; the entry caps are never shown
    expect(note).toHaveTextContent('Free keeps your last 2 days. Pro keeps your last 30 days.')
    await user.click(within(note).getByRole('button', { name: 'See Pro' }))
    expect(h.create).toHaveBeenCalledWith({ url: expect.stringMatching(/\/pricing$/), active: true })
    expect(h.track).toHaveBeenCalledWith('upgrade_clicked', { source: 'recently_closed_sidebar' })
    unmount()
    h.tier = 'pro'
    renderSection()
    expect(screen.queryByTestId('recently-closed-free-note')).toBeNull()
  })

  it('while the plan is loading there is no Free line', () => {
    h.tier = 'free'
    h.planLoading = true
    renderSection()
    expect(screen.queryByTestId('recently-closed-free-note')).toBeNull()
  })

  it('collapsing it opens nothing else; toggling again opens it', async () => {
    const user = userEvent.setup()
    renderSection()
    const toggle = screen.getByRole('button', { name: /recently closed \(3\)/i })
    await user.click(toggle)
    expect(useUIStore.getState().openSidebarSection).toBeNull()
    expect(screen.queryByTestId('recently-closed-days')).toBeNull()
    await act(async () => {
      await user.click(toggle)
    })
    expect(useUIStore.getState().openSidebarSection).toBe(SIDEBAR_SECTION.recentlyClosed)
  })
})
