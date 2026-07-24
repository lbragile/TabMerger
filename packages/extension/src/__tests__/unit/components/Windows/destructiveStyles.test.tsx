import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowItem } from '@/components/Windows/Window'
import { TabItem } from '@/components/Windows/Tab'
import type { Window as WindowType } from '@/lib/types'
import type { Tab as TabType } from '@/lib/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: <T,>(arr: T[], from: number, to: number) => { const a = [...arr]; const [item] = a.splice(from, 1); a.splice(to, 0, item); return a; },
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    DragOverlay: () => null,
    useSensors: vi.fn(() => []),
    useSensor: vi.fn(),
  }
})

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteWindow: () => ({ mutate: vi.fn() }),
  useUpdateWindowName: () => ({ mutate: vi.fn() }),
  useUpdateWindowNote: () => ({ mutate: vi.fn() }),
  useToggleWindowStarred: () => ({ mutate: vi.fn() }),
  useToggleWindowIncognito: () => ({ mutate: vi.fn() }),
  useMoveWindow: () => ({ mutate: vi.fn() }),
  useGroups: () => ({ data: { available: [] } }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useDeleteTab: () => ({ mutate: vi.fn() }),
  useMoveTab: () => ({ mutate: vi.fn() }),
  useUpdateTabNote: () => ({ mutate: vi.fn() }),
  useSetTabReminder: () => ({ mutate: vi.fn() }),
  useClearTabReminder: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) =>
    selector({
      openModal: vi.fn(),
      selectionMode: false,
      selectedItems: [],
      toggleSelection: vi.fn(),
      enterSelectionMode: vi.fn(),
    }),
}))

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({}),
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
}))

vi.mock('@/hooks/useOpenWindow', () => ({
  useOpenWindow: () => vi.fn(),
}))

vi.mock('@/lib/chromeGroups', () => ({
  openTabInChromeGroup: vi.fn(),
}))

vi.mock('@/components/Windows/TabPreview', () => ({
  TabPreview: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

globalThis.chrome = {
  tabs: { create: vi.fn(), query: vi.fn() },
  tabGroups: null,
} as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(TooltipProvider, null, ui)
    )
  )
}

function makeWindow(overrides: Partial<WindowType> = {}): WindowType {
  return { id: 1, name: 'Window 1', tabs: [], starred: false, incognito: false, focused: false, ...overrides }
}

function makeTab(overrides: Partial<TabType> = {}): TabType {
  return { id: 1, title: 'Example', url: 'https://example.com', ...overrides }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Destructive button styling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('WindowItem — Delete window dropdown item', () => {
    async function openMoreMenu() {
      // MoreHorizontal button is the last visible button in the window header
      const buttons = screen.getAllByRole('button')
      await userEvent.click(buttons[buttons.length - 1])
      return screen.getByText('Remove window').closest('[role="menuitem"]') as HTMLElement
    }

    it('has text-destructive at rest', async () => {
      wrap(React.createElement(WindowItem, { window: makeWindow(), groupIndex: 0, windowIndex: 0, siblingCount: 2, tabIds: [] }))
      const item = await openMoreMenu()
      expect(item.className).toMatch(/text-destructive/)
    })

    it('has data-[highlighted] classes so hover/focus stays red', async () => {
      wrap(React.createElement(WindowItem, { window: makeWindow(), groupIndex: 0, windowIndex: 0, siblingCount: 2, tabIds: [] }))
      const item = await openMoreMenu()
      expect(item.className).toMatch(/data-\[highlighted\]:bg-destructive/)
      expect(item.className).toMatch(/data-\[highlighted\]:text-destructive/)
    })
  })

  describe('TabItem — close (X) button', () => {
    function getDeleteButton(container: HTMLElement) {
      return container.querySelector('button[class*="text-destructive"]') as HTMLElement
    }

    it('has text-destructive at rest', () => {
      const { container } = wrap(
        React.createElement(TabItem, { tab: makeTab(), groupIndex: 0, windowIndex: 0, tabIndex: 0, siblingCount: 2 })
      )
      const btn = getDeleteButton(container)
      expect(btn).toBeTruthy()
      expect(btn.className).toMatch(/text-destructive/)
    })

    it('has hover:text-destructive and hover:bg-destructive/10 for hover state', () => {
      const { container } = wrap(
        React.createElement(TabItem, { tab: makeTab(), groupIndex: 0, windowIndex: 0, tabIndex: 0, siblingCount: 2 })
      )
      const btn = getDeleteButton(container)
      expect(btn.className).toMatch(/hover:text-destructive/)
      expect(btn.className).toMatch(/hover:bg-destructive/)
    })
  })
})
