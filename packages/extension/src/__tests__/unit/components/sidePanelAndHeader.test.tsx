import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidePanel } from '@/components/SidePanel'
import { Header } from '@/components/Header'
import { WindowsPanel } from '@/components/Windows'
import type { Group, GroupsState } from '@/lib/types'
import { FreeLimitExceededError } from '@/lib/tierLimits'
import { i18n } from '@/lib/i18n'

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
  mockNameGroupMutateAsync,
  mockUseNameGroupState,
  mockUpdateGroupName,
  mockDescribeGroupMutateAsync,
  mockUseAiUsage,
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
  mockUseAppSettings: vi.fn((): { data: Record<string, unknown> } => ({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: true } })),
  mockNameGroupMutateAsync: vi.fn(),
  mockUseNameGroupState: vi.fn(() => ({ isPending: false })),
  mockUpdateGroupName: vi.fn(),
  mockDescribeGroupMutateAsync: vi.fn(),
  mockUseAiUsage: vi.fn(() => ({ remaining: 1820, used: 180, cap: 2000, loading: false, known: true })),
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))
// This suite exercises Header's AI dropdown behavior directly, not the coming-soon
// flag, so force it on regardless of the real VITE_AI_ENABLED default.
vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true, AI_MANAGED_ENABLED: true, AI_BYOK_ENABLED: true }))

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
  GroupItem: ({ group, searchMatchCount, searchDimmed, reorderLocked }: { group: { name: string }; searchMatchCount?: number; searchDimmed?: boolean; reorderLocked?: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'group-item', 'data-found': searchMatchCount, 'data-dimmed': String(!!searchDimmed), 'data-locked': String(!!reorderLocked) },
      group.name
    ),
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
  useGroupsSnapshot: () => () => mockUseGroupsData()?.data,
  useApplyAIGroups: () => ({ mutateAsync: mockApplyAIGroupsMutateAsync }),
  useUpdateGroupName: () => ({ mutate: mockUpdateGroupName }),
  useAddWindow: () => ({ mutate: vi.fn() }),
  useReplaceWithCurrent: () => ({ mutate: vi.fn() }),
  useMergeWithCurrent: () => ({ mutate: vi.fn() }),
  useUniteWindows: () => ({ mutate: vi.fn() }),
  useSplitWindows: () => ({ mutate: vi.fn() }),
  useSortTabs: () => ({ mutate: vi.fn() }),
  useDeleteAllWindows: () => ({ mutate: vi.fn() }),
  useUpdateGroupNote: () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  useRemoveStaleTabs: () => ({ mutate: vi.fn() }),
  useRestoreGroup: () => ({ mutate: vi.fn() }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
  GROUPS_QUERY_KEY: ['groups'],
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => mockUseEntitlements(),
  isOverFreeLimit: (itemIndex: number, freeLimit: number) => itemIndex >= freeLimit,
}))

// The Header only wires the buttons to useUndoRedo; the cursor move itself is tested in
// hooks/useUndoRedo.test.ts and hooks/useGroupsUndo.test.tsx
const undoRedo = vi.hoisted(() => ({ canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() }))
vi.mock('@/hooks/useUndoRedo', () => ({
  useUndoRedo: () => ({ ...undoRedo, undoStack: [], redoStack: [] }),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: object) => unknown) => mockUseUIStore(selector), {
    getState: () => ({ tourHistory: null, signalTour: vi.fn() }),
  }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}))

// The component imports the error class from '@/lib/aiErrors' (never re-exported by useAI: see
// the WXT auto-import note there), so the stub class replaces it there too.
vi.mock('@/lib/aiErrors', async (importOriginal) => ({ ...(await importOriginal<object>()), QuotaExceededError: MockQuotaExceededError }))
vi.mock('@/hooks/useAI', () => ({
  useAutoGroup: () => ({ mutateAsync: mockAutoGroupMutateAsync, ...mockUseAutoGroupState() }),
  useOrganizeTabs: () => ({ mutateAsync: mockOrganizeTabsMutateAsync, ...mockUseOrganizeState() }),
  useNameGroup: () => ({ mutateAsync: mockNameGroupMutateAsync, ...mockUseNameGroupState() }),
  useDescribeGroup: () => ({ mutateAsync: mockDescribeGroupMutateAsync, isPending: false }),
  QuotaExceededError: MockQuotaExceededError,
}))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => mockUseAiUsage() }))

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

/** Renders `ui` with a fresh query client; `groupsCache` seeds the groups query (read by id by the AI actions once a reply is in). */
function wrap(ui: React.ReactElement, groupsCache?: GroupsState) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (groupsCache) qc.setQueryData(['groups'], groupsCache)
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

// ─── SidePanel — search hide / dim ───────────────────────────────────────────

describe('SidePanel — search hides or dims non-matching groups', () => {
  const tabsIn = (...titles: string[]) => [
    { id: 1, tabs: titles.map((title) => ({ id: 0, title, url: `https://example.com/${title}` })), incognito: false, focused: false },
  ]
  const nowOpen = () => makeGroup({ id: 'now', permanent: true, name: 'Now Open', windows: tabsIn('zzz only') })
  const work = () => makeGroup({ id: 'work', name: 'Work', windows: tabsIn('alpha doc') })
  const play = () => makeGroup({ id: 'play', name: 'Play', windows: tabsIn('beta game') })
  const names = () => screen.queryAllByTestId('group-item').map((el) => el.textContent)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitlements.mockReturnValue({ maxGroups: 5, tier: 'free', aiFeatures: false })
    mockUseAppSettings.mockReturnValue({ data: {} })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector({ ...baseUIState, searchFilter: 'alpha', activeGroupIndex: 1 }))
  })

  afterEach(() => {
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: true } })
  })

  it('hide (the default): Now Open stays listed with "0 found", the active group stays, other non-matching groups go; reordering is locked', () => {
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([nowOpen(), work(), play()]) }))
    expect(names()).toEqual(['Now Open', 'Work'])
    const items = screen.getAllByTestId('group-item')
    expect(items[0]).toHaveAttribute('data-found', '0')
    expect(items[1]).toHaveAttribute('data-found', '1')
    expect(items.every((el) => el.getAttribute('data-locked') === 'true')).toBe(true)
  })

  it('dim: every group stays in place, non-matching ones are flagged dimmed, and reordering stays on', () => {
    mockUseAppSettings.mockReturnValue({ data: { searchNonMatching: 'dim' } })
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([nowOpen(), work(), play()]) }))
    expect(names()).toEqual(['Now Open', 'Work', 'Play'])
    const items = screen.getAllByTestId('group-item')
    expect(items.map((el) => el.getAttribute('data-dimmed'))).toEqual(['true', 'false', 'true'])
    expect(items.every((el) => el.getAttribute('data-locked') === 'false')).toBe(true)
  })

  it('an unknown stored mode falls back to hide', () => {
    mockUseAppSettings.mockReturnValue({ data: { searchNonMatching: 'bogus' } })
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([nowOpen(), work(), play()]) }))
    expect(names()).toEqual(['Now Open', 'Work'])
  })

  it('no search: nothing is flagged, hidden or locked', () => {
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    wrap(React.createElement(SidePanel, { groupsState: makeGroupsState([nowOpen(), work(), play()]) }))
    expect(names()).toEqual(['Now Open', 'Work', 'Play'])
    expect(screen.getAllByTestId('group-item').every((el) => el.getAttribute('data-locked') === 'false' && el.getAttribute('data-dimmed') === 'false')).toBe(true)
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

// ─── Header — logo links to the website ──────────────────────────────────────
// The logo opens the TabMerger site of the build's environment (VITE_WEB_APP_URL), in the
// popup's language, always with the language prefix (`/en` too: it resets the site's
// NEXT_LOCALE cookie). No valid URL: the logo renders exactly as before, with no link.

describe('Header — logo links to the website', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await act(async () => {
      await i18n.changeLanguage('en')
    })
  })

  function logoLink() {
    return screen.getByRole('link', { name: 'Open the TabMerger website (new tab)' })
  }

  it.each([
    ['stable', 'https://tabmerger.com', 'https://tabmerger.com/en'],
    ['beta', 'https://preview.tabmerger.com', 'https://preview.tabmerger.com/en'],
    ['development', 'http://localhost:3000', 'http://localhost:3000/en'],
  ])('links a %s build to its own site, in a new tab', (_build, env, href) => {
    vi.stubEnv('VITE_WEB_APP_URL', env)
    wrap(React.createElement(Header))
    const link = logoLink()
    expect(link).toHaveAttribute('href', href)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('TabMerger')
  })

  it.each([['missing', ''], ['not a URL', 'tabmerger.com'], ['a script URL', 'javascript:alert(1)'], ['another scheme', 'ftp://tabmerger.com']])(
    'renders the plain logo with no link when the web app URL is %s',
    (_label, env) => {
      vi.stubEnv('VITE_WEB_APP_URL', env)
      const { container } = wrap(React.createElement(Header))
      expect(screen.queryByTestId('header-logo-link')).toBeNull()
      const logoCell = container.querySelector('header')?.firstElementChild as HTMLElement
      expect(logoCell.querySelector('a')).toBeNull()
      expect(logoCell.querySelector('img')).toHaveAttribute('alt', 'TabMerger')
      expect(logoCell).toHaveTextContent('TabMerger')
    }
  )

  it('links to the prefixed home of the popup language, and follows a language change', async () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.com')
    await act(async () => {
      await i18n.changeLanguage('de')
    })
    wrap(React.createElement(Header))
    const link = screen.getByRole('link', { name: 'TabMerger-Website öffnen (neuer Tab)' })
    expect(link).toHaveAttribute('href', 'https://tabmerger.com/de')

    await act(async () => {
      await i18n.changeLanguage('pt-BR')
    })
    expect(screen.getByTestId('header-logo-link')).toHaveAttribute('href', 'https://tabmerger.com/pt-BR')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(screen.getByTestId('header-logo-link')).toHaveAttribute('href', 'https://tabmerger.com/en')
  })

  it('opens the site with chrome.tabs.create instead of navigating the popup', () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://preview.tabmerger.com')
    wrap(React.createElement(Header))
    const notPrevented = fireEvent.click(logoLink())
    expect(notPrevented).toBe(false)
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://preview.tabmerger.com/en', active: true })
  })

  it('keeps the logo cell 240px wide with the link inside it', () => {
    vi.stubEnv('VITE_WEB_APP_URL', 'https://tabmerger.com')
    const { container } = wrap(React.createElement(Header))
    const logoCell = container.querySelector('header')?.firstElementChild as HTMLElement
    expect(logoCell.style.width).toBe('240px')
    expect(logoCell.firstElementChild).toBe(logoLink())
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

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    Object.assign(undoRedo, { canUndo: true, canRedo: true })
  })

  afterEach(() => {
    Object.assign(undoRedo, { canUndo: false, canRedo: false })
  })

  it('Undo and Redo call useUndoRedo().undo / .redo', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /undo/i }))
    expect(undoRedo.undo).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /redo/i }))
    expect(undoRedo.redo).toHaveBeenCalledTimes(1)
  })

  it('the buttons are disabled while their stack is empty', () => {
    Object.assign(undoRedo, { canUndo: false, canRedo: false })
    wrap(React.createElement(Header))
    expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /redo/i })).toBeDisabled()
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

  it('without AI features, Auto-group is a locked preview: clicking it runs nothing and opens nothing', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [{ id: 1, title: 'T', url: 'https://a.com' }], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })

    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))
    await user.click(await screen.findByTestId('header-ai-auto-group'))

    expect(mockAutoGroupMutateAsync).not.toHaveBeenCalled()
    expect(baseUIState.openModal).not.toHaveBeenCalled()
    // The menu stays open (the click was swallowed)
    expect(screen.getByTestId('header-ai-menu')).toBeTruthy()
  })

  it('hides the Auto-group menu item when aiAutoGroupEnabled is off in Settings', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: false, aiOrganizeEnabled: true } })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })

    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))

    expect(screen.queryByText('Auto-group')).toBeNull()
    expect(await screen.findByText('Organize…')).toBeTruthy()
  })

  it('hides the Organize menu item when aiOrganizeEnabled is off in Settings', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: false } })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })

    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))

    expect(await screen.findByText('Auto-group')).toBeTruthy()
    expect(screen.queryByText('Organize…')).toBeNull()
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
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ createdGroups: 2, mergedGroups: 0, appliedTabs: 2 })

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
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ createdGroups: 1, mergedGroups: 0, appliedTabs: 1 })

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
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ createdGroups: 0, mergedGroups: 0, appliedTabs: 0 })

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
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ createdGroups: 1, mergedGroups: 0, appliedTabs: 1 })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockApplyAIGroupsMutateAsync).toHaveBeenCalledWith([suggestions[0]])
    expect(mockToastSuccess).toHaveBeenCalledWith('AI created 1 group', expect.objectContaining({ description: expect.stringContaining('1 more suggested') }))
  })

  it('says how many existing groups received tabs: alone in the title, or as a description next to new groups', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockAutoGroupMutateAsync.mockResolvedValue({ groups: [{ name: 'Work', color: 'rgba(0,0,0,1)', tabIds: [1] }] })

    mockApplyAIGroupsMutateAsync.mockResolvedValueOnce({ createdGroups: 0, mergedGroups: 3, appliedTabs: 3 })
    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)
    expect(mockToastSuccess).toHaveBeenLastCalledWith('AI added tabs to 3 existing groups', {})

    cleanup()
    mockApplyAIGroupsMutateAsync.mockResolvedValueOnce({ createdGroups: 2, mergedGroups: 1, appliedTabs: 4 })
    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)
    expect(mockToastSuccess).toHaveBeenLastCalledWith('AI created 2 groups', { description: 'Also added tabs to 1 existing group.' })
  })

  it('at the free-tier group limit, still applies suggestions that go into existing same-named groups', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: true, maxGroups: 1 })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([
      makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] }),
      makeGroup({ name: 'YouTube' }),
    ])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    const suggestions = [{ name: 'New one', color: 'rgba(0,0,0,1)', tabIds: [2] }, { name: 'youtube', color: 'rgba(0,0,0,1)', tabIds: [1] }]
    mockAutoGroupMutateAsync.mockResolvedValue({ groups: suggestions })
    mockApplyAIGroupsMutateAsync.mockResolvedValue({ createdGroups: 0, mergedGroups: 1, appliedTabs: 1 })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockApplyAIGroupsMutateAsync).toHaveBeenCalledWith([suggestions[1]])
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith('AI added tabs to 1 existing group', { description: expect.stringContaining('1 more suggested') })
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

  it('shows no generic error when the Free-limit backstop blocks applying AI groups (upgrade toast already shown)', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: true, maxGroups: 5, maxTabs: 50 })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    const groupsState = makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })])
    mockUseGroupsData.mockReturnValue({ data: groupsState })
    mockAutoGroupMutateAsync.mockResolvedValue({ groups: [{ name: 'Work', color: 'rgba(0,0,0,1)', tabIds: [1] }] })
    mockApplyAIGroupsMutateAsync.mockRejectedValue(new FreeLimitExceededError('maxTabs'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^auto-group$/i)

    expect(mockApplyAIGroupsMutateAsync).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalledWith('AI grouping failed')
    expect(consoleSpy).not.toHaveBeenCalled()
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

  it('Organize with proposed changes opens the review modal in the popup (no web tab)', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    const actions = [{ type: 'rename', groupId: 'g1', newName: 'Work' }]
    mockOrganizeTabsMutateAsync.mockResolvedValue({ actions })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^organize…$/i)

    await waitFor(() => expect(baseUIState.openModal).toHaveBeenCalledWith('organizeReview', { actions }))
    expect(mockOrganizeTabsMutateAsync).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.create).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('Organize with nothing to change says the groups already look organized (no modal, no web tab)', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockOrganizeTabsMutateAsync.mockResolvedValue({ actions: [] })

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^organize…$/i)

    await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith('Your groups already look organized'))
    expect(baseUIState.openModal).not.toHaveBeenCalled()
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('shows the AI quota-exceeded CTA (not a generic error toast) when organizeTabs rejects with QuotaExceededError', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockOrganizeTabsMutateAsync.mockRejectedValue(new MockQuotaExceededError('quota exceeded'))

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^organize…$/i)

    expect(await screen.findByTestId('ai-quota-exceeded-prompt')).toBeTruthy()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it.each([
    ['auto-group', /^auto-group$/i, () => mockAutoGroupMutateAsync],
    ['organize', /^organize…$/i, () => mockOrganizeTabsMutateAsync],
  ] as const)('%s: an error fixed in Settings → AI offers "Open Settings", which opens Settings on the AI tab', async (_name, item, mutation) => {
    const { AiRequestError } = await import('@/lib/aiErrors')
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    const tab = { id: 1, title: 'T', url: 'https://a.com' }
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true, windows: [{ id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }] })]) })
    mutation().mockRejectedValue(new AiRequestError('byok_key_missing', 0, 'Add your key'))

    wrap(React.createElement(Header))
    await clickAIMenuItem(item)

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    const [message, options] = mockToastError.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('Add your key')
    expect(options.action.label).toBe('Open Settings')
    options.action.onClick()
    expect(baseUIState.openModal).toHaveBeenCalledWith('settings', { tab: 'ai' })
  })

  it('an AI error not fixed in Settings has no "Open Settings" action', async () => {
    const { AiRequestError } = await import('@/lib/aiErrors')
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockOrganizeTabsMutateAsync.mockRejectedValue(new AiRequestError('ai_failed', 500, 'AI failed'))

    wrap(React.createElement(Header))
    await clickAIMenuItem(/^organize…$/i)

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('AI failed'))
  })
})

// ─── Header — AI "Name group" (acts on the active group) ─────────────────────

describe('Header — AI dropdown: Name group', () => {
  const tabA = { id: 0, title: 'Docs', url: 'https://docs.example.com' }
  const tabB = { id: 0, title: 'Spec', url: 'https://spec.example.com' }
  const savedWindow = { id: 1, name: 'W1', tabs: [tabA, tabB], starred: false, incognito: false, focused: false }
  const nowOpen = () => makeGroup({ permanent: true, name: 'Now Open', windows: [{ ...savedWindow, tabs: [{ id: 9, title: 'Live', url: 'https://live.example.com' }] }] })

  /** Header with `groups` and the main panel showing `activeGroupIndex`, AI menu open. */
  async function openMenu(groups: Group[], activeGroupIndex: number) {
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState(groups) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector({ ...baseUIState, activeGroupIndex }))
    const user = userEvent.setup()
    wrap(React.createElement(Header), makeGroupsState(groups))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))
    return { user, item: await screen.findByTestId('header-ai-name-group') }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, maxGroups: Infinity })
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: true, aiNameGroupEnabled: true } })
    mockUseNameGroupState.mockReturnValue({ isPending: false })
  })

  it('sits between Auto-group and Organize, with Describe group', async () => {
    await openMenu([nowOpen(), makeGroup({ name: 'Research', windows: [savedWindow] })], 1)
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '')
    expect(labels.map((l) => l.split(/Sort open|Suggest|Write a|Merge,/)[0])).toEqual(['Auto-group', 'Name group', 'Describe group', 'Organize…', 'AI settings'])
  })

  it('on a saved group: enabled, and the section label names the group it acts on', async () => {
    const { item } = await openMenu([nowOpen(), makeGroup({ name: 'Research', windows: [savedWindow] })], 1)
    expect(item).not.toHaveAttribute('aria-disabled')
    expect(item).toHaveTextContent('Suggest a name')
    const section = item.closest('[role="group"]') as HTMLElement
    expect(section).toHaveAccessibleName('Selected group · Research')
    // The name is bidi-isolated and carries its full text as a title (the box cuts it with an ellipsis)
    const name = section.querySelector('bdi')
    expect(name?.textContent).toBe('Research')
    expect(name).toHaveAttribute('title', 'Research')
  })

  it('renders a group name as text, never as markup', async () => {
    const { item } = await openMenu([nowOpen(), makeGroup({ name: '<img src=x onerror=alert(1)>', windows: [savedWindow] })], 1)
    const section = item.closest('[role="group"]') as HTMLElement
    expect(section.querySelector('img')).toBeNull()
    expect(section.querySelector('bdi')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('sends the active group\'s tabs and opens the name picker for that group (no rename yet)', async () => {
    mockNameGroupMutateAsync.mockResolvedValue({ names: ['Product research', 'Specs'], name: 'Product research' })
    const research = makeGroup({ name: 'Research', windows: [savedWindow] })
    const { user, item } = await openMenu([nowOpen(), makeGroup({ name: 'Other', windows: [] }), research], 2)
    await user.click(item)
    expect(mockNameGroupMutateAsync).toHaveBeenCalledWith([tabA, tabB])
    await waitFor(() =>
      expect(baseUIState.openModal).toHaveBeenCalledWith('nameGroupPicker', { groupId: research.id, suggestions: ['Product research', 'Specs'] })
    )
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })

  it.each([
    ['Now Open', () => [nowOpen()], 0, 'Select a saved group first'],
    ['an index with no group', () => [nowOpen()], 3, 'Select a saved group first'],
    ['a saved group without tabs', () => [nowOpen(), makeGroup({ name: 'Empty', windows: [] })], 1, 'No tabs in this group to name'],
  ] as const)('on %s: shown but disabled, with a hint, and never calls the API', async (_name, groups, index, hint) => {
    const { user, item } = await openMenu([...groups()], index)
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent(hint)
    await user.click(item).catch(() => undefined) // pointer-events: none on a disabled item
    expect(mockNameGroupMutateAsync).not.toHaveBeenCalled()
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })

  it('is hidden when "Name group" is off in Settings → AI', async () => {
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: true, aiOrganizeEnabled: true, aiNameGroupEnabled: false } })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([nowOpen(), makeGroup({ name: 'Research', windows: [savedWindow] })]) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector({ ...baseUIState, activeGroupIndex: 1 }))
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))
    expect(await screen.findByText('Auto-group')).toBeTruthy()
    expect(screen.queryByTestId('header-ai-name-group')).toBeNull()
    expect(screen.queryByText('Name group')).toBeNull()
  })

  it('the AI button pulses and is disabled while a name is being suggested', () => {
    mockUseNameGroupState.mockReturnValue({ isPending: true })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([nowOpen()]) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    wrap(React.createElement(Header))
    const button = screen.getByRole('button', { name: /ai actions/i })
    expect(button).toBeDisabled()
    expect(button.className).toContain('animate-pulse')
  })

  it('an error fixed in Settings → AI offers "Open Settings" (same toast as the sidebar menu)', async () => {
    const { AiRequestError } = await import('@/lib/aiErrors')
    mockNameGroupMutateAsync.mockRejectedValue(new AiRequestError('byok_key_missing', 0, 'Add your key'))
    const { user, item } = await openMenu([nowOpen(), makeGroup({ name: 'Research', windows: [savedWindow] })], 1)
    await user.click(item)
    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    const [message, options] = mockToastError.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('Add your key')
    expect(options.action.label).toBe('Open Settings')
    options.action.onClick()
    expect(baseUIState.openModal).toHaveBeenCalledWith('settings', { tab: 'ai' })
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
  })
})

// ─── Header — AI menu sections, Describe group, footer ──────────────────────

describe('Header — AI menu: sections, Describe group, footer', () => {
  const tab = { id: 0, title: 'Docs', url: 'https://docs.example.com' }
  const savedWindow = { id: 1, name: 'W1', tabs: [tab], starred: false, incognito: false, focused: false }
  const nowOpen = () => makeGroup({ permanent: true, name: 'Now Open', windows: [{ ...savedWindow, tabs: [{ id: 9, title: 'Live', url: 'https://live.example.com' }] }] })
  const research = () => makeGroup({ name: 'Research', windows: [savedWindow] })
  const ALL_ON = { aiAutoGroupEnabled: true, aiNameGroupEnabled: true, aiDescribeGroupEnabled: true, aiOrganizeEnabled: true }

  async function openMenu(groups: Group[] = [nowOpen(), research()], activeGroupIndex = 1) {
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState(groups) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector({ ...baseUIState, activeGroupIndex }))
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /ai actions/i }))
    return { user, menu: await screen.findByTestId('header-ai-menu') }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, aiMode: 'managed', maxGroups: Infinity })
    mockUseAppSettings.mockReturnValue({ data: { ...ALL_ON } })
    mockUseNameGroupState.mockReturnValue({ isPending: false })
    mockUseAiUsage.mockReturnValue({ remaining: 1820, used: 180, cap: 2000, loading: false, known: true })
  })

  it('groups the actions by scope under labelled sections (labels are not menu items)', async () => {
    await openMenu()
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(3)
    expect(groups[0]).toHaveAccessibleName('Open tabs')
    expect(groups[1]).toHaveAccessibleName('Selected group · Research')
    expect(groups[2]).toHaveAccessibleName('All groups')
    expect(within(groups[0]).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Auto-groupSort open tabs into groups'])
    expect(within(groups[1]).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Name groupSuggest a name',
      'Describe groupWrite a short note about its tabs',
    ])
    expect(within(groups[2]).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Organize…Merge, rename, archive, reorder'])
    // Labels are plain text, never focusable items
    for (const label of screen.getAllByText(/^(Open tabs|All groups)$/)) {
      expect(label.closest('[role="menuitem"]')).toBeNull()
    }
  })

  it.each([
    ['Now Open', () => [nowOpen()], 0, 'Select a saved group first', 'Select a saved group first'],
    ['no group at that index', () => [nowOpen()], 4, 'Select a saved group first', 'Select a saved group first'],
    ['a saved group without tabs', () => [nowOpen(), makeGroup({ name: 'Empty', windows: [] })], 1, 'No tabs in this group to name', 'No tabs in this group to describe'],
  ] as const)('on %s: both selected-group items are disabled with a hint', async (_name, groups, index, nameHint, describeHint) => {
    const { user } = await openMenu([...groups()], index)
    const name = screen.getByTestId('header-ai-name-group')
    const describeItem = screen.getByTestId('header-ai-describe-group')
    expect(name).toHaveAttribute('aria-disabled', 'true')
    expect(describeItem).toHaveAttribute('aria-disabled', 'true')
    expect(name).toHaveTextContent(nameHint)
    expect(describeItem).toHaveTextContent(describeHint)
    await user.click(describeItem).catch(() => undefined) // pointer-events: none on a disabled item
    expect(mockDescribeGroupMutateAsync).not.toHaveBeenCalled()
  })

  it('without a saved group selected the label reads just "Selected group"', async () => {
    await openMenu([nowOpen()], 0)
    expect(screen.getAllByRole('group')[1]).toHaveAccessibleName('Selected group')
  })

  it("Describe group sends the active group's name and tabs", async () => {
    mockDescribeGroupMutateAsync.mockResolvedValue({ description: null })
    const { user } = await openMenu([nowOpen(), makeGroup({ name: 'Other', windows: [] }), research()], 2)
    await user.click(screen.getByTestId('header-ai-describe-group'))
    expect(mockDescribeGroupMutateAsync).toHaveBeenCalledWith({ groupName: 'Research', tabs: [tab] })
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Could not describe this group'))
  })

  it('Describe group off in Settings hides only that item', async () => {
    mockUseAppSettings.mockReturnValue({ data: { ...ALL_ON, aiDescribeGroupEnabled: false } })
    await openMenu()
    expect(screen.queryByTestId('header-ai-describe-group')).toBeNull()
    expect(screen.getByTestId('header-ai-name-group')).toBeTruthy()
  })

  it('a section whose items are all switched off is hidden, with no stray separators', async () => {
    mockUseAppSettings.mockReturnValue({ data: { ...ALL_ON, aiNameGroupEnabled: false, aiDescribeGroupEnabled: false } })
    const { menu } = await openMenu()
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveAccessibleName('Open tabs')
    expect(groups[1]).toHaveAccessibleName('All groups')
    // under the title, between the two sections, above the footer
    expect(within(menu).getAllByRole('separator')).toHaveLength(3)
  })

  it('every action off: only the title and the footer', async () => {
    mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: false, aiNameGroupEnabled: false, aiDescribeGroupEnabled: false, aiOrganizeEnabled: false } })
    const { menu } = await openMenu()
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['AI settings'])
  })

  it('managed plan: the footer shows the credits left this month and describes the AI settings item', async () => {
    await openMenu()
    expect(screen.getByTestId('header-ai-plan')).toHaveTextContent('1,820 credits left')
    expect(screen.getByTestId('header-ai-settings')).toHaveAccessibleDescription('1,820 credits left')
  })

  it('managed plan with one credit left: singular', async () => {
    mockUseAiUsage.mockReturnValue({ remaining: 1, used: 1999, cap: 2000, loading: false, known: true })
    await openMenu()
    expect(screen.getByTestId('header-ai-plan')).toHaveTextContent('1 credit left')
  })

  it('managed plan whose balance is not known yet: no credits line', async () => {
    mockUseAiUsage.mockReturnValue({ remaining: 2000, used: 0, cap: 2000, loading: true, known: false })
    await openMenu()
    expect(screen.queryByTestId('header-ai-plan')).toBeNull()
    expect(screen.getByTestId('header-ai-settings')).not.toHaveAttribute('aria-describedby')
  })

  it('own-key plan: "Your own key", no credits', async () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: true, aiMode: 'byok', maxGroups: Infinity })
    await openMenu()
    expect(screen.getByTestId('header-ai-plan')).toHaveTextContent('Your own key')
    expect(screen.getByTestId('header-ai-menu')).not.toHaveTextContent(/credit/i)
  })

  it('"AI settings" opens Settings on the AI tab', async () => {
    const { user } = await openMenu()
    await user.click(screen.getByTestId('header-ai-settings'))
    expect(baseUIState.openModal).toHaveBeenCalledWith('settings', { tab: 'ai' })
  })

  describe.each([
    ['free', { tier: 'free', aiFeatures: false, maxGroups: 5 }],
    ['pro', { tier: 'pro', aiFeatures: false, maxGroups: Infinity }],
  ])('a %s account: the locked preview', (_name, ent) => {
    beforeEach(() => {
      mockUseEntitlements.mockReturnValue(ent)
      // Switches left off from an earlier Pro AI period don't apply to the preview
      mockUseAppSettings.mockReturnValue({ data: { aiAutoGroupEnabled: false, aiNameGroupEnabled: false, aiDescribeGroupEnabled: false, aiOrganizeEnabled: false } })
    })

    it('the button: full-colour sparkle, a "Pro AI" tag, named "AI actions, Pro AI", enabled', () => {
      mockUseGroupsData.mockReturnValue({ data: makeGroupsState([nowOpen(), research()]) })
      mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
      wrap(React.createElement(Header))
      const button = screen.getByRole('button', { name: 'AI actions, Pro AI' })
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('aria-disabled')
      expect(button.className.split(/\s+/)).not.toContain('opacity-50')
      expect(button.querySelector('svg')?.getAttribute('class')).toContain('text-purple-500')
      const tag = within(button).getByTestId('header-ai-pro-tag')
      expect(tag).toHaveTextContent('Pro AI')
      expect(tag.closest('[aria-hidden="true"]')).not.toBeNull()
    })

    it('the menu shows every action under its section, each locked (a lock, aria-disabled) and never run', async () => {
      const { user, menu } = await openMenu()
      expect(menu).toHaveAttribute('data-locked')
      const groups = screen.getAllByRole('group')
      expect(groups).toHaveLength(3)
      expect(groups[0]).toHaveAccessibleName('Open tabs')
      expect(groups[1]).toHaveAccessibleName('Selected group · Research')
      expect(groups[2]).toHaveAccessibleName('All groups')
      const ids = ['header-ai-auto-group', 'header-ai-name-group', 'header-ai-describe-group', 'header-ai-organize']
      for (const id of ids) {
        const item = screen.getByTestId(id)
        expect(item).toHaveAttribute('role', 'menuitem')
        expect(item).toHaveAttribute('aria-disabled', 'true')
        expect(item).not.toHaveAttribute('data-disabled')
        expect(within(item).getByTestId('header-ai-lock')).toBeTruthy()
        await user.click(item)
      }
      expect(mockAutoGroupMutateAsync).not.toHaveBeenCalled()
      expect(mockNameGroupMutateAsync).not.toHaveBeenCalled()
      expect(mockDescribeGroupMutateAsync).not.toHaveBeenCalled()
      expect(baseUIState.openModal).not.toHaveBeenCalled()
      // Hints describe the action, not why it is blocked
      expect(screen.getByTestId('header-ai-name-group')).toHaveTextContent('Suggest a name')
    })

    it('no credits footer and no "AI settings": an "Upgrade to Pro AI" item that opens the upgrade modal', async () => {
      const { user } = await openMenu()
      expect(screen.queryByTestId('header-ai-settings')).toBeNull()
      expect(screen.queryByTestId('header-ai-plan')).toBeNull()
      const upgrade = screen.getByRole('menuitem', { name: 'Upgrade to Pro AI' })
      expect(upgrade).not.toHaveAttribute('aria-disabled')
      await user.click(upgrade)
      expect(baseUIState.openModal).toHaveBeenCalledWith('upgrade', { reason: 'aiFeatures' })
    })

    it('the arrow keys reach the locked items and the upgrade item', async () => {
      mockUseGroupsData.mockReturnValue({ data: makeGroupsState([nowOpen(), research()]) })
      mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector({ ...baseUIState, activeGroupIndex: 1 }))
      const user = userEvent.setup()
      wrap(React.createElement(Header))
      screen.getByRole('button', { name: 'AI actions, Pro AI' }).focus()
      await user.keyboard('{Enter}')
      await waitFor(() => expect(screen.getByTestId('header-ai-auto-group')).toHaveFocus())
      for (const id of ['header-ai-name-group', 'header-ai-describe-group', 'header-ai-organize', 'header-ai-upgrade']) {
        await user.keyboard('{ArrowDown}')
        await waitFor(() => expect(screen.getByTestId(id)).toHaveFocus())
      }
      await user.keyboard('{Enter}')
      expect(baseUIState.openModal).toHaveBeenCalledWith('upgrade', { reason: 'aiFeatures' })
    })

    it('is hidden when "Show AI button" is off', () => {
      mockUseAppSettings.mockReturnValue({ data: { showAiButton: false } })
      mockUseGroupsData.mockReturnValue({ data: makeGroupsState([nowOpen(), research()]) })
      mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
      wrap(React.createElement(Header))
      expect(screen.queryByRole('button', { name: /ai actions/i })).toBeNull()
    })
  })

  it('Pro AI is unchanged: no tag, no locks, the credits footer, items run', async () => {
    const { menu } = await openMenu()
    // (hidden: the open menu hides the rest of the page from the accessibility tree)
    expect(screen.getByRole('button', { name: 'AI actions', hidden: true })).toBeTruthy()
    expect(screen.queryByTestId('header-ai-pro-tag')).toBeNull()
    expect(menu).not.toHaveAttribute('data-locked')
    expect(screen.queryByTestId('header-ai-lock')).toBeNull()
    expect(screen.queryByTestId('header-ai-upgrade')).toBeNull()
    expect(screen.getByTestId('header-ai-plan')).toHaveTextContent('1,820 credits left')
    expect(screen.getByTestId('header-ai-auto-group')).not.toHaveAttribute('aria-disabled')
  })

  it.each([
    ['explicitly on', { showAiButton: true }, true],
    ['missing (settings saved before it existed)', {}, true],
    ['off', { showAiButton: false }, false],
  ])('Pro AI with "Show AI button" %s', (_name, extra, shown) => {
    mockUseAppSettings.mockReturnValue({ data: { ...ALL_ON, ...extra } })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([nowOpen(), research()]) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    wrap(React.createElement(Header))
    expect(screen.queryByRole('button', { name: 'AI actions' }) !== null).toBe(shown)
  })

  it('a Pro AI account whose AI option is not live has no AI button at all', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro_ai', aiFeatures: false, aiMode: 'byok', maxGroups: Infinity })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([nowOpen(), research()]) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector(baseUIState))
    wrap(React.createElement(Header))
    expect(screen.queryByRole('button', { name: /ai actions/i })).toBeNull()
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
    expect(screen.getByRole('combobox')).toBeTruthy()
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
    const input = screen.getByRole('combobox')
    await user.type(input, 'abc')
    expect(mockTrackEvent).toHaveBeenCalledWith('search_used')
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })

  describe('the search box has the focus as soon as it opens (no timer: keys typed straight away reach it)', () => {
    beforeEach(() => mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() }))

    it('opened by a click', () => {
      wrap(React.createElement(Header))
      act(() => { fireEvent.click(screen.getByRole('button', { name: /open search/i })) })
      expect(screen.getByRole('combobox')).toHaveFocus()
    })

    it('opened by Ctrl+K', () => {
      wrap(React.createElement(Header))
      act(() => { fireEvent.keyDown(window, { key: 'k', ctrlKey: true }) })
      expect(screen.getByRole('combobox')).toHaveFocus()
    })
  })

  describe('focus returns to the opener when the search closes', () => {
    beforeEach(() => mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() }))
    const opener = () => screen.getByRole('button', { name: /open search/i })

    it('Escape in the search box', async () => {
      const user = userEvent.setup()
      wrap(React.createElement(Header))
      await user.click(opener())
      await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
      expect(opener()).toHaveFocus()
    })

    it('Ctrl+K toggles it closed and refocuses the opener', async () => {
      const user = userEvent.setup()
      wrap(React.createElement(Header))
      await user.click(opener())
      await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
      await user.keyboard('{Control>}k{/Control}')
      await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
      expect(opener()).toHaveFocus()
    })

    it('a click outside the search', async () => {
      const user = userEvent.setup()
      wrap(React.createElement(Header))
      await user.click(opener())
      await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
      // the full-popup backdrop behind the search box
      fireEvent.click(document.querySelector('.fixed.inset-0.z-40') as HTMLElement)
      await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
      expect(opener()).toHaveFocus()
    })
  })

  it('the opener name includes the current query, so the search state is announced', () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState) => unknown) => selector({ ...baseUIState, searchFilter: 'my query' }))
    wrap(React.createElement(Header))
    expect(screen.getByRole('button', { name: 'Open search, current search: my query' })).toBeInTheDocument()
  })

  it('does not track search_used when the query is cleared back to empty', async () => {
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: /open search/i }))
    const input = screen.getByRole('combobox')
    await user.type(input, 'a')
    await user.clear(input)
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })
})

// ─── Header — guided tour button ─────────────────────────────────────────────

describe('Header — "Take the tour" button', () => {
  const startTour = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: null, signOut: vi.fn() })
    mockUseEntitlements.mockReturnValue({ tier: 'free', aiFeatures: false, maxGroups: 5 })
    mockUseGroupsData.mockReturnValue({ data: makeGroupsState([makeGroup({ permanent: true })]) })
    mockUseUIStore.mockImplementation((selector: (s: typeof baseUIState & { startTour: typeof startTour }) => unknown) =>
      selector({ ...baseUIState, startTour })
    )
  })

  it('renders a "Take the tour" button that is also the help tour anchor', () => {
    wrap(React.createElement(Header))
    const button = screen.getByRole('button', { name: 'Take the tour' })
    expect(button).toHaveAttribute('data-tour', 'help')
  })

  it('starts the tour from the first step and reports the source', async () => {
    const user = userEvent.setup()
    wrap(React.createElement(Header))
    await user.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(startTour).toHaveBeenCalledTimes(1)
    expect(startTour).toHaveBeenCalledWith()
    expect(mockTrackEvent).toHaveBeenCalledWith('tour_started', { source: 'header' })
  })

  it('marks the search trigger and the account menu as tour anchors', () => {
    wrap(React.createElement(Header))
    expect(screen.getByRole('button', { name: /open search/i })).toHaveAttribute('data-tour', 'search')
    expect(screen.getByRole('button', { name: /settings menu/i })).toHaveAttribute('data-tour', 'account-menu')
  })
})
