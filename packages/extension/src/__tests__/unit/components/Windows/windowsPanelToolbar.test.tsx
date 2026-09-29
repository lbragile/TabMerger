/**
 * Branch coverage for WindowsPanel toolbar/menu: dropdown mutations, stale-tabs
 * badge visibility (permanent vs saved group), group note editor, empty-group
 * message, deduplicate no-op, and Add Window selectionMode guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { clearDndDragLive, setDndDragLive } from '@/lib/dndMultiDrag'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowsPanel } from '@/components/Windows'
import type { Group, Window as ExtWindow, Tab } from '@/lib/types'

const {
  mockReplaceWithCurrent,
  mockMergeWithCurrent,
  mockUniteWindows,
  mockSplitWindows,
  mockSortTabs,
  mockDeleteAllWindows,
  mockUpdateGroupNote,
  mockRemoveStaleTabs,
  mockAddWindow,
  mockToastInfo,
  mockOpenModal,
  mockGetSetting,
  mockExitSelectionMode,
} = vi.hoisted(() => ({
  mockReplaceWithCurrent: vi.fn(),
  mockMergeWithCurrent: vi.fn(),
  mockUniteWindows: vi.fn(),
  mockSplitWindows: vi.fn(),
  mockSortTabs: vi.fn(),
  mockDeleteAllWindows: vi.fn(),
  mockUpdateGroupNote: vi.fn(),
  mockRemoveStaleTabs: vi.fn(),
  mockAddWindow: vi.fn(),
  mockToastInfo: vi.fn(),
  mockOpenModal: vi.fn(),
  mockGetSetting: vi.fn(),
  mockExitSelectionMode: vi.fn(),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  closestCenter: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  DragOverlay: () => null,
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: <T,>(arr: T[]) => arr,
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
  getEventCoordinates: vi.fn(),
}))

vi.mock('@/components/Windows/Window', () => ({
  WindowItem: () => React.createElement('div', { 'data-testid': 'window-item' }),
}))

vi.mock('@/hooks/useDnd', () => ({
  useDndSensors: () => [],
  useWindowDndHandlers: () => ({ onDragEnd: vi.fn() }),
  setBodyDragCursor: vi.fn(),
  parseDndId: vi.fn(() => ({ kind: 'tab', tabId: 0, groupIndex: 0, windowIndex: 0, tabIndex: 0 })),
}))

vi.mock('@/hooks/useGroups', () => ({
  useAddWindow: () => ({ mutate: mockAddWindow }),
  useReplaceWithCurrent: () => ({ mutate: mockReplaceWithCurrent }),
  useMergeWithCurrent: () => ({ mutate: mockMergeWithCurrent }),
  useUniteWindows: () => ({ mutate: mockUniteWindows }),
  useSplitWindows: () => ({ mutate: mockSplitWindows }),
  useSortTabs: () => ({ mutate: mockSortTabs }),
  useDeleteAllWindows: () => ({ mutate: mockDeleteAllWindows }),
  useUpdateGroupNote: () => ({ mutate: mockUpdateGroupNote }),
  useRemoveStaleTabs: () => ({ mutate: mockRemoveStaleTabs }),
  GROUPS_QUERY_KEY: ['groups'],
}))

let entitledMaxTabs = Infinity
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ maxTabs: entitledMaxTabs, tier: 'pro', aiFeatures: false }),
}))

let selectionMode = false
let selectedItems: Array<{ type: string; id: string }> = []
let searchFilterState = ''
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      searchFilter: searchFilterState,
      scrollToWindowIndex: null,
      setScrollToWindowIndex: vi.fn(),
      activeGroupIndex: 0,
      selectionMode,
      selectedItems,
      exitSelectionMode: mockExitSelectionMode,
      openModal: mockOpenModal,
      setSelection: mockSetSelection,
      enterSelectionMode: mockEnterSelectionMode,
      pendingNoteGroupIndex: null,
      setPendingNoteGroupIndex: vi.fn(),
    }),
}))
const mockSetSelection = vi.fn()
const mockEnterSelectionMode = vi.fn()

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  getSetting: mockGetSetting,
  setSetting: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({ toast: { info: mockToastInfo, error: vi.fn(), success: vi.fn() } }))

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return { id: 1, title: 'Tab', url: 'https://example.com', favIconUrl: '', pinned: false, ...overrides }
}

function makeWindow(overrides: Partial<ExtWindow> = {}): ExtWindow {
  return { id: 1, tabs: [makeTab()], incognito: false, focused: false, starred: false, ...overrides }
}

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Group',
    color: 'rgba(0,0,0,1)',
    updatedAt: Date.now(),
    windows: [makeWindow()],
    permanent: false,
    starred: false,
    ...overrides,
  }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TooltipProvider, null, ui)))
}

beforeEach(() => {
  vi.clearAllMocks()
  selectionMode = false
  selectedItems = []
  mockGetSetting.mockResolvedValue({})
  globalThis.chrome = {
    ...globalThis.chrome,
    windows: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as typeof chrome
})

async function openMenu() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /more group options/i }))
  return user
}

describe('WindowsPanel — Ctrl/Cmd+A selects everything in the panel', () => {
  const twoWindows = () => makeGroup({ windows: [makeWindow({ tabs: [makeTab(), makeTab()] }), makeWindow({ tabs: [makeTab()] })] })

  it('selects every TAB of this group and enters selection mode (and suppresses page select-all)', () => {
    wrap(<WindowsPanel group={twoWindows()} groupIndex={2} />)
    const panel = screen.getByTestId('windows-panel-scroll')
    const ev = fireEvent.keyDown(panel, { key: 'a', ctrlKey: true })
    expect(ev).toBe(false) // preventDefault
    expect(mockEnterSelectionMode).toHaveBeenCalled()
    expect(mockSetSelection).toHaveBeenCalledWith([
      { type: 'tab', id: 'tab-2-0-0' },
      { type: 'tab', id: 'tab-2-0-1' },
      { type: 'tab', id: 'tab-2-1-0' },
    ])
  })

  it('selects every WINDOW when windows are the current selection type (Cmd+A too)', () => {
    selectedItems = [{ type: 'window', id: 'window-2-0' }]
    wrap(<WindowsPanel group={twoWindows()} groupIndex={2} />)
    fireEvent.keyDown(screen.getByTestId('windows-panel-scroll'), { key: 'A', metaKey: true })
    expect(mockSetSelection).toHaveBeenCalledWith([
      { type: 'window', id: 'window-2-0' },
      { type: 'window', id: 'window-2-1' },
    ])
  })

  it('ignores plain A, Ctrl+Shift+A, text inputs, and an empty group', () => {
    const { unmount } = wrap(<WindowsPanel group={twoWindows()} groupIndex={2} />)
    const panel = screen.getByTestId('windows-panel-scroll')
    fireEvent.keyDown(panel, { key: 'a' })
    fireEvent.keyDown(panel, { key: 'a', ctrlKey: true, shiftKey: true })
    const input = document.createElement('input')
    panel.appendChild(input)
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true })
    unmount()
    wrap(<WindowsPanel group={makeGroup({ windows: [] })} groupIndex={2} />)
    fireEvent.keyDown(screen.getByTestId('windows-panel-scroll'), { key: 'a', ctrlKey: true })
    expect(mockSetSelection).not.toHaveBeenCalled()
  })
})

describe('WindowsPanel — Ctrl/Cmd+A only selects what the user can act on', () => {
  beforeEach(() => {
    searchFilterState = ''
    entitledMaxTabs = Infinity
  })
  afterEach(() => {
    searchFilterState = ''
    entitledMaxTabs = Infinity
    clearDndDragLive()
  })

  it('does nothing while a drag is live (it would change what the drag carries)', () => {
    setDndDragLive('keyboard')
    wrap(<WindowsPanel group={makeGroup({ windows: [makeWindow({ tabs: [makeTab(), makeTab()] })] })} groupIndex={2} />)
    const ev = fireEvent.keyDown(screen.getByTestId('windows-panel-scroll'), { key: 'a', ctrlKey: true })
    expect(ev).toBe(true) // not preventDefault-ed
    expect(mockSetSelection).not.toHaveBeenCalled()
  })

  it('skips tabs dimmed out by the search filter', () => {
    searchFilterState = 'github'
    const group = makeGroup({
      windows: [
        makeWindow({ tabs: [makeTab({ title: 'GitHub', url: 'https://github.com' }), makeTab({ title: 'Mail', url: 'https://mail.example.com' })] }),
      ],
    })
    wrap(<WindowsPanel group={group} groupIndex={2} />)
    fireEvent.keyDown(screen.getByTestId('windows-panel-scroll'), { key: 'a', ctrlKey: true })
    expect(mockSetSelection).toHaveBeenCalledWith([{ type: 'tab', id: 'tab-2-0-0' }])
  })

  it('skips tabs locked by the free-tier limit (counted across windows)', () => {
    entitledMaxTabs = 2
    const group = makeGroup({ windows: [makeWindow({ tabs: [makeTab(), makeTab()] }), makeWindow({ tabs: [makeTab()] })] })
    wrap(<WindowsPanel group={group} groupIndex={2} />)
    fireEvent.keyDown(screen.getByTestId('windows-panel-scroll'), { key: 'a', ctrlKey: true })
    expect(mockSetSelection).toHaveBeenCalledWith([
      { type: 'tab', id: 'tab-2-0-0' },
      { type: 'tab', id: 'tab-2-0-1' },
    ])
  })
})

describe('WindowsPanel — toolbar dropdown mutations', () => {
  it('dispatches replaceWithCurrent', async () => {
    const group = makeGroup()
    wrap(<WindowsPanel group={group} groupIndex={2} />)
    const user = await openMenu()
    await user.click(screen.getByText('Replace with current'))
    expect(mockReplaceWithCurrent).toHaveBeenCalledWith(2)
  })

  it('dispatches mergeWithCurrent', async () => {
    const group = makeGroup()
    wrap(<WindowsPanel group={group} groupIndex={1} />)
    const user = await openMenu()
    await user.click(screen.getByText('Merge with current'))
    expect(mockMergeWithCurrent).toHaveBeenCalledWith(1)
  })

  it('dispatches uniteWindows and splitWindows', async () => {
    const group = makeGroup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    let user = await openMenu()
    await user.click(screen.getByText('Unite windows'))
    expect(mockUniteWindows).toHaveBeenCalledWith(0)

    user = await openMenu()
    await user.click(screen.getByText('Split windows'))
    expect(mockSplitWindows).toHaveBeenCalledWith(0)
  })

  it('dispatches sortTabs by title and by url', async () => {
    const group = makeGroup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    let user = await openMenu()
    await user.click(screen.getByText('Sort by title'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 0, by: 'title' })

    user = await openMenu()
    await user.click(screen.getByText('Sort by URL'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 0, by: 'url' })
  })

  it('deduplicate: shows "No duplicates found" toast when there are none', async () => {
    const group = makeGroup({ windows: [makeWindow({ tabs: [makeTab({ url: 'https://a.com' })] })] })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    const user = await openMenu()
    await user.click(screen.getByText('Deduplicate tabs'))
    expect(mockToastInfo).toHaveBeenCalledWith('No duplicates found')
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('deduplicate: opens the deduplicateGroup modal when duplicates exist', async () => {
    const dupTab = makeTab({ url: 'https://dup.com' })
    const group = makeGroup({
      windows: [
        makeWindow({ tabs: [dupTab] }),
        makeWindow({ id: 2, tabs: [makeTab({ id: 2, url: 'https://dup.com' })] }),
      ],
    })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    const user = await openMenu()
    await user.click(screen.getByText('Deduplicate tabs'))
    expect(mockOpenModal).toHaveBeenCalledWith('deduplicateGroup', expect.objectContaining({ groupIndex: 0 }))
  })

  it('dispatches deleteAllWindows and shows "Close all windows" label for a permanent group', async () => {
    const group = makeGroup({ permanent: true })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    const user = await openMenu()
    expect(screen.getByText('Close all windows')).toBeInTheDocument()
    await user.click(screen.getByText('Close all windows'))
    expect(mockDeleteAllWindows).toHaveBeenCalledWith({ groupIndex: 0 })
  })

  it('shows "Remove all windows" label for a non-permanent group', async () => {
    const group = makeGroup({ permanent: false })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    await openMenu()
    expect(screen.getByText('Remove all windows')).toBeInTheDocument()
  })
})

describe('WindowsPanel — stale tabs badge', () => {
  it('shows the stale-tabs button for a saved group with stale tabs and removes them on click', async () => {
    mockGetSetting.mockResolvedValue({ staleThresholdDays: 1 })
    const staleTab = makeTab({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })
    const group = makeGroup({ permanent: false, windows: [makeWindow({ tabs: [staleTab] })] })
    const user = userEvent.setup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)

    const btn = await screen.findByRole('button', { name: /remove 1 stale tab/i })
    await user.click(btn)
    expect(mockRemoveStaleTabs).toHaveBeenCalledWith(expect.objectContaining({ groupIndex: 0 }))
  })

  it('opens the removeStaleTabs confirm modal instead of removing directly when confirmOnDelete=true', async () => {
    mockGetSetting.mockResolvedValue({ staleThresholdDays: 1, confirmOnDelete: true })
    const staleTab = makeTab({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })
    const group = makeGroup({ permanent: false, windows: [makeWindow({ tabs: [staleTab] })] })
    const user = userEvent.setup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)

    const btn = await screen.findByRole('button', { name: /remove 1 stale tab/i })
    await user.click(btn)
    expect(mockOpenModal).toHaveBeenCalledWith('removeStaleTabs', expect.objectContaining({ count: 1 }))
    expect(mockRemoveStaleTabs).not.toHaveBeenCalled()
  })

  it('styles the stale-tabs button to match the group color', async () => {
    mockGetSetting.mockResolvedValue({ staleThresholdDays: 1 })
    const staleTab = makeTab({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })
    const group = makeGroup({ permanent: false, color: 'rgba(10,20,30,1)', windows: [makeWindow({ tabs: [staleTab] })] })
    wrap(<WindowsPanel group={group} groupIndex={0} />)

    const btn = await screen.findByRole('button', { name: /remove 1 stale tab/i })
    expect(btn).toHaveStyle({ color: 'rgba(10,20,30,1)' })
  })

  it('never shows the stale-tabs button for a permanent (Now Open) group', async () => {
    mockGetSetting.mockResolvedValue({ staleThresholdDays: 1 })
    const staleTab = makeTab({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })
    const group = makeGroup({ permanent: true, windows: [makeWindow({ tabs: [staleTab] })] })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    // flush the async getSetting()-driven staleThresholdMs effect (act-wrapped) before asserting
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('button', { name: /remove.*stale/i })).not.toBeInTheDocument()
  })
})

describe('WindowsPanel — group note editor', () => {
  it('shows the note icon only when group.note is set, opens editor, saves via commit', async () => {
    const group = makeGroup({ note: 'Existing note' })
    const user = userEvent.setup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)

    await user.click(screen.getByRole('button', { name: 'Edit group note' }))
    const textarea = screen.getByPlaceholderText('Add a note for this group…')
    expect(textarea).toHaveValue('Existing note')

    await user.clear(textarea)
    await user.type(textarea, 'Updated')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockUpdateGroupNote).toHaveBeenCalledWith({ groupIndex: 0, note: 'Updated' })
  })

  it('does not render the note icon when group.note is unset', () => {
    const group = makeGroup({ note: undefined })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    expect(screen.queryByRole('button', { name: 'Edit group note' })).not.toBeInTheDocument()
  })

  it('cancel closes the editor without committing', async () => {
    const group = makeGroup({ note: 'Existing note' })
    const user = userEvent.setup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    await user.click(screen.getByRole('button', { name: 'Edit group note' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockUpdateGroupNote).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Add a note for this group…')).not.toBeInTheDocument()
  })
})

describe('WindowsPanel — empty state and Add Window guard', () => {
  it('shows "No windows in this group" when there are no windows', () => {
    const group = makeGroup({ windows: [] })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    expect(screen.getByText('No windows in this group')).toBeInTheDocument()
  })

  it('disables Add Window while in selection mode', () => {
    selectionMode = true
    const group = makeGroup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    expect(screen.getByRole('button', { name: /add window/i })).toBeDisabled()
  })

  it('renders Add Window for a permanent (Now Open) group, opening a REAL browser window instead of a stored one', async () => {
    const group = makeGroup({ permanent: true })
    const user = userEvent.setup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    const btn = screen.getByRole('button', { name: /add window/i })
    expect(btn).toBeInTheDocument()
    await user.click(btn)
    expect(chrome.windows.create).toHaveBeenCalledWith({})
    // Must NOT insert an empty stored window — useCurrentTabs would overwrite/vanish it.
    expect(mockAddWindow).not.toHaveBeenCalled()
  })

  it('DOES render the new-window drop zone for a permanent (Now Open) group — dropping a tab there is a real chrome.windows.create/tabs.move detach, not a stored mutation', () => {
    const group = makeGroup({ permanent: true })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    expect(screen.queryByTestId('new-window-dropzone')).toBeInTheDocument()
  })

  it('clicking Add Window dispatches addWindow with the group index', async () => {
    const group = makeGroup()
    const user = userEvent.setup()
    wrap(<WindowsPanel group={group} groupIndex={3} />)
    await user.click(screen.getByRole('button', { name: /add window/i }))
    expect(mockAddWindow).toHaveBeenCalledWith({ groupIndex: 3 })
  })

  /**
   * 2c — the "Add Window" button used to sit ~40px below the last window because the
   * ALWAYS-MOUNTED new-window drop zone was `invisible` but still in the flow. The zone
   * is now absolutely positioned over the button, so the only gap is a single `mt-2` —
   * the same 8px the sidebar uses above "Add Group".
   */
  it('puts the new-window drop zone OVER the Add Window button, leaving only the window card gap', () => {
    const group = makeGroup()
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    const zone = screen.getByTestId('new-window-dropzone')
    expect(zone.className).toMatch(/absolute/)
    expect(zone.className).not.toMatch(/\bmt-\d/)
    const box = zone.parentElement!
    expect(box.className).toMatch(/relative/)
    // No top margin of its own: every window card already carries `mb-2`, so the gap
    // above the button is the same 8px the sidebar's `mt-2` puts above "Add Group"
    // (sidebar group rows have no margin of their own).
    expect(box.className).not.toMatch(/\bmt-/)
    // Both children survive the whole drag — neither may be unmounted (spec C4).
    expect(box.textContent).toMatch(/Add Window/)
    // The button itself no longer carries its own top margin.
    expect(screen.getByRole('button', { name: /add window/i }).className).not.toMatch(/\bmt-/)
  })
})

describe('WindowsPanel — window/tab count header', () => {
  it('sums tabs across every window regardless of stale-tab data on individual tabs', () => {
    const group = makeGroup({
      windows: Array.from({ length: 6 }, (_, i) =>
        makeWindow({
          id: i + 1,
          tabs: [makeTab({ id: i + 1, savedAt: i % 2 === 0 ? Date.now() - 100 * 24 * 60 * 60 * 1000 : undefined })],
        })
      ),
    })
    wrap(<WindowsPanel group={group} groupIndex={0} />)
    expect(screen.getByText('6 Windows ◆ 6 Tabs')).toBeInTheDocument()
  })
})

describe('WindowsPanel — clicking empty panel space clears the selection', () => {
  it('a click on empty panel space exits selection mode when items are selected', () => {
    selectionMode = true
    selectedItems = [{ type: 'tab', id: 'tab-1-0-0' }]
    wrap(<WindowsPanel group={makeGroup()} groupIndex={1} />)
    fireEvent.click(screen.getByTestId('windows-panel-scroll'))
    expect(mockExitSelectionMode).toHaveBeenCalledTimes(1)
  })

  it('a click on a control inside the panel does not clear it, and with nothing selected a click does nothing', () => {
    selectedItems = [{ type: 'tab', id: 'tab-1-0-0' }]
    wrap(<WindowsPanel group={makeGroup()} groupIndex={1} />)
    fireEvent.click(screen.getByRole('button', { name: /add window/i }))
    expect(mockExitSelectionMode).not.toHaveBeenCalled()

    selectedItems = []
    wrap(<WindowsPanel group={makeGroup({ id: 'g2' })} groupIndex={2} />)
    fireEvent.click(screen.getAllByTestId('windows-panel-scroll')[1])
    expect(mockExitSelectionMode).not.toHaveBeenCalled()
  })
})
