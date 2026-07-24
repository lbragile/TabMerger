import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GroupContextMenu } from '@/components/SidePanel/GroupContextMenu'
import type { Group } from '@/lib/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.hoisted ensures these are available when vi.mock factories are evaluated
const { mockDuplicateGroupMutate, mockUseGroups, mockUseEntitlements, mockToastError } = vi.hoisted(() => ({
  mockDuplicateGroupMutate: vi.fn(),
  mockUseGroups: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteGroup: () => ({ mutate: vi.fn() }),
  useDuplicateGroup: () => ({ mutate: mockDuplicateGroupMutate }),
  useUpdateGroupColor: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useArchiveGroup: () => ({ mutate: vi.fn() }),
  useRestoreGroup: () => ({ mutate: vi.fn() }),
  useGroups: () => mockUseGroups(),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({ openModal: vi.fn(), setRenameTarget: vi.fn() }),
}))

vi.mock('@/components/ColorPicker', () => ({
  ColorPicker: () => React.createElement('div', { 'data-testid': 'color-picker' }),
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => mockUseEntitlements(),
}))

vi.mock('sonner', () => ({
  toast: { error: mockToastError },
}))

// ─── Chrome stub ──────────────────────────────────────────────────────────────

globalThis.chrome = {
  tabs: { create: vi.fn() },
} as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function renderContextMenu(group: Group, open = true) {
  const qc = new QueryClient()
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null,
        React.createElement(GroupContextMenu, {
          group,
          groupIndex: 1,
          open,
          onOpenChange: vi.fn(),
          children: React.createElement('div', null, 'trigger'),
        })
      )
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: 3 groups, limit 5 — safely under limit
  mockUseGroups.mockReturnValue({
    data: { available: new Array(3).fill({}), active: { id: '', index: 0 } },
  })
  mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free' })
})

// ─── Tests — item descriptions ────────────────────────────────────────────────

describe('GroupContextMenu — item descriptions', () => {
  it('shows a description for every menu item', () => {
    renderContextMenu(makeGroup())

    const descriptions: [string, string][] = [
      ['Rename', 'Set a new name for this group'],
      // ponytail: color picker moved out of the context menu onto the sidebar
      // swatch button (ColorPicker popover) — no longer a menu item here.
      ['Add note', 'Attach a note to this group'],
      ['Duplicate', 'Copy this group with all its tabs'],
      ['Replace with current', 'Swap all windows with your open browser session'],
      ['Merge with current', 'Add your open browser windows to this group'],
      ['Unite windows', 'Combine all windows into one'],
      ['Split windows', 'Move each tab into its own window'],
      ['Sort by title', 'Alphabetically sort all tabs by name'],
      ['Sort by URL', 'Alphabetically sort all tabs by address'],
      ['Delete group', 'Permanently remove this group and its tabs'],
    ]

    for (const [label, description] of descriptions) {
      expect(screen.getByText(label), `label "${label}" not found`).toBeTruthy()
      expect(screen.getByText(description), `description for "${label}" not found`).toBeTruthy()
    }
  })

  it('does not show Delete group for permanent groups', () => {
    renderContextMenu(makeGroup({ permanent: true }))
    expect(screen.queryByText('Delete group')).toBeNull()
  })

  it('Delete group item has text-destructive at rest', () => {
    renderContextMenu(makeGroup())
    const item = screen.getByText('Delete group').closest('[role="menuitem"]') as HTMLElement
    expect(item).toBeTruthy()
    expect(item.className).toMatch(/text-destructive/)
  })

  it('Delete group item has data-[highlighted] classes so hover/focus stays red', () => {
    renderContextMenu(makeGroup())
    const item = screen.getByText('Delete group').closest('[role="menuitem"]') as HTMLElement
    expect(item.className).toMatch(/data-\[highlighted\]:bg-destructive/)
    expect(item.className).toMatch(/data-\[highlighted\]:text-destructive/)
  })
})

// ─── Tests — duplicate free-tier guard ────────────────────────────────────────

describe('GroupContextMenu — duplicate free-tier guard', () => {
  it('calls duplicateGroup when under the group limit', () => {
    // 3 groups, limit 5 → allowed
    mockUseGroups.mockReturnValue({
      data: { available: new Array(3).fill({}), active: { id: '', index: 0 } },
    })
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free' })

    renderContextMenu(makeGroup())
    fireEvent.click(screen.getByText('Duplicate'))

    expect(mockDuplicateGroupMutate).toHaveBeenCalledWith(1)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('shows toast.error and does NOT call duplicateGroup when at the group limit (Now Open excluded)', () => {
    // 6 total (1 Now Open + 5 saved), limit 5 → blocked: 6-1=5 >= 5
    mockUseGroups.mockReturnValue({
      data: { available: new Array(6).fill({}), active: { id: '', index: 0 } },
    })
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free' })

    renderContextMenu(makeGroup())
    fireEvent.click(screen.getByText('Duplicate'))

    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 5 groups.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Upgrade' }) })
    )
    expect(mockDuplicateGroupMutate).not.toHaveBeenCalled()
  })

  it('allows duplicate with 5 total groups (4 saved + Now Open), limit 5', () => {
    // 5-1=4 < 5 → allowed
    mockUseGroups.mockReturnValue({
      data: { available: new Array(5).fill({}), active: { id: '', index: 0 } },
    })
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free' })

    renderContextMenu(makeGroup())
    fireEvent.click(screen.getByText('Duplicate'))

    expect(mockDuplicateGroupMutate).toHaveBeenCalledWith(1)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('shows toast.error when exceeding the group limit', () => {
    // 7 total (6 saved + Now Open), limit 5 → blocked: 7-1=6 >= 5
    mockUseGroups.mockReturnValue({
      data: { available: new Array(7).fill({}), active: { id: '', index: 0 } },
    })
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free' })

    renderContextMenu(makeGroup())
    fireEvent.click(screen.getByText('Duplicate'))

    expect(mockToastError).toHaveBeenCalled()
    expect(mockDuplicateGroupMutate).not.toHaveBeenCalled()
  })

  it('treats missing groupsState data as zero groups (allows duplicate)', () => {
    mockUseGroups.mockReturnValue({ data: null })
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free' })

    renderContextMenu(makeGroup())
    fireEvent.click(screen.getByText('Duplicate'))

    // 0 < 5 → allowed
    expect(mockDuplicateGroupMutate).toHaveBeenCalledWith(1)
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
