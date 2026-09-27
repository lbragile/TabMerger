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
  mockToastSuccess,
  mockToastInfo,
  mockAutoGroupMutateAsync,
  mockUseAutoGroupState,
  mockSaveSessionMutateAsync,
  mockUseGroupsData,
  mockSetGroupsState,
  mockApplyAIGroupsMutateAsync,
  mockTrackEvent,
  MockQuotaExceededError,
  mockOrganizeTabsMutateAsync,
  mockUseOrganizeState,
  mockUseAppSettings,
} = vi.hoisted(() => ({
  mockAddGroupMutateAsync: vi.fn().mockResolvedValue({}),
  mockUseEntitlements: vi.fn(),
  mockUseUIStore: vi.fn(),
  mockUseAuth: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastInfo: vi.fn(),
  mockAutoGroupMutateAsync: vi.fn(),
  mockUseAutoGroupState: vi.fn(() => ({ isPending: false })),
  mockSaveSessionMutateAsync: vi.fn(),
  mockUseGroupsData: vi.fn((): { data: GroupsState | null } => ({ data: null })),
  mockSetGroupsState: vi.fn(),
  mockApplyAIGroupsMutateAsync: vi.fn().mockResolvedValue({}),
  mockTrackEvent: vi.fn(),
  MockQuotaExceededError: class extends Error {
    isQuotaExceeded = true as const
  },
  mockOrganizeTabsMutateAsync: vi.fn(),
  mockUseOrganizeState: vi.fn(() => ({ isPending: false })),
  mockUseAppSettings: vi.fn(() => ({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: true } })),
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
// This suite exercises Header's AI dropdown behavior directly, not the coming-soon
// flag, so force it on regardless of the real VITE_AI_ENABLED default.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))

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
  setBodyDragCursor: vi.fn(),
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
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue({}),
  saveGroupsState: vi.fn(),
  getGroupsState: vi.fn(),
  getSessions: vi.fn().mockResolvedValue([]),
}))

// ─── Hooks ────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useGroups', () => ({
  useAddGroup: () => ({ mutateAsync: mockAddGroupMutateAsync }),
  useGroups: () => mockUseGroupsData(),
  useSetGroupsState: () => mockSetGroupsState,
  useApplyAIGroups: () => ({ mutateAsync: mockApplyAIGroupsMutateAsync }),
  useAddWindow: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useDeleteAllWindows: () => ({ mutate: vi.fn() }),
  useUpdateGroupNote: () => ({ mutate: vi.fn() }),
  useRemoveStaleTabs: () => ({ mutate: vi.fn() }),
  useRestoreGroup: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => mockUseEntitlements(),
  isOverFreeLimit: (itemIndex: number, freeLimit: number) => itemIndex >= freeLimit,
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => mockUseUIStore(selector),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/hooks/useAI', () => ({
  useAutoGroup: () => ({ mutateAsync: mockAutoGroupMutateAsync, ...mockUseAutoGroupState() }),
  useOrganizeTabs: () => ({ mutateAsync: mockOrganizeTabsMutateAsync, ...mockUseOrganizeState() }),
  QuotaExceededError: MockQuotaExceededError,
}))

vi.mock('@/hooks/useAppSettings', () => ({
  useAppSettings: () => mockUseAppSettings(),
}))

vi.mock('@/components/AIQuotaExceededPrompt', () => ({
  AIQuotaExceededPrompt: () => React.createElement('div', { 'data-testid': 'ai-quota-exceeded-prompt' }, 'Buy 50 more AI calls'),
}))

vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({ data: [] }),
  useSaveSession: () => ({ mutateAsync: mockSaveSessionMutateAsync }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/toast', () => ({
  toast: { error: mockToastError, success: mockToastSuccess, info: mockToastInfo },
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
  undoStack: [] as GroupsState[],
  redoStack: [] as GroupsState[],
  undo: vi.fn(),
  redo: vi.fn(),
  selectionMode: false,
  toggleSelectionMode: vi.fn(),
  activeGroupIndex: 0,
  setActiveGroupIndex: vi.fn(),
  setRenameTarget: vi.fn(),
  scrollToWindowIndex: null,
  setScrollToWindowIndex: vi.fn(),
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
    expect(mockTrackEvent).toHaveBeenCalledWith('entitlement_limit_hit', { limit: 'maxGroups' })
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
    expect(mockTrackEvent).not.toHaveBeenCalledWith('entitlement_limit_hit', expect.anything())
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

  it('does NOT show "Upgrade to Pro" when not signed in (sign-in only)', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })

    wrap(React.createElement(Header))
    await openProfileMenu()

    expect(screen.queryByText('Upgrade to Pro')).toBeNull()
  })

  it('does NOT show "Upgrade to Pro" when signed in with pro tier', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'pro@example.com', user_metadata: {} }, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'pro', aiFeatures: false, maxGroups: Infinity })

    wrap(React.createElement(Header))
    await openProfileMenu()

    expect(screen.queryByText('Upgrade to Pro')).toBeNull()
  })
})

// ─── Header/SidePanel — column alignment ─────────────────────────────────────
// Regression test: header's logo cell must be the same 240px width + right
// border as SidePanel's root, flush against the left edge with no outer gap —
// otherwise the search box in the header drifts out of alignment with the
// sidebar/main-content boundary below it.

describe('Header — logo column alignment with SidePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
  })

  it('gives the logo cell the same 240px width as SidePanel, with no leading padding on <header>', () => {
    const { container } = wrap(React.createElement(Header))
    const header = container.querySelector('header')
    expect(header?.className).not.toMatch(/\bpx-3\b/)

    const logoCell = header?.firstElementChild as HTMLElement
    expect(logoCell.style.width).toBe('240px')
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

  // ponytail: "signed-out" styling variant removed — Header no longer renders
  // "Upgrade to Pro" at all when signed out (see the item-visibility test above),
  // so there is no signed-out styling to assert.
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

// ─── Header — undo/redo ───────────────────────────────────────────────────────

describe('Header — undo/redo', () => {
  const groupsState = makeGroupsState([makeGroup({ permanent: true })])
  const undoFn = vi.fn().mockReturnValue(groupsState)
  const redoFn = vi.fn().mockReturnValue(groupsState)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) =>
      selector({ ...baseUIState, undoStack: [groupsState], redoStack: [groupsState], undo: undoFn, redo: redoFn })
    )
  })

  it('applies the popped undo snapshot via setGroupsState when Undo is clicked', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /undo/i }))
    expect(undoFn).toHaveBeenCalledWith(groupsState)
    expect(mockSetGroupsState).toHaveBeenCalledWith(groupsState)
  })

  it('applies the popped redo snapshot via setGroupsState when Redo is clicked', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /redo/i }))
    expect(redoFn).toHaveBeenCalledWith(groupsState)
    expect(mockSetGroupsState).toHaveBeenCalledWith(groupsState)
  })

  it('is a no-op when undo() returns nothing (empty stack)', async () => {
    undoFn.mockReturnValueOnce(undefined)
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /undo/i }))
    expect(mockSetGroupsState).not.toHaveBeenCalled()
  })
})

// ─── Header — AI auto-group ───────────────────────────────────────────────────

describe('Header — AI dropdown (Auto-group / Organize)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: true } })
  })

  /** Opens the AI dropdown and clicks the named menu item ("Auto-group" or "Organize"). */
  async function clickAIMenuItem(name: RegExp) {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /ai actions/i }))
    await user.click(await screen.findByText(name))
    return user
  }

  it('opens the upgrade modal instead of a menu when AI features are not entitled', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [{ id: 1, title: 'T', url: 'https://a.com' }], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })

    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))

    expect(baseUIState.openModal).toHaveBeenCalledWith('upgrade')
    expect(mockAutoGroupMutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByText(/auto-group/i)).toBeNull()
  })

  it('hides the Auto-group menu item when aiAutoGroupEnabled is off in Settings', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: false, aiOrganizeEnabled: true } })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })

    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))

    expect(screen.queryByText('Auto-group')).toBeNull()
    expect(await screen.findByText('Organize')).toBeTruthy()
  })

  it('hides the Organize menu item when aiOrganizeEnabled is off in Settings', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: false } })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })

    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))

    expect(await screen.findByText('Auto-group')).toBeTruthy()
    expect(screen.queryByText('Organize')).toBeNull()
  })

  it('toasts an error and does not call autoGroup when Now Open has no tabs', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockToastError).toHaveBeenCalledWith('No tabs open to group')
    expect(mockAutoGroupMutateAsync).not.toHaveBeenCalled()
  })

  it('calls autoGroup with Now Open tabs, applies the suggestions, and shows a pluralized success toast', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    const suggestions = [{ name: 'Work', color: 'rgba(0,0,0,1)', tabIds: [1] }, { name: 'Other', color: 'rgba(0,0,0,1)', tabIds: [2] }]
    mockAutoGroupMutateAsync.mockResolvedValue({ groups: suggestions })
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ appliedGroups: 2, appliedTabs: 2 })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockAutoGroupMutateAsync).toHaveBeenCalledWith([tab])
    expect(mockApplyAIGroupsMutateAsync).toHaveBeenCalledWith(suggestions)
    expect(mockToastSuccess).toHaveBeenCalledWith('AI created 2 groups', expect.anything())
  })

  it('shows a singular "1 group" toast when only one group is suggested', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockAutoGroupMutateAsync.mockResolvedValue({ groups: [{ name: 'Work', color: 'rgba(0,0,0,1)', tabIds: [1] }] })
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ appliedGroups: 1, appliedTabs: 1 })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockToastSuccess).toHaveBeenCalledWith('AI created 1 group', expect.anything())
  })

  it('shows an info toast (not a false-positive success) when none of the suggested tabIds match a live Now Open tab', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockAutoGroupMutateAsync.mockResolvedValue({ groups: [{ name: 'Ghost', color: 'rgba(0,0,0,1)', tabIds: [999] }] })
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ appliedGroups: 0, appliedTabs: 0 })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith("No matching tabs found for AI's suggestion")
  })

  it('caps applied suggestions to remaining free-tier group slots and warns about skipped ones', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: true, maxGroups: 1 })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([
      makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] }),
    ])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    const suggestions = [{ name: 'Work', color: 'rgba(0,0,0,1)', tabIds: [1] }, { name: 'Other', color: 'rgba(0,0,0,1)', tabIds: [2] }]
    mockAutoGroupMutateAsync.mockResolvedValue({ groups: suggestions })
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ appliedGroups: 1, appliedTabs: 1 })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockApplyAIGroupsMutateAsync).toHaveBeenCalledWith([suggestions[0]])
    expect(mockToastSuccess).toHaveBeenCalledWith('AI created 1 group', expect.objectContaining({ description: expect.stringContaining('1 more suggested') }))
  })

  it('logs an error without throwing when autoGroup rejects', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockAutoGroupMutateAsync.mockRejectedValue(new Error('AI down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('shows the AI quota-exceeded CTA instead of a generic error toast when autoGroup rejects with QuotaExceededError', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockAutoGroupMutateAsync.mockRejectedValue(new MockQuotaExceededError('quota exceeded'))

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(await screen.findByTestId('ai-quota-exceeded-prompt')).toBeTruthy()
    expect(mockToastError).not.toHaveBeenCalledWith('AI grouping failed')
  })

  it('calls organizeTabs, shows a success toast, and opens the dashboard tab', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockOrganizeTabsMutateAsync.mockResolvedValue(undefined)

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^organize$/i)

    expect(mockOrganizeTabsMutateAsync).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith('Organize started — review the proposal in your dashboard')
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: expect.stringContaining('/dashboard') })
  })

  it('shows the AI quota-exceeded CTA (not a generic error toast) when organizeTabs rejects with QuotaExceededError', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockOrganizeTabsMutateAsync.mockRejectedValue(new MockQuotaExceededError('quota exceeded'))

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^organize$/i)

    expect(await screen.findByTestId('ai-quota-exceeded-prompt')).toBeTruthy()
    expect(mockToastError).not.toHaveBeenCalled()
  })
})

// ─── SidePanel — save session (moved from the Header per P4, popup-ui-consolidation-spec.md) ──

describe('SidePanel — save session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5, sessions: false })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  const groupsState = makeGroupsState([makeGroup({ permanent: true })])

  /** SidePanel opens the 'saveSession' modal instead of window.prompt(); grab the onSave callback it passed. */
  async function clickSaveSessionAndGetOnSave() {
    const user = userEvent.setup()
    wrap(React.createElement(SidePanel, { groupsState }))
    await user.click(screen.getByRole('button', { name: /save current session/i }))
    expect(baseUIState.openModal).toHaveBeenCalledWith('saveSession', { onSave: expect.any(Function) })
    const [, data] = (baseUIState.openModal as ReturnType<typeof vi.fn>).mock.calls[0]
    return data.onSave as (name: string) => Promise<void>
  }

  it('opens the saveSession modal instead of window.prompt()', async () => {
    await clickSaveSessionAndGetOnSave()
    expect(mockSaveSessionMutateAsync).not.toHaveBeenCalled()
  })

  it('saves the session and shows a success toast', async () => {
    mockSaveSessionMutateAsync.mockResolvedValue(undefined)
    const onSave = await clickSaveSessionAndGetOnSave()
    await onSave('My Session')
    expect(mockSaveSessionMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Session' })
    )
    expect(mockToastSuccess).toHaveBeenCalledWith('Session saved')
  })

  it('shows an upgrade-prompt toast when the free session limit is hit', async () => {
    mockSaveSessionMutateAsync.mockRejectedValue(new Error('SESSION_LIMIT'))
    const onSave = await clickSaveSessionAndGetOnSave()
    await onSave('My Session')
    expect(mockToastError).toHaveBeenCalledWith(
      'Free plan allows up to 3 sessions.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Upgrade' }) })
    )
  })

  it('shows a generic failure toast for non-limit errors', async () => {
    mockSaveSessionMutateAsync.mockRejectedValue(new Error('network down'))
    const onSave = await clickSaveSessionAndGetOnSave()
    await onSave('My Session')
    expect(mockToastError).toHaveBeenCalledWith('Failed to save session')
  })
})

// ─── Header — no longer has a save-session control (moved to SidePanel, P4) ───

describe('Header — save session removed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5, sessions: false })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('no longer renders a "Save session" header button', () => {
    wrap(React.createElement(Header))
    expect(screen.queryByRole('button', { name: /save session/i })).toBeNull()
  })
})

// ─── Header — search + selection mode + sign out ─────────────────────────────

describe('Header — search overlay + selection mode + sign out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
  })

  it('opens the search overlay when the search trigger is clicked', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /open search/i }))
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('toggles selection mode on click', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /select items/i }))
    expect(baseUIState.toggleSelectionMode).toHaveBeenCalled()
  })

  it('calls signOut when "Sign out" is clicked (signed in)', async () => {
    const signOutFn = vi.fn()
    mockUseAuth.mockReturnValue({ user: { email: 'user@example.com', user_metadata: {} }, signOut: signOutFn })
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[buttons.length - 1])
    await user.click(screen.getByText('Sign out'))
    expect(signOutFn).toHaveBeenCalled()
  })

  it('opens the auth modal when "Sign in" is clicked (signed out)', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[buttons.length - 1])
    await user.click(screen.getByText('Sign in'))
    expect(baseUIState.openModal).toHaveBeenCalledWith('auth')
  })

  it('tracks search_used once on the first non-empty keystroke, not on every keystroke', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /open search/i }))
    const input = screen.getByRole('textbox')
    await user.type(input, 'abc')
    expect(mockTrackEvent).toHaveBeenCalledWith('search_used')
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })

  it('does not track search_used when the query is cleared back to empty', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /open search/i }))
    const input = screen.getByRole('textbox')
    await user.type(input, 'a')
    await user.clear(input)
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })
})
