/**
 * Branch coverage for SidePanel: archived-groups toggle/restore/delete,
 * sessions toggle/restore(confirm)/delete, starred-first sort, isLocked gating,
 * selectionMode guards on add-group and item click.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidePanel } from '@/components/SidePanel'
import type { Group, GroupsState } from '@/lib/types'
import type { Session } from '@tabmerger/shared'

const {
  mockUseEntitlements,
  mockUseUIStore,
  mockRestoreGroup,
  mockDeleteGroup,
  mockRestoreSession,
  mockDeleteSession,
  mockUseSessionsData,
  mockUseRestoreSessionState,
  mockSetActiveGroupIndex,
} = vi.hoisted(() => ({
  mockUseEntitlements: vi.fn(),
  mockUseUIStore: vi.fn(),
  mockRestoreGroup: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockRestoreSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockUseSessionsData: vi.fn((): { data: Session[] } => ({ data: [] })),
  mockUseRestoreSessionState: vi.fn(() => ({ isPending: false })),
  mockSetActiveGroupIndex: vi.fn(),
}))

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
  GroupItem: ({ group, onClick, isLocked }: { group: { name: string }; onClick: () => void; isLocked: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'group-item', 'data-locked': String(isLocked), onClick },
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

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector),
}))

vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => mockUseSessionsData(),
  useDeleteSession: () => ({ mutate: mockDeleteSession }),
  useRestoreSession: () => ({ mutate: mockRestoreSession, ...mockUseRestoreSessionState() }),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome

const baseUIState = {
  selectionMode: false,
  activeGroupIndex: 0,
  setActiveGroupIndex: mockSetActiveGroupIndex,
  setRenameTarget: vi.fn(),
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
  mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
})

describe('SidePanel — archived groups section', () => {
  it('renders nothing when there are no archived groups', () => {
    const groupsState = makeGroupsState([makeGroup({ permanent: true })])
    wrap(React.createElement(SidePanel, { groupsState }))
    expect(screen.queryByText(/ARCHIVED/)).toBeNull()
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
    expect(mockRestoreGroup).toHaveBeenCalledWith(1)

    await user.click(screen.getByRole('button', { name: /delete old project/i }))
    expect(mockDeleteGroup).toHaveBeenCalledWith(1)

    await user.click(screen.getByText(/ARCHIVED \(1\)/))
    expect(screen.queryByText('Old Project')).toBeNull()
  })
})

describe('SidePanel — sessions section', () => {
  it('renders nothing when there are no sessions', () => {
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))
    expect(screen.queryByText(/SESSIONS/)).toBeNull()
  })

  it('toggles sessions open, restores on confirm accept, skips on confirm reject, and deletes', async () => {
    const session = makeSession({ name: 'Morning setup' })
    mockUseSessionsData.mockReturnValue({ data: [session] })
    const confirmSpy = vi.spyOn(window, 'confirm')
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([makeGroup({ permanent: true })]) }))

    await user.click(screen.getByText(/SESSIONS \(1\)/))
    expect(screen.getByText('Morning setup')).toBeTruthy()

    confirmSpy.mockReturnValueOnce(false)
    await user.click(screen.getByRole('button', { name: /restore session: morning setup/i }))
    expect(mockRestoreSession).not.toHaveBeenCalled()

    confirmSpy.mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: /restore session: morning setup/i }))
    expect(mockRestoreSession).toHaveBeenCalledWith(session)

    await user.click(screen.getByRole('button', { name: /delete session morning setup/i }))
    expect(mockDeleteSession).toHaveBeenCalledWith(session.id)
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
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
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
