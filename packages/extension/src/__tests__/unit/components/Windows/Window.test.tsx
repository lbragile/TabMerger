import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore'
import { WindowItem } from '@/components/Windows/Window'
import type { Window as WindowType, GroupsState } from '@/lib/types'

const {
  mockDeleteWindow,
  mockUpdateWindowName,
  mockUpdateWindowNote,
  mockToggleStarred,
  mockToggleIncognito,
  mockMoveWindow,
  mockSortTabs,
  mockUseGroups,
  mockUseUIStore,
  mockOpenWindow,
  mockGetSetting,
} = vi.hoisted(() => ({
  mockDeleteWindow: vi.fn(),
  mockUpdateWindowName: vi.fn(),
  mockUpdateWindowNote: vi.fn(),
  mockToggleStarred: vi.fn(),
  mockToggleIncognito: vi.fn(),
  mockMoveWindow: vi.fn(),
  mockSortTabs: vi.fn(),
  mockUseGroups: vi.fn(),
  mockUseUIStore: vi.fn(),
  mockOpenWindow: vi.fn(),
  mockGetSetting: vi.fn().mockResolvedValue({ confirmOnDelete: false }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteWindow: () => ({ mutate: mockDeleteWindow }),
  useUpdateWindowName: () => ({ mutate: mockUpdateWindowName }),
  useUpdateWindowNote: () => ({ mutate: mockUpdateWindowNote }),
  useToggleWindowStarred: () => ({ mutate: mockToggleStarred }),
  useToggleWindowIncognito: () => ({ mutate: mockToggleIncognito }),
  useMoveWindow: () => ({ mutate: mockMoveWindow }),
  useSortTabs: () => ({ mutate: mockSortTabs }),
  useGroups: () => mockUseGroups(),
}))

vi.mock('@/hooks/useOpenWindow', () => ({ useOpenWindow: () => mockOpenWindow }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ maxGroups: 5 }) }))
vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))
vi.mock('@/components/Windows/Tab', () => ({
  TabItem: ({ tab }: { tab: { title: string } }) => React.createElement('div', { 'data-testid': 'tab-item' }, tab.title),
}))

const baseUIState = {
  openModal: vi.fn(),
  selectionMode: false,
  selectedItems: [] as { type: string; id: string }[],
  toggleSelection: vi.fn(),
  enterSelectionMode: vi.fn(),
  selectRange: vi.fn(),
  selectionAnchor: null as { type: string; id: string } | null,
}

vi.mock('@/stores/uiStore', () => ({
  // `getState` is what `toggleSelectionOnCtrlSpace` (keyboard Ctrl+Space) reads.
  useUIStore: Object.assign((selector: (s: object) => unknown) => mockUseUIStore(selector), {
    getState: () => baseUIState,
  }),
}))

function makeWindow(overrides: Partial<WindowType> = {}): WindowType {
  return {
    id: 1,
    tabs: [{ id: 1, title: 'Tab 1', url: 'https://a.com' }],
    incognito: false,
    focused: false,
    starred: false,
    name: 'Test Window',
    ...overrides,
  }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, ui)))
}

function renderWindow(win: WindowType, groupIndex = 1) {
  const tabIds = win.tabs.map((t) => `tab-${t.id}`)
  return wrap(React.createElement(WindowItem, { window: win, groupIndex, windowIndex: 0, siblingCount: 2, tabIds }))
}

async function openMoreMenu() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /more window options/i }))
  return user
}

describe('WindowItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
    const groupsState: GroupsState = {
      available: [
        { id: 'g0', permanent: true, name: 'Now Open', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
        { id: 'g1', permanent: false, name: 'Saved', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
        { id: 'g2', permanent: false, name: 'Other', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
      ],
      active: { id: 'g1', index: 1 },
    }
    mockUseGroups.mockReturnValue({ data: groupsState })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('renders window name and tab count', () => {
    renderWindow(makeWindow({ name: 'My Window', tabs: [makeWindow().tabs[0], makeWindow().tabs[0]] }))
    expect(screen.getByText('My Window')).toBeTruthy()
    expect(screen.getByText(/2 tabs/)).toBeTruthy()
  })

  it('shows "Empty window" message when there are no tabs', () => {
    renderWindow(makeWindow({ tabs: [] }))
    expect(screen.getByText('Empty window')).toBeTruthy()
  })

  it('renders each tab via TabItem', () => {
    renderWindow(makeWindow({ tabs: [{ id: 1, title: 'A', url: 'https://a.com' }, { id: 2, title: 'B', url: 'https://b.com' }] }))
    expect(screen.getAllByTestId('tab-item').length).toBe(2)
  })

  it('renames the window on double-click and Enter', () => {
    renderWindow(makeWindow({ name: 'Old Name' }))
    fireEvent.doubleClick(screen.getByText('Old Name'))
    const input = screen.getByDisplayValue('Old Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockUpdateWindowName).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0, name: 'New Name' })
  })

  it('cancel button exits rename without saving', () => {
    renderWindow(makeWindow({ name: 'Old Name' }))
    fireEvent.doubleClick(screen.getByText('Old Name'))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockUpdateWindowName).not.toHaveBeenCalled()
    expect(screen.getByText('Old Name')).toBeTruthy()
  })

  it('does not rename to a blank value', () => {
    renderWindow(makeWindow({ name: 'Old Name' }))
    fireEvent.doubleClick(screen.getByText('Old Name'))
    const input = screen.getByDisplayValue('Old Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockUpdateWindowName).not.toHaveBeenCalled()
  })

  it('toggles star on click', () => {
    renderWindow(makeWindow({ starred: false }))
    fireEvent.click(screen.getByRole('button', { name: /star window/i }))
    expect(mockToggleStarred).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0 })
  })

  it('shows "Unstar window" label when already starred', () => {
    renderWindow(makeWindow({ starred: true }))
    expect(screen.getByRole('button', { name: /unstar window/i })).toBeTruthy()
  })

  it('shows incognito badge when window.incognito is true', () => {
    renderWindow(makeWindow({ incognito: true }))
    expect(screen.getByText('Incognito')).toBeTruthy()
  })

  it('checkbox in selection mode toggles window selection', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
    renderWindow(makeWindow())
    const checkbox = screen.getByRole('checkbox', { name: 'Select Test Window' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(checkbox)
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' })
  })

  it('Shift+click on the window checkbox extends the RANGE instead of toggling', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
    renderWindow(makeWindow())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Test Window' }), { shiftKey: true })
    expect(baseUIState.selectRange).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' }, expect.any(Array))
    expect(baseUIState.toggleSelection).not.toHaveBeenCalled()
  })

  it('a selected window card uses a full-opacity primary ring (contrast)', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true, selectedItems: [{ type: 'window', id: 'window-1-0' }] })
    )
    renderWindow(makeWindow())
    const card = document.querySelector('[data-window-index="0"]') as HTMLElement
    expect(card.className.split(' ')).toContain('ring-primary')
    expect(card.className).not.toContain('ring-primary/70')
  })

  it('ctrl+click on header enters selection mode and toggles this window', () => {
    renderWindow(makeWindow())
    const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
    fireEvent.click(header, { ctrlKey: true })
    expect(baseUIState.enterSelectionMode).toHaveBeenCalled()
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' })
  })

  it('in selection mode the window grip stays draggable, with the checkbox right after it; the card carries its DnD model id', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
    wrap(React.createElement(WindowItem, { groupId: 'g1', window: makeWindow(), groupIndex: 1, windowIndex: 0, siblingCount: 2, tabIds: [] }))
    const grip = document.querySelector('[aria-label="Drag to reorder window: Test Window"]')
    expect(grip?.getAttribute('draggable')).toBe('true')
    const checkbox = screen.getByRole('checkbox', { name: 'Select Test Window' })
    expect(grip!.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('[data-window-index="0"]')!.getAttribute('data-tm-dnd-id')).toBe('g1::w0')
  })

  it('a group with ONE window still gets a drag grip — moving the last window to another group is allowed', () => {
    // Previously gated on `siblingCount > 1`, which left a one-window group window
    // undraggable (and unreachable by keyboard drag) even though `canDrop` allowed the
    // move. The source group is simply left empty; it is never auto-deleted.
    wrap(React.createElement(WindowItem, { groupId: 'g1', window: makeWindow(), groupIndex: 1, windowIndex: 0, siblingCount: 1, tabIds: [] }))
    const grip = document.querySelector('[aria-label="Drag to reorder window: Test Window"]')
    expect(grip).not.toBeNull()
    expect(grip!.getAttribute('draggable')).toBe('true')
  })

  it('Shift+Space on the window GRIP range-selects instead of picking the window up; plain Space does not range-select', () => {
    wrap(React.createElement(WindowItem, { groupId: 'g1', window: makeWindow(), groupIndex: 1, windowIndex: 0, siblingCount: 2, tabIds: [] }))
    const grip = document.querySelector('[aria-label="Drag to reorder window: Test Window"]') as HTMLElement
    const ev = fireEvent.keyDown(grip, { key: ' ', code: 'Space', shiftKey: true })
    expect(ev).toBe(false) // preventDefault — the activator never sees it
    expect(baseUIState.selectRange).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' }, expect.any(Array))
    vi.mocked(baseUIState.selectRange).mockClear()
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' })
    expect(baseUIState.selectRange).not.toHaveBeenCalled()
  })

  it('plain Space on the focused window HEADER (and on its grip) requests keyboard move mode', () => {
    useKeyboardMoveStore.setState({ request: null })
    wrap(React.createElement(WindowItem, { groupId: 'g1', window: makeWindow(), groupIndex: 1, windowIndex: 0, siblingCount: 2, tabIds: [] }))
    const header = document.querySelector('[data-window-header]') as HTMLElement
    fireEvent.keyDown(header, { key: 'Enter', code: 'Enter' })
    expect(useKeyboardMoveStore.getState().request).toBeNull()
    fireEvent.keyDown(header, { key: ' ', code: 'Space' })
    expect(useKeyboardMoveStore.getState().request).toEqual({ kind: 'window', id: 'g1::w0' })
    useKeyboardMoveStore.setState({ request: null })
    const grip = document.querySelector('[aria-label="Drag to reorder window: Test Window"]') as HTMLElement
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' })
    expect(useKeyboardMoveStore.getState().request).toEqual({ kind: 'window', id: 'g1::w0' })
  })

  it('the tab list is keyed by the window\'s model id (the container key of the gap the keyboard preview opens)', () => {
    wrap(React.createElement(WindowItem, { groupId: 'g1', window: makeWindow(), groupIndex: 1, windowIndex: 0, siblingCount: 2, tabIds: [] }))
    const list = document.querySelector('[role="list"][data-tm-dnd-list]')
    expect(list?.getAttribute('data-tm-dnd-list')).toBe('g1::w0')
  })

  it('Ctrl+Space on the focused window HEADER or its grip toggles the window in the selection and starts no move', () => {
    useKeyboardMoveStore.setState({ request: null })
    wrap(React.createElement(WindowItem, { groupId: 'g1', window: makeWindow(), groupIndex: 1, windowIndex: 0, siblingCount: 2, tabIds: [] }))
    const header = document.querySelector('[data-window-header]') as HTMLElement
    const ev = fireEvent.keyDown(header, { key: ' ', code: 'Space', ctrlKey: true })
    expect(ev).toBe(false)
    expect(baseUIState.enterSelectionMode).toHaveBeenCalled()
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' })
    vi.mocked(baseUIState.toggleSelection).mockClear()
    const grip = document.querySelector('[aria-label="Drag to reorder window: Test Window"]') as HTMLElement
    fireEvent.keyDown(grip, { key: ' ', code: 'Space', ctrlKey: true })
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' })
    expect(useKeyboardMoveStore.getState().request).toBeNull()
  })

  it('shift+click on the header selects the window RANGE from the anchor (same group) and blocks text selection', () => {
    mockUseGroups.mockReturnValue({
      data: {
        active: { id: 'g1', index: 1 },
        available: [
          { id: 'g0', permanent: true, name: 'Now Open', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
          { id: 'g1', permanent: false, name: 'Saved', color: 'rgba(0,0,0,1)', windows: [makeWindow(), makeWindow(), makeWindow()], updatedAt: 0 },
        ],
      },
    })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true, selectionAnchor: { type: 'window', id: 'window-1-2' } })
    )
    renderWindow(makeWindow())
    const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
    fireEvent.click(header, { shiftKey: true })
    expect(baseUIState.selectRange).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' }, [
      { type: 'window', id: 'window-1-0' },
      { type: 'window', id: 'window-1-1' },
      { type: 'window', id: 'window-1-2' },
    ])
    expect(baseUIState.toggleSelection).not.toHaveBeenCalled()
    expect(fireEvent.mouseDown(header, { shiftKey: true })).toBe(false)
  })

  it('"More options" menu: marks incognito', async () => {
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Mark incognito'))
    expect(mockToggleIncognito).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0 })
  })

  it('"More options" menu: shows "Remove incognito" when already incognito', async () => {
    renderWindow(makeWindow({ incognito: true }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /more window options/i }))
    expect(screen.getByText('Remove incognito')).toBeTruthy()
  })

  it('"More options" menu: opens window in browser (disabled when no tabs)', async () => {
    renderWindow(makeWindow({ tabs: [] }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /more window options/i }))
    const openItem = screen.getByText('Open in browser').closest('[role="menuitem"]')
    expect(openItem?.getAttribute('data-disabled')).not.toBeNull()
  })

  it('"More options" menu: opens the window when it has tabs', async () => {
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Open in browser'))
    expect(mockOpenWindow).toHaveBeenCalled()
  })

  it('"More options" menu: sorts tabs by title', async () => {
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Sort this window by title'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0, by: 'title' })
  })

  it('"More options" menu: sorts tabs by URL', async () => {
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Sort this window by URL'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0, by: 'url' })
  })

  it('opens and commits the window note editor', async () => {
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Add note'))
    const textarea = await screen.findByPlaceholderText(/add a note/i)
    fireEvent.change(textarea, { target: { value: 'Window note' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(mockUpdateWindowNote).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0, note: 'Window note' })
  })

  it('shows note icon when window already has a note', () => {
    renderWindow(makeWindow({ note: 'Existing note' }))
    expect(screen.getByRole('button', { name: /edit window note/i })).toBeTruthy()
  })

  it('right-click header context menu moves window to another group', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow())
    const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
    fireEvent.contextMenu(header)
    await user.hover(screen.getByText(/move to group/i))
    const other = await screen.findByText('Other')
    fireEvent.click(other.closest('[role="menuitem"]') as HTMLElement)
    expect(mockMoveWindow).toHaveBeenCalledWith({ fromGroupIndex: 1, windowIndex: 0, toGroupIndex: 2 })
  })

  it('shows "Copy to group" label for windows in the Now Open (permanent) group', () => {
    renderWindow(makeWindow(), 0)
    const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
    fireEvent.contextMenu(header)
    expect(screen.getByText(/copy to group/i)).toBeTruthy()
  })

  it('excludes archived groups from the move-to-group submenu', async () => {
    const user = userEvent.setup()
    mockUseGroups.mockReturnValue({
      data: {
        available: [
          { id: 'g0', permanent: true, name: 'Now Open', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
          { id: 'g1', permanent: false, name: 'Saved', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
          { id: 'g2', permanent: false, name: 'Other', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
          { id: 'g3', permanent: false, name: 'Archived', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0, archived: true },
        ],
        active: { id: 'g1', index: 1 },
      },
    })
    renderWindow(makeWindow())
    const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
    fireEvent.contextMenu(header)
    await user.hover(screen.getByText(/move to group/i))
    expect(await screen.findByText('Other')).toBeTruthy()
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
  })

  it('shows "Create new group…" in the move-to-group submenu and wires moveWindow through its onCreated callback', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow(), 1)
    const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
    fireEvent.contextMenu(header)
    await user.hover(screen.getByText(/move to group/i))
    const createItem = await screen.findByText('Create new group…')
    fireEvent.click(createItem)
    expect(baseUIState.openModal).toHaveBeenCalledWith('addGroup', { onCreated: expect.any(Function) })

    const onCreated = (baseUIState.openModal as ReturnType<typeof vi.fn>).mock.calls[0][1].onCreated as (
      groupIndex: number
    ) => void
    onCreated(7)
    expect(mockMoveWindow).toHaveBeenCalledWith({ fromGroupIndex: 1, windowIndex: 0, toGroupIndex: 7 })
  })

  it('deletes the window directly when confirmOnDelete is false', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: false })
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Remove window'))
    await waitFor(() => expect(mockDeleteWindow).toHaveBeenCalledWith({ groupIndex: 1, windowIndex: 0 }))
    expect(baseUIState.openModal).not.toHaveBeenCalled()
  })

  it('opens confirm modal instead of deleting when confirmOnDelete is true', async () => {
    mockGetSetting.mockResolvedValue({ confirmOnDelete: true })
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Remove window'))
    await waitFor(() =>
      expect(baseUIState.openModal).toHaveBeenCalledWith('deleteWindow', expect.objectContaining({ groupIndex: 1, windowIndex: 0 }))
    )
    expect(mockDeleteWindow).not.toHaveBeenCalled()
  })
})
