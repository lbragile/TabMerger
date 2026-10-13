import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GroupItem } from '@/components/SidePanel/GroupItem'
import type { Group } from '@/lib/types'
import { DEFAULT_GROUP_TITLE } from '@/lib/types'
import { TOUR_READY_ATTR } from '@/lib/tourSteps'

/** Tour v2 anchors on a group row: the name field, "Save" (ready marker), colour dot, star. */
const { mockUseUIStore } = vi.hoisted(() => ({ mockUseUIStore: vi.fn() }))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }) }))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))
vi.mock('@/components/SidePanel/GroupContextMenu', () => ({
  GroupContextMenu: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}))
vi.mock('@/hooks/useGroups', () => ({
  useUpdateGroupName: () => ({ mutate: vi.fn() }),
  useUpdateGroupColor: () => ({ mutate: vi.fn() }),
  useToggleGroupStar: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: { available: [], active: { id: '', index: 0 } } }),
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: object) => unknown) => mockUseUIStore(selector), { getState: () => ({}) }),
}))

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

const group = (over: Partial<Group> = {}): Group => ({
  id: 'g1',
  name: 'Group',
  color: 'rgba(59,130,246,1)',
  updatedAt: 0,
  windows: [],
  permanent: false,
  starred: false,
  ...over,
})
const ui = (over: Record<string, unknown> = {}) => ({
  renameTarget: null,
  setRenameTarget: vi.fn(),
  selectionMode: false,
  selectedItems: [],
  toggleSelection: vi.fn(),
  enterSelectionMode: vi.fn(),
  selectRange: vi.fn(),
  selectionAnchor: null,
  previewGroupColor: null,
  setPreviewGroupColor: vi.fn(),
  ...over,
})
function renderItem(g: Group, state: Record<string, unknown> = {}) {
  mockUseUIStore.mockImplementation((selector: (s: object) => unknown) => selector(ui(state)))
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <GroupItem group={g} groupIndex={1} isActive={false} onClick={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
const renaming = { renameTarget: { kind: 'group', groupIndex: 1 } }
const save = () => screen.getByRole('button', { name: 'Save' })

beforeEach(() => vi.clearAllMocks())

describe('GroupItem tour anchors: renaming', () => {
  it('labels the name field "Group name" and anchors it', () => {
    renderItem(group({ name: 'Work' }), renaming)
    const input = screen.getByRole('textbox', { name: 'Group name' })
    expect(input).toHaveAttribute('data-tour', 'group-name-input')
    expect(input.closest('[data-tour="group-name"]')).not.toBeNull()
  })

  it('anchors Save', () => {
    renderItem(group({ name: 'Work' }), renaming)
    expect(save()).toHaveAttribute('data-tour', 'group-name-save')
  })

  it('does not mark Save ready while the field still holds the placeholder name', () => {
    renderItem(group({ name: DEFAULT_GROUP_TITLE }), renaming)
    expect(save()).not.toHaveAttribute(TOUR_READY_ATTR)
  })

  it('marks Save ready once a name of the user\'s own is typed', () => {
    renderItem(group({ name: DEFAULT_GROUP_TITLE }), renaming)
    fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), { target: { value: 'Practice' } })
    expect(save()).toHaveAttribute(TOUR_READY_ATTR)
  })

  it('drops the marker again when the field is emptied, blank, or typed back to the placeholder', () => {
    renderItem(group({ name: DEFAULT_GROUP_TITLE }), renaming)
    const input = screen.getByRole('textbox', { name: 'Group name' })
    fireEvent.change(input, { target: { value: 'Practice' } })
    expect(save()).toHaveAttribute(TOUR_READY_ATTR)
    for (const value of ['', '   ', DEFAULT_GROUP_TITLE, `  ${DEFAULT_GROUP_TITLE}  `]) {
      fireEvent.change(input, { target: { value } })
      expect(save(), JSON.stringify(value)).not.toHaveAttribute(TOUR_READY_ATTR)
    }
  })

  it('an existing group renamed to another name is ready straight away', () => {
    renderItem(group({ name: 'Work' }), renaming)
    expect(save()).toHaveAttribute(TOUR_READY_ATTR)
  })
})

describe('GroupItem tour anchors: row controls', () => {
  it('carries the colour dot and the pin star anchors, and no name field outside renaming', () => {
    renderItem(group())
    expect(screen.getByRole('button', { name: 'Change group color' })).toHaveAttribute('data-tour', 'group-color')
    expect(screen.getByRole('button', { name: 'Pin group' })).toHaveAttribute('data-tour', 'group-pin')
    expect(screen.queryByRole('textbox', { name: 'Group name' })).toBeNull()
    expect(document.querySelector('[data-tour="group-name-save"]')).toBeNull()
  })

  it('the star keeps its anchor when the group is pinned (named Unpin group)', () => {
    renderItem(group({ starred: true }))
    expect(screen.getByRole('button', { name: 'Unpin group' })).toHaveAttribute('data-tour', 'group-pin')
  })

  it('the Now Open group has no star to point at', () => {
    renderItem(group({ permanent: true, name: 'Now Open' }))
    expect(document.querySelector('[data-tour="group-pin"]')).toBeNull()
  })
})
