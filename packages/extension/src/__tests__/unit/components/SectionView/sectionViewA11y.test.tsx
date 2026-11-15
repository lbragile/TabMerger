import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainPanel } from '@/components/SectionView/MainPanel'
import { SectionViewAnnouncer } from '@/components/SectionView/SectionViewAnnouncer'
import { clearSectionViewStatus, getSectionViewStatus } from '@/lib/sectionViewStatus'
import { TOUR_ANCHORS } from '@/lib/tourSteps'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Session } from '@/lib/types'

/**
 * Accessibility of the read-only section views: the polite status line (open, restore, delete),
 * where focus goes when a view closes, the one arrow-key list across a session's groups.
 */

const h = vi.hoisted(() => ({
  restoreGroup: vi.fn(),
  deleteGroup: vi.fn(),
  restoreSession: vi.fn(),
  deleteSession: vi.fn(),
  sessions: [] as Session[] | undefined,
}))

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() }))
vi.mock('@/hooks/useRecentlyClosed', () => ({ useRecentlyClosed: () => ({ days: [], entries: [], isLoading: false }) }))
vi.mock('@/components/Windows', () => ({ WindowsPanel: () => <div data-testid="windows-panel" /> }))
vi.mock('@/hooks/useGroups', () => ({
  useRestoreGroup: () => ({ mutate: h.restoreGroup, isPending: false }),
  useDeleteGroup: () => ({ mutate: h.deleteGroup }),
}))
vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({ data: h.sessions }),
  useDeleteSession: () => ({ mutate: h.deleteSession }),
  useRestoreSession: () => ({ mutate: h.restoreSession, isPending: false }),
}))

const tab = (url: string) => ({ id: 0, title: url, url })
const win = (...urls: string[]) => ({ id: 1, tabs: urls.map(tab), incognito: false, focused: false })
const group = (id: string, extra: Partial<Group> = {}): Group => ({ id, name: `Name ${id}`, color: 'rgba(1, 2, 3, 1)', updatedAt: Date.now(), windows: [], ...extra })
const archived = group('arch', { archived: true, windows: [win('https://a.test/')] })
const state = (...groups: Group[]): GroupsState => ({ active: { id: 'now', index: 0 }, available: [group('now', { permanent: true }), ...groups] })

/** The panel next to a stand-in sidebar: the archived section (toggle + the row that opens the view) and group rows. */
function renderWithSidebar(s: GroupsState, { withOpener = true }: { withOpener?: boolean } = {}) {
  const sidebar = (next: GroupsState) => (
    <div>
      {next.available.filter((g) => !g.archived).map((g, i) => (
        <div key={g.id} tabIndex={0} data-sidebar-group-index={i}>{g.name}</div>
      ))}
      <div data-tour={TOUR_ANCHORS.archived}>
        <button type="button" data-sidebar-section-toggle="">Archived</button>
        {withOpener && <button type="button" data-archived-open="arch">Show archived group Name arch</button>}
      </div>
    </div>
  )
  const ui = (next: GroupsState) => (
    <TooltipProvider>
      {sidebar(next)}
      <MainPanel groupsState={next} />
      <SectionViewAnnouncer />
    </TooltipProvider>
  )
  const utils = render(ui(s))
  return { ...utils, rerenderWith: (next: GroupsState) => utils.rerender(ui(next)) }
}

const status = () => screen.getByTestId('section-view-status')
const openArchived = () => act(() => useUIStore.getState().openMainView({ kind: 'archived', groupId: 'arch' }, 'now'))

beforeEach(() => {
  vi.clearAllMocks()
  h.sessions = []
  useUIStore.setState({ activeGroupIndex: 0, mainView: GROUP_VIEW, mainViewReturnGroupId: null })
  ;(globalThis as { chrome?: unknown }).chrome = { tabs: { create: vi.fn().mockResolvedValue({}) } }
})
afterEach(() => act(() => clearSectionViewStatus()))

describe('section views — the status line', () => {
  it('says which view opened, as a polite status, and clears it when the view closes', () => {
    renderWithSidebar(state(archived))
    expect(status()).toHaveAttribute('role', 'status')
    expect(status()).toHaveAttribute('aria-live', 'polite')
    openArchived()
    expect(status()).toHaveTextContent('Showing archived group Name arch, read-only')
    fireEvent.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(status()).toBeEmptyDOMElement()
  })

  it('a session view says so too', () => {
    h.sessions = [{ id: 's1', name: 'Morning', createdAt: Date.now(), groups: [] }]
    renderWithSidebar(state())
    act(() => useUIStore.getState().openMainView({ kind: 'session', sessionId: 's1' }, 'now'))
    expect(status()).toHaveTextContent('Showing session Morning, read-only')
  })

  it('Restore from the view says "Restored", and closing the view keeps that line', () => {
    const { rerenderWith } = renderWithSidebar(state(archived))
    openArchived()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    const restored = state({ ...archived, archived: false })
    act(() => h.restoreGroup.mock.calls[0][1].onSuccess(restored))
    rerenderWith(restored)
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
    expect(status()).toHaveTextContent('Restored Name arch')
  })

  it('Delete from the view says "Deleted"', async () => {
    const user = userEvent.setup()
    renderWithSidebar(state(archived))
    openArchived()
    await user.click(screen.getByRole('button', { name: 'More options for Name arch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete group' }))
    act(() => h.deleteGroup.mock.calls[0][1].onSuccess())
    expect(getSectionViewStatus()).toBe('Deleted Name arch')
  })
})

describe('section views — focus when a view closes', () => {
  it('✕ returns focus to the sidebar row that opened the view', () => {
    renderWithSidebar(state(archived))
    openArchived()
    screen.getByRole('button', { name: 'Close this view' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(screen.getByRole('button', { name: 'Show archived group Name arch' })).toHaveFocus()
  })

  it('without that row (section collapsed) it goes to the group row shown again', () => {
    renderWithSidebar(state(archived), { withOpener: false })
    openArchived()
    screen.getByRole('button', { name: 'Close this view' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(screen.getByText('Name now')).toHaveFocus()
  })

  it('without either, it goes to the section toggle', () => {
    renderWithSidebar(state(archived), { withOpener: false })
    // no group row to go back to (index 7 is not listed, and no remembered group)
    act(() => useUIStore.setState({ activeGroupIndex: 7 }))
    act(() => useUIStore.getState().openMainView({ kind: 'archived', groupId: 'arch' }, null))
    screen.getByRole('button', { name: 'Close this view' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveFocus()
  })
})

describe('section views — arrow keys', () => {
  const session: Session = {
    id: 's1',
    name: 'Morning',
    createdAt: Date.now(),
    groups: [group('g1', { name: 'Work', windows: [win('https://w1.test/', 'https://w2.test/')] }), group('g2', { name: 'Read', windows: [win('https://r1.test/')] })],
  }

  it('in a session, Up/Down/Home/End move across every group\'s tabs as one list, and say so', () => {
    h.sessions = [session]
    renderWithSidebar(state())
    act(() => useUIStore.getState().openMainView({ kind: 'session', sessionId: 's1' }, 'now'))
    const tabs = screen.getAllByRole('button', { name: /\.test\// })
    expect(tabs).toHaveLength(3)
    for (const b of tabs) expect(b).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End')
    tabs[1].focus()
    fireEvent.keyDown(tabs[1], { key: 'ArrowDown' })
    expect(tabs[2]).toHaveFocus()
    expect(within(screen.getByRole('group', { name: 'Read' })).getByRole('button', { name: /r1\.test/ })).toHaveFocus()
    fireEvent.keyDown(tabs[2], { key: 'Home' })
    expect(tabs[0]).toHaveFocus()
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(tabs[2]).toHaveFocus()
    fireEvent.keyDown(tabs[2], { key: 'ArrowUp' })
    expect(tabs[1]).toHaveFocus()
  })

  it('each window is a named group with a heading, never a landmark', () => {
    renderWithSidebar(state(archived))
    openArchived()
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    const windowGroup = screen.getByRole('group', { name: 'Window 1' })
    expect(within(windowGroup).getByRole('heading', { level: 3, name: 'Window 1' })).toBeInTheDocument()
  })
})
