import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionView } from '@/components/SectionView/SessionView'
import { ArchivedGroupView } from '@/components/SectionView/ArchivedGroupView'
import { i18n } from '@/lib/i18n'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group, Session } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() }))
vi.mock('@/hooks/useGroups', () => ({
  useRestoreGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useSessions', () => ({
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false }),
}))

const g = (id: string): Group => ({
  id, name: `Name ${id}`, color: 'rgba(1, 2, 3, 1)', updatedAt: Date.now(),
  windows: [{ id: 1, tabs: [{ id: 0, title: 'T', url: 'https://t.test/' }], incognito: false, focused: false }],
})
const session = (createdAt: number, groups: Group[]): Session => ({ id: 's', name: 'Snap', createdAt, groups })
/** A meta line ("Saved … · 5 groups"): its separators are aria-hidden spans, so match the whole paragraph's text */
const metaLine = (m: string | RegExp, scope: Pick<typeof screen, 'getByText'> = screen) =>
  scope.getByText((_, el) => el?.tagName === 'P' && (typeof m === 'string' ? el.textContent === m : m.test(el.textContent ?? '')))
const renderView = (s: Session) => render(<TooltipProvider><SessionView session={s} groups={[]} /></TooltipProvider>)

beforeEach(() => useUIStore.setState({ mainView: GROUP_VIEW, mainViewReturnGroupId: null }))
afterEach(async () => {
  cleanup()
  await act(async () => { await i18n.changeLanguage('en') })
})

describe('SessionView', () => {
  it('leaves the year out of the date when the session is from this year', () => {
    const now = new Date()
    const thisYear = new Date(now.getFullYear(), 0, 2, 9, 5).getTime()
    renderView(session(thisYear, [g('a')]))
    expect(metaLine(/^Saved /).textContent).not.toContain(String(now.getFullYear()))
  })

  it('includes the year when the session is not from this year', () => {
    renderView(session(new Date(2020, 5, 10, 18, 22).getTime(), [g('a')]))
    expect(metaLine(/^Saved /).textContent).toContain('2020')
  })

  it('says so when the session holds no groups', () => {
    renderView(session(Date.now(), []))
    expect(screen.getByText('This session has no groups.')).toBeInTheDocument()
    expect(metaLine(/· 0 groups · 0 windows · 0 tabs$/)).toBeInTheDocument()
    // nothing to end
    expect(screen.queryByText(/End of session/)).toBeNull()
  })
})

describe.each(['he', 'ar', 'fa'])('read-only views render right-to-left in %s', (lng) => {
  it('both views render with their catalog text and bidi-safe names', async () => {
    await act(async () => { await i18n.changeLanguage(lng) })
    const { unmount } = renderView(session(Date.now(), [g('a')]))
    expect(screen.getByTestId('session-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('heading', { level: 3 })).toHaveAttribute('dir', 'auto')
    // translated, not the English fallback, and no read-only banner (Restore asks first)
    expect(screen.getByRole('heading', { level: 2 }).nextElementSibling!.textContent).not.toMatch(/Saved|groups/)
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.getByRole('group', { name: 'Name a' }).querySelector('[role="group"]')!.getAttribute('aria-label')).not.toMatch(/window/)
    unmount()
    render(<TooltipProvider><ArchivedGroupView group={g('b')} groupIndex={1} groups={[g('b')]} /></TooltipProvider>)
    expect(screen.getByTestId('archived-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('note').textContent).not.toMatch(/Read-only/)
    expect(i18n.dir(lng)).toBe('rtl')
  })
})

describe('SessionView — Option M layout', () => {
  const tab = (url: string, title = url) => ({ id: 0, title, url })
  const grp = (id: string, name: string, windows: Group['windows']): Group => ({ id, name, color: 'rgba(59, 130, 246, 1)', updatedAt: 1, windows })
  const win = (tabs: ReturnType<typeof tab>[], name?: string) => ({ id: 0, tabs, incognito: false, focused: false, ...(name ? { name } : {}) })
  const sample = () =>
    session(new Date(2020, 10, 10, 18, 22).getTime(), [
      grp('l', 'Launch', [win([tab('https://a.test/'), tab('https://b.test/')]), win([tab('https://c.test/')], 'Press')]),
      grp('e', 'Engineering', [win([tab('https://d.test/')])]),
    ])

  it('one meta line: saved date, then groups, windows and tabs in lower case, plural-aware', () => {
    renderView(sample())
    expect(metaLine(/^Saved /).textContent).toMatch(/^Saved Nov 10, 2020, 6:22\sPM · 2 groups · 3 windows · 4 tabs$/)
  })

  it('the header tile is a bookmark in the session colour, hidden from screen readers; the title is bold', () => {
    const { container } = renderView({ ...sample(), color: 'rgba(234, 179, 8, 1)' })
    const tile = container.querySelector('[data-session-tile]') as HTMLElement
    expect(tile).toHaveAttribute('aria-hidden', 'true')
    expect(tile).toHaveClass('tm-session-tile')
    expect(tile.style.getPropertyValue('--item-color')).toBe('rgba(234, 179, 8, 1)')
    expect(tile.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('font-bold')
  })

  it('Restore session has an icon and still asks first', async () => {
    renderView(sample())
    const restore = screen.getByRole('button', { name: 'Restore session' })
    expect(restore.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // its own colour tokens (white on the light theme's --primary is only 3.04:1)
    expect(restore).toHaveClass('bg-view-primary', 'text-view-primary-foreground')
    expect(restore).not.toHaveClass('bg-primary')
    await act(async () => restore.click())
    expect(await screen.findByRole('alertdialog', { name: 'Restore this session?' })).toBeInTheDocument()
  })

  it('shows the description on its own line', () => {
    renderView({ ...sample(), description: 'Everything open before the launch' })
    expect(screen.getByText('Everything open before the launch')).toBeInTheDocument()
  })

  it('each group has a sticky header (colour square, bold name naming the group, lower-case counts)', () => {
    const { container } = renderView(sample())
    const headers = container.querySelectorAll<HTMLElement>('[data-session-group-header]')
    expect(headers).toHaveLength(2)
    for (const h of headers) expect(h).toHaveClass('sticky', 'top-0', 'bg-background', 'h-[var(--section-group-header)]')
    const launch = screen.getByRole('group', { name: 'Launch' })
    expect(within(launch).getByRole('heading', { level: 3, name: 'Launch' })).toHaveClass('font-bold')
    expect(headers[0].querySelector('p')!.textContent).toBe('2 windows · 3 tabs')
    expect(headers[1].querySelector('p')!.textContent).toBe('1 window · 1 tab')
    // no left colour bar and no boxed window cards any more
    expect(launch.getAttribute('style') ?? '').not.toMatch(/border/)
    expect(container.querySelector('.border.bg-card')).toBeNull()
  })

  it('windows are brackets named "<group>, window N, <tabs>" (with a custom name when there is one), tiles sticky under the group header', () => {
    renderView(sample())
    const launch = screen.getByRole('group', { name: 'Launch' })
    expect(within(launch).getByRole('group', { name: 'Launch, window 1, 2 tabs' })).toBeInTheDocument()
    expect(within(launch).getByRole('group', { name: 'Launch, Press, window 2, 1 tab' })).toBeInTheDocument()
    const tile = within(launch).getByRole('group', { name: 'Launch, window 1, 2 tabs' }).querySelector('[data-window-tile]')
    expect(tile).toHaveClass('sticky', 'top-[calc(var(--section-group-header)+0.5rem)]')
  })

  it('ends with "End of session · N tabs"', () => {
    const { container } = renderView(sample())
    expect(container.querySelector('[data-session-end]')!.textContent).toBe('End of session · 4 tabs')
  })

  it('Up/Down cross windows and groups as one list', () => {
    renderView(sample())
    const tabs = screen.getAllByRole('button', { name: /\.test\// })
    expect(tabs).toHaveLength(4)
    tabs[1].focus()
    fireEvent.keyDown(tabs[1], { key: 'ArrowDown' })
    // into Launch's second window
    expect(within(screen.getByRole('group', { name: 'Launch, Press, window 2, 1 tab' })).getByRole('button')).toHaveFocus()
    fireEvent.keyDown(tabs[2], { key: 'ArrowDown' })
    // into the next group
    expect(within(screen.getByRole('group', { name: 'Engineering, window 1, 1 tab' })).getByRole('button')).toHaveFocus()
    fireEvent.keyDown(tabs[3], { key: 'ArrowUp' })
    expect(tabs[2]).toHaveFocus()
  })

  it('the scroll area has the two fades, hidden from screen readers and not catching the pointer', () => {
    const { container } = renderView(sample())
    const fades = container.querySelectorAll('[data-fade]')
    expect(fades).toHaveLength(2)
    for (const f of fades) {
      expect(f).toHaveAttribute('aria-hidden', 'true')
      expect(f).toHaveClass('pointer-events-none')
    }
    // the top fade starts under the sticky group header
    expect(container.querySelector('[data-fade="top"]')).toHaveClass('top-[var(--section-group-header)]')
  })
})

describe('ArchivedGroupView — brackets', () => {
  it('shows its windows as brackets in the group colour, without a group header', () => {
    const group: Group = {
      id: 'b', name: 'Old Project', color: 'rgba(239, 68, 68, 1)', updatedAt: 1, archived: true,
      windows: [
        { id: 1, tabs: [{ id: 0, title: 'A', url: 'https://a.test/' }, { id: 0, title: 'B', url: 'https://b.test/' }], incognito: false, focused: false },
        { id: 2, tabs: [{ id: 0, title: 'C', url: 'https://c.test/' }], incognito: false, focused: false, name: 'Research' },
      ],
    }
    const { container } = render(<TooltipProvider><ArchivedGroupView group={group} groupIndex={1} groups={[group]} /></TooltipProvider>)
    expect(screen.getByRole('group', { name: 'Old Project, window 1, 2 tabs' }).style.getPropertyValue('--item-color')).toBe('rgba(239, 68, 68, 1)')
    expect(screen.getByRole('group', { name: 'Old Project, Research, window 2, 1 tab' })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-window-gutter]')).toHaveLength(2)
    expect(container.querySelector('[data-session-group-header]')).toBeNull()
    expect(container.querySelector('[data-window-tile]')).toHaveClass('sticky', 'top-2')
    // the archived view keeps its read-only note and its header (no session tile)
    expect(screen.getByRole('note')).toHaveTextContent('Read-only')
    expect(container.querySelector('[data-session-tile]')).toBeNull()
  })
})
