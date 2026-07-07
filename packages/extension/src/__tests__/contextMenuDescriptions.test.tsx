import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GroupContextMenu } from '@/components/SidePanel/GroupContextMenu'
import type { Group } from '@/lib/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteGroup: () => ({ mutate: vi.fn() }),
  useDuplicateGroup: () => ({ mutate: vi.fn() }),
  useUpdateGroupColor: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({ openModal: vi.fn(), setRenameTarget: vi.fn() }),
}))

vi.mock('@/components/ColorPicker', () => ({
  ColorPicker: () => React.createElement('div', { 'data-testid': 'color-picker' }),
}))

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
        },
          React.createElement('div', null, 'trigger')
        )
      )
    )
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GroupContextMenu — item descriptions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows a description for every menu item', () => {
    renderContextMenu(makeGroup())

    const descriptions: [string, string][] = [
      ['Rename', 'Set a new name for this group'],
      ['Change color', 'Pick a color for this group label'],
      ['Add/edit note', 'Attach a note to this group'],
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
