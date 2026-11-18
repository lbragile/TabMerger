import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState } from '@/lib/types'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import type { RecentlyClosedDay } from '@/lib/recentlyClosedDays'
import { clearSectionViewStatus, getSectionViewStatus } from '@/lib/sectionViewStatus'
import { CLOSED_DAY_PAGE_SIZE } from '@/components/SectionView/ClosedDayView'
import { CLOSED_HOUR_BAR_ATTR, CLOSED_HOUR_MARKER_ATTR } from '@/components/SectionView/ClosedHourStrip'

const h = vi.hoisted(() => ({
  days: [] as RecentlyClosedDay[],
  searchMode: 'hide' as string,
  actions: {
    reopen: vi.fn(),
    reopenAll: vi.fn(),
    remove: vi.fn(),
    removeDay: vi.fn(),
    clearAll: vi.fn(),
    saveToGroup: vi.fn(),
    copyLink: vi.fn(),
  },
}))

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() }))
vi.mock('@/hooks/useRecentlyClosed', () => ({ useRecentlyClosed: () => ({ days: h.days, entries: [], isLoading: false }) }))
vi.mock('@/hooks/useRecentlyClosedActions', () => ({ useRecentlyClosedActions: () => h.actions }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: 'pro', loading: false }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: { searchNonMatching: h.searchMode } }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/Windows', () => ({ WindowsPanel: () => <div data-testid="windows-panel" /> }))
vi.mock('@/hooks/useGroups', () => ({ useRestoreGroup: () => ({ mutate: vi.fn() }), useDeleteGroup: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/useSessions', () => ({ useSessions: () => ({ data: [] }), useDeleteSession: () => ({ mutate: vi.fn() }), useRestoreSession: () => ({ mutate: vi.fn() }) }))

import { MainPanel } from '@/components/SectionView/MainPanel'

const at = (hour: number, min: number) => new Date(2030, 0, 3, hour, min).getTime()
const tab = (id: string, closedAt: number, title = id): RecentlyClosedEntry => ({ id, closedAt, kind: 'tab', tabs: [{ url: `https://${id}.example/`, title }] })
const win = (id: string, closedAt: number): RecentlyClosedEntry => ({
  id,
  closedAt,
  kind: 'window',
  tabs: [
    { url: 'https://github.com/a', title: 'GitHub A' },
    { url: 'https://linear.app/b', title: 'Linear B' },
  ],
})

/** 16:00 ×3 (a window among them), 14:00 ×2, 11:00 ×3, 09:00 ×1, newest first. */
const DAY_ENTRIES: RecentlyClosedEntry[] = [
  tab('figma', at(16, 42), 'Figma file'),
  win('win', at(16, 38)),
  tab('pr', at(16, 5), 'Pull request'),
  tab('stripe', at(14, 51), 'Stripe webhooks'),
  tab('next', at(14, 12), 'Next.js notes'),
  tab('cal', at(11, 30), 'Calendar'),
  tab('launch', at(11, 2), 'Launch post'),
  tab('lofi', at(11, 1), 'Lofi beats'),
  tab('hn', at(9, 15), 'Hacker News'),
]

function makeDay(key: string, entries: RecentlyClosedEntry[], label = 'Today', kind: RecentlyClosedDay['kind'] = 'today'): RecentlyClosedDay {
  return {
    key,
    kind,
    label,
    color: 'rgba(6, 182, 212, 1)',
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
  { id: 'work', name: 'Work', color: 'rgba(239, 68, 68, 1)', updatedAt: 1, windows: [] },
]
const groupsState: GroupsState = { active: { id: 'now', index: 0 }, available: groups }

const renderPanel = () => {
  const utils = render(<TooltipProvider><MainPanel groupsState={groupsState} /></TooltipProvider>)
  return { ...utils, rerenderPanel: () => utils.rerender(<TooltipProvider><MainPanel groupsState={groupsState} /></TooltipProvider>) }
}
const openDay = (day = '2030-01-03') => act(() => useUIStore.getState().openMainView({ kind: 'closedDay', day }, 'work'))

const strip = () => screen.getByRole('group', { name: 'Tabs closed per hour' })
const bars = () => within(strip()).getAllByRole('button')
const bar = (hour: number) => strip().querySelector<HTMLButtonElement>(`[${CLOSED_HOUR_BAR_ATTR}="${hour}"]`)!
const list = () => screen.getByRole('list', { name: 'Closed tabs and windows' })
const rowButtons = () => within(list()).getAllByRole('button', { name: /^(Reopen|Restore window)/ })
const rowIds = () => [...list().querySelectorAll('[data-closed-entry]')].map((el) => el.getAttribute('data-closed-entry'))
const status = () => screen.getByTestId('closed-hour-status')
const H = (hour: number) => (hour % 12 || 12) + ':00\\s' + (hour < 12 ? 'AM' : 'PM') + '|' + String(hour).padStart(2, '0') + ':00|' + hour + ':00'

beforeEach(() => {
  vi.clearAllMocks()
  clearSectionViewStatus()
  h.days = [makeDay('2030-01-03', DAY_ENTRIES), makeDay('2030-01-02', [tab('y', new Date(2030, 0, 2, 8, 0).getTime())], 'Yesterday', 'yesterday')]
  h.searchMode = 'hide'
  for (const fn of Object.values(h.actions)) fn.mockResolvedValue(true)
  useUIStore.setState({ activeGroupIndex: 1, mainView: GROUP_VIEW, mainViewReturnGroupId: null, selectionMode: false, searchFilter: '' })
})

afterEach(() => {
  document.documentElement.dir = ''
})

describe('ClosedDayView — activity strip', () => {
  it('one bar button per hour with closes, named "<hour>, N closed", not pressed; empty hours are hidden ticks', () => {
    renderPanel()
    openDay()
    expect(bars().map((b) => b.getAttribute(CLOSED_HOUR_BAR_ATTR))).toEqual(['9', '11', '14', '16'])
    expect(bar(16)).toHaveAccessibleName(new RegExp(`^(${H(16)}), 3 closed$`))
    expect(bar(9)).toHaveAccessibleName(new RegExp(`^(${H(9)}), 1 closed$`))
    for (const b of bars()) expect(b).toHaveAttribute('aria-pressed', 'false')
    // 24 slots: 4 bars + 20 decorative ticks
    expect(strip().children).toHaveLength(24)
    expect(strip().querySelectorAll(':scope > span[aria-hidden="true"]')).toHaveLength(20)
  })

  it('bar heights scale with the busiest hour, in the day colour', () => {
    renderPanel()
    openDay()
    const fill = (hour: number) => bar(hour).firstElementChild as HTMLElement
    expect(fill(16).style.height).toBe('2.625rem')
    expect(fill(11).style.height).toBe('2.625rem')
    expect(fill(14).style.height).toBe('1.75rem')
    expect(fill(9).style.height).toBe('0.875rem')
    expect(fill(16).style.backgroundColor).toBe('rgb(6, 182, 212)')
  })

  it('the axis names 00, 06, 12, 18 and 23 in the locale hour format, hidden from assistive tech', () => {
    renderPanel()
    openDay()
    const axis = strip().nextElementSibling as HTMLElement
    expect(axis).toHaveAttribute('aria-hidden', 'true')
    expect(axis.children).toHaveLength(5)
    expect(axis.children[2].textContent).toMatch(/^(12\sPM|12)$/)
  })

  it('status: the two busiest hours when tied, else the one, else how many hours had closes', () => {
    const { rerenderPanel } = renderPanel()
    openDay()
    expect(status().textContent).toMatch(new RegExp(`^Busiest: (${H(11)}) and (${H(16)})$`))
    h.days = [makeDay('2030-01-03', DAY_ENTRIES.filter((e) => e.id !== 'cal')), h.days[1]]
    rerenderPanel()
    expect(status().textContent).toMatch(new RegExp(`^Busiest: (${H(16)})$`))
    h.days = [makeDay('2030-01-03', [tab('a', at(8, 1)), tab('b', at(9, 1)), tab('c', at(10, 1))]), h.days[1]]
    rerenderPanel()
    expect(status().textContent).toBe('Closed across 3 hours')
    // the default line is not announced (the view's "Showing tabs closed today" is)
    expect(getSectionViewStatus()).toBe('Showing tabs closed today')
  })

  it('a bar shows only its hour: pressed, the others dimmed, the status says it and is announced', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(16))
    expect(bar(16)).toHaveAttribute('aria-pressed', 'true')
    expect(bar(14)).toHaveAttribute('aria-pressed', 'false')
    expect((bar(14).firstElementChild as HTMLElement).className).toContain('opacity-40')
    expect((bar(16).firstElementChild as HTMLElement).className).not.toContain('opacity-40')
    expect(rowIds()).toEqual(['figma', 'win', 'pr'])
    expect(status()).toHaveTextContent(new RegExp(`^Showing (${H(16)}) · 3 closed`))
    expect(getSectionViewStatus()).toMatch(new RegExp(`^Showing (${H(16)}) · 3 closed$`))
    // the header count is still the whole day
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Recently closed ◆ 9 closed')).toBeInTheDocument()
  })

  it('the same bar again shows every hour', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(11))
    expect(rowIds()).toEqual(['cal', 'launch', 'lofi'])
    await user.click(bar(11))
    expect(rowIds()).toHaveLength(9)
    expect(bar(11)).toHaveAttribute('aria-pressed', 'false')
    expect(getSectionViewStatus()).toBe('Showing all hours')
  })

  it('"Show all hours" clears the pick and puts focus on the bar that was picked', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(14))
    await user.click(within(status()).getByRole('button', { name: 'Show all hours' }))
    expect(rowIds()).toHaveLength(9)
    expect(within(status()).queryByRole('button', { name: 'Show all hours' })).toBeNull()
    expect(bar(14)).toHaveFocus()
    expect(bar(14)).toHaveAttribute('tabindex', '0')
  })

  it('another bar moves the pick', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(16))
    await user.click(bar(9))
    expect(rowIds()).toEqual(['hn'])
    expect(bar(16)).toHaveAttribute('aria-pressed', 'false')
  })

  it('the pick goes back to every hour when that hour has nothing left (reopen, remove, Undo)', async () => {
    const user = userEvent.setup()
    const { rerenderPanel } = renderPanel()
    openDay()
    await user.click(bar(9))
    h.days = [makeDay('2030-01-03', DAY_ENTRIES.filter((e) => e.id !== 'hn')), h.days[1]]
    rerenderPanel()
    expect(strip().querySelector(`[${CLOSED_HOUR_BAR_ATTR}="9"]`)).toBeNull()
    expect(rowIds()).toHaveLength(8)
    expect(within(status()).queryByRole('button', { name: 'Show all hours' })).toBeNull()
    // an Undo bringing 09:00 back does not bring the old pick back
    h.days = [makeDay('2030-01-03', DAY_ENTRIES), h.days[1]]
    rerenderPanel()
    expect(rowIds()).toHaveLength(9)
    expect(bar(9)).toHaveAttribute('aria-pressed', 'false')
  })

  it('the pick resets when another day is shown', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(16))
    openDay('2030-01-02')
    expect(bar(8)).toHaveAttribute('aria-pressed', 'false')
    openDay()
    expect(rowIds()).toHaveLength(9)
    expect(bars().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true)
  })

  it('closing the view clears an announced pick', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(16))
    expect(getSectionViewStatus()).not.toBe('')
    act(() => useUIStore.getState().closeMainView(groups))
    expect(getSectionViewStatus()).toBe('')
  })
})

describe('ClosedDayView — strip keyboard', () => {
  it('the bars are one tab stop; Left/Right/Home/End move between them', () => {
    renderPanel()
    openDay()
    expect(bars().filter((b) => b.tabIndex === 0)).toEqual([bar(9)])
    act(() => bar(9).focus())
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    act(() => void bar(9).dispatchEvent(right))
    expect(right.defaultPrevented).toBe(true)
    expect(bar(11)).toHaveFocus()
    expect(bar(11).tabIndex).toBe(0)
    expect(bar(9).tabIndex).toBe(-1)
    fireEvent.keyDown(bar(11), { key: 'End' })
    expect(bar(16)).toHaveFocus()
    fireEvent.keyDown(bar(16), { key: 'ArrowRight' })
    expect(bar(16)).toHaveFocus()
    fireEvent.keyDown(bar(16), { key: 'ArrowLeft' })
    expect(bar(14)).toHaveFocus()
    fireEvent.keyDown(bar(14), { key: 'Home' })
    expect(bar(9)).toHaveFocus()
    expect(bar(9)).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End')
  })

  it('right to left: ArrowLeft moves to the next (later) hour', () => {
    document.documentElement.dir = 'rtl'
    renderPanel()
    openDay()
    act(() => bar(9).focus())
    fireEvent.keyDown(bar(9), { key: 'ArrowLeft' })
    expect(bar(11)).toHaveFocus()
    fireEvent.keyDown(bar(11), { key: 'ArrowRight' })
    expect(bar(9)).toHaveFocus()
  })

  it('other keys and modified arrows are left alone; the picked bar is the tab stop', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    act(() => bar(9).focus())
    const shifted = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
    bar(9).dispatchEvent(shifted)
    expect(shifted.defaultPrevented).toBe(false)
    const other = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })
    bar(9).dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    expect(bar(9)).toHaveFocus()
    await user.click(bar(14))
    act(() => bar(14).blur())
    expect(bar(14).tabIndex).toBe(0)
  })
})

describe('ClosedDayView — hour markers', () => {
  it('each hour ends with its marker, below its entries (newest first), hidden and never focusable', () => {
    renderPanel()
    openDay()
    const order = [...list().children].map((li) => li.getAttribute(CLOSED_HOUR_MARKER_ATTR) ?? li.querySelector('[data-closed-entry]')?.getAttribute('data-closed-entry'))
    expect(order).toEqual(['figma', 'win', 'pr', '16', 'stripe', 'next', '14', 'cal', 'launch', 'lofi', '11', 'hn', '9'])
    const markers = list().querySelectorAll(`[${CLOSED_HOUR_MARKER_ATTR}]`)
    for (const m of markers) {
      expect(m).toHaveAttribute('aria-hidden', 'true')
      expect(m.querySelector('button, a, [tabindex]')).toBeNull()
    }
    expect(markers[2].textContent).toMatch(new RegExp(`^(${H(11)})$`))
    // assistive tech sees one list item per entry
    expect(within(list()).getAllByRole('listitem')).toHaveLength(9)
  })

  it('a picked hour lists its entries then its one marker', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(14))
    expect(list().querySelectorAll(`[${CLOSED_HOUR_MARKER_ATTR}]`)).toHaveLength(1)
    expect(list().lastElementChild).toHaveAttribute(CLOSED_HOUR_MARKER_ATTR, '14')
  })

  it('Up/Down cross from one hour to the next, skipping the markers', () => {
    renderPanel()
    openDay()
    const rows = rowButtons()
    rows[2].focus() // the last entry of 16:00
    fireEvent.keyDown(rows[2], { key: 'ArrowDown' })
    expect(rows[3]).toHaveFocus() // the first of 14:00
    fireEvent.keyDown(rows[3], { key: 'ArrowUp' })
    expect(rows[2]).toHaveFocus()
    fireEvent.keyDown(rows[2], { key: 'End' })
    expect(rows[8]).toHaveFocus()
  })

  it('removing the last entry of an hour moves focus to the first entry of the next hour', async () => {
    const user = userEvent.setup()
    const { rerenderPanel } = renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'More options for Pull request' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from list' }))
    h.days = [makeDay('2030-01-03', DAY_ENTRIES.filter((e) => e.id !== 'pr')), h.days[1]]
    rerenderPanel()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Reopen Stripe webhooks/ })).toHaveFocus())
  })

  it('an open window keeps its tabs listed when the row above it in the same hour leaves', async () => {
    const user = userEvent.setup()
    const { rerenderPanel } = renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: /^Tabs of the window closed at/ }))
    h.days = [makeDay('2030-01-03', DAY_ENTRIES.filter((e) => e.id !== 'figma')), h.days[1]]
    rerenderPanel()
    expect(screen.getByRole('button', { name: /^Tabs of the window closed at/ })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('ClosedDayView — strip with search and paging', () => {
  it('the search works inside the picked hour; the bars still count the whole day', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(14))
    act(() => useUIStore.setState({ searchFilter: 'stripe' }))
    expect(rowIds()).toEqual(['stripe'])
    expect(bar(14)).toHaveAccessibleName(new RegExp(`, 2 closed$`))
    expect(bar(16)).toHaveAccessibleName(new RegExp(`, 3 closed$`))
    act(() => useUIStore.setState({ searchFilter: 'figma' }))
    expect(rowIds()).toEqual([])
    expect(screen.getByText('No closed tabs in this hour match your search.')).toBeInTheDocument()
  })

  it('"dim" mode keeps the picked hour\'s rows, muting the ones that don\'t match', async () => {
    h.searchMode = 'dim'
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(bar(14))
    act(() => useUIStore.setState({ searchFilter: 'stripe' }))
    expect(rowIds()).toEqual(['stripe', 'next'])
    expect(screen.getByRole('button', { name: /^Reopen Next.js notes/ })).toHaveAccessibleDescription("Doesn't match the search")
  })

  it('without a pick, no match still says "on this day"', () => {
    useUIStore.setState({ searchFilter: 'zzzz' })
    renderPanel()
    openDay()
    expect(screen.getByText('No closed tabs on this day match your search.')).toBeInTheDocument()
  })

  it('"Show more" pages the picked hour, and a new pick starts from the first page', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: CLOSED_DAY_PAGE_SIZE + 20 }, (_, i) => tab(`m${i}`, at(10, 59) - i * 1000))
    h.days = [makeDay('2030-01-03', [tab('late', at(12, 0)), ...many])]
    renderPanel()
    openDay()
    await user.click(bar(12))
    expect(rowIds()).toEqual(['late'])
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    await user.click(bar(10))
    expect(rowIds()).toHaveLength(CLOSED_DAY_PAGE_SIZE)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(rowIds()).toHaveLength(CLOSED_DAY_PAGE_SIZE + 20)
    await user.click(bar(12))
    await user.click(bar(10))
    expect(rowIds()).toHaveLength(CLOSED_DAY_PAGE_SIZE)
  }, 30_000)
})
