import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidePanel } from '@/components/SidePanel'
import { Header } from '@/components/Header'
import { WindowsPanel } from '@/components/Windows'
import type { Group, GroupsState } from '@/lib/types'

// ─── vi.hoisted — variables needed inside vi.mock factories ──────────────────

const {
  mockAddGroupMutateAsync,
  mockUseEntitlements,
  mockUseUIStore,
  mockUseAuth,
  mockToastError,
} = vi.hoisted(() => ({
  mockAddGroupMutateAsync: vi.fn().mockResolvedValue({}),
  mockUseEntitlements: vi.fn(),
  mockUseUIStore: vi.fn(),
  mockUseAuth: vi.fn(),
  mockToastError: vi.fn(),
}))

// ─── DnD stubs (shared) ───────────────────────────────────────────────────────

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  closestCenter: vi.fn(),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  DragOverlay: () => null,
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('@/hooks/useDnd', () => ({
  useDndSensors: () => [],
  useGroupDndHandlers: () => ({ onDragEnd: vi.fn() }),
  useWindowDndHandlers: () => ({ onDragEnd: vi.fn() }),
  parseDndId: vi.fn(),
}))

// ─── Stub heavy child components ─────────────────────────────────────────────

vi.mock('@/components/SidePanel/GroupItem', () => ({
  GroupItem: ({ group }: { group: { name: string } }) =>
    React.createElement('div', { 'data-testid': 'group-item' }, group.name),
}))

vi.mock('@/components/Windows/Window', () => ({
  WindowItem: () => React.createElement('div', { 'data-testid': 'window-item' }),
}))

// ─── lib/localDb ─────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
}))

// ─── Hooks ────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useGroups', () => ({
  useAddGroup: () => ({ mutateAsync: mockAddGroupMutateAsync }),
  useGroups: () => ({ data: null }),
  useSetGroupsState: () => vi.fn(),
  useAddWindow: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useDeleteAllWindows: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => mockUseEntitlements(),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/hooks/useAI', () => ({
  useAutoGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('sonner', () => ({
  toast: { error: mockToastError, success: vi.fn() },
}))

// ─── Chrome stub ─────────────────────────────────────────────────────────────

globalThis.chrome = {
  tabs: { create: vi.fn() },
} as unknown as typeof chrome

// ─── Shared UI store state ────────────────────────────────────────────────────

const baseUIState = {
  searchFilter: '',
  setSearchFilter: vi.fn(),
  openModal: vi.fn(),
  undoStack: [],
  redoStack: [],
  undo: vi.fn(),
  redo: vi.fn(),
  selectionMode: false,
  toggleSelectionMode: vi.fn(),
  activeGroupIndex: 0,
  setActiveGroupIndex: vi.fn(),
  setRenameTarget: vi.fn(),
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: `g-${Math.random()}`,
    name: 'Group',
    color: 'rgba(59,130,246,1)',
    updatedAt: Date.now(),
    windows: [],
    permanent: false,
    starred: false,
    ...overrides,
  }
}

function makeGroupsState(groups: Group[]): GroupsState {
  return { available: groups, active: { id: '', index: 0 } }
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

// ─── SidePanel — group limit excludes Now Open ────────────────────────────────

describe('SidePanel — Add Group limit excludes Now Open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free', aiFeatures: false })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('toasts and does NOT add a group when 5 saved groups + Now Open already exist (6 total)', async () => {
    // available: 1 permanent (Now Open) + 5 saved = 6 total; 6-1=5 >= 5 → blocked
    const nowOpen = makeGroup({ permanent: true, name: 'Now Open' })
    const saved = Array.from({ length: 5 }, (_, i) => makeGroup({ name: `Saved ${i}` }))
    const groupsState = makeGroupsState([nowOpen, ...saved])

    wrap(React.createElement(SidePanel, { groupsState }))
    fireEvent.click(screen.getByRole('button', { name: /add group/i }))

    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 5 groups.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Upgrade' }) })
    )
    expect(mockAddGroupMutateAsync).not.toHaveBeenCalled()
  })

  it('adds a group when 4 saved groups + Now Open exist (5 total)', async () => {
    // available: 1 permanent + 4 saved = 5 total; 5-1=4 < 5 → allowed
    const nowOpen = makeGroup({ permanent: true, name: 'Now Open' })
    const saved = Array.from({ length: 4 }, (_, i) => makeGroup({ name: `Saved ${i}` }))
    const groupsState = makeGroupsState([nowOpen, ...saved])

    wrap(React.createElement(SidePanel, { groupsState }))
    fireEvent.click(screen.getByRole('button', { name: /add group/i }))

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockAddGroupMutateAsync).toHaveBeenCalled()
  })
})

// ─── SidePanel footer — stats exclude Now Open ───────────────────────────────

describe('SidePanel footer — stats exclude Now Open (permanent group)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free', aiFeatures: false })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('shows counts for saved groups only, excluding the permanent Now Open group', () => {
    const nowOpen = makeGroup({
      permanent: true,
      name: 'Now Open',
      windows: [
        { id: 1, name: 'W1', tabs: [{ id: 1, title: 'T1', url: 'https://a.com' }, { id: 2, title: 'T2', url: 'https://b.com' }], starred: false, incognito: false, focused: false },
        { id: 2, name: 'W2', tabs: [{ id: 3, title: 'T3', url: 'https://c.com' }, { id: 4, title: 'T4', url: 'https://d.com' }, { id: 5, title: 'T5', url: 'https://e.com' }], starred: false, incognito: false, focused: false },
      ],
    })
    const saved1 = makeGroup({
      name: 'Work',
      windows: [
        { id: 3, name: 'W3', tabs: [{ id: 6, title: 'T6', url: 'https://f.com' }, { id: 7, title: 'T7', url: 'https://g.com' }], starred: false, incognito: false, focused: false },
      ],
    })
    const saved2 = makeGroup({
      name: 'Personal',
      windows: [
        { id: 4, name: 'W4', tabs: [{ id: 8, title: 'T8', url: 'https://h.com' }, { id: 9, title: 'T9', url: 'https://i.com' }, { id: 10, title: 'T10', url: 'https://j.com' }], starred: false, incognito: false, focused: false },
        { id: 5, name: 'W5', tabs: [{ id: 11, title: 'T11', url: 'https://k.com' }, { id: 12, title: 'T12', url: 'https://l.com' }, { id: 13, title: 'T13', url: 'https://m.com' }], starred: false, incognito: false, focused: false },
      ],
    })
    const groupsState = makeGroupsState([nowOpen, saved1, saved2])

    wrap(React.createElement(SidePanel, { groupsState }))

    // 2 saved groups, 3 windows (1+2), 8 tabs (2+3+3)
    expect(screen.getByText(/2 Groups/)).toBeTruthy()
    expect(screen.getByText(/3 Windows/)).toBeTruthy()
    expect(screen.getByText(/8 Tabs/)).toBeTruthy()
  })
})

// ─── Header — Upgrade to Pro visibility ──────────────────────────────────────

describe('Header — Upgrade to Pro menu item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  async function openProfileMenu() {
    const user = userEvent.setup()
    // The profile button is the last button in the header actions area
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[buttons.length - 1])
  }

  it('shows "Upgrade to Pro" when signed in with free tier', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com', user_metadata: {} }, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })

    wrap(React.createElement(Header))
    await openProfileMenu()

    expect(screen.getByText('Upgrade to Pro')).toBeTruthy()
  })

  it('shows "Upgrade to Pro" when not signed in', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })

    wrap(React.createElement(Header))
    await openProfileMenu()

    expect(screen.getByText('Upgrade to Pro')).toBeTruthy()
  })

  it('does NOT show "Upgrade to Pro" when signed in with pro tier', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'pro@example.com', user_metadata: {} }, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'pro', aiFeatures: false, maxGroups: Infinity })

    wrap(React.createElement(Header))
    await openProfileMenu()

    expect(screen.queryByText('Upgrade to Pro')).toBeNull()
  })
})

// ─── WindowsPanel — Add Window button ────────────────────────────────────────

describe('WindowsPanel — Add Window button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('renders "Add Window" button when group has windows', () => {
    const group = makeGroup({
      windows: [
        { id: 1, name: 'W1', tabs: [], starred: false, incognito: false, focused: false },
      ],
    })
    wrap(React.createElement(WindowsPanel, { group, groupIndex: 0 }))
    expect(screen.getByRole('button', { name: /add window/i })).toBeTruthy()
  })

  it('renders "Add Window" button when group has no windows', () => {
    const group = makeGroup({ windows: [] })
    wrap(React.createElement(WindowsPanel, { group, groupIndex: 0 }))
    expect(screen.getByRole('button', { name: /add window/i })).toBeTruthy()
  })
})

// ─── Styling — key interactive element classes ────────────────────────────────
// These verify that design-token classes (text-primary, hover:, focus:) are
// present on the rendered elements. They don't snapshot full DOM trees —
// updating a Tailwind class intentionally just re-run `vitest -u`.

describe('Styling — "Upgrade to Pro" menu item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  async function getUpgradeItem() {
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[buttons.length - 1])
    return screen.getByText('Upgrade to Pro').closest('[role="menuitem"]') as HTMLElement
  }

  it('has text-primary and focus:text-primary at rest and on focus (signed-in free tier)', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com', user_metadata: {} }, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    wrap(React.createElement(Header))
    const item = await getUpgradeItem()
    expect(item.className).toMatch(/text-primary/)
    expect(item.className).toMatch(/focus:text-primary/)
  })

  it('has text-primary and focus:text-primary at rest and on focus (signed-out)', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    wrap(React.createElement(Header))
    const item = await getUpgradeItem()
    expect(item.className).toMatch(/text-primary/)
    expect(item.className).toMatch(/focus:text-primary/)
  })
})

describe('Styling — "Add Group" button (SidePanel)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free', aiFeatures: false })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('uses outline variant — has border and hover:bg-accent classes', () => {
    const groupsState = makeGroupsState([makeGroup({ permanent: true, name: 'Now Open' })])
    wrap(React.createElement(SidePanel, { groupsState }))
    const btn = screen.getByRole('button', { name: /add group/i })
    expect(btn.className).toMatch(/border/)
    expect(btn.className).toMatch(/hover:bg-accent/)
  })
})

describe('Styling — "Add Window" button (WindowsPanel)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('uses outline variant — has border and hover:bg-accent classes', () => {
    wrap(React.createElement(WindowsPanel, { group: makeGroup({ windows: [] }), groupIndex: 0 }))
    const btn = screen.getByRole('button', { name: /add window/i })
    expect(btn.className).toMatch(/border/)
    expect(btn.className).toMatch(/hover:bg-accent/)
  })
})
