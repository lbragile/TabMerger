import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowItem } from '@/components/Windows/Window'
import type { Window as WindowType } from '@/lib/types'

// ─── vi.hoisted — vars referenced inside vi.mock factories ───────────────────

const { mockOpenWindow, mockSortTabs } = vi.hoisted(() => ({
  mockOpenWindow: vi.fn().mockResolvedValue(undefined),
  mockSortTabs: vi.fn(),
}))

// ─── DnD stubs ────────────────────────────────────────────────────────────────

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

// ─── lucide-react — partial mock to give key icons test-ids ──────────────────

vi.mock('lucide-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('lucide-react')>()
  return {
    ...original,
    EyeOff: (props: React.SVGProps<SVGSVGElement>) =>
      React.createElement('svg', { 'data-testid': 'eye-off-icon', ...props }),
    MoreHorizontal: (props: React.SVGProps<SVGSVGElement>) =>
      React.createElement('svg', { 'data-testid': 'more-horizontal-icon', ...props }),
    ExternalLink: (props: React.SVGProps<SVGSVGElement>) =>
      React.createElement('svg', { 'data-testid': 'external-link-icon', ...props }),
  }
})

// ─── Hooks ────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useOpenWindow', () => ({
  useOpenWindow: () => mockOpenWindow,
}))

vi.mock('@/hooks/useGroups', () => ({
  useDeleteWindow: () => ({ mutate: vi.fn() }),
  useUpdateWindowName: () => ({ mutate: vi.fn() }),
  useUpdateWindowNote: () => ({ mutate: vi.fn() }),
  useToggleWindowStarred: () => ({ mutate: vi.fn() }),
  useToggleWindowIncognito: () => ({ mutate: vi.fn() }),
  useMoveWindow: () => ({ mutate: vi.fn() }),
  useGroups: () => ({
    data: {
      available: [
        { permanent: false, id: 'g0', name: 'Group 0', color: 'rgba(0,0,0,1)', windows: [], updatedAt: 0 },
      ],
      active: { id: '', index: 0 },
    },
  }),
  useSortTabs: () => ({ mutate: mockSortTabs }),
}))

// ─── lib/localDb ──────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  setSetting: vi.fn().mockResolvedValue(undefined),
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
  getSetting: vi.fn().mockResolvedValue({ confirmOnWindowClose: false }),
}))

// ─── UI store ─────────────────────────────────────────────────────────────────

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

// ─── Tab child stub ───────────────────────────────────────────────────────────

vi.mock('@/components/Windows/Tab', () => ({
  TabItem: () => React.createElement('div', { 'data-testid': 'tab-item' }),
}))

// ─── Chrome stub ──────────────────────────────────────────────────────────────

globalThis.chrome = {
  tabs: { create: vi.fn(), query: vi.fn() },
  windows: { create: vi.fn(), update: vi.fn() },
} as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWindow(overrides: Partial<WindowType> = {}): WindowType {
  return {
    id: 1,
    tabs: [],
    incognito: false,
    focused: false,
    starred: false,
    name: 'Test Window',
    ...overrides,
  }
}

function makeTab(id: number) {
  return { id, title: `Tab ${id}`, url: `https://example.com/${id}` }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TooltipProvider, null, ui)
    )
  )
}

function renderWindow(win: WindowType, groupIndex = 0, windowIndex = 0) {
  const tabIds = win.tabs.map((t) => `tab-${t.id}`)
  return wrap(React.createElement(WindowItem, { window: win, groupIndex, windowIndex, siblingCount: 2, tabIds }))
}

async function openMoreMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByTestId('more-horizontal-icon').closest('button')!
  await user.click(trigger)
}

// ─── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── "Open in browser" moved to ⋯ dropdown ───────────────────────────────────

describe('WindowItem — "Open in browser" in ⋯ dropdown', () => {
  it('does not render ExternalLink as a standalone button in the header', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow({ tabs: [makeTab(1)] }))

    // Dropdown closed: ExternalLink not in the DOM at all
    expect(screen.queryByTestId('external-link-icon')).toBeNull()

    // After opening menu: ExternalLink is inside a menuitem, not a button
    await openMoreMenu(user)
    const icon = screen.getByTestId('external-link-icon')
    expect(icon.closest('[role="menuitem"]')).not.toBeNull()
    expect(icon.closest('button')).toBeNull()
  })

  it('shows "Open in browser" after opening ⋯ dropdown', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow({ tabs: [makeTab(1)] }))
    await openMoreMenu(user)
    expect(screen.getByText('Open in browser')).toBeTruthy()
  })

  it('"Open in browser" is disabled when window has no tabs', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow({ tabs: [] }))
    await openMoreMenu(user)

    const item = screen.getByText('Open in browser').closest('[role="menuitem"]') as HTMLElement
    expect(item).toBeTruthy()
    // Radix sets data-disabled="" on disabled menu items
    expect(item.dataset.disabled).toBe('')
  })

  it('"Open in browser" is enabled when window has tabs', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow({ tabs: [makeTab(1)] }))
    await openMoreMenu(user)

    const item = screen.getByText('Open in browser').closest('[role="menuitem"]') as HTMLElement
    expect(item.dataset.disabled).toBeUndefined()
  })

  it('calls openWindow with the window object when "Open in browser" is clicked', async () => {
    const user = userEvent.setup()
    const win = makeWindow({ tabs: [makeTab(1)] })
    renderWindow(win)
    await openMoreMenu(user)
    await user.click(screen.getByText('Open in browser'))
    expect(mockOpenWindow).toHaveBeenCalledWith(win)
  })
})

// ─── Sort tabs ────────────────────────────────────────────────────────────────

describe('WindowItem — sort tabs in ⋯ dropdown', () => {
  it('shows "Sort this window by title" and calls sortTabs with by="title"', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow(), 3, 1)
    await openMoreMenu(user)

    expect(screen.getByText('Sort this window by title')).toBeTruthy()
    await user.click(screen.getByText('Sort this window by title'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 3, windowIndex: 1, by: 'title' })
  })

  it('shows "Sort this window by URL" and calls sortTabs with by="url"', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow(), 3, 1)
    await openMoreMenu(user)

    expect(screen.getByText('Sort this window by URL')).toBeTruthy()
    await user.click(screen.getByText('Sort this window by URL'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 3, windowIndex: 1, by: 'url' })
  })

  it('passes the correct groupIndex and windowIndex to sortTabs', async () => {
    const user = userEvent.setup()
    renderWindow(makeWindow(), 7, 2)
    await openMoreMenu(user)
    await user.click(screen.getByText('Sort this window by title'))
    expect(mockSortTabs).toHaveBeenCalledWith({ groupIndex: 7, windowIndex: 2, by: 'title' })
  })
})

// ─── Incognito indicator ──────────────────────────────────────────────────────

describe('WindowItem — incognito indicator', () => {
  it('renders EyeOff icon when window.incognito is true', () => {
    renderWindow(makeWindow({ incognito: true }))
    expect(screen.getByTestId('eye-off-icon')).toBeTruthy()
  })

  it('does not render EyeOff icon when window.incognito is false', () => {
    renderWindow(makeWindow({ incognito: false }))
    expect(screen.queryByTestId('eye-off-icon')).toBeNull()
  })

  it('never shows badge text "incognito" when incognito is true', () => {
    renderWindow(makeWindow({ incognito: true }))
    expect(screen.queryByText('incognito')).toBeNull()
  })

  it('never shows badge text "incognito" when incognito is false', () => {
    renderWindow(makeWindow({ incognito: false }))
    expect(screen.queryByText('incognito')).toBeNull()
  })
})
