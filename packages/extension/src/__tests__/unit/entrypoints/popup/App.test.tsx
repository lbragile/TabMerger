import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from '@/entrypoints/popup/App'

const { mockUseGroups, mockUseUIStore, mockGetSetting, mockTrackEvent } = vi.hoisted(() => ({
  mockUseGroups: vi.fn(),
  mockUseUIStore: vi.fn(),
  mockGetSetting: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockUseGroups() }))
vi.mock('@/hooks/useCurrentTabs', () => ({ useCurrentTabs: vi.fn() }))
vi.mock('@/hooks/useSync', () => ({ useSync: vi.fn() }))
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }))
vi.mock('@/hooks/useKeyboardNav', () => ({ useKeyboardNav: vi.fn() }))
vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
vi.mock('@/stores/uiStore', () => ({ useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector) }))

// App now hoists a single real <DndProvider> around the panels; mock it here (the
// panels themselves are already stubbed) so this suite needs no QueryClient.
vi.mock('@/components/dnd/DndProvider', () => ({
  DndProvider: ({ children }: { children: unknown }) => <>{children as never}</>,
  useDndContext: () => ({ overrideState: null, active: null, isDragging: false }),
}))

vi.mock('@/components/KeyboardMove/KeyboardMoveHost', () => ({ KeyboardMoveHost: () => null }))
vi.mock('@/components/Header', () => ({ Header: () => <div data-testid="header" /> }))
vi.mock('@/components/SidePanel', () => ({ SidePanel: () => <div data-testid="sidepanel" /> }))
vi.mock('@/components/Windows', () => ({ WindowsPanel: ({ groupIndex }: { groupIndex: number }) => <div data-testid="windowspanel">{groupIndex}</div> }))
vi.mock('@/components/Modal', () => ({ ModalRoot: () => <div data-testid="modalroot" /> }))
vi.mock('@/components/AIGroupSuggestion', () => ({ AIGroupSuggestion: () => null }))
vi.mock('@/components/SelectionActionBar', () => ({ SelectionActionBar: () => <div data-testid="selectionbar" /> }))
vi.mock('@/components/SubscriptionStatusBanner', () => ({ SubscriptionStatusBanner: () => null }))
vi.mock('@/components/UpgradeCTA', () => ({ UpgradeCTA: () => null }))
vi.mock('@/components/CleanupSuggestionBanner', () => ({ CleanupSuggestionBanner: () => null }))

const baseUIState = {
  activeGroupIndex: 0,
  searchFilter: '',
  setActiveGroupIndex: vi.fn(),
  selectionMode: false,
  selectedItems: [] as unknown[],
  exitSelectionMode: vi.fn(),
}

function mockGroupsState(available: Array<{ id: string; name: string }>) {
  mockUseGroups.mockReturnValue({ data: { available, active: { id: available[0]?.id, index: 0 } }, isLoading: false })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  mockGetSetting.mockResolvedValue(0)
  sessionStorage.clear()
})

describe('App — loading state', () => {
  it('shows a spinner while groups are loading', () => {
    mockUseGroups.mockReturnValue({ data: undefined, isLoading: true })
    render(<App />)
    expect(screen.queryByTestId('header')).toBeNull()
  })
})

describe('App — loaded state', () => {
  it('renders the main layout once groups have loaded', async () => {
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    render(<App />)
    expect(screen.getByTestId('header')).toBeTruthy()
    expect(screen.getByTestId('sidepanel')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('windowspanel')).toBeTruthy())
  })

  it('tracks "extension_opened" only once per session', () => {
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    render(<App />)
    expect(mockTrackEvent).toHaveBeenCalledWith('extension_opened')
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })

  it('does not track "extension_opened" again on a second render if sessionStorage flag is set', () => {
    sessionStorage.setItem('ext_opened', '1')
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    render(<App />)
    expect(mockTrackEvent).not.toHaveBeenCalledWith('extension_opened')
  })

  it('restores a saved activeGroupIndex, clamping if it is out of range', async () => {
    mockGetSetting.mockResolvedValue(5) // out of range for a 1-group state
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    render(<App />)
    await waitFor(() => expect(baseUIState.setActiveGroupIndex).toHaveBeenCalledWith(0))
  })

  it('shows the SelectionActionBar only when items are selected', () => {
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectedItems: [{ type: 'tab' }] })
    )
    render(<App />)
    expect(screen.getByTestId('selectionbar')).toBeTruthy()
  })

  it('Escape exits selection mode — but NOT when a keyboard drag already consumed it (defaultPrevented)', () => {
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
    render(<App />)
    // dnd-kit's KeyboardSensor cancels the drag with preventDefault on its document listener
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    consumed.preventDefault()
    window.dispatchEvent(consumed)
    expect(baseUIState.exitSelectionMode).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(baseUIState.exitSelectionMode).toHaveBeenCalledTimes(1)
  })

  it('Escape with focus on a selection checkbox hands focus to its row before the checkbox unmounts', () => {
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, selectionMode: true })
    )
    render(<App />)
    const row = document.createElement('div')
    row.setAttribute('role', 'listitem')
    row.tabIndex = 0
    const checkbox = document.createElement('button')
    checkbox.setAttribute('role', 'checkbox')
    row.appendChild(checkbox)
    document.body.appendChild(row)
    checkbox.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(row)
    expect(baseUIState.exitSelectionMode).toHaveBeenCalled()
    row.remove()
  })

  it('always mounts the selection live region (outside the DnD provider)', () => {
    mockGroupsState([{ id: 'now', name: 'Now Open' }])
    render(<App />)
    expect(screen.getByTestId('selection-announcer').getAttribute('role')).toBe('status')
  })

  it('shows "No group selected" when available is empty', () => {
    mockGroupsState([])
    render(<App />)
    expect(screen.getByText('No group selected')).toBeTruthy()
  })
})
