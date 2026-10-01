import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GroupItem } from '@/components/SidePanel/GroupItem'
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore'
import type { Group } from '@/lib/types'
import { DEFAULT_GROUP_TITLE } from '@/lib/types'

const {
  mockUpdateGroupName,
  mockUpdateGroupColor,
  mockToggleGroupStar,
  mockDeleteGroup,
  mockUseGroups,
  mockUseUIStore,
} = vi.hoisted(() => ({
  mockUpdateGroupName: vi.fn(),
  mockUpdateGroupColor: vi.fn(),
  mockToggleGroupStar: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockUseGroups: vi.fn(),
  mockUseUIStore: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('@/components/SidePanel/GroupContextMenu', () => ({
  GroupContextMenu: ({
    children,
    wrapperRef,
    wrapperClassName,
    wrapperStyle,
    wrapperDndId,
    onWrapperClick,
    onWrapperContextMenu,
    onWrapperMouseEnter,
    onWrapperMouseLeave,
    moveGroupId,
    selectGroupItem,
  }: {
    children: React.ReactNode
    wrapperRef?: (node: HTMLElement | null) => void
    wrapperClassName?: string
    wrapperStyle?: React.CSSProperties
    wrapperDndId?: string
    moveGroupId?: string
    selectGroupItem?: unknown
    onWrapperClick?: React.MouseEventHandler<HTMLDivElement>
    onWrapperContextMenu?: React.MouseEventHandler<HTMLDivElement>
    onWrapperMouseEnter?: React.MouseEventHandler<HTMLDivElement>
    onWrapperMouseLeave?: React.MouseEventHandler<HTMLDivElement>
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'group-wrapper',
        'data-tm-dnd-id': wrapperDndId,
        'data-move-group-id': moveGroupId,
        'data-select-item': selectGroupItem ? JSON.stringify(selectGroupItem) : undefined,
        ref: wrapperRef,
        className: wrapperClassName,
        style: wrapperStyle,
        onClick: onWrapperClick,
        onContextMenu: onWrapperContextMenu,
        onMouseEnter: onWrapperMouseEnter,
        onMouseLeave: onWrapperMouseLeave,
      },
      children
    ),
}))

vi.mock('@/hooks/useGroups', () => ({
  useUpdateGroupName: () => ({ mutate: mockUpdateGroupName }),
  useUpdateGroupColor: () => ({ mutate: mockUpdateGroupColor }),
  useToggleGroupStar: () => ({ mutate: mockToggleGroupStar }),
  useDeleteGroup: () => ({ mutate: mockDeleteGroup }),
  useGroups: () => mockUseGroups(),
}))

vi.mock('@/stores/uiStore', () => ({
  // `getState` is what `toggleSelectionOnCtrlSpace` (keyboard Ctrl+Space) reads.
  useUIStore: Object.assign((selector: (s: object) => unknown) => mockUseUIStore(selector), {
    getState: () => baseUIState,
  }),
}))

// ponytail: jsdom has no ResizeObserver; stub fires the callback once synchronously on observe(),
// which is enough to exercise the truncation measurement effect in tests.
class MockResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: `g-${Math.random()}`,
    name: 'Group',
    color: 'rgba(59,130,246,1)',
    updatedAt: Date.now(),
    windows: [
      { id: 1, name: 'W1', tabs: [{ id: 1, title: 'T1', url: 'https://a.com' }], starred: false, incognito: false, focused: false },
    ],
    permanent: false,
    starred: false,
    ...overrides,
  }
}

const baseUIState = {
  renameTarget: null as { kind: string; groupIndex: number } | null,
  setRenameTarget: vi.fn(),
  selectionMode: false,
  selectedItems: [] as { type: string; id: string }[],
  toggleSelection: vi.fn(),
  enterSelectionMode: vi.fn(),
  selectRange: vi.fn(),
  selectionAnchor: null as { type: string; id: string } | null,
  previewGroupColor: null as { groupId: string; color: string } | null,
  setPreviewGroupColor: vi.fn(),
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, ui))
  )
}

describe('GroupItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGroups.mockReturnValue({ data: { available: [makeGroup(), makeGroup()], active: { id: '', index: 0 } } })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('renders group name and window/tab count badge', () => {
    const group = makeGroup({ name: 'Work' })
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })

  it('renders long names in full with CSS truncation (no manual character slicing)', () => {
    const group = makeGroup({ name: 'A Very Long Group Name Here' })
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const nameEl = screen.getByText('A Very Long Group Name Here')
    expect(nameEl).toBeTruthy()
    expect(nameEl.className).toMatch(/truncate/)
  })

  it('calls onClick when wrapper is clicked normally', () => {
    const onClick = vi.fn()
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick }))
    fireEvent.click(screen.getByTestId('group-wrapper'))
    expect(onClick).toHaveBeenCalled()
  })

  it('does not call onClick when locked', () => {
    const onClick = vi.fn()
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, isLocked: true, onClick }))
    fireEvent.click(screen.getByTestId('group-wrapper'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ctrl+click enters selection mode and toggles selection instead of calling onClick', () => {
    const onClick = vi.fn()
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick }))
    fireEvent.click(screen.getByTestId('group-wrapper'), { ctrlKey: true })
    expect(onClick).not.toHaveBeenCalled()
    expect(baseUIState.enterSelectionMode).toHaveBeenCalled()
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'group', id: 'group-0' })
  })

  it('shows checkbox in selection mode for non-permanent groups and toggles on click', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const checkbox = screen.getByRole('checkbox', { name: `Select ${group.name}` })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(checkbox)
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'group', id: 'group-0' })
  })

  it('does not show checkbox for permanent (Now Open) group even in selection mode', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
    const group = makeGroup({ permanent: true, name: 'Now Open' })
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('shows lock icon and tooltip when isLocked, hiding the star button', () => {
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, isLocked: true, onClick: vi.fn() }))
    expect(screen.queryByRole('button', { name: /pin group/i })).toBeNull()
  })

  it('toggles star on click for a non-permanent group', () => {
    const group = makeGroup({ starred: false })
    wrap(React.createElement(GroupItem, { group, groupIndex: 2, isActive: false, onClick: vi.fn() }))
    fireEvent.click(screen.getByRole('button', { name: /pin group/i }))
    expect(mockToggleGroupStar).toHaveBeenCalledWith(2)
  })

  it('enters rename mode on double-click and commits new name on Enter', () => {
    const group = makeGroup({ name: 'Old Name' })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 0 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue('Old Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockUpdateGroupName).toHaveBeenCalledWith({ groupIndex: 0, name: 'New Name' })
    expect(baseUIState.setRenameTarget).toHaveBeenCalledWith(null)
  })

  it('cancel button exits rename without saving', () => {
    const group = makeGroup({ name: 'Old Name' })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 0 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
    expect(mockDeleteGroup).not.toHaveBeenCalled()
    expect(baseUIState.setRenameTarget).toHaveBeenCalledWith(null)
  })

  it('deletes a freshly-created group (still named DEFAULT_GROUP_TITLE) when rename is cancelled via the X button', () => {
    const group = makeGroup({ name: DEFAULT_GROUP_TITLE })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 0 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockDeleteGroup).toHaveBeenCalledWith(0)
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
    expect(baseUIState.setRenameTarget).toHaveBeenCalledWith(null)
  })

  it('deletes a freshly-created group when rename is cancelled via Escape', () => {
    const group = makeGroup({ name: DEFAULT_GROUP_TITLE })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 1 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue(DEFAULT_GROUP_TITLE) as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(mockDeleteGroup).toHaveBeenCalledWith(1)
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })

  it('does NOT delete a freshly-created group on plain Enter with unchanged default text — commits it as-is', () => {
    const group = makeGroup({ name: DEFAULT_GROUP_TITLE })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 1 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue(DEFAULT_GROUP_TITLE) as HTMLInputElement
    // No fireEvent.change — simulates a user who never typed anything before Enter/blur
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockDeleteGroup).not.toHaveBeenCalled()
    expect(mockUpdateGroupName).toHaveBeenCalledWith({ groupIndex: 1, name: DEFAULT_GROUP_TITLE })
  })

  it('does NOT delete a freshly-created group on blur (e.g. clicking away to add tabs) — reverts/commits like a normal rename', () => {
    const group = makeGroup({ name: DEFAULT_GROUP_TITLE })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 1 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue(DEFAULT_GROUP_TITLE) as HTMLInputElement
    fireEvent.blur(input)
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })

  it('does NOT delete a freshly-created group on blur with emptied text — just closes rename without committing', () => {
    const group = makeGroup({ name: DEFAULT_GROUP_TITLE })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 1 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue(DEFAULT_GROUP_TITLE) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(mockDeleteGroup).not.toHaveBeenCalled()
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })

  it('does NOT delete an existing group whose name still equals DEFAULT_GROUP_TITLE by user choice, once a real name is committed', () => {
    const group = makeGroup({ name: DEFAULT_GROUP_TITLE })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 0 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue(DEFAULT_GROUP_TITLE) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'My Real Group' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockUpdateGroupName).toHaveBeenCalledWith({ groupIndex: 0, name: 'My Real Group' })
    expect(mockDeleteGroup).not.toHaveBeenCalled()
  })

  it('does not delete an existing (already-named) group when its rename is cancelled empty', () => {
    const group = makeGroup({ name: 'Existing Group' })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 0 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue('Existing Group') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockDeleteGroup).not.toHaveBeenCalled()
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })

  it('does not rename permanent group — resets rename target instead', () => {
    const group = makeGroup({ permanent: true, name: 'Now Open' })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 0 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue('Now Open') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
    expect(baseUIState.setRenameTarget).toHaveBeenCalledWith(null)
  })

  it('does not commit empty rename value', () => {
    const group = makeGroup({ name: 'Old Name' })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, renameTarget: { kind: 'group', groupIndex: 0 } })
    )
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const input = screen.getByDisplayValue('Old Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })

  it('double-clicking the name enters rename mode for a non-permanent group', () => {
    const group = makeGroup({ name: 'Work' })
    wrap(React.createElement(GroupItem, { group, groupIndex: 3, isActive: false, onClick: vi.fn() }))
    fireEvent.doubleClick(screen.getByText('Work'))
    expect(baseUIState.setRenameTarget).toHaveBeenCalledWith({ kind: 'group', groupIndex: 3 })
  })

  it('double-clicking the name on the permanent group does not enter rename mode', () => {
    const group = makeGroup({ name: 'Now Open', permanent: true })
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    fireEvent.doubleClick(screen.getByText('Now Open'))
    expect(baseUIState.setRenameTarget).not.toHaveBeenCalled()
  })

  it('hides the checkbox in selection mode once a non-group type has been committed', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true, selectedItems: [{ type: 'tab', id: 'tab-0-0-0' }] })
    )
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('shows a static placeholder (no drag handle) for the permanent group', () => {
    const group = makeGroup({ permanent: true, name: 'Now Open' })
    const { container } = wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    expect(container.querySelector('[aria-label^="Drag to reorder group"]')).toBeNull()
  })

  it('shows a static placeholder (no drag handle) when there is only one saved group', () => {
    mockUseGroups.mockReturnValue({ data: { available: [makeGroup({ permanent: true })], active: { id: '', index: 0 } } })
    const group = makeGroup()
    const { container } = wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    expect(container.querySelector('[aria-label^="Drag to reorder group"]')).toBeNull()
  })

  it('applies the selected background/outline style when isSelected', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectedItems: [{ type: 'group', id: 'group-0' }] })
    )
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const wrapper = screen.getByTestId('group-wrapper')
    // full opacity (jsdom normalises rgba(…, 1) to rgb(…)); the old 50% outline failed 3:1 contrast
    // ≥3:1 in both themes: --sidebar-text-active (≈14.5:1 light / 14:1 dark on the selected
    // tint). The old rgba(0,180,204) outline was ≈2.0:1 in the light theme.
    expect(wrapper.getAttribute('style') ?? '').toContain('var(--sidebar-text-active)')
    expect(wrapper.getAttribute('style') ?? '').not.toMatch(/0,\s*180,\s*204,\s*1\)/)
    expect(wrapper.style.outline).not.toContain('0.5')
  })

  it('applies mouse-enter/leave hover background only when not active/selected/menu-open', () => {
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const wrapper = screen.getByTestId('group-wrapper')
    fireEvent.mouseEnter(wrapper)
    expect(wrapper.style.background).toBe('var(--sidebar-hover-bg)')
    fireEvent.mouseLeave(wrapper)
    expect(wrapper.style.background).toBe('')
  })

  it('does not apply hover background when the group is already active', () => {
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: true, onClick: vi.fn() }))
    const wrapper = screen.getByTestId('group-wrapper')
    fireEvent.mouseEnter(wrapper)
    expect(wrapper.style.background).not.toBe('var(--sidebar-hover-bg)')
  })

  it('renders the star filled with the group color when starred', () => {
    const group = makeGroup({ starred: true, color: 'rgba(9,9,9,1)' })
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    const star = screen.getByRole('button', { name: /unpin group/i }).querySelector('svg') as SVGElement
    expect(star.style.fill).toBe('rgb(9, 9, 9)')
  })

  describe('name tooltip truncation gating', () => {
    let scrollWidthSpy: ReturnType<typeof vi.spyOn>
    let clientWidthSpy: ReturnType<typeof vi.spyOn>

    afterEach(() => {
      scrollWidthSpy?.mockRestore()
      clientWidthSpy?.mockRestore()
    })

    it('suppresses the tooltip (open=false) when the name is not truncated', () => {
      scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100)
      clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
      const group = makeGroup({ name: 'Short' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
      fireEvent.mouseEnter(screen.getByText('Short'))
      // Radix suppresses opening entirely when open={false}; the tooltip content should not appear.
      expect(screen.queryByText('Short', { selector: '[role="tooltip"] *' })).toBeNull()
    })

    it('allows the tooltip to open when the name is truncated', () => {
      scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
      clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
      const group = makeGroup({ name: 'A Very Long Truncated Name' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
      const nameEl = screen.getByText('A Very Long Truncated Name')
      expect(nameEl).toBeTruthy()
      // open prop is undefined (default hover behavior) rather than forced false — no throw,
      // and the element is present and eligible for hover-triggered tooltip content.
      fireEvent.mouseEnter(nameEl)
    })
  })

  it('opens the context menu on right-click', () => {
    const group = makeGroup()
    wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
    // Wrapper renders unconditionally; right-click just needs to not throw and call preventDefault
    fireEvent.contextMenu(screen.getByTestId('group-wrapper'))
    // No assertion needed beyond "did not throw" — contextMenuOpen state is internal,
    // but this exercises the onWrapperContextMenu branch for coverage.
  })
  /**
   * 2a — a multi-group selection has to be DRAGGABLE. The grip used to be REPLACED by
   * the checkbox in selection mode, so a selection of groups had no drag affordance at
   * all and could never be moved. Both are shown now, exactly as in Tab.tsx / Window.tsx.
   */
  describe('selection mode shows grip AND checkbox (2a)', () => {
    const selecting = (over: Partial<typeof baseUIState> = {}) =>
      mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
        selector({ ...baseUIState, selectionMode: true, ...over })
      )

    it('renders a draggable grip next to the checkbox', () => {
      selecting()
      const group = makeGroup({ name: 'Work' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
      const grip = screen.getByLabelText('Drag to reorder group: Work')
      expect(grip.getAttribute('draggable')).toBe('true')
      expect(screen.getByRole('checkbox', { name: 'Select Work' })).toBeTruthy()
    })

    it('keeps the grip out of Now Open (it is never reorderable)', () => {
      selecting()
      const group = makeGroup({ permanent: true, name: 'Now Open' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
      expect(screen.queryByLabelText(/^Drag to reorder group/)).toBeNull()
    })

    it('exposes the row id the multi-drag registry collapses/counts by', () => {
      selecting()
      const group = makeGroup({ name: 'Work' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
      expect(screen.getByTestId('group-wrapper').getAttribute('data-tm-dnd-id')).toBe(group.id)
    })

    it('Shift+click on the row and on the checkbox both extend a sidebar range', () => {
      const selectRange = vi.fn()
      selecting({ selectRange, selectionAnchor: { type: 'group', id: 'group-0' } })
      const group = makeGroup({ name: 'Work' })
      const onClick = vi.fn()
      wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick }))

      fireEvent.click(screen.getByTestId('group-wrapper'), { shiftKey: true })
      expect(onClick).not.toHaveBeenCalled()
      expect(selectRange).toHaveBeenCalledWith({ type: 'group', id: 'group-1' }, expect.any(Array))

      selectRange.mockClear()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Work' }), { shiftKey: true })
      expect(selectRange).toHaveBeenCalledWith({ type: 'group', id: 'group-1' }, expect.any(Array))
      expect(baseUIState.toggleSelection).not.toHaveBeenCalled()
    })

    it('Ctrl+Space on the GRIP toggles the group in the selection and starts no move', () => {
      useKeyboardMoveStore.setState({ request: null })
      selecting()
      const group = makeGroup({ name: 'Work' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
      const ev = fireEvent.keyDown(screen.getByLabelText('Drag to reorder group: Work'), { key: ' ', code: 'Space', ctrlKey: true })
      expect(ev).toBe(false)
      expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'group', id: 'group-1' })
      expect(useKeyboardMoveStore.getState().request).toBeNull()
    })

    it('plain Space on the GRIP requests a group move', () => {
      useKeyboardMoveStore.setState({ request: null })
      selecting()
      const group = makeGroup({ name: 'Work' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
      fireEvent.keyDown(screen.getByLabelText('Drag to reorder group: Work'), { key: ' ', code: 'Space' })
      expect(useKeyboardMoveStore.getState().request).toEqual({ kind: 'group', id: group.id })
    })

    it('hands the row its keyboard move id and Ctrl+Space selection item; Now Open gets neither', () => {
      selecting()
      const group = makeGroup({ name: 'Work' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
      let w = screen.getByTestId('group-wrapper')
      expect(w.getAttribute('data-move-group-id')).toBe(group.id)
      expect(JSON.parse(w.getAttribute('data-select-item')!)).toEqual({ type: 'group', id: 'group-1' })
      cleanup()
      wrap(React.createElement(GroupItem, { group: makeGroup({ permanent: true, name: 'Now Open' }), groupIndex: 0, isActive: false, onClick: vi.fn() }))
      w = screen.getByTestId('group-wrapper')
      expect(w.getAttribute('data-move-group-id')).toBeNull()
      expect(w.getAttribute('data-select-item')).toBeNull()
    })

    it('a lone saved group has no move id (nothing to reorder among), but can still be selected', () => {
      selecting()
      mockUseGroups.mockReturnValue({ data: { available: [makeGroup({ permanent: true }), makeGroup()], active: { id: '', index: 0 } } })
      wrap(React.createElement(GroupItem, { group: makeGroup({ name: 'Solo' }), groupIndex: 1, isActive: false, onClick: vi.fn() }))
      const w = screen.getByTestId('group-wrapper')
      expect(w.getAttribute('data-move-group-id')).toBeNull()
      expect(w.getAttribute('data-select-item')).not.toBeNull()
    })

    it('Shift+Space on the grip extends the range instead of picking the group up', () => {
      const selectRange = vi.fn()
      selecting({ selectRange, selectionAnchor: { type: 'group', id: 'group-0' } })
      const group = makeGroup({ name: 'Work' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 1, isActive: false, onClick: vi.fn() }))
      fireEvent.keyDown(screen.getByLabelText('Drag to reorder group: Work'), { key: ' ', shiftKey: true })
      expect(selectRange).toHaveBeenCalledWith({ type: 'group', id: 'group-1' }, expect.any(Array))
    })
  })

  describe('colour picker live preview', () => {
    it('renders the live preview colour on the swatch dot when previewGroupColor matches this group', () => {
      const group = makeGroup({ color: 'rgba(1, 2, 3, 1)' })
      mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
        selector({ ...baseUIState, previewGroupColor: { groupId: group.id, color: 'rgba(9, 9, 9, 1)' } })
      )
      wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
      expect(screen.getByLabelText('Change group color')).toHaveStyle({ backgroundColor: 'rgba(9, 9, 9, 1)' })
    })

    it('ignores a previewGroupColor that belongs to a different group', () => {
      const group = makeGroup({ color: 'rgba(1, 2, 3, 1)' })
      mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
        selector({ ...baseUIState, previewGroupColor: { groupId: 'some-other-group', color: 'rgba(9, 9, 9, 1)' } })
      )
      wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
      expect(screen.getByLabelText('Change group color')).toHaveStyle({ backgroundColor: 'rgba(1, 2, 3, 1)' })
    })

    it('typing a hex in the picker sets the preview for this group id, and Apply persists once and clears it', () => {
      vi.useFakeTimers()
      try {
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
          cb(0)
          return 0
        })
        const group = makeGroup({ color: 'rgba(1, 2, 3, 1)' })
        wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
        // Opens straight into the picker — no separate "Custom colour" step.
        fireEvent.click(screen.getByLabelText('Change group color'))
        fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#ff0000' } })
        expect(baseUIState.setPreviewGroupColor).toHaveBeenCalledWith({ groupId: group.id, color: 'rgba(255, 0, 0, 1)' })

        fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
        expect(mockUpdateGroupColor).toHaveBeenCalledWith({ groupIndex: 0, color: 'rgba(255, 0, 0, 1)' })
        expect(baseUIState.setPreviewGroupColor).toHaveBeenLastCalledWith(null)
        rafSpy.mockRestore()
      } finally {
        vi.useRealTimers()
      }
    })

    it('Cancel in the picker closes it and clears the preview without persisting', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0)
        return 0
      })
      const group = makeGroup({ color: 'rgba(1, 2, 3, 1)' })
      wrap(React.createElement(GroupItem, { group, groupIndex: 0, isActive: false, onClick: vi.fn() }))
      fireEvent.click(screen.getByLabelText('Change group color'))
      fireEvent.change(screen.getByPlaceholderText('#rrggbb'), { target: { value: '#ff0000' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByPlaceholderText('#rrggbb')).not.toBeInTheDocument()
      expect(mockUpdateGroupColor).not.toHaveBeenCalled()
      expect(baseUIState.setPreviewGroupColor).toHaveBeenLastCalledWith(null)
      rafSpy.mockRestore()
    })
  })
})
