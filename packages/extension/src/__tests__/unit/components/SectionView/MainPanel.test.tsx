import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainPanel } from '@/components/SectionView/MainPanel'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Session } from '@/lib/types'

const h = vi.hoisted(() => ({
  restoreGroup: vi.fn(),
  deleteGroup: vi.fn(),
  restoreSession: vi.fn(),
  deleteSession: vi.fn(),
  sessions: undefined as Session[] | undefined,
}))

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() }))
vi.mock('@/components/Windows', () => ({
  WindowsPanel: ({ groupIndex }: { groupIndex: number }) => <div data-testid="windows-panel">{groupIndex}</div>,
}))
vi.mock('@/hooks/useGroups', () => ({
  useRestoreGroup: () => ({ mutate: h.restoreGroup, isPending: false }),
  useDeleteGroup: () => ({ mutate: h.deleteGroup }),
}))
vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({ data: h.sessions }),
  useDeleteSession: () => ({ mutate: h.deleteSession }),
  useRestoreSession: () => ({ mutate: h.restoreSession, isPending: false }),
}))

const tab = (url: string, title = url) => ({ id: 0, title, url })
const win = (...urls: string[]) => ({ id: 1, tabs: urls.map((u) => tab(u)), incognito: false, focused: false })
const group = (id: string, extra: Partial<Group> = {}): Group => ({ id, name: `Name ${id}`, color: 'rgba(1, 2, 3, 1)', updatedAt: Date.now(), windows: [], ...extra })
const nowOpen = group('now', { permanent: true })
const state = (...groups: Group[]): GroupsState => ({ active: { id: 'now', index: 0 }, available: [nowOpen, ...groups] })

/** A meta line ("Session ◆ …"): its ◆ separators are aria-hidden spans, so match the whole paragraph's text */
const metaLine = (m: string | RegExp, scope: Pick<typeof screen, 'getByText'> = screen) =>
  scope.getByText((_, el) => el?.tagName === 'P' && (typeof m === 'string' ? el.textContent === m : m.test(el.textContent ?? '')))
const renderPanel = (s: GroupsState) => {
  const utils = render(<TooltipProvider><MainPanel groupsState={s} /></TooltipProvider>)
  return { ...utils, rerenderWith: (next: GroupsState) => utils.rerender(<TooltipProvider><MainPanel groupsState={next} /></TooltipProvider>) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sessions = []
  useUIStore.setState({ activeGroupIndex: 0, mainView: GROUP_VIEW, mainViewReturnGroupId: null, selectionMode: false })
  ;(globalThis as { chrome?: unknown }).chrome = { tabs: { create: vi.fn().mockResolvedValue({}) } }
})

describe('MainPanel — group view', () => {
  it('shows the active group', () => {
    useUIStore.setState({ activeGroupIndex: 1 })
    renderPanel(state(group('a')))
    expect(screen.getByTestId('windows-panel')).toHaveTextContent('1')
  })
})

describe('MainPanel — archived group view', () => {
  const archived = group('arch', { archived: true, windows: [win('https://a.test/page', 'https://b.test/')] })

  const openArchived = () => act(() => useUIStore.getState().openMainView({ kind: 'archived', groupId: 'arch' }, 'now'))

  it('shows the group read-only: heading, counts, banner, and tabs that only open', () => {
    renderPanel(state(group('a'), archived))
    openArchived()
    expect(screen.getByRole('heading', { level: 2, name: 'Name arch' })).toBeInTheDocument()
    const meta = metaLine('Archived ◆ 1 Window ◆ 2 Tabs')
    // the separators are not read out ("black diamond")
    expect(meta.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2)
    expect(screen.getByRole('note')).toHaveTextContent(/^Archived just now\. Read-only: restore it to move, edit or add tabs\. Clicking a tab still opens it\.$/)
    expect(screen.queryByTestId('windows-panel')).toBeNull()
    // no attributes the popup's keyboard shortcuts (Delete, F2, N) act on
    expect(document.querySelector('[data-tab-index], [data-window-index], [data-group-index]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /a\.test\/page/ }))
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.test/page', active: true })
  })

  it('✕ goes back to the group shown before', () => {
    renderPanel(state(group('a'), archived))
    openArchived()
    fireEvent.click(screen.getByRole('button', { name: 'Close this view' }))
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
    expect(screen.getByTestId('windows-panel')).toBeInTheDocument()
  })

  it('Restore restores it by position, then shows it as a normal group', () => {
    renderPanel(state(group('a'), archived))
    openArchived()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(h.restoreGroup).toHaveBeenCalledWith(2, expect.objectContaining({ onSuccess: expect.any(Function) }))
    act(() => h.restoreGroup.mock.calls[0][1].onSuccess(state(group('a'), { ...archived, archived: false })))
    expect(useUIStore.getState()).toMatchObject({ activeGroupIndex: 2, mainView: { kind: 'group' } })
  })

  it('Delete in the ⋯ menu deletes it by position', async () => {
    const user = userEvent.setup()
    renderPanel(state(group('a'), archived))
    openArchived()
    await user.click(screen.getByRole('button', { name: 'More options for Name arch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete group' }))
    expect(h.deleteGroup).toHaveBeenCalledWith(2, expect.objectContaining({ onSuccess: expect.any(Function) }))
  })

  it('falls back to the group view when the group is no longer archived or is gone', () => {
    const { rerenderWith } = renderPanel(state(group('a'), archived))
    openArchived()
    rerenderWith(state(group('a'), { ...archived, archived: false }))
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })

    openArchived()
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
    rerenderWith(state(group('a'), archived))
    openArchived()
    rerenderWith(state(group('a')))
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
  })

  it('Up and Down move between the tabs and are not passed on to the popup-wide keys', () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    renderPanel(state({ ...archived, windows: [win('https://a.test/', 'https://b.test/'), win('https://c.test/')] }))
    openArchived()
    const tabs = screen.getAllByRole('button', { name: /\.test/ })
    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'ArrowDown' })
    expect(tabs[1]).toHaveFocus()
    fireEvent.keyDown(tabs[1], { key: 'End' })
    expect(tabs[2]).toHaveFocus()
    expect(outer.mock.calls.every(([e]) => (e as KeyboardEvent).defaultPrevented)).toBe(true)
    document.removeEventListener('keydown', outer)
  })
})

describe('MainPanel — session view', () => {
  const session: Session = {
    id: 's1',
    name: 'Morning',
    description: 'Before standup',
    createdAt: Date.now(),
    groups: [group('g1', { name: 'Work', windows: [win('https://w.test/')] }), group('g2', { name: 'Read', color: 'rgba(9, 9, 9, 1)', windows: [win('https://r.test/', 'https://r2.test/')] })],
  }

  const openSession = () => act(() => useUIStore.getState().openMainView({ kind: 'session', sessionId: 's1' }, 'now'))

  it('previews each group with its colour bar, counts and tabs', () => {
    h.sessions = [session]
    renderPanel(state())
    openSession()
    expect(screen.getByRole('heading', { level: 2, name: 'Morning' })).toBeInTheDocument()
    expect(metaLine(/^Session ◆ .+ ◆ 2 Groups ◆ 3 Tabs$/)).toBeInTheDocument()
    expect(screen.getByText('Before standup')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent("A snapshot of your groups. Looking doesn't change anything; Restore session brings these groups back.")
    // a named group (not a landmark) with a real heading
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    const read = screen.getByRole('group', { name: 'Read' })
    expect(within(read).getByRole('heading', { level: 3, name: 'Read' })).toBeInTheDocument()
    expect(metaLine('1 Window ◆ 2 Tabs', within(read))).toBeInTheDocument()
  })

  it('Restore session asks first, restores, then goes back to the group view', async () => {
    h.sessions = [session]
    const user = userEvent.setup()
    renderPanel(state())
    openSession()
    await user.click(screen.getByRole('button', { name: 'Restore session' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close all windows' }))
    expect(h.restoreSession).toHaveBeenCalledWith(session, expect.objectContaining({ onSuccess: expect.any(Function) }))
    act(() => h.restoreSession.mock.calls[0][1].onSuccess())
    await waitFor(() => expect(useUIStore.getState().mainView).toEqual({ kind: 'group' }))
  })

  it('an automatic backup is never shown, and a deleted session falls back', () => {
    h.sessions = [{ ...session, auto: true }]
    renderPanel(state())
    openSession()
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
  })

  it('waits while the sessions are still loading', () => {
    h.sessions = undefined
    renderPanel(state())
    openSession()
    expect(useUIStore.getState().mainView).toEqual({ kind: 'session', sessionId: 's1' })
  })
})

describe('MainPanel — focus return', () => {
  const archived = group('arch', { archived: true, windows: [win('https://a.test/')] })

  function renderWithSidebarRow() {
    const row = document.createElement('div')
    row.tabIndex = 0
    row.setAttribute('data-sidebar-group-index', '1')
    document.body.appendChild(row)
    return row
  }

  it('returning to the group view with focus lost puts focus on the active group\'s sidebar row', () => {
    const row = renderWithSidebarRow()
    useUIStore.setState({ activeGroupIndex: 1 })
    renderPanel(state(group('a'), archived))
    act(() => useUIStore.getState().openMainView({ kind: 'archived', groupId: 'arch' }, 'a'))
    // the view's ✕ unmounts with focus on it: focus falls back to <body>
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => useUIStore.getState().closeMainView(state(group('a'), archived).available))
    expect(row).toHaveFocus()
    row.remove()
  })

  it('leaves focus alone when it is already somewhere else', () => {
    const row = renderWithSidebarRow()
    const other = document.createElement('button')
    document.body.appendChild(other)
    useUIStore.setState({ activeGroupIndex: 1 })
    renderPanel(state(group('a'), archived))
    act(() => useUIStore.getState().openMainView({ kind: 'archived', groupId: 'arch' }, 'a'))
    other.focus()
    act(() => useUIStore.getState().closeMainView(state(group('a'), archived).available))
    expect(other).toHaveFocus()
    row.remove()
    other.remove()
  })
})
