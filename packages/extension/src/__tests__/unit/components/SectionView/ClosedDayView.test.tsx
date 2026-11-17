import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState } from '@/lib/types'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import type { RecentlyClosedDay } from '@/lib/recentlyClosedDays'
import { clearSectionViewStatus, getSectionViewStatus } from '@/lib/sectionViewStatus'
import { CLOSED_DAY_PAGE_SIZE, closedEntryMatches } from '@/components/SectionView/ClosedDayView'
import { closedHost, isBackgroundClick } from '@/components/SectionView/ClosedEntryRow'

const h = vi.hoisted(() => ({
  days: [] as RecentlyClosedDay[],
  loading: false,
  tier: 'pro' as string,
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
  create: vi.fn(),
  track: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() }))
vi.mock('@/hooks/useRecentlyClosed', () => ({ useRecentlyClosed: () => ({ days: h.days, entries: [], isLoading: h.loading }) }))
vi.mock('@/hooks/useRecentlyClosedActions', () => ({ useRecentlyClosedActions: () => h.actions }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: h.tier, loading: false }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: { searchNonMatching: h.searchMode } }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: h.track }))
vi.mock('@/components/Windows', () => ({ WindowsPanel: () => <div data-testid="windows-panel" /> }))
vi.mock('@/hooks/useGroups', () => ({ useRestoreGroup: () => ({ mutate: vi.fn() }), useDeleteGroup: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/useSessions', () => ({ useSessions: () => ({ data: [] }), useDeleteSession: () => ({ mutate: vi.fn() }), useRestoreSession: () => ({ mutate: vi.fn() }) }))

import { MainPanel } from '@/components/SectionView/MainPanel'

const T0 = new Date(2030, 0, 3, 14, 58).getTime()
const tabEntry = (id: string, url: string, title: string, closedAt = T0): RecentlyClosedEntry => ({ id, closedAt, kind: 'tab', tabs: [{ url, title, favIconUrl: 'https://x.example/f.ico' }] })
const windowEntry: RecentlyClosedEntry = {
  id: 'w1',
  closedAt: T0 - 60_000,
  kind: 'window',
  tabs: [
    { url: 'https://figma.com/a', title: 'Figma A' },
    { url: 'https://figma.com/b', title: 'Figma B' },
    { url: 'https://other.example/c', title: 'Other C' },
  ],
}

function makeDay(key: string, entries: RecentlyClosedEntry[], label = 'Today', kind: RecentlyClosedDay['kind'] = 'today'): RecentlyClosedDay {
  return {
    key,
    kind,
    label,
    color: 'rgba(59, 130, 246, 1)',
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
  { id: 'old', name: 'Old', color: 'c', updatedAt: 1, windows: [], archived: true },
]
const groupsState: GroupsState = { active: { id: 'now', index: 0 }, available: groups }

const renderPanel = () => {
  const utils = render(<TooltipProvider><MainPanel groupsState={groupsState} /></TooltipProvider>)
  return { ...utils, rerenderPanel: () => utils.rerender(<TooltipProvider><MainPanel groupsState={groupsState} /></TooltipProvider>) }
}
const openDay = (day = '2030-01-03') => act(() => useUIStore.getState().openMainView({ kind: 'closedDay', day }, 'work'))
const metaLine = (text: string) => screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text)

beforeEach(() => {
  vi.clearAllMocks()
  clearSectionViewStatus()
  h.days = [
    makeDay('2030-01-03', [tabEntry('t1', 'https://github.com/pr/126', 'Pull request #126'), windowEntry, tabEntry('t2', 'https://news.ycombinator.com/', 'Hacker News')]),
    makeDay('2030-01-02', [tabEntry('t3', 'https://developer.mozilla.org/at', 'Array.prototype.at()')], 'Yesterday', 'yesterday'),
  ]
  h.loading = false
  h.tier = 'pro'
  h.searchMode = 'hide'
  for (const fn of Object.values(h.actions)) fn.mockResolvedValue(true)
  vi.stubGlobal('chrome', { tabs: { create: h.create } })
  useUIStore.setState({ activeGroupIndex: 1, mainView: GROUP_VIEW, mainViewReturnGroupId: null, selectionMode: false, searchFilter: '' })
})

describe('ClosedDayView — header and list', () => {
  it('header: colour dot, the day (h2), "Recently closed ◆ N closed"; entries newest first with time, favicon, title and host', () => {
    renderPanel()
    openDay()
    expect(screen.getByTestId('closed-day-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument()
    const meta = metaLine('Recently closed ◆ 3 closed')
    expect(meta.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1)
    const list = screen.getByRole('list', { name: 'Closed tabs and windows' })
    const buttons = within(list).getAllByRole('button', { name: /^(Reopen|Restore window)/ })
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Reopen Pull request #126, closed /),
      expect.stringMatching(/^Restore window with 3 tabs, closed /),
      expect.stringMatching(/^Reopen Hacker News, closed /),
    ])
    expect(within(buttons[0]).getByText('github.com')).toBeInTheDocument()
    expect(within(buttons[1]).getByText('Window · 3 tabs')).toBeInTheDocument()
    expect(within(buttons[1]).getByText('figma.com +2')).toBeInTheDocument()
    expect(within(buttons[0]).getByText(/2:58|14:58/)).toBeInTheDocument()
    // no landmarks per entry, and none of the editable panel's keyboard-shortcut attributes
    expect(list.querySelector('[role="region"], section, nav')).toBeNull()
    expect(document.querySelector('[data-tab-index], [data-window-index], [data-group-index]')).toBeNull()
  })

  it('says which day is showing in the status line, and clears it on close', () => {
    renderPanel()
    openDay()
    expect(getSectionViewStatus()).toBe('Showing tabs closed today')
    act(() => useUIStore.getState().closeMainView(groups))
    expect(getSectionViewStatus()).toBe('')
  })

  it('✕ returns to the group shown before', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(useUIStore.getState().mainView).toEqual(GROUP_VIEW)
    expect(screen.getByTestId('windows-panel')).toBeInTheDocument()
  })

  it('✕ puts focus back on the day row that opened the view, else on the Recently closed toggle', async () => {
    const user = userEvent.setup()
    const opener = document.createElement('button')
    opener.setAttribute('data-closed-day-open', '2030-01-03')
    document.body.appendChild(opener)
    renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(opener).toHaveFocus()
    opener.remove()

    const section = document.createElement('div')
    section.setAttribute('data-recently-closed-section', '')
    const toggle = document.createElement('button')
    toggle.setAttribute('data-sidebar-section-toggle', '')
    section.appendChild(toggle)
    document.body.appendChild(section)
    useUIStore.setState({ activeGroupIndex: 42 })
    openDay()
    await user.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(toggle).toHaveFocus()
    section.remove()
  })

  it('falls back to the group view when the day is gone (every entry reopened or removed), but not while loading', () => {
    const { rerenderPanel } = renderPanel()
    openDay()
    h.days = [h.days[1]]
    h.loading = true
    rerenderPanel()
    expect(useUIStore.getState().mainView).toEqual({ kind: 'closedDay', day: '2030-01-03' })
    h.loading = false
    rerenderPanel()
    expect(useUIStore.getState().mainView).toEqual(GROUP_VIEW)
  })

  it('a day view and another day: opening another day keeps the same return group', () => {
    renderPanel()
    openDay()
    openDay('2030-01-02')
    expect(useUIStore.getState().mainViewReturnGroupId).toBe('work')
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeInTheDocument()
  })
})

describe('ClosedDayView — rows', () => {
  it('a click reopens; Ctrl/Cmd click and middle click open in the background', () => {
    renderPanel()
    openDay()
    const first = screen.getByRole('button', { name: /^Reopen Pull request #126/ })
    fireEvent.click(first)
    expect(h.actions.reopen).toHaveBeenLastCalledWith(h.days[0].entries[0], { background: false })
    fireEvent.click(first, { ctrlKey: true })
    expect(h.actions.reopen).toHaveBeenLastCalledWith(h.days[0].entries[0], { background: true })
    fireEvent.click(first, { metaKey: true })
    expect(h.actions.reopen).toHaveBeenLastCalledWith(h.days[0].entries[0], { background: true })
    fireEvent(first, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(h.actions.reopen).toHaveBeenCalledTimes(4)
    expect(h.actions.reopen).toHaveBeenLastCalledWith(h.days[0].entries[0], { background: true })
  })

  it('a window row restores the whole window; its chevron lists the tabs, each reopenable on its own', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    fireEvent.click(screen.getByRole('button', { name: /^Restore window with 3 tabs/ }))
    expect(h.actions.reopen).toHaveBeenLastCalledWith(windowEntry, { background: false })
    const chevron = screen.getByRole('button', { name: 'Tabs in this window' })
    expect(chevron).toHaveAttribute('aria-expanded', 'false')
    await user.click(chevron)
    expect(chevron).toHaveAttribute('aria-expanded', 'true')
    const inner = screen.getByRole('list', { name: 'Tabs in this window' })
    expect(chevron).toHaveAttribute('aria-controls', inner.id)
    await user.click(within(inner).getByRole('button', { name: 'Reopen Figma B' }))
    expect(h.actions.reopen).toHaveBeenLastCalledWith(windowEntry, { tabIndex: 1, background: false })
  })

  it('the row menu: Reopen, Save to group…, Copy link (tabs only), Remove from list', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'More options for Pull request #126' }))
    expect(await screen.findByRole('menuitem', { name: 'Reopen' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Save to group…' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    expect(h.actions.copyLink).toHaveBeenCalledWith('https://github.com/pr/126')

    await user.click(screen.getByRole('button', { name: 'More options for Window · 3 tabs' }))
    expect(await screen.findByRole('menuitem', { name: 'Restore window' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Copy link' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Remove from list' }))
    expect(h.actions.remove).toHaveBeenCalledWith(windowEntry)
  })

  it('Save to group… lists the saved groups with colours (no Now Open, no archived) and "New group: <site>"', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'More options for Pull request #126' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Save to group…' }))
    await user.keyboard('{ArrowRight}')
    const work = await screen.findByRole('menuitem', { name: 'Work' })
    expect(screen.queryByRole('menuitem', { name: 'Now Open' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Old' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'New group: github.com' })).toBeInTheDocument()
    fireEvent.click(work)
    expect(h.actions.saveToGroup).toHaveBeenCalledWith([h.days[0].entries[0]], { groupId: 'work' }, 'tab', 'Work')
  })

  it('"New group" saves into a new group named after the site', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'More options for Window · 3 tabs' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Save to group…' }))
    await user.keyboard('{ArrowRight}')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New group: figma.com' }))
    expect(h.actions.saveToGroup).toHaveBeenCalledWith([windowEntry], { newGroupName: 'figma.com' }, 'window', 'figma.com')
  })

  it('after removing an entry focus moves to the next row; after the last one, to the previous', async () => {
    const user = userEvent.setup()
    const { rerenderPanel } = renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'More options for Pull request #126' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from list' }))
    h.days = [makeDay('2030-01-03', [windowEntry, h.days[0].entries[2]]), h.days[1]]
    rerenderPanel()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Restore window with 3 tabs/ })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: /^Reopen Hacker News/ }))
    h.days = [makeDay('2030-01-03', [windowEntry]), h.days[1]]
    rerenderPanel()
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Restore window with 3 tabs/ })).toHaveFocus())
  })

  it('a failed action leaves focus where it was', async () => {
    h.actions.reopen.mockResolvedValue(false)
    renderPanel()
    openDay()
    const row = screen.getByRole('button', { name: /^Reopen Hacker News/ })
    row.focus()
    fireEvent.click(row)
    await act(async () => {})
    expect(row).toHaveFocus()
  })

  it('reopening one tab out of a window keeps the row (no focus move)', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    await user.click(screen.getByRole('button', { name: 'Tabs in this window' }))
    await user.click(screen.getByRole('button', { name: 'Reopen Figma A' }))
    expect(h.actions.reopen).toHaveBeenCalledWith(windowEntry, { tabIndex: 0, background: false })
  })

  it('Up/Down/Home/End move between the rows and are not passed on to the popup-wide keys', () => {
    renderPanel()
    openDay()
    const rows = within(screen.getByRole('list', { name: 'Closed tabs and windows' })).getAllByRole('button', { name: /^(Reopen|Restore window)/ })
    rows[0].focus()
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    rows[0].dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(rows[1]).toHaveFocus()
    fireEvent.keyDown(rows[1], { key: 'End' })
    expect(rows[2]).toHaveFocus()
    fireEvent.keyDown(rows[2], { key: 'Home' })
    expect(rows[0]).toHaveFocus()
    expect(rows[0]).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End')
  })
})

describe('ClosedDayView — header menu', () => {
  it('Reopen all, Save all to group…, Remove this day, Clear all (N)', async () => {
    const user = userEvent.setup()
    renderPanel()
    openDay()
    const open = () => user.click(screen.getByRole('button', { name: 'More options for Today' }))
    await open()
    await user.click(await screen.findByRole('menuitem', { name: 'Reopen all in a new window' }))
    expect(h.actions.reopenAll).toHaveBeenCalledWith(h.days[0])
    await open()
    await user.click(await screen.findByRole('menuitem', { name: 'Remove this day' }))
    expect(h.actions.removeDay).toHaveBeenCalledWith(h.days[0])
    await open()
    // N counts every entry of every day
    await user.click(await screen.findByRole('menuitem', { name: 'Clear all recently closed (4)' }))
    expect(h.actions.clearAll).toHaveBeenCalled()
    await open()
    await user.click(await screen.findByRole('menuitem', { name: 'Save all to group…' }))
    await user.keyboard('{ArrowRight}')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Work' }))
    expect(h.actions.saveToGroup).toHaveBeenCalledWith(h.days[0].entries, { groupId: 'work' }, 'day', 'Work')
  })
})

describe('ClosedDayView — search, long days, Free note', () => {
  it('the header search filters the day by title and URL ("hide" mode)', () => {
    useUIStore.setState({ searchFilter: 'figma' })
    renderPanel()
    openDay()
    const list = screen.getByRole('list', { name: 'Closed tabs and windows' })
    expect(within(list).getAllByRole('button', { name: /^(Reopen|Restore)/ })).toHaveLength(1)
    act(() => useUIStore.setState({ searchFilter: 'hacker' }))
    expect(within(list).getByRole('button', { name: /^Reopen Hacker News/ })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /^Reopen Pull request/ })).toBeNull()
  })

  it('"dim" mode keeps every row and fades the others', () => {
    h.searchMode = 'dim'
    useUIStore.setState({ searchFilter: 'github.com/pr' })
    renderPanel()
    openDay()
    const rows = within(screen.getByRole('list', { name: 'Closed tabs and windows' })).getAllByRole('button', { name: /^(Reopen|Restore window)/ })
    expect(rows).toHaveLength(3)
    expect(rows[0].closest('li')?.className).not.toContain('opacity-40')
    expect(rows[2].closest('li')?.className).toContain('opacity-40')
  })

  it('no match says so', () => {
    useUIStore.setState({ searchFilter: 'zzzz' })
    renderPanel()
    openDay()
    expect(screen.getByText('No closed tabs on this day match your search.')).toBeInTheDocument()
  })

  it('shows the first 100 entries of a long day, then 100 more per "Show more"', () => {
    const many = Array.from({ length: CLOSED_DAY_PAGE_SIZE + 30 }, (_, i) => tabEntry(`m${i}`, `https://m${i}.example/`, `Page ${i}`, T0 - i))
    h.days = [makeDay('2030-01-03', many)]
    renderPanel()
    openDay()
    const list = screen.getByRole('list', { name: 'Closed tabs and windows' })
    expect(list.querySelectorAll(':scope > li')).toHaveLength(CLOSED_DAY_PAGE_SIZE)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(list.querySelectorAll(':scope > li')).toHaveLength(CLOSED_DAY_PAGE_SIZE + 30)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  }, 30_000)

  it('Free: the oldest day ends with how long each plan keeps them and a "See Pro" link', async () => {
    h.tier = 'free'
    const user = userEvent.setup()
    renderPanel()
    openDay()
    expect(screen.queryByTestId('closed-day-free-note')).toBeNull()
    openDay('2030-01-02')
    const note = screen.getByTestId('closed-day-free-note')
    // both limits of both plans (RECENTLY_CLOSED_LIMITS), numbers formatted for the locale
    expect(note).toHaveTextContent('Free keeps up to 50 from the last 7 days. Pro keeps up to 1,000 for 30 days.')
    await user.click(within(note).getByRole('button', { name: 'See Pro' }))
    expect(h.create).toHaveBeenCalledWith({ url: expect.stringMatching(/\/pricing$/), active: true })
  })
})

describe('helpers', () => {
  it('closedEntryMatches looks at every tab title and URL', () => {
    expect(closedEntryMatches(windowEntry, 'other c')).toBe(true)
    expect(closedEntryMatches(windowEntry, 'figma.com/b')).toBe(true)
    expect(closedEntryMatches(windowEntry, 'github')).toBe(false)
  })

  it('closedHost drops www. and falls back for odd URLs', () => {
    expect(closedHost('https://www.github.com/x')).toBe('github.com')
    expect(closedHost('not a url')).toBe('')
  })

  it('isBackgroundClick: middle button or Ctrl/Cmd', () => {
    expect(isBackgroundClick({ button: 1, ctrlKey: false, metaKey: false } as never)).toBe(true)
    expect(isBackgroundClick({ button: 0, ctrlKey: true, metaKey: false } as never)).toBe(true)
    expect(isBackgroundClick({ button: 0, ctrlKey: false, metaKey: false } as never)).toBe(false)
  })
})
