/**
 * Branch coverage for SidePanel: archived-groups toggle/restore/delete,
 * sessions toggle/restore(confirm)/delete, starred-first sort, isLocked gating,
 * selectionMode guards on add-group and item click.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidePanel } from '@/components/SidePanel'
import type { Group, GroupsState } from '@/lib/types'
import type { Session } from '@tabmerger/shared'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import { act } from '@testing-library/react'
import { clearSectionViewStatus, getSectionViewStatus } from '@/lib/sectionViewStatus'

const {
  mockUseEntitlements,
  mockRestoreGroup,
  mockDeleteGroup,
  mockRestoreSession,
  mockDeleteSession,
  mockUseSessionsData,
  mockUseRestoreSessionState,
  mockSetActiveGroupIndex,
} = vi.hoisted(() => ({
  mockUseEntitlements: vi.fn(),
  mockRestoreGroup: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockRestoreSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockUseSessionsData: vi.fn((): { data: Session[] } => ({ data: [] })),
  mockUseRestoreSessionState: vi.fn(() => ({ isPending: false })),
  mockSetActiveGroupIndex: vi.fn(),
}))

// The Auto-saved section has its own tests (AutoSavedSection.test.tsx)
vi.mock('@/components/SidePanel/AutoSavedSection', () => ({ AutoSavedSection: () => null }))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  closestCenter: vi.fn(),
  // The sidebar's always-mounted "new group" drop zone registers a droppable.
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
}))

vi.mock('@/hooks/useDnd', () => ({
  useDndSensors: () => [],
  useGroupDndHandlers: () => ({ onDragEnd: vi.fn() }),
  setBodyDragCursor: vi.fn(),
}))

vi.mock('@/components/SidePanel/GroupItem', () => ({
  GroupItem: ({ group, onClick, isLocked, isActive }: { group: { name: string }; onClick: () => void; isLocked: boolean; isActive: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'group-item', 'data-locked': String(isLocked), 'data-active': String(isActive), onClick },
      group.name
    ),
}))

vi.mock('@/hooks/useGroups', () => ({
  useAddGroup: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useRestoreGroup: () => ({ mutate: mockRestoreGroup }),
  useDeleteGroup: () => ({ mutate: mockDeleteGroup }),
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => mockUseEntitlements(),
  isOverFreeLimit: (itemIndex: number, freeLimit: number) => itemIndex >= freeLimit,
}))

vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => mockUseSessionsData(),
  useDeleteSession: () => ({ mutate: mockDeleteSession }),
  useRestoreSession: () => ({ mutate: mockRestoreSession, ...mockUseRestoreSessionState() }),
  useSaveSession: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome

const baseUIState = {
  selectionMode: false,
  activeGroupIndex: 0,
  setActiveGroupIndex: mockSetActiveGroupIndex,
  setRenameTarget: vi.fn(),
  openModal: vi.fn(),
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: `g-${Math.random()}`,
    name: 'Group',
    color: 'rgba(59,130,246,1)',
    updatedAt: Date.now(),
    windows: [],
    permanent: false,
    starred: false,
    ...overrides,
  }
}

function makeGroupsState(groups: Group[]): GroupsState {
  return { available: groups, active: { id: '', index: 0 } }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `s-${Math.random()}`,
    name: 'Session',
    createdAt: Date.now(),
    groups: [makeGroup()],
    ...overrides,
  }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, ui))
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free', aiFeatures: false })
  mockUseSessionsData.mockReturnValue({ data: [] })
  mockUseRestoreSessionState.mockReturnValue({ isPending: false })
  // The real store (the sections are an accordion kept there), with the actions the tests watch replaced
  useUIStore.setState({ ...baseUIState, openSidebarSection: null, mainView: GROUP_VIEW, mainViewReturnGroupId: null })
})

describe('SidePanel — archived groups section', () => {
  it('always shows the header (0) and an empty state when expanded, even with no archived groups', async () => {
    const groupsState = makeGroupsState([makeGroup({ permanent: true })])
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState }))
    expect(screen.getByText(/ARCHIVED \(0\)/)).toBeTruthy()
    await user.click(screen.getByText(/ARCHIVED \(0\)/))
    expect(screen.getByText('No archived groups')).toBeTruthy()
  })

  it('toggles the archived list open/closed and restores/deletes an archived group', async () => {
    const archived = makeGroup({ name: 'Old Project', archived: true })
    const groupsState = makeGroupsState([makeGroup({ permanent: true }), archived])
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState }))

    expect(screen.getByText(/ARCHIVED \(1\)/)).toBeTruthy()
    expect(screen.queryByText('Old Project')).toBeNull()

    await user.click(screen.getByText(/ARCHIVED \(1\)/))
    expect(screen.getByText('Old Project')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /restore old project/i }))
    expect(mockRestoreGroup).toHaveBeenCalledWith(1, expect.objectContaining({ onSuccess: expect.any(Function) }))

    await user.click(screen.getByRole('button', { name: /delete old project/i }))
    expect(mockDeleteGroup).toHaveBeenCalledWith(1, expect.objectContaining({ onSuccess: expect.any(Function) }))

    await user.click(screen.getByText(/ARCHIVED \(1\)/))
    expect(screen.queryByText('Old Project')).toBeNull()
  })
})

describe('SidePanel — sessions section', () => {
  it('always shows the header (0) and an empty state when expanded, even with no sessions', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))
    expect(screen.getByText(/SESSIONS \(0\)/)).toBeTruthy()
    await user.click(screen.getByText(/SESSIONS \(0\)/))
    expect(screen.getByText('No saved sessions')).toBeTruthy()
  })

  it('exposes a "Save current session" action beside the sessions header', () => {
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))
    expect(screen.getByRole('button', { name: /save current session/i })).toBeTruthy()
  })

  it('toggles sessions open, restores on confirm accept, skips on confirm reject, and deletes', async () => {
    const session = makeSession({ name: 'Morning setup' })
    mockUseSessionsData.mockReturnValue({ data: [session] })
    const nativeConfirm = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))

    await user.click(screen.getByText(/SESSIONS \(1\)/))
    expect(screen.getByText('Morning setup')).toBeTruthy()

    // Cancel: the in-app question closes and nothing is restored
    await user.click(screen.getByRole('button', { name: /restore session: morning setup/i }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Restore this session?' })
    expect(dialog).toHaveTextContent('This will close all open windows and open the tabs saved in "Morning setup" instead.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mockRestoreSession).not.toHaveBeenCalled()

    // Confirm: only the action button restores
    await user.click(screen.getByRole('button', { name: /restore session: morning setup/i }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close all windows' }))
    expect(mockRestoreSession).toHaveBeenCalledWith(session, expect.objectContaining({ onSuccess: expect.any(Function) }))
    expect(mockRestoreSession).toHaveBeenCalledTimes(1)
    expect(nativeConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /delete session morning setup/i }))
    expect(mockDeleteSession).toHaveBeenCalledWith(session.id, expect.objectContaining({ onSuccess: expect.any(Function) }))
  })

  it('cuts a long session name at 60 characters in the restore question and Escape cancels it', async () => {
    const longName = 'S'.repeat(80)
    mockUseSessionsData.mockReturnValue({ data: [makeSession({ name: longName })] })
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))
    await user.click(screen.getByText(/SESSIONS \(1\)/))
    await user.click(screen.getByRole('button', { name: /restore session:/i }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(`"${'S'.repeat(60)}…"`)
    expect(dialog).not.toHaveTextContent('S'.repeat(61))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mockRestoreSession).not.toHaveBeenCalled()
  })

  it('disables the restore button while a restore is pending', async () => {
    mockUseSessionsData.mockReturnValue({ data: [makeSession({ name: 'Pending session' })] })
    mockUseRestoreSessionState.mockReturnValue({ isPending: true })
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))
    await user.click(screen.getByText(/SESSIONS \(1\)/))
    expect(screen.getByRole('button', { name: /restore session: pending session/i })).toBeDisabled()
  })
})

describe('SidePanel — starred-first ordering and isLocked gating', () => {
  it('renders starred saved groups before unstarred ones, after Now Open', () => {
    const nowOpen = makeGroup({ permanent: true, name: 'Now Open' })
    const unstarred = makeGroup({ name: 'Unstarred', starred: false })
    const starred = makeGroup({ name: 'Starred', starred: true })
    const groupsState = makeGroupsState([nowOpen, unstarred, starred])
    wrap(React.createElement(SidePanel, { groupsState }))

    const items = screen.getAllByTestId('group-item')
    expect(items.map((el) => el.textContent)).toEqual(['Now Open', 'Starred', 'Unstarred'])
  })

  it('marks groups beyond the free limit as locked, but never the permanent group', () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 1, tier: 'free', aiFeatures: false })
    const nowOpen = makeGroup({ permanent: true, name: 'Now Open' })
    const saved1 = makeGroup({ name: 'First' })
    const saved2 = makeGroup({ name: 'Second' })
    const groupsState = makeGroupsState([nowOpen, saved1, saved2])
    wrap(React.createElement(SidePanel, { groupsState }))

    const items = screen.getAllByTestId('group-item')
    expect(items[0].dataset.locked).toBe('false') // Now Open
    expect(items[1].dataset.locked).toBe('false') // within limit (index 0 < maxGroups 1)
    expect(items[2].dataset.locked).toBe('true') // over limit (index 1 >= maxGroups 1)
  })

  it('does not mark any group as locked when maxGroups is Infinity (pro tier)', () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: Infinity, tier: 'pro', aiFeatures: false })
    const groupsState = makeGroupsState([
      makeGroup({ permanent: true, name: 'Now Open' }),
      makeGroup({ name: 'Saved' }),
    ])
    wrap(React.createElement(SidePanel, { groupsState }))
    const items = screen.getAllByTestId('group-item')
    expect(items.every((el) => el.dataset.locked === 'false')).toBe(true)
  })
})

describe('SidePanel — selectionMode guards', () => {
  it('disables the Add Group button and ignores group-item clicks while in selection mode', async () => {
    useUIStore.setState({ selectionMode: true })
    const groupsState = makeGroupsState([makeGroup({ permanent: true, name: 'Now Open' })])
    wrap(React.createElement(SidePanel, { groupsState }))

    expect(screen.getByRole('button', { name: /add group/i })).toBeDisabled()

    fireEvent.click(screen.getByTestId('group-item'))
    expect(mockSetActiveGroupIndex).not.toHaveBeenCalled()
  })

  it('sets active group index on click when not in selection mode', () => {
    const groupsState = makeGroupsState([makeGroup({ permanent: true, name: 'Now Open' })])
    wrap(React.createElement(SidePanel, { groupsState }))
    fireEvent.click(screen.getByTestId('group-item'))
    expect(mockSetActiveGroupIndex).toHaveBeenCalledWith(0)
  })
})

describe('SidePanel — section rows open read-only views; the sections are an accordion', () => {
  it('expanding one section collapses the other; the open one collapses on a second click', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))
    const archived = screen.getByRole('button', { name: /ARCHIVED \(0\)/ })
    const sessions = screen.getByRole('button', { name: /SESSIONS \(0\)/ })
    await user.click(archived)
    expect(archived).toHaveAttribute('aria-expanded', 'true')
    await user.click(sessions)
    expect(sessions).toHaveAttribute('aria-expanded', 'true')
    expect(archived).toHaveAttribute('aria-expanded', 'false')
    await user.click(sessions)
    expect(sessions).toHaveAttribute('aria-expanded', 'false')
  })

  it('an archived row opens its view and is the current row (semibold); Restore and Delete stay siblings', async () => {
    const archivedGroup = makeGroup({ id: 'arch', name: 'Old Project', archived: true })
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ id: 'now', permanent: true }), archivedGroup]) }))
    await user.click(screen.getByText(/ARCHIVED \(1\)/))
    const open = screen.getByRole('button', { name: 'Show archived group Old Project' })
    expect(open).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('group-item')).toHaveAttribute('data-active', 'true')
    await user.click(open)
    // one current row: the group behind the view is not marked while the view shows
    expect(screen.getByTestId('group-item')).toHaveAttribute('data-active', 'false')
    expect(useUIStore.getState()).toMatchObject({ mainView: { kind: 'archived', groupId: 'arch' }, mainViewReturnGroupId: 'now' })
    expect(open).toHaveAttribute('aria-current', 'page')
    expect(within(open).getByText('Old Project')).toHaveClass('font-semibold')
    expect(open.querySelector('button')).toBeNull()
    expect(open.parentElement).toContainElement(screen.getByRole('button', { name: /restore old project/i }))
  })

  it('a session row opens its view; nothing opens while selecting', async () => {
    const session = makeSession({ id: 's1', name: 'Morning setup' })
    mockUseSessionsData.mockReturnValue({ data: [session] })
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))
    await user.click(screen.getByText(/SESSIONS \(1\)/))
    useUIStore.setState({ selectionMode: true })
    await user.click(screen.getByRole('button', { name: 'Show session Morning setup' }))
    expect(useUIStore.getState().mainView).toEqual({ kind: 'group' })
    useUIStore.setState({ selectionMode: false })
    await user.click(screen.getByRole('button', { name: 'Show session Morning setup' }))
    expect(useUIStore.getState().mainView).toEqual({ kind: 'session', sessionId: 's1' })
    expect(screen.getByRole('button', { name: 'Show session Morning setup' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('SidePanel — section rows: feedback, focus, selection mode, contrast', () => {
  /** Renders the panel and returns a rerender with new groups (same wrappers). */
  function renderPanel(groupsState: GroupsState) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const ui = (gs: GroupsState) =>
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, React.createElement(SidePanel, { groupsState: gs })))
    const utils = render(ui(groupsState))
    return { ...utils, rerenderWith: (gs: GroupsState) => utils.rerender(ui(gs)) }
  }
  const nowOpen = () => makeGroup({ id: 'now', permanent: true, name: 'Now Open' })

  it('Restore on an archived row says "Restored" and moves focus to the next row, then the toggle', async () => {
    const a = makeGroup({ id: 'a', name: 'Alpha', archived: true })
    const b = makeGroup({ id: 'b', name: 'Beta', archived: true })
    const now = nowOpen()
    const user = userEvent.setup()
    const { rerenderWith } = renderPanel(makeGroupsState([now, a, b]))
    await user.click(screen.getByText(/ARCHIVED \(2\)/))
    await user.click(screen.getByRole('button', { name: 'Restore Alpha' }))
    act(() => mockRestoreGroup.mock.calls[0][1].onSuccess())
    expect(getSectionViewStatus()).toBe('Restored Alpha')
    rerenderWith(makeGroupsState([now, { ...a, archived: false }, b]))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show archived group Beta' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Delete Beta' }))
    act(() => mockDeleteGroup.mock.calls[0][1].onSuccess())
    expect(getSectionViewStatus()).toBe('Deleted Beta')
    rerenderWith(makeGroupsState([now, { ...a, archived: false }]))
    await waitFor(() => expect(screen.getByRole('button', { name: /^ARCHIVED \(0\)/ })).toHaveFocus())
    act(() => clearSectionViewStatus())
  })

  it('a failed Restore leaves focus alone', async () => {
    const a = makeGroup({ id: 'a', name: 'Alpha', archived: true })
    const user = userEvent.setup()
    const { rerenderWith } = renderPanel(makeGroupsState([nowOpen(), a]))
    await user.click(screen.getByText(/ARCHIVED \(1\)/))
    const restore = screen.getByRole('button', { name: 'Restore Alpha' })
    await user.click(restore)
    act(() => mockRestoreGroup.mock.calls[0][1].onError())
    rerenderWith(makeGroupsState([nowOpen(), a]))
    expect(restore).toHaveFocus()
  })

  it('Delete on a session row says "Deleted" and moves focus to the previous row when it was the last', async () => {
    const s1 = makeSession({ id: 's1', name: 'First' })
    const s2 = makeSession({ id: 's2', name: 'Second' })
    mockUseSessionsData.mockReturnValue({ data: [s1, s2] })
    const user = userEvent.setup()
    const { rerenderWith } = renderPanel(makeGroupsState([nowOpen()]))
    await user.click(screen.getByText(/SESSIONS \(2\)/))
    await user.click(screen.getByRole('button', { name: 'Delete session Second' }))
    act(() => mockDeleteSession.mock.calls[0][1].onSuccess())
    expect(getSectionViewStatus()).toBe('Deleted Second')
    mockUseSessionsData.mockReturnValue({ data: [s1] })
    rerenderWith(makeGroupsState([nowOpen()]))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show session First' })).toHaveFocus())
    act(() => clearSectionViewStatus())
  })

  it('in selection mode the rows say they are unavailable (aria-disabled)', async () => {
    mockUseSessionsData.mockReturnValue({ data: [makeSession({ id: 's1', name: 'First' })] })
    const user = userEvent.setup()
    renderPanel(makeGroupsState([nowOpen(), makeGroup({ id: 'a', name: 'Alpha', archived: true })]))
    await user.click(screen.getByText(/ARCHIVED \(1\)/))
    expect(screen.getByRole('button', { name: 'Show archived group Alpha' })).not.toHaveAttribute('aria-disabled')
    act(() => useUIStore.setState({ selectionMode: true }))
    expect(screen.getByRole('button', { name: 'Show archived group Alpha' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByText(/SESSIONS \(1\)/))
    expect(screen.getByRole('button', { name: 'Show session First' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('session rows use the readable 10px muted detail text; Restore icons mirror right-to-left', async () => {
    mockUseSessionsData.mockReturnValue({ data: [makeSession({ id: 's1', name: 'First', description: 'Notes' })] })
    const user = userEvent.setup()
    renderPanel(makeGroupsState([nowOpen()]))
    await user.click(screen.getByText(/SESSIONS \(1\)/))
    const row = screen.getByRole('button', { name: 'Show session First' })
    expect(within(row).getByText('Notes')).toHaveClass('text-[0.625rem]', 'text-muted-foreground')
    expect(row.querySelector('[class*="text-[9px]"], [class*="text-muted-foreground/"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Restore session: First' }).querySelector('svg')).toHaveClass('rtl:-scale-x-100')
  })

  it('the current section row has the current background (not the hover one) and darker detail text', async () => {
    const user = userEvent.setup()
    renderPanel(makeGroupsState([nowOpen(), makeGroup({ id: 'a', name: 'Alpha', archived: true })]))
    await user.click(screen.getByText(/ARCHIVED \(1\)/))
    const open = screen.getByRole('button', { name: 'Show archived group Alpha' })
    await user.click(open)
    expect(open.closest('li')).toHaveClass('bg-[var(--sidebar-current-bg)]')
    expect(open.closest('li')).not.toHaveClass('hover:bg-[var(--sidebar-hover-bg)]')
    expect(open.querySelector('[id^="archived-detail-"]')).toHaveClass('text-[var(--sidebar-text-inactive)]')
  })
})
