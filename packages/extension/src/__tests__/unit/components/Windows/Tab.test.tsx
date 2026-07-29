import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabItem } from '@/components/Windows/Tab'
import type { Tab, Group, GroupsState } from '@/lib/types'

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
} = vi.hoisted(() => ({
  mockDeleteTab: vi.fn(),
  mockMoveTab: vi.fn(),
  mockUpdateTabNote: vi.fn(),
  mockSetTabReminder: vi.fn(),
  mockClearTabReminder: vi.fn(),
  mockUseGroupsData: vi.fn(),
  mockToggleSelection: vi.fn(),
  mockEnterSelectionMode: vi.fn(),
  mockUseUrlRulesData: vi.fn(() => ({ data: [] })),
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
  mockOpenTabInChromeGroup: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: mockSaveGroupsState,
  getGroupsState: vi.fn(),
  getSetting: vi.fn().mockResolvedValue([]),
  setSetting: vi.fn(),
}))

vi.mock('@/lib/chromeGroups', () => ({
  openTabInChromeGroup: mockOpenTabInChromeGroup,
}))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
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

vi.mock('@/hooks/useUrlRules', () => ({
  useUrlRules: () => mockUseUrlRulesData(),
  matchUrlToRule: vi.fn((url: string | undefined, rules: Array<{ pattern: string; groupId: string }>) => {
    const rule = rules.find((r) => url?.includes(r.pattern))
    return rule?.groupId ?? null
  }),
}))

let selectionState = {
  selectionMode: false,
  selectedItems: [] as Array<{ type: string; id: string }>,
}

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      openModal: vi.fn(),
      selectionMode: selectionState.selectionMode,
      selectedItems: selectionState.selectedItems,
      toggleSelection: mockToggleSelection,
      enterSelectionMode: mockEnterSelectionMode,
    }),
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

  it('renders the tab URL hostname (no protocol/path) with a truncate class', () => {
    const t = makeTab({ url: 'https://www.example.com/some/deep/path?query=1' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const hostEl = screen.getByText('example.com')
    expect(hostEl.className).toMatch(/truncate/)
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

describe('TabItem — selection mode', () => {
  it('shows a checkbox instead of the drag handle, toggles selection on click', async () => {
    selectionState = { selectionMode: true, selectedItems: [] }
    const user = userEvent.setup()
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    const checkbox = screen.getByRole('button', { name: 'Select tab' })
    await user.click(checkbox)
    expect(mockToggleSelection).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' })
  })

  it('shows "Deselect tab" label when this tab is already selected', () => {
    selectionState = { selectionMode: true, selectedItems: [{ type: 'tab', id: 'tab-0-0-0' }] }
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.getByRole('button', { name: 'Deselect tab' })).toBeInTheDocument()
  })

  it('hides the checkbox when a non-tab type is already committed to the selection', () => {
    selectionState = { selectionMode: true, selectedItems: [{ type: 'window', id: 'window-0-0' }] }
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    expect(screen.queryByRole('button', { name: /select tab/i })).not.toBeInTheDocument()
  })

  it('ctrl+click on the row enters selection mode and toggles the tab', () => {
    const t = makeTab()
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.click(screen.getByRole('listitem'), { ctrlKey: true })
    expect(mockEnterSelectionMode).toHaveBeenCalled()
    expect(mockToggleSelection).toHaveBeenCalledWith({ type: 'tab', id: 'tab-0-0-0' })
    expect(globalThis.chrome.tabs.create).not.toHaveBeenCalled()
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
    const user = userEvent.setup()
    const t = makeTab({ title: 'Example Tab' })
    render(<TabItem tab={t} groupIndex={0} windowIndex={0} tabIndex={0} siblingCount={1} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('listitem'))
    await user.click(screen.getByText(/rename tab/i))
    const input = await screen.findByDisplayValue('Example Tab')
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mockSaveGroupsState).toHaveBeenCalled())
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
})

describe('TabItem — url-rule auto-save suggestion (Now Open only)', () => {
  it('shows an Auto-save item when a matching rule and target group exist', async () => {
    mockUseUrlRulesData.mockReturnValue({ data: [{ id: 'r1', pattern: 'example.com', groupId: 'dst' }] })
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
    mockUseUrlRulesData.mockReturnValue({ data: [{ id: 'r1', pattern: 'nomatch.com', groupId: 'dst' }] })
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
