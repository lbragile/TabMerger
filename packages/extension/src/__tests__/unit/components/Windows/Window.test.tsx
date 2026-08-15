import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
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
}

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector),
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
    fireEvent.click(screen.getByRole('button', { name: /select window/i }))
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' })
  })

  it('ctrl+click on header enters selection mode and toggles this window', () => {
    renderWindow(makeWindow())
    const header = document.querySelector('[data-window-index="0"] .group.relative') as HTMLElement
    fireEvent.click(header, { ctrlKey: true })
    expect(baseUIState.enterSelectionMode).toHaveBeenCalled()
    expect(baseUIState.toggleSelection).toHaveBeenCalledWith({ type: 'window', id: 'window-1-0' })
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
    await user.click(screen.getByText('Sort by title'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 1, by: 'title' })
  })

  it('"More options" menu: sorts tabs by URL', async () => {
    renderWindow(makeWindow())
    const user = await openMoreMenu()
    await user.click(screen.getByText('Sort by URL'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 1, by: 'url' })
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
