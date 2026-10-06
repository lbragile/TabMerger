import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabItem } from '@/components/Windows/Tab'
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore'
import type { Tab, Group, GroupsState, UrlRule } from '@/lib/types'

const {
  mockDeleteTab,
  mockMoveTab,
  mockUpdateTabNote,
  mockSetTabReminder,
  mockClearTabReminder,
  mockUseGroupsData,
  mockToggleSelection,
  mockEnterSelectionMode,
  mockUseUrlRulesData,
  mockSaveGroupsState,
  mockOpenTabInChromeGroup,
  mockOpenModal,
  mockSelectRange,
} = vi.hoisted(() => ({
  mockDeleteTab: vi.fn(),
  mockMoveTab: vi.fn(),
  mockUpdateTabNote: vi.fn(),
  mockSetTabReminder: vi.fn(),
  mockClearTabReminder: vi.fn(),
  mockUseGroupsData: vi.fn(),
  mockToggleSelection: vi.fn(),
  mockEnterSelectionMode: vi.fn(),
  mockUseUrlRulesData: vi.fn((): { data: UrlRule[] } => ({ data: [] })),
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
  mockOpenTabInChromeGroup: vi.fn().mockResolvedValue(undefined),
  mockOpenModal: vi.fn(),
  mockSelectRange: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: mockSaveGroupsState,
  // the title edit is an atomic read-modify-write on the (mocked) current state
  updateGroupsState: async (fn: (s: unknown) => unknown) => {
    const current = mockUseGroupsData().data
    const next = fn(current)
    if (!next) return current
    await mockSaveGroupsState(next)
    return next
  },
  getGroupsState: vi.fn(),
  getSetting: vi.fn().mockResolvedValue([]),
  setSetting: vi.fn(),
}))

vi.mock('@/lib/chromeGroups', () => ({
  openTabInChromeGroup: mockOpenTabInChromeGroup,
}))

// dnd-kit's spread listeners — a spy so tests can prove which keys still reach the activator.
const sortableListeners = vi.hoisted(() => ({ onKeyDown: vi.fn() }))
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: sortableListeners,
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('@/components/Windows/TabPreview', () => ({
  TabPreview: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteTab: () => ({ mutate: mockDeleteTab }),
  useMoveTab: () => ({ mutate: mockMoveTab }),
  useGroups: () => mockUseGroupsData(),
  useUpdateTabNote: () => ({ mutate: mockUpdateTabNote }),
  useSetTabReminder: () => ({ mutate: mockSetTabReminder }),
  useClearTabReminder: () => ({ mutate: mockClearTabReminder }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ maxGroups: 5 }),
}))

vi.mock('@/hooks/useUrlRules', () => ({
  useUrlRules: () => mockUseUrlRulesData(),
  matchUrlToRule: vi.fn((url: string | undefined, rules: Array<{ pattern: string; groupId: string }>) => {
    const rule = rules.find((r) => url?.includes(r.pattern))
    return rule?.groupId ?? null
  }),
}))

let selectionState: {
  selectionMode: boolean
  selectedItems: Array<{ type: string; id: string }>
  selectionAnchor?: { type: string; id: string } | null
} = {
  selectionMode: false,
  selectedItems: [],
}

vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (s: object) => unknown) =>
      selector({
        openModal: mockOpenModal,
        selectionMode: selectionState.selectionMode,
        selectedItems: selectionState.selectedItems,
        toggleSelection: mockToggleSelection,
        enterSelectionMode: mockEnterSelectionMode,
        selectRange: mockSelectRange,
        selectionAnchor: selectionState.selectionAnchor ?? null,
      }),
    {
      // `getState` is what `toggleSelectionOnCtrlSpace` (keyboard Ctrl+Space) reads.
      getState: () => ({
        selectedItems: selectionState.selectedItems,
        toggleSelection: mockToggleSelection,
        enterSelectionMode: mockEnterSelectionMode,
      }),
    }
  ),
}))

globalThis.chrome = {
  tabs: { create: vi.fn(), group: vi.fn().mockResolvedValue(1) },
  tabGroups: { update: vi.fn(), query: vi.fn() },
  storage: { local: { get: vi.fn(), set: vi.fn(), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } },
} as unknown as typeof chrome

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 1,
    title: 'My Tab',
    url: 'https://example.com',
    favIconUrl: '',
    pinned: false,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Group',
    color: 'rgba(0,0,0,1)',
    updatedAt: Date.now(),
    windows: [],
    permanent: false,
    starred: false,
    ...overrides,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const groupsData = mockUseGroupsData().data as GroupsState | undefined
  if (groupsData) qc.setQueryData(['groups'], groupsData)
  return React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, children))
}

beforeEach(() => {
  vi.clearAllMocks()
  selectionState = { selectionMode: false, selectedItems: [] }
  mockUseGroupsData.mockReturnValue({ data: { available: [makeGroup()], active: { id: 'g1', index: 0 } } })
  mockUseUrlRulesData.mockReturnValue({ data: [] })
})

describe('TabItem — basic rendering and open', () => {
  it('renders tab title and opens it on click', () => {
    const t = makeTab({ title: 'Example Tab' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.click(screen.getByText('Example Tab'))
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com', active: true })
  })

  it('renders long titles with a truncate class so CSS clips them', () => {
    const longTitle = 'Client ID for Web application – Google Auth Platform – My First Project – Google Cloud console'
    const t = makeTab({ title: longTitle })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const titleEl = screen.getByText(longTitle)
    expect(titleEl.className).toMatch(/truncate/)
    expect(titleEl.className).toMatch(/min-w-0/)
  })

  it('gives the title a fixed, smaller grid track so hostnames line up across rows', () => {
    const t = makeTab({ title: 'Example Tab' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const titleGrid = screen.getByText('Example Tab').closest('div.grid')
    expect(titleGrid?.className).toMatch(/grid-cols-\[12\.5rem_minmax\(0,1fr\)\]/)
  })

  it('renders the tab URL hostname + path (no protocol/query/hash) with a truncate class', () => {
    const t = makeTab({ url: 'https://www.example.com/some/deep/path?query=1' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const hostEl = screen.getByText('example.com/some/deep/path')
    expect(hostEl.className).toMatch(/truncate/)
  })

  it('shows a bare hostname (no trailing slash) for root-path URLs', () => {
    const t = makeTab({ url: 'https://www.example.com/' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('truncates a very long path itself, keeping the hostname intact', () => {
    const t = makeTab({ url: 'https://example.com/this/is/a/very/long/path/segment/that/keeps/going' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const el = screen.getByText(/^example\.com\/.*\.\.\.$/)
    expect(el.textContent).toBe('example.com/this/is/a/very...')
  })

  it('keeps a gap between the title/hostname grid and the right-pinned indicators', () => {
    const t = makeTab({ title: 'Example Tab' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const titleGrid = screen.getByText('Example Tab').closest('div.grid')
    expect(titleGrid?.className).toMatch(/mr-2/)
  })

  it('omits the hostname row when the tab has no URL', () => {
    const t = makeTab({ url: undefined, title: 'No URL Tab' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
  })
})

describe('TabItem — isLocked', () => {
  it('does not open the tab on click when isLocked', () => {
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} isLocked />, { wrapper })
    fireEvent.click(screen.getByText('My Tab'))
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('shows the lock icon and no delete button when isLocked', () => {
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} isLocked />, { wrapper })
    expect(screen.queryByRole('button', { name: /remove tab|close tab/i })).not.toBeInTheDocument()
  })
})

describe('TabItem — Now Open vs saved group labeling', () => {
  it('shows "Close tab" aria-label when source group is permanent (Now Open)', () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ permanent: true })], active: { id: '', index: 0 } },
    })
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByRole('button', { name: /close tab/i })).toBeInTheDocument()
  })

  it('shows "Remove tab" aria-label for a non-permanent saved group', () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ permanent: false })], active: { id: '', index: 0 } },
    })
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByRole('button', { name: /remove tab/i })).toBeInTheDocument()
  })

  it('clicking the delete button calls deleteTab with the tab position', async () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ permanent: false })], active: { id: '', index: 0 } },
    })
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={2} tabIndex={3} siblingCount={1} />, { wrapper })
    await user.click(screen.getByRole('button', { name: /remove tab/i }))
    expect(mockDeleteTab).toHaveBeenCalledWith({ groupIndex: 0, windowIndex: 2, tabIndex: 3 })
  })

  it('deletes the tab from the context menu', async () => {
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(screen.getByText(/remove tab/i))
    expect(mockDeleteTab).toHaveBeenCalledWith({ groupIndex: 0, windowIndex: 0, tabIndex: 0 })
  })
})

describe('TabItem — keyboard: keys from nested controls never open the tab', () => {
  // dnd-kit's keyboard activator on the grip calls preventDefault but NOT stopPropagation,
  // so a Space/Enter pickup (and drop) bubbled to the row and opened the tab — which
  // dismisses the toolbar popup mid keyboard-drag.
  it.each([' ', 'Enter'])('%j on the drag GRIP does not call chrome.tabs.create', (key) => {
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const grip = document.querySelector('[aria-label^="Drag to reorder"]') as HTMLElement
    fireEvent.keyDown(grip, { key, code: key === ' ' ? 'Space' : 'Enter' })
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('Space on the selection CHECKBOX does not open the tab either', () => {
    selectionState = { selectionMode: true, selectedItems: [] }
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ', code: 'Space' })
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('Enter on the focused ROW itself still opens the tab', () => {
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.keyDown(screen.getByRole('listitem'), { key: 'Enter', code: 'Enter' })
    expect(globalThis.chrome.tabs.create).toHaveBeenCalledTimes(1)
  })

  it('plain Space on the focused ROW requests keyboard move mode and does NOT open the tab; Enter never does', () => {
    useKeyboardMoveStore.setState({ request: null })
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const row = screen.getByRole('listitem')
    fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' })
    expect(useKeyboardMoveStore.getState().request).toBeNull()
    fireEvent.keyDown(row, { key: ' ', code: 'Space' })
    expect(useKeyboardMoveStore.getState().request).toEqual({ kind: 'tab', id: expect.stringMatching(/::w0::t0$/) })
    expect(globalThis.chrome.tabs.create).toHaveBeenCalledTimes(1) // the Enter above only
  })

  it('Ctrl+Space (and Cmd+Space) on the focused ROW toggles the tab in the selection: no move, no open', () => {
    useKeyboardMoveStore.setState({ request: null })
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const row = screen.getByRole('listitem')
    const ev = fireEvent.keyDown(row, { key: ' ', code: 'Space', ctrlKey: true })
    expect(ev).toBe(false) // consumed
    expect(mockEnterSelectionMode).toHaveBeenCalledTimes(1)
    expect(mockToggleSelection).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' })
    fireEvent.keyDown(row, { key: ' ', code: 'Space', metaKey: true })
    expect(mockToggleSelection).toHaveBeenCalledTimes(2)
    expect(useKeyboardMoveStore.getState().request).toBeNull()
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('Ctrl+Space on the GRIP also toggles the selection and does not start a move', () => {
    useKeyboardMoveStore.setState({ request: null })
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const grip = document.querySelector('[aria-label^="Drag to reorder"]') as HTMLElement
    fireEvent.keyDown(grip, { key: ' ', code: 'Space', ctrlKey: true })
    expect(mockToggleSelection).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' })
    expect(useKeyboardMoveStore.getState().request).toBeNull()
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('Shift+Space on the focused row selects the RANGE and does not open the tab', () => {
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.keyDown(screen.getByRole('listitem'), { key: ' ', code: 'Space', shiftKey: true })
    expect(mockSelectRange).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' }, expect.any(Array))
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('Shift+Space on the GRIP range-selects and does not start a move; plain Space on the grip does', () => {
    useKeyboardMoveStore.setState({ request: null })
    mockSelectRange.mockClear()
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const grip = document.querySelector('[aria-label^="Drag to reorder"]') as HTMLElement
    const shifted = fireEvent.keyDown(grip, { key: ' ', code: 'Space', shiftKey: true })
    expect(shifted).toBe(false)
    expect(mockSelectRange).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' }, expect.any(Array))
    expect(useKeyboardMoveStore.getState().request).toBeNull()

    mockSelectRange.mockClear()
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' })
    expect(useKeyboardMoveStore.getState().request).toEqual({ kind: 'tab', id: expect.stringMatching(/::w0::t0$/) })
    expect(mockSelectRange).not.toHaveBeenCalled()
  })

  it('the grip ring is ring-ring (≥3:1), not ring-primary (2.73:1 on a selected light row)', () => {
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const grip = document.querySelector('[aria-label^="Drag to reorder"]') as HTMLElement
    const row = screen.getByRole('listitem')
    for (const el of [grip, row]) {
      expect(el.className).toContain('focus-visible:ring-ring')
      expect(el.className).not.toContain('ring-primary')
    }
  })

  it('the grip becomes fully visible + ringed on keyboard focus (static classes only)', () => {
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const grip = document.querySelector('[aria-label^="Drag to reorder"]') as HTMLElement
    expect(grip.className).toContain('focus-visible:opacity-100')
    expect(grip.className).toContain('group-focus-within:opacity-100')
    expect(grip.className).toContain('focus-visible:ring-2')
  })
})

describe('TabItem — selection mode', () => {
  it('shows a checkbox (next to the still-draggable grip) and toggles selection on click', async () => {
    selectionState = { selectionMode: true, selectedItems: [] }
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    // a real checkbox, named after the TAB (not a generic "Select tab" repeated on every row)
    const checkbox = screen.getByRole('checkbox', { name: 'Select My Tab' })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    await user.click(checkbox)
    expect(mockToggleSelection).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' })
  })

  it('exposes the selected state via aria-checked when this tab is already selected', () => {
    selectionState = { selectionMode: true, selectedItems: [{ type: 'tab', id: 'tab-0-0-0' }] }
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByRole('checkbox', { name: 'Select My Tab' }).getAttribute('aria-checked')).toBe('true')
  })

  it('Shift+click on the checkbox extends the RANGE instead of toggling', () => {
    selectionState = { selectionMode: true, selectedItems: [] }
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select My Tab' }), { shiftKey: true })
    expect(mockSelectRange).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' }, expect.any(Array))
    expect(mockToggleSelection).not.toHaveBeenCalled()
  })

  it('hides the checkbox when a non-tab type is already committed to the selection', () => {
    selectionState = { selectionMode: true, selectedItems: [{ type: 'window', id: 'window-0-0' }] }
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('ctrl+click on the row enters selection mode and toggles the tab', () => {
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.click(screen.getByRole('listitem'), { ctrlKey: true })
    expect(mockEnterSelectionMode).toHaveBeenCalled()
    expect(mockToggleSelection).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' })
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('in selection mode the drag grip is STILL present and draggable (a selection is dragged from its grip), with the checkbox right after it', () => {
    selectionState = { selectionMode: true, selectedItems: [{ type: 'tab', id: 'tab-0-0-0' }] }
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    // Label is descriptive but keeps the "Drag to reorder" prefix the DnD sensor selects on.
    const grip = document.querySelector('[aria-label="Drag to reorder tab: My Tab"]')
    expect(grip).not.toBeNull()
    expect(grip!.matches('[aria-label^="Drag to reorder"]')).toBe(true)
    expect(grip!.getAttribute('draggable')).toBe('true')
    const checkbox = screen.getByRole('checkbox', { name: 'Select My Tab' })
    expect(grip!.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the row carries its positional DnD model id (multi-drag finds the other selected rows by it)', () => {
    render(<TabItem groupId="g1" tab={makeTab()} groupIndex={0} windowIndex={1} tabIndex={2} siblingCount={3} />, { wrapper })
    expect(screen.getByRole('listitem').getAttribute('data-tm-dnd-id')).toBe('g1::w1::t2')
  })

  it('shift+click selects the RANGE from the anchor (spanning windows, visual order) and never opens the tab', () => {
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [
          makeGroup({
            windows: [
              { id: 0, tabs: [makeTab(), makeTab()], incognito: false, focused: false },
              { id: 0, tabs: [makeTab()], incognito: false, focused: false },
            ],
          }),
        ],
        active: { id: 'g1', index: 0 },
      },
    })
    selectionState = {
      selectionMode: true,
      selectedItems: [{ type: 'tab', id: 'tab-0-0-1' }],
      selectionAnchor: { type: 'tab', id: 'tab-0-0-1' },
    }
    render(<TabItem tab={makeTab()} groupIndex={0} windowIndex={1} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.click(screen.getByText('My Tab'), { shiftKey: true })
    expect(mockSelectRange).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-1-0' }, [
      { type: 'tab', id: 'tab-0-0-1' },
      { type: 'tab', id: 'tab-0-1-0' },
    ])
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
    // shift+mousedown must not start a browser text selection across rows
    expect(fireEvent.mouseDown(screen.getByRole('listitem'), { shiftKey: true })).toBe(false)
  })
})

describe('TabItem — note editor', () => {
  it('opens the note editor from the context menu, saves, and clears on Cancel', async () => {
    const user = userEvent.setup()
    const t = makeTab({ note: 'existing note' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Edit tab note' }))
    const textarea = await screen.findByPlaceholderText('Add a note…')
    expect(textarea).toHaveValue('existing note')

    await user.clear(textarea)
    await user.type(textarea, 'updated')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdateTabNote).toHaveBeenCalledWith({ groupIndex: 0, windowIndex: 0, tabIndex: 0, note: 'updated' })
  })

  it('cancels without saving when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const t = makeTab({ note: 'existing note' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Edit tab note' }))
    await screen.findByPlaceholderText('Add a note…')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockUpdateTabNote).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Add a note…')).not.toBeInTheDocument()
  })

  it('shows the note icon and reopens the note editor when tab already has a note', async () => {
    const user = userEvent.setup()
    const t = makeTab({ note: 'Existing note' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    await user.click(screen.getByRole('button', { name: /edit tab note/i }))
    expect(await screen.findByDisplayValue('Existing note')).toBeTruthy()
  })
})

describe('TabItem — reminder editor', () => {
  it('sets a reminder via a quick-pick button', async () => {
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })

    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(await screen.findByText(/remind me/i))
    await user.click(await screen.findByRole('button', { name: '1 hour' }))

    expect(mockSetTabReminder).toHaveBeenCalledWith(
      expect.objectContaining({ groupIndex: 0, windowIndex: 0, tabIndex: 0, note: undefined })
    )
  })

  it('uses the group color for the reminder icon when groupColor is provided', () => {
    const t = makeTab({ reminder: { fireAt: Date.now() + 60_000 } })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} groupColor="rgb(1, 2, 3)" />,
      { wrapper }
    )
    expect(screen.getByRole('button', { name: 'Edit tab reminder' })).toHaveStyle({ color: 'rgb(1, 2, 3)' })
  })

  it('falls back to DEFAULT_GROUP_COLOR for the reminder icon when groupColor is not provided', () => {
    const t = makeTab({ reminder: { fireAt: Date.now() + 60_000 } })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />,
      { wrapper }
    )
    expect(screen.getByRole('button', { name: 'Edit tab reminder' })).toHaveStyle({ color: 'rgba(128, 128, 128, 1)' })
  })

  it('shows the reminder icon and clears the reminder from the context menu when a reminder exists', async () => {
    const user = userEvent.setup()
    const t = makeTab({ reminder: { fireAt: Date.now() + 60_000, note: 'follow up' } })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })

    expect(screen.getByRole('button', { name: 'Edit tab reminder' })).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(screen.getByText(/clear reminder/i))
    expect(mockClearTabReminder).toHaveBeenCalledWith({ groupIndex: 0, windowIndex: 0, tabIndex: 0 })
  })
})

describe('TabItem — custom title / rename flow', () => {
  it('shows the "renamed" badge when a customTitle is set', () => {
    const t = makeTab({ customTitle: 'My Renamed Tab' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByText('renamed')).toBeInTheDocument()
    expect(screen.getByText('My Renamed Tab')).toBeInTheDocument()
  })

  it('styles the "renamed" badge as a low-opacity pill matching the group color', () => {
    const t = makeTab({ customTitle: 'My Renamed Tab' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} groupColor="rgba(10, 20, 30, 1)" />, { wrapper })
    const badge = screen.getByLabelText('Custom title')
    expect(badge).toHaveClass('rounded-none')
    expect(badge.style.backgroundColor).toBe('rgba(10, 20, 30, 0.18)')
    expect(badge.style.color).toBe('rgb(10, 20, 30)')
  })

  it('renames the tab title via context menu and commits on Enter', async () => {
    const startedAt = Date.now()
    const t = makeTab({ title: 'Example Tab' })
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [{ ...makeGroup(), windows: [{ id: 1, name: 'W', tabs: [t], starred: false, incognito: false, focused: false }] }],
        active: { id: '', index: 0 },
      },
    })
    const user = userEvent.setup()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(screen.getByText(/rename tab/i))
    const input = await screen.findByDisplayValue('Example Tab')
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mockSaveGroupsState).toHaveBeenCalled())
    // the edit is a sync-visible change to the saved group (it used to be neither pushed nor kept)
    const saved = mockSaveGroupsState.mock.calls.at(-1)?.[0] as GroupsState
    expect(saved.available[0].windows[0].tabs[0].customTitle).toBe('New Title')
    expect(saved.available[0].pendingSync).toBe(true)
    expect(saved.available[0].updatedAt).toBeGreaterThanOrEqual(startedAt)
  })
})

describe('TabItem — reset to original title', () => {
  it('shows "Reset to original title" in context menu when customTitle is set, persists on click', async () => {
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [
          { ...makeGroup(), windows: [{ id: 1, name: 'W', tabs: [makeTab({ customTitle: 'Renamed' })], starred: false, incognito: false, focused: false }] },
        ],
        active: { id: '', index: 0 },
      },
    })
    const user = userEvent.setup()
    const t = makeTab({ customTitle: 'Renamed' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    const resetItem = await screen.findByText(/reset to original title/i)
    await user.click(resetItem)
    await waitFor(() => expect(mockSaveGroupsState).toHaveBeenCalled())
  })
})

describe('TabItem — chromeGroup pill', () => {
  it('renders the group name pill when chromeGroup is set', () => {
    const t = makeTab({ chromeGroup: { id: 5, name: 'Work', color: 'blue' } })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('does not render a pill when chromeGroup is absent', () => {
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByText('My Tab')).toBeInTheDocument()
    expect(screen.queryByTitle(/Work|Research|Design/)).toBeNull()
  })

  it('does not reopen a Chrome tab group via chrome.tabGroups when unavailable', () => {
    const t = makeTab({ chromeGroup: { id: 5, name: 'Work', color: 'blue' } })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByText('Work')).toBeTruthy()
  })
})

describe('TabItem — chromeGroup pill in Now Open (reopen button)', () => {
  it('renders a clickable reopen-group button when isNowOpen and tab has a chromeGroup', () => {
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [
          {
            ...makeGroup({ permanent: true }),
            windows: [{ id: 1, name: 'W', tabs: [], starred: false, incognito: false, focused: false }],
          },
        ],
        active: { id: '', index: 0 },
      },
    })
    const t = makeTab({ chromeGroup: { id: 5, name: 'Work', color: 'blue' } })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByRole('button', { name: /reopen chrome group: work/i })).toBeInTheDocument()
  })
})

describe('TabItem — target groups (move to group)', () => {
  it('shows "No other groups" when this is the only group', async () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ id: 'only' })], active: { id: '', index: 0 } },
    })
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(await screen.findByText(/move to group/i))
    expect(await screen.findByText('No other groups')).toBeInTheDocument()
  })

  it('lists other groups and dispatches moveTab with copy=false for a saved-group source', async () => {
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [makeGroup({ id: 'src', name: 'Source' }), makeGroup({ id: 'dst', name: 'Dest' })],
        active: { id: '', index: 0 },
      },
    })
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(await screen.findByText(/move to group/i))
    fireEvent.click(await screen.findByText('Dest'))
    expect(mockMoveTab).toHaveBeenCalledWith({
      fromGroupIndex: 0,
      fromWindowIndex: 0,
      fromTabIndex: 0,
      toGroupIndex: 1,
      copy: false,
    })
  })

  it('shows "Copy to group" and dispatches copy=true when source is Now Open', async () => {
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [makeGroup({ id: 'src', permanent: true, name: 'Now Open' }), makeGroup({ id: 'dst', name: 'Dest' })],
        active: { id: '', index: 0 },
      },
    })
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    expect(await screen.findByText(/copy to group/i)).toBeInTheDocument()
  })

  it('excludes archived groups from the move-to-group submenu', async () => {
    const user = userEvent.setup()
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [
          makeGroup({ id: 'src', name: 'Source' }),
          makeGroup({ id: 'dst', name: 'Dest' }),
          makeGroup({ id: 'arch', name: 'Archived', archived: true }),
        ],
        active: { id: '', index: 0 },
      },
    })
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(await screen.findByText(/move to group/i))
    expect(await screen.findByText('Dest')).toBeInTheDocument()
    expect(screen.queryByText('Archived')).not.toBeInTheDocument()
  })

  it('shows "Create new group…" in the move-to-group submenu and wires moveTab through its onCreated callback', async () => {
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [makeGroup({ id: 'src', name: 'Source' }), makeGroup({ id: 'dst', name: 'Dest' })],
        active: { id: '', index: 0 },
      },
    })
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={1} tabIndex={2} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(await screen.findByText(/move to group/i))
    const createItem = await screen.findByText('Create new group…')
    fireEvent.click(createItem)
    expect(mockOpenModal).toHaveBeenCalledWith('addGroup', { onCreated: expect.any(Function) })

    const onCreated = mockOpenModal.mock.calls[0][1].onCreated as (groupIndex: number) => void
    onCreated(5)
    expect(mockMoveTab).toHaveBeenCalledWith({
      fromGroupIndex: 0,
      fromWindowIndex: 1,
      fromTabIndex: 2,
      toGroupIndex: 5,
      copy: false,
    })
  })
})

describe('TabItem — url-rule auto-save suggestion (Now Open only)', () => {
  it('shows an Auto-save item when a matching rule and target group exist', async () => {
    mockUseUrlRulesData.mockReturnValue({ data: [{ id: 'r1', pattern: 'example.com', groupId: 'dst', createdAt: 0 }] })
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [makeGroup({ id: 'src', permanent: true, name: 'Now Open' }), makeGroup({ id: 'dst', name: 'Work' })],
        active: { id: '', index: 0 },
      },
    })
    const t = makeTab({ url: 'https://example.com/path' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    expect(await screen.findByText(/auto-save to/i)).toBeInTheDocument()
  })

  it('does not show an Auto-save item when no rule matches', async () => {
    mockUseUrlRulesData.mockReturnValue({ data: [{ id: 'r1', pattern: 'nomatch.com', groupId: 'dst', createdAt: 0 }] })
    mockUseGroupsData.mockReturnValue({
      data: {
        available: [makeGroup({ id: 'src', permanent: true, name: 'Now Open' }), makeGroup({ id: 'dst', name: 'Work' })],
        active: { id: '', index: 0 },
      },
    })
    const user = userEvent.setup()
    const t = makeTab({ url: 'https://example.com/path' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(await screen.findByText(/copy to group/i))
    expect(screen.queryByText(/auto-save to/i)).not.toBeInTheDocument()
  })
})

describe('TabItem — stale badge', () => {
  it('renders the stale indicator when savedAt exceeds the threshold in a saved (non-Now-Open) group', () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ permanent: false })], active: { id: '', index: 0 } },
    })
    const t = makeTab({ savedAt: Date.now() - 100_000 })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} staleThresholdMs={1000} />,
      { wrapper }
    )
    expect(screen.getByLabelText('Stale tab')).toBeInTheDocument()
  })

  it('uses the group color for the stale indicator when groupColor is provided', () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ permanent: false })], active: { id: '', index: 0 } },
    })
    const t = makeTab({ savedAt: Date.now() - 100_000 })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} staleThresholdMs={1000} groupColor="rgb(1, 2, 3)" />,
      { wrapper }
    )
    expect(screen.getByLabelText('Stale tab')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' })
  })

  it('falls back to DEFAULT_GROUP_COLOR for the stale indicator when groupColor is not provided', () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ permanent: false })], active: { id: '', index: 0 } },
    })
    const t = makeTab({ savedAt: Date.now() - 100_000 })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} staleThresholdMs={1000} />,
      { wrapper }
    )
    expect(screen.getByLabelText('Stale tab')).toHaveStyle({ backgroundColor: 'rgba(128, 128, 128, 1)' })
  })

  it('does not render the stale indicator for the Now Open group even if savedAt is old', () => {
    mockUseGroupsData.mockReturnValue({
      data: { available: [makeGroup({ permanent: true })], active: { id: '', index: 0 } },
    })
    const t = makeTab({ savedAt: Date.now() - 100_000 })
    render(
      <TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} staleThresholdMs={1000} />,
      { wrapper }
    )
    expect(screen.queryByLabelText('Stale tab')).not.toBeInTheDocument()
  })
})
