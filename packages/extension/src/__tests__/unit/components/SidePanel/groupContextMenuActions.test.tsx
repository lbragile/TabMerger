/**
 * Coverage pass: GroupContextMenu items not already exercised by confirmOnDelete.test.tsx
 * (rename, note, url rules, duplicate + free-tier limit, replace/merge with current,
 * open all in new window, unite/split windows, sort by title/url, archive/restore).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GroupContextMenu } from '@/components/SidePanel/GroupContextMenu'
import type { Group } from '@/lib/types'

const {
  mockDeleteGroup,
  mockDuplicateGroup,
  mockReplaceWithCurrent,
  mockMergeWithCurrent,
  mockUniteWindows,
  mockSplitWindows,
  mockSortTabs,
  mockArchiveGroup,
  mockRestoreGroup,
  mockOpenModal,
  mockSetRenameTarget,
  mockToastError,
  mockGetSetting,
  mockUseGroupsData,
  mockTrackEvent,
} = vi.hoisted(() => ({
  mockDeleteGroup: vi.fn(),
  mockDuplicateGroup: vi.fn(),
  mockReplaceWithCurrent: vi.fn(),
  mockMergeWithCurrent: vi.fn(),
  mockUniteWindows: vi.fn(),
  mockSplitWindows: vi.fn(),
  mockSortTabs: vi.fn(),
  mockArchiveGroup: vi.fn(),
  mockRestoreGroup: vi.fn(),
  mockOpenModal: vi.fn(),
  mockSetRenameTarget: vi.fn(),
  mockToastError: vi.fn(),
  mockGetSetting: vi.fn().mockResolvedValue({ confirmOnDelete: false }),
  mockUseGroupsData: vi.fn(() => ({ available: [{}, {}, {}] })),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteGroup: () => ({ mutate: mockDeleteGroup }),
  useDuplicateGroup: () => ({ mutate: mockDuplicateGroup }),
  useReplaceWithCurrent: () => ({ mutate: mockReplaceWithCurrent }),
  useMergeWithCurrent: () => ({ mutate: mockMergeWithCurrent }),
  useUniteWindows: () => ({ mutate: mockUniteWindows }),
  useSplitWindows: () => ({ mutate: mockSplitWindows }),
  useSortTabs: () => ({ mutate: mockSortTabs }),
  useArchiveGroup: () => ({ mutate: mockArchiveGroup }),
  useRestoreGroup: () => ({ mutate: mockRestoreGroup }),
  useGroups: () => ({ data: mockUseGroupsData() }),
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: 2 }) }))

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({ openModal: mockOpenModal, setRenameTarget: mockSetRenameTarget }),
}))

vi.mock('sonner', () => ({ toast: { error: mockToastError, success: vi.fn() } }))

globalThis.chrome = {
  tabs: { create: vi.fn() },
  windows: { create: vi.fn() },
} as unknown as typeof chrome

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Test Group',
    color: 'rgba(59,130,246,1)',
    updatedAt: Date.now(),
    windows: [],
    permanent: false,
    ...overrides,
  }
}

function renderGroup(group: Group, groupIndex = 1) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null,
        React.createElement(GroupContextMenu, {
          group,
          groupIndex,
          open: true,
          onOpenChange: vi.fn(),
          children: React.createElement('div', null, 'trigger'),
        })
      )
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
  mockUseGroupsData.mockReturnValue({ available: [{}, {}, {}] })
})

describe('GroupContextMenu — item actions', () => {
  it('sets the rename target for non-permanent groups', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Rename'))
    expect(mockSetRenameTarget).toHaveBeenCalledWith({ kind: 'group', groupIndex: 1 })
  })

  it('does not show Rename for the permanent group', () => {
    renderGroup(makeGroup({ permanent: true }))
    expect(screen.queryByText('Rename')).toBeNull()
  })

  it('opens the note modal, showing "Add note" when no note exists', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Add note'))
    expect(mockOpenModal).toHaveBeenCalledWith('note', { groupIndex: 1, groupId: 'g1' })
  })

  it('shows "Edit note" when a note already exists', () => {
    renderGroup(makeGroup({ note: 'existing note' }))
    expect(screen.getByText('Edit note')).toBeTruthy()
  })

  it('opens URL rules modal', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Manage URL rules'))
    expect(mockOpenModal).toHaveBeenCalledWith('urlRules')
  })

  it('duplicates the group when under the free-tier group limit', async () => {
    mockUseGroupsData.mockReturnValue({ available: [{}, {}] }) // 2 groups - 1 = 1 < maxGroups(2)
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Duplicate'))
    expect(mockDuplicateGroup).toHaveBeenCalledWith(1)
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockTrackEvent).not.toHaveBeenCalledWith('entitlement_limit_hit', expect.anything())
  })

  it('shows an upgrade toast instead of duplicating when at the free-tier group limit', async () => {
    mockUseGroupsData.mockReturnValue({ available: [{}, {}, {}] }) // 3 groups - 1 = 2 >= maxGroups(2)
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Duplicate'))
    expect(mockDuplicateGroup).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 2 groups.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Upgrade' }) })
    )
    expect(mockTrackEvent).toHaveBeenCalledWith('entitlement_limit_hit', { limit: 'maxGroups' })
  })

  it('replaces and merges with current for non-permanent groups', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Replace with current'))
    expect(mockReplaceWithCurrent).toHaveBeenCalledWith(1)
    await user.click(screen.getByText('Merge with current'))
    expect(mockMergeWithCurrent).toHaveBeenCalledWith(1)
  })

  it('does not show replace/merge for the permanent group', () => {
    renderGroup(makeGroup({ permanent: true }))
    expect(screen.queryByText('Replace with current')).toBeNull()
    expect(screen.queryByText('Merge with current')).toBeNull()
  })

  it('opens all http(s) tabs in a new window and disables the item when there are none', async () => {
    const withTabs = makeGroup({
      windows: [{ id: 1, tabs: [{ id: 1, title: 'A', url: 'https://a.com' }, { id: 2, title: 'B', url: 'chrome://settings' }], starred: false, incognito: false, focused: false }],
    })
    const user = userEvent.setup()
    renderGroup(withTabs)
    await user.click(screen.getByText('Open all in new window'))
    expect(chrome.windows.create).toHaveBeenCalledWith({ url: ['https://a.com'] })
    expect(mockTrackEvent).toHaveBeenCalledWith('session_restored', { source: 'open_all' })
  })

  it('disables "Open all in new window" when the group has no http(s) tabs', () => {
    renderGroup(makeGroup({ windows: [] }))
    const item = screen.getByText('Open all in new window').closest('[role="menuitem"]') as HTMLElement
    expect(item.getAttribute('aria-disabled')).toBe('true')
  })

  it('unites windows, splits windows, and sorts by title/url', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Unite windows'))
    expect(mockUniteWindows).toHaveBeenCalledWith(1)
    await user.click(screen.getByText('Split windows'))
    expect(mockSplitWindows).toHaveBeenCalledWith(1)
    await user.click(screen.getByText('Sort by title'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 1, by: 'title' })
    await user.click(screen.getByText('Sort by URL'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 1, by: 'url' })
  })

  it('archives a non-archived group', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup({ archived: false }))
    await user.click(screen.getByText('Archive group'))
    expect(mockArchiveGroup).toHaveBeenCalledWith(1)
  })

  it('restores an archived group', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup({ archived: true }))
    await user.click(screen.getByText('Restore group'))
    expect(mockRestoreGroup).toHaveBeenCalledWith(1)
  })
})
