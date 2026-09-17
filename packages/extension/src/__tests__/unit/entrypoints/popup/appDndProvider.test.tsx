/**
 * appDndProvider.test.tsx — RED PHASE (TDD)
 *
 * Item 1 of the unified-DnD rework: `App` must wrap the SidePanel + WindowsPanel in
 * exactly ONE `<DndProvider>` so a single `<DndContext>` spans both panels (the
 * nested provider inside `Windows/index.tsx` then degrades to a passthrough).
 *
 * FAILS NOW because `App.tsx` does not import or render `DndProvider` at all — no
 * provider wraps the two panels.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { App } from '@/entrypoints/popup/App'

const { mockUseGroups, mockUseUIStore, mockGetSetting, cap } = vi.hoisted(() => ({
  mockUseGroups: vi.fn(),
  mockUseUIStore: vi.fn(),
  mockGetSetting: vi.fn(),
  cap: { providerCount: 0 }
}))

vi.mock('@/components/dnd/DndProvider', () => ({
  DndProvider: ({ children }: { children: React.ReactNode }) => {
    cap.providerCount += 1
    return React.createElement('div', { 'data-testid': 'dnd-provider' }, children)
  },
  useDndContext: () => ({ overrideState: null, active: null, isDragging: false })
}))

vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockUseGroups() }))
vi.mock('@/hooks/useCurrentTabs', () => ({ useCurrentTabs: vi.fn() }))
vi.mock('@/hooks/useSync', () => ({ useSync: vi.fn() }))
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }))
vi.mock('@/hooks/useKeyboardNav', () => ({ useKeyboardNav: vi.fn() }))
vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector)
}))

vi.mock('@/components/Header', () => ({ Header: () => React.createElement('div', { 'data-testid': 'header' }) }))
vi.mock('@/components/SidePanel', () => ({
  SidePanel: () => React.createElement('div', { 'data-testid': 'sidepanel' })
}))
vi.mock('@/components/Windows', () => ({
  WindowsPanel: () => React.createElement('div', { 'data-testid': 'windowspanel' })
}))
vi.mock('@/components/Modal', () => ({ ModalRoot: () => null }))
vi.mock('@/components/AIGroupSuggestion', () => ({ AIGroupSuggestion: () => null }))
vi.mock('@/components/SelectionActionBar', () => ({ SelectionActionBar: () => null }))
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
  openModal: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  cap.providerCount = 0
  mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  mockGetSetting.mockResolvedValue(0)
  sessionStorage.clear()
  mockUseGroups.mockReturnValue({
    data: {
      available: [{ id: 'now', name: 'Now Open', permanent: true, windows: [], color: 'rgba(0,0,0,1)', updatedAt: 0 }],
      active: { id: 'now', index: 0 }
    },
    isLoading: false
  })
})

describe('App — one unified DnD provider spanning both panels (item 1)', () => {
  it('renders exactly one <DndProvider>', async () => {
    render(React.createElement(App))
    await waitFor(() => expect(screen.getByTestId('windowspanel')).toBeTruthy())
    expect(cap.providerCount).toBe(1)
  })

  it('nests BOTH the SidePanel and the WindowsPanel inside that provider', async () => {
    render(React.createElement(App))
    await waitFor(() => expect(screen.getByTestId('windowspanel')).toBeTruthy())
    const provider = screen.getByTestId('dnd-provider')
    expect(provider.querySelector('[data-testid="sidepanel"]')).not.toBeNull()
    expect(provider.querySelector('[data-testid="windowspanel"]')).not.toBeNull()
  })
})
