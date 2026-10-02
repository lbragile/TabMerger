/**
 * Coverage pass: GroupContextMenu items not already exercised by confirmOnDelete.test.tsx
 * (rename, note, url rules, duplicate + free-tier limit, replace/merge with current,
 * open all in new window, unite/split windows, sort by title/url, archive/restore).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GroupContextMenu } from '@/components/SidePanel/GroupContextMenu'
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore'
import type { Group } from '@/lib/types'

const {
  mockDeleteGroup,
  mockDuplicateGroup,
  mockReplaceWithCurrent,
  mockMergeWithCurrent,
  mockUniteWindows,
  mockSplitWindows,
  mockSortTabs,
  mockDeleteAllWindows,
  mockArchiveGroup,
  mockRestoreGroup,
  mockUpdateGroupName,
  mockOpenModal,
  mockSetRenameTarget,
  mockSetActiveGroupIndex,
  mockSetPendingNoteGroupIndex,
  mockToastError,
  mockToastInfo,
  mockGetSetting,
  mockUseGroupsData,
  mockTrackEvent,
  mockUseEntitlements,
  mockUseAppSettings,
  mockNameGroup,
  mockToggleSelection,
  mockEnterSelectionMode,
} = vi.hoisted(() => ({
  mockDeleteGroup: vi.fn(),
  mockDuplicateGroup: vi.fn(),
  mockReplaceWithCurrent: vi.fn(),
  mockMergeWithCurrent: vi.fn(),
  mockUniteWindows: vi.fn(),
  mockSplitWindows: vi.fn(),
  mockSortTabs: vi.fn(),
  mockDeleteAllWindows: vi.fn(),
  mockArchiveGroup: vi.fn(),
  mockRestoreGroup: vi.fn(),
  mockUpdateGroupName: vi.fn(),
  mockOpenModal: vi.fn(),
  mockSetRenameTarget: vi.fn(),
  mockSetActiveGroupIndex: vi.fn(),
  mockSetPendingNoteGroupIndex: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockGetSetting: vi.fn().mockResolvedValue({ confirmOnDelete: false }),
  mockUseGroupsData: vi.fn(() => ({ available: [{}, {}, {}] })),
  mockTrackEvent: vi.fn(),
  mockUseEntitlements: vi.fn(() => ({ maxGroups: 2, aiFeatures: false })),
  mockUseAppSettings: vi.fn(() => ({ data: { aiNameGroupEnabled: true } })),
  mockNameGroup: vi.fn(),
  mockToggleSelection: vi.fn(),
  mockEnterSelectionMode: vi.fn(),
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
  useDeleteAllWindows: () => ({ mutate: mockDeleteAllWindows }),
  useArchiveGroup: () => ({ mutate: mockArchiveGroup }),
  useRestoreGroup: () => ({ mutate: mockRestoreGroup }),
  useUpdateGroupName: () => ({ mutate: mockUpdateGroupName }),
  useGroups: () => ({ data: mockUseGroupsData() }),
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))

vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => mockUseAppSettings() }))

const { QuotaExceededError } = vi.hoisted(() => ({
  QuotaExceededError: class QuotaExceededError extends Error {},
}))
vi.mock('@/hooks/useAI', () => ({
  useNameGroup: () => ({ mutateAsync: mockNameGroup }),
  QuotaExceededError,
}))

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (s: object) => unknown) =>
      selector({
        openModal: mockOpenModal,
        setRenameTarget: mockSetRenameTarget,
        setActiveGroupIndex: mockSetActiveGroupIndex,
        setPendingNoteGroupIndex: mockSetPendingNoteGroupIndex,
      }),
    // `getState` is what `toggleSelectionOnCtrlSpace` (keyboard Ctrl+Space) reads.
    { getState: () => ({ selectedItems: [], toggleSelection: mockToggleSelection, enterSelectionMode: mockEnterSelectionMode }) }
  ),
}))

vi.mock('@/lib/toast', () => ({ toast: { error: mockToastError, success: vi.fn(), info: mockToastInfo } }))

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
  mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: false })
  mockUseAppSettings.mockReturnValue({ data: { aiNameGroupEnabled: true } })
})

describe('GroupContextMenu — AI rename', () => {
  const groupWithTabs = () =>
    makeGroup({
      windows: [{ id: 1, tabs: [{ id: 1, title: 'A', url: 'https://a.com' }], starred: false, incognito: false, focused: false }],
    })

  it('hides "AI rename" when aiFeatures is off', () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: false })
    renderGroup(groupWithTabs())
    expect(screen.queryByText('AI rename')).toBeNull()
  })

  it('hides "AI rename" when aiNameGroupEnabled is explicitly false', () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: true })
    mockUseAppSettings.mockReturnValue({ data: { aiNameGroupEnabled: false } })
    renderGroup(groupWithTabs())
    expect(screen.queryByText('AI rename')).toBeNull()
  })

  it('hides "AI rename" for the permanent group even with aiFeatures on', () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: true })
    renderGroup(makeGroup({ ...groupWithTabs(), permanent: true }))
    expect(screen.queryByText('AI rename')).toBeNull()
  })

  it('shows "AI rename" when aiFeatures on, setting enabled, and group not permanent', () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: true })
    renderGroup(groupWithTabs())
    expect(screen.getByText('AI rename')).toBeTruthy()
  })

  it('calls nameGroup then updateGroupName with the returned name', async () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: true })
    mockNameGroup.mockResolvedValue({ name: 'Suggested Name' })
    const user = userEvent.setup()
    renderGroup(groupWithTabs())
    await user.click(screen.getByText('AI rename'))
    expect(mockNameGroup).toHaveBeenCalledWith([{ id: 1, title: 'A', url: 'https://a.com' }])
    expect(mockUpdateGroupName).toHaveBeenCalledWith({ groupIndex: 1, name: 'Suggested Name' })
  })

  it('shows a quota toast (not a generic error) on QuotaExceededError', async () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: true })
    mockNameGroup.mockRejectedValue(new QuotaExceededError('quota'))
    const user = userEvent.setup()
    renderGroup(groupWithTabs())
    await user.click(screen.getByText('AI rename'))
    await vi.waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockToastError).toHaveBeenCalledWith(
      "You've used all your AI credits for this month.",
      expect.objectContaining({ action: expect.objectContaining({ label: 'Buy more' }) })
    )
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })

  it('shows a generic error toast on other errors', async () => {
    mockUseEntitlements.mockReturnValue({ maxGroups: 2, aiFeatures: true })
    mockNameGroup.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    renderGroup(groupWithTabs())
    await user.click(screen.getByText('AI rename'))
    await vi.waitFor(() => expect(mockToastError).toHaveBeenCalledWith('boom'))
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })
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

  it('selects the group and stashes the pending note target, showing "Add note" when no note exists', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Add note'))
    expect(mockSetActiveGroupIndex).toHaveBeenCalledWith(1)
    expect(mockSetPendingNoteGroupIndex).toHaveBeenCalledWith(1)
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('shows "Edit note" when a note already exists', () => {
    renderGroup(makeGroup({ note: 'existing note' }))
    expect(screen.getByText('Edit note')).toBeTruthy()
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

  it('opens the deduplicate-confirm modal when duplicates exist', async () => {
    const user = userEvent.setup()
    const withDupes = makeGroup({
      windows: [{
        id: 1,
        starred: false,
        incognito: false,
        focused: false,
        tabs: [
          { id: 1, title: 'A', url: 'https://a.com' },
          { id: 2, title: 'A dup', url: 'https://a.com' },
        ],
      }],
    })
    renderGroup(withDupes)
    await user.click(screen.getByText('Deduplicate tabs'))
    expect(mockOpenModal).toHaveBeenCalledWith('deduplicateGroup', expect.objectContaining({ groupIndex: 1 }))
  })

  it('shows an info toast instead of opening a modal when there are no duplicates', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup({
      windows: [{ id: 1, starred: false, incognito: false, focused: false, tabs: [{ id: 1, title: 'A', url: 'https://a.com' }] }],
    }))
    await user.click(screen.getByText('Deduplicate tabs'))
    expect(mockToastInfo).toHaveBeenCalledWith('No duplicates found')
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('calls deleteAllWindows, labelled "Remove all windows" for a non-permanent group', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup())
    await user.click(screen.getByText('Remove all windows'))
    await waitFor(() => expect(mockDeleteAllWindows).toHaveBeenCalledWith({ groupIndex: 1 }))
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it.each([
    [false, 'Remove all windows'],
    [true, 'Close all windows'],
  ])('confirmOnDelete on (permanent=%s): opens removeAllWindows modal and deletes nothing until onConfirm', async (permanent, label) => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    const user = userEvent.setup()
    renderGroup(makeGroup({ permanent }))
    await user.click(screen.getByText(label))
    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledWith('removeAllWindows', expect.objectContaining({ isNowOpen: permanent })))
    expect(mockDeleteAllWindows).not.toHaveBeenCalled()
    const data = mockOpenModal.mock.calls.find((c) => c[0] === 'removeAllWindows')![1] as { onConfirm: () => void }
    data.onConfirm()
    expect(mockDeleteAllWindows).toHaveBeenCalledWith({ groupIndex: 1 })
  })

  it('labels the same action "Close all windows" for the permanent group', async () => {
    const user = userEvent.setup()
    renderGroup(makeGroup({ permanent: true }))
    expect(screen.queryByText('Remove all windows')).toBeNull()
    await user.click(screen.getByText('Close all windows'))
    await waitFor(() => expect(mockDeleteAllWindows).toHaveBeenCalledWith({ groupIndex: 1 }))
  })
})

describe('GroupContextMenu — row keyboard: Space moves, Ctrl+Space selects, Enter activates', () => {
  function renderRow(props: Record<string, unknown>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const onWrapperClick = vi.fn()
    render(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(TooltipProvider, null,
          React.createElement(GroupContextMenu, {
            group: makeGroup({ name: 'Work' }),
            groupIndex: 1,
            open: false,
            onOpenChange: vi.fn(),
            onWrapperClick,
            children: React.createElement('div', null, 'trigger'),
            ...props,
          })
        )
      )
    )
    return { row: screen.getByRole('button', { name: 'Work' }), onWrapperClick }
  }
  beforeEach(() => useKeyboardMoveStore.setState({ request: null }))

  it('plain Space on a draggable row requests a group move and does not activate it', () => {
    const { row, onWrapperClick } = renderRow({ moveGroupId: 'g1' })
    const ev = fireEvent.keyDown(row, { key: ' ', code: 'Space' })
    expect(ev).toBe(false)
    expect(useKeyboardMoveStore.getState().request).toEqual({ kind: 'group', id: 'g1' })
    expect(onWrapperClick).not.toHaveBeenCalled()
  })

  it('Ctrl+Space toggles the row in the selection, without moving or activating it', () => {
    const { row, onWrapperClick } = renderRow({ moveGroupId: 'g1', selectGroupItem: { type: 'group', id: 'group-1' } })
    fireEvent.keyDown(row, { key: ' ', code: 'Space', ctrlKey: true })
    expect(mockEnterSelectionMode).toHaveBeenCalled()
    expect(mockToggleSelection).toHaveBeenCalledWith({ type: 'group', id: 'group-1' })
    expect(useKeyboardMoveStore.getState().request).toBeNull()
    expect(onWrapperClick).not.toHaveBeenCalled()
  })

  it('Enter activates the row and never starts a move', () => {
    const { row, onWrapperClick } = renderRow({ moveGroupId: 'g1' })
    fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' })
    expect(onWrapperClick).toHaveBeenCalledTimes(1)
    expect(useKeyboardMoveStore.getState().request).toBeNull()
  })

  it('a row with no move id (Now Open) activates on Space', () => {
    const { row, onWrapperClick } = renderRow({})
    fireEvent.keyDown(row, { key: ' ', code: 'Space' })
    expect(onWrapperClick).toHaveBeenCalledTimes(1)
    expect(useKeyboardMoveStore.getState().request).toBeNull()
  })
})
