import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useOpenWindow } from '@/hooks/useOpenWindow'
import { useBulkDelete, useBulkMoveToGroup, useBulkStar } from '@/hooks/useBulkActions'
import { useToggleGroupStar, useMoveTab, useDeleteTab, useDeleteGroup, useToggleWindowIncognito, GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { useGroupDndHandlers, useWindowDndHandlers } from '@/hooks/useDnd'
import { useCurrentTabs } from '@/hooks/useCurrentTabs'
import { useUIStore } from '@/stores/uiStore'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import type { GroupsState, Tab, Window as ExtWindow } from '@/lib/types'
import type { DragEndEvent } from '@dnd-kit/core'

// ─── Mock localDb ─────────────────────────────────────────────────────────────

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
  deleteGroup: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/syncEngine', () => ({
  deleteRemoteGroups: vi.fn().mockResolvedValue(undefined),
}))

// Import after vi.mock so we get the mocked versions
import { saveGroupsState, getGroupsState } from '@/lib/localDb'
import { deleteRemoteGroups } from '@/lib/syncEngine'

// ─── Chrome API mocks ─────────────────────────────────────────────────────────

// Stub event emitter objects — useCurrentTabs registers listeners on these
const makeListener = () => ({ addListener: vi.fn(), removeListener: vi.fn() })

const chromeMock = {
  tabs: {
    query: vi.fn<() => Promise<chrome.tabs.Tab[]>>().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({}),
    onCreated: makeListener(),
    onRemoved: makeListener(),
    onUpdated: makeListener(),
    onMoved: makeListener(),
    onDetached: makeListener(),
    onAttached: makeListener(),
  },
  windows: {
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn<() => Promise<chrome.windows.Window[]>>().mockResolvedValue([]),
    onCreated: makeListener(),
    onRemoved: makeListener(),
  },
  tabGroups: {
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  },
  runtime: {
    id: 'test-extension-id',
  },
}
globalThis.chrome = chromeMock as unknown as typeof chrome

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UI_RESET = {
  modal: { type: null } as const,
  activeGroupIndex: 0,
  searchFilter: '',
  renameTarget: null,
  undoStack: [],
  redoStack: [],
  selectionMode: false,
  selectedItems: [],
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

/** Build a minimal GroupsState from a list of groups. */
function makeState(groups: GroupsState['available']): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}

/** Quickly build a Tab with a specific numeric id, title and url. */
function tab(id: number, url: string, title = 'Tab'): Tab {
  return { id, url, title, favIconUrl: '', pinned: false }
}

/** Build an ExtWindow with given tabs. */
function win(tabs: Tab[]): ExtWindow {
  return { id: Date.now(), tabs, incognito: false, focused: false }
}

beforeEach(() => {
  useUIStore.setState(UI_RESET)
  vi.clearAllMocks()
  // Restore default chrome mock resolutions
  chromeMock.tabs.query.mockResolvedValue([])
  chromeMock.tabs.create.mockResolvedValue({})
  chromeMock.tabs.remove.mockResolvedValue(undefined)
  chromeMock.tabs.sendMessage.mockResolvedValue({})
  chromeMock.windows.create.mockResolvedValue({})
  chromeMock.windows.update.mockResolvedValue({})
  chromeMock.windows.remove.mockResolvedValue(undefined)
  chromeMock.windows.getAll.mockResolvedValue([])
  chromeMock.tabGroups.query.mockResolvedValue([])
  ;(saveGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

// ─── useOpenWindow ────────────────────────────────────────────────────────────

/**
 * useOpenWindow — smart window-open logic that avoids creating duplicate browser windows.
 * Tests verify: all-new URLs create a window, partial matches create only missing tabs,
 * all-present URLs only focus, empty windows are no-ops, and blank URLs are filtered out.
 */
describe('useOpenWindow', () => {
  it('opens all URLs in a new window when no saved URLs are currently open', async () => {
    chromeMock.tabs.query.mockResolvedValue([])
    // Return a window object so targetWindowId resolves
    chromeMock.windows.create.mockResolvedValue({ id: 99, tabs: [] })

    const { result } = renderHook(() => useOpenWindow())
    const window: ExtWindow = win([tab(1, 'https://a.com', 'A'), tab(2, 'https://b.com', 'B')])

    await act(async () => {
      await result.current(window)
    })

    // Hook now creates a focused window first, then adds tabs individually
    expect(chromeMock.windows.create).toHaveBeenCalledWith({ focused: true })
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ windowId: 99, url: 'https://a.com' })
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ windowId: 99, url: 'https://b.com' })
    expect(chromeMock.windows.update).not.toHaveBeenCalled()
  })

  it('creates only missing tabs in the matched window and focuses it when some URLs are already open', async () => {
    // Tab A is already open in browser window 42
    chromeMock.tabs.query.mockResolvedValue([
      { url: 'https://a.com', windowId: 42 } as chrome.tabs.Tab,
    ])

    const { result } = renderHook(() => useOpenWindow())
    const window: ExtWindow = win([tab(1, 'https://a.com', 'A'), tab(2, 'https://b.com', 'B')])

    await act(async () => {
      await result.current(window)
    })

    // B is missing → create in the matched window
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ windowId: 42, url: 'https://b.com' })
    // Focus the matched window
    expect(chromeMock.windows.update).toHaveBeenCalledWith(42, { focused: true })
    // No new window created
    expect(chromeMock.windows.create).not.toHaveBeenCalled()
  })

  it('only focuses the window when all URLs are already open', async () => {
    chromeMock.tabs.query.mockResolvedValue([
      { url: 'https://a.com', windowId: 42 } as chrome.tabs.Tab,
      { url: 'https://b.com', windowId: 42 } as chrome.tabs.Tab,
    ])

    const { result } = renderHook(() => useOpenWindow())
    const window: ExtWindow = win([tab(1, 'https://a.com', 'A'), tab(2, 'https://b.com', 'B')])

    await act(async () => {
      await result.current(window)
    })

    expect(chromeMock.windows.update).toHaveBeenCalledWith(42, { focused: true })
    expect(chromeMock.tabs.create).not.toHaveBeenCalled()
    expect(chromeMock.windows.create).not.toHaveBeenCalled()
  })

  it('does nothing when the window has no tabs', async () => {
    const { result } = renderHook(() => useOpenWindow())
    const emptyWindow: ExtWindow = win([])

    await act(async () => {
      await result.current(emptyWindow)
    })

    expect(chromeMock.tabs.query).not.toHaveBeenCalled()
    expect(chromeMock.windows.create).not.toHaveBeenCalled()
    expect(chromeMock.windows.update).not.toHaveBeenCalled()
  })

  it('filters out tabs with empty/undefined URLs before opening', async () => {
    chromeMock.tabs.query.mockResolvedValue([])
    chromeMock.windows.create.mockResolvedValue({ id: 99, tabs: [] })

    const { result } = renderHook(() => useOpenWindow())
    // One tab has no URL (e.g. a new tab page stub)
    const tabWithUrl = tab(1, 'https://a.com', 'A')
    const tabNoUrl = { ...tab(2, '', 'Empty'), url: '' }
    const window: ExtWindow = win([tabWithUrl, tabNoUrl])

    await act(async () => {
      await result.current(window)
    })

    // Only the tab with a URL should be created
    expect(chromeMock.windows.create).toHaveBeenCalledWith({ focused: true })
    expect(chromeMock.tabs.create).toHaveBeenCalledTimes(1)
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ windowId: 99, url: 'https://a.com' })
  })
})

// ─── useBulkDelete ────────────────────────────────────────────────────────────

/**
 * useBulkDelete — batch deletion of selected tabs/windows/groups.
 * Key constraints under test: tabs with `id:0` must not call `chrome.tabs.remove`
 * (they are saved copies, not live browser tabs); undo snapshot is always pushed before mutating;
 * selection mode exits on success; empty items array is a complete no-op.
 */
describe('useBulkDelete', () => {
  it('calls chrome.tabs.remove for the tab IDs of all selected tabs', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(101, 'https://live.com', 'Live')])]

    const savedGroup = createGroup('g1', 'Work')
    savedGroup.windows = [win([tab(202, 'https://work.com', 'Work')])]

    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    // Select the tab in the saved group: group 1, window 0, tab 0
    const items = [{ type: 'tab' as const, id: 'tab-1-0-0' }]

    await act(async () => {
      await result.current.mutateAsync(items)
    })

    expect(chromeMock.tabs.remove).toHaveBeenCalledWith([202])
    expect(saveGroupsState).toHaveBeenCalled()
    // The tab should be removed from state
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows[0].tabs).toHaveLength(0)
    void qc
  })

  it('does not call chrome.tabs.remove when selected tabs have no truthy id', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []

    const savedGroup = createGroup('g1', 'Saved')
    // Tab with id=0 is treated as no real browser tab
    savedGroup.windows = [win([{ id: 0, url: 'https://saved.com', title: 'Saved', pinned: false }])]

    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'tab' as const, id: 'tab-1-0-0' }])
    })

    expect(chromeMock.tabs.remove).not.toHaveBeenCalled()
    void qc
  })

  it('exits selection mode after successful delete', async () => {
    const nowOpen = createNowOpenGroup()
    const savedGroup = createGroup('g1', 'Work')
    savedGroup.windows = [win([tab(101, 'https://a.com')])]
    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    useUIStore.setState({ ...UI_RESET, selectionMode: true })

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'tab' as const, id: 'tab-1-0-0' }])
    })

    expect(useUIStore.getState().selectionMode).toBe(false)
    void qc
  })

  it('pushes undo snapshot before mutating', async () => {
    const nowOpen = createNowOpenGroup()
    const savedGroup = createGroup('g1', 'Work')
    savedGroup.windows = [win([tab(101, 'https://a.com')])]
    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'tab' as const, id: 'tab-1-0-0' }])
    })

    expect(useUIStore.getState().undoStack).toHaveLength(1)
    void qc
  })

  it('returns early without side effects when items array is empty', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([])
    })

    expect(chromeMock.tabs.remove).not.toHaveBeenCalled()
    expect(saveGroupsState).not.toHaveBeenCalled()
    void qc
  })

  it('sorts multi-tab selections by windowIndex/tabIndex tiebreaks within the same group and auto-collapses an emptied window', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const group = createGroup('g1', 'Work')
    // Two windows in the same group: window 0 has one tab (will empty and collapse),
    // window 1 has two tabs (only one removed) — exercises the windowIndex/tabIndex
    // comparator tiebreak branches and the "windows.length > 1" collapse branch.
    group.windows = [
      win([tab(1, 'https://a.com')]),
      win([tab(2, 'https://b.com'), tab(3, 'https://c.com')]),
    ]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'tab' as const, id: 'tab-1-1-0' }, // group1, window1, tab0 (b.com)
        { type: 'tab' as const, id: 'tab-1-0-0' }, // group1, window0, tab0 (a.com) — empties window 0
      ])
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    // window 0 collapsed away since it became empty and >1 window existed
    expect(saved.available[1].windows).toHaveLength(1)
    expect(saved.available[1].windows[0].tabs.map((t) => t.url)).toEqual(['https://c.com'])
    void qc
  })

  it('sorts multi-window selections by windowIndex tiebreak within the same group', async () => {
    const nowOpen = createNowOpenGroup()
    const group = createGroup('g1', 'Work')
    group.windows = [
      win([tab(1, 'https://a.com')]),
      win([tab(2, 'https://b.com')]),
      win([tab(3, 'https://c.com')]),
    ]
    const state = makeState([nowOpen, group])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'window' as const, id: 'window-1-0' },
        { type: 'window' as const, id: 'window-1-2' },
      ])
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows).toHaveLength(1)
    expect(saved.available[1].windows[0].tabs[0].url).toBe('https://b.com')
    void qc
  })
})

// ─── useDeleteGroup (single) ───────────────────────────────────────────────────

describe('useDeleteGroup', () => {
  it('hard-deletes the group from Supabase to prevent sync resurrection', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const state = makeState([nowOpen, a])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(1)
    })

    expect(deleteRemoteGroups).toHaveBeenCalledWith(['a'])
  })

  it('refuses to delete the permanent Now Open group', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(0)
    })

    expect(deleteRemoteGroups).not.toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available).toHaveLength(1)
  })
})

// ─── useBulkDelete — group type ────────────────────────────────────────────────

/**
 * Regression coverage: deleting multiple groups in one selection-mode batch must
 * (a) actually persist to IndexedDB with BOTH groups removed (not just one, and not
 *     reverted by index drift from processing the DESC-sorted removal list), and
 * (b) hard-delete each group from Supabase so the next sync doesn't resurrect it
 *     locally (pullRemoteChanges treats a still-remote-but-locally-absent group as
 *     "remote-only" and re-inserts it — see syncEngine.ts).
 */
describe('useBulkDelete — group type', () => {
  it('removes all selected groups (non-adjacent indices) in a single persisted write', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const b = createGroup('b', 'B')
    const c = createGroup('c', 'C')
    const state = makeState([nowOpen, a, b, c])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    // Select A (index 1) and C (index 3); B (index 2) must survive
    await act(async () => {
      await result.current.mutateAsync([
        { type: 'group' as const, id: 'group-1' },
        { type: 'group' as const, id: 'group-3' },
      ])
    })

    expect(saveGroupsState).toHaveBeenCalledTimes(1)
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available.map((g) => g.name)).toEqual(['Now Open', 'B'])
    void qc
  })

  it('hard-deletes each removed group from Supabase to prevent sync resurrection', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const b = createGroup('b', 'B')
    const state = makeState([nowOpen, a, b])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'group' as const, id: 'group-1' },
        { type: 'group' as const, id: 'group-2' },
      ])
    })

    expect(deleteRemoteGroups).toHaveBeenCalledWith(['b', 'a'])
    void qc
  })

  it('never deletes the permanent Now Open group even if targeted', async () => {
    const nowOpen = createNowOpenGroup()
    const a = createGroup('a', 'A')
    const state = makeState([nowOpen, a])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        { type: 'group' as const, id: 'group-0' },
        { type: 'group' as const, id: 'group-1' },
      ])
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available.map((g) => g.name)).toEqual(['Now Open'])
    void qc
  })
})

// ─── useBulkMoveToGroup ───────────────────────────────────────────────────────

/**
 * useBulkMoveToGroup — batch move of selected items to a target group.
 * Tests verify: tabs are removed from source and added to target; group-type items
 * are silently ignored (moving a group into a group is a no-op); selection mode exits on success.
 */
describe('useBulkMoveToGroup', () => {
  it('moves selected tabs from source group to target group', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []

    const source = createGroup('src', 'Source')
    const targetTab = tab(10, 'https://source.com', 'Source Tab')
    source.windows = [win([targetTab])]

    const target = createGroup('tgt', 'Target')
    target.windows = []

    const state = makeState([nowOpen, source, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    // Select tab from group 1 (source), move to group 2 (target)
    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'tab' as const, id: 'tab-1-0-0' }],
        targetGroupIndex: 2,
      })
    })

    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState

    // Tab removed from source group
    const sourceGroup = saved.available[1]
    const sourceTabCount = sourceGroup.windows.reduce((n, w) => n + w.tabs.length, 0)
    expect(sourceTabCount).toBe(0)

    // Tab added to target group
    const targetGroup = saved.available[2]
    const targetTabCount = targetGroup.windows.reduce((n, w) => n + w.tabs.length, 0)
    expect(targetTabCount).toBe(1)
    expect(targetGroup.windows[0].tabs[0].url).toBe('https://source.com')

    void qc
  })

  it('is a no-op when moving groups into groups (type=group)', async () => {
    const nowOpen = createNowOpenGroup()
    const g1 = createGroup('g1', 'One')
    const g2 = createGroup('g2', 'Two')
    const state = makeState([nowOpen, g1, g2])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'group' as const, id: 'group-1' }],
        targetGroupIndex: 2,
      })
    })

    // State not persisted because it's a no-op
    expect(saveGroupsState).not.toHaveBeenCalled()
    void qc
  })

  it('exits selection mode on success', async () => {
    const nowOpen = createNowOpenGroup()
    const source = createGroup('src', 'Source')
    source.windows = [win([tab(5, 'https://x.com')])]
    const target = createGroup('tgt', 'Target')
    target.windows = []
    const state = makeState([nowOpen, source, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    useUIStore.setState({ ...UI_RESET, selectionMode: true })

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'tab' as const, id: 'tab-1-0-0' }],
        targetGroupIndex: 2,
      })
    })

    expect(useUIStore.getState().selectionMode).toBe(false)
    void qc
  })

  it('closes browser tabs and removes the window for window-type bulk delete', async () => {
    const nowOpen = createNowOpenGroup()
    const savedGroup = createGroup('g1', 'Work')
    savedGroup.windows = [win([tab(11, 'https://a.com'), tab(12, 'https://b.com')]), win([tab(13, 'https://c.com')])]
    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkDelete(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([{ type: 'window' as const, id: 'window-1-0' }])
    })

    expect(chromeMock.tabs.remove).toHaveBeenCalledWith([11, 12])
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows).toHaveLength(1)
    expect(saved.available[1].windows[0].tabs[0].url).toBe('https://c.com')
    void qc
  })

  it('moves selected tabs to the permanent Now Open group by opening live tabs (no IndexedDB insert)', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const source = createGroup('src', 'Source')
    source.windows = [win([tab(20, 'https://source.com')])]
    const state = makeState([nowOpen, source])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'tab' as const, id: 'tab-1-0-0' }],
        targetGroupIndex: 0,
      })
    })

    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://source.com', active: false })
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[0].windows).toHaveLength(0)
    void qc
  })

  it('skips restricted URLs when moving tabs into Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const source = createGroup('src', 'Source')
    source.windows = [win([tab(21, 'chrome://settings')])]
    const state = makeState([nowOpen, source])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'tab' as const, id: 'tab-1-0-0' }],
        targetGroupIndex: 0,
      })
    })

    expect(chromeMock.tabs.create).not.toHaveBeenCalled()
    void qc
  })

  it('moves selected windows to the target group', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const source = createGroup('src', 'Source')
    source.windows = [win([tab(30, 'https://source.com')])]
    const target = createGroup('tgt', 'Target')
    target.windows = []
    const state = makeState([nowOpen, source, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'window' as const, id: 'window-1-0' }],
        targetGroupIndex: 2,
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows).toHaveLength(0)
    expect(saved.available[2].windows).toHaveLength(1)
    void qc
  })

  it('moves selected windows into Now Open by opening a live browser window', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const source = createGroup('src', 'Source')
    source.windows = [win([tab(31, 'https://source.com')])]
    const state = makeState([nowOpen, source])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [{ type: 'window' as const, id: 'window-1-0' }],
        targetGroupIndex: 0,
      })
    })

    expect(chromeMock.windows.create).toHaveBeenCalledWith({ url: ['https://source.com'], focused: false })
    void qc
  })

  it('is a no-op when items array is empty', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ items: [], targetGroupIndex: 0 })
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
    void qc
  })

  it('moves multiple tabs from the same source group (windowIndex/tabIndex tiebreaks) and collapses an emptied window', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const source = createGroup('src', 'Source')
    source.windows = [
      win([tab(1, 'https://a.com')]),
      win([tab(2, 'https://b.com'), tab(3, 'https://c.com')]),
    ]
    const target = createGroup('tgt', 'Target')
    target.windows = []
    const state = makeState([nowOpen, source, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'tab' as const, id: 'tab-1-1-0' },
          { type: 'tab' as const, id: 'tab-1-0-0' },
        ],
        targetGroupIndex: 2,
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    // source window 0 collapsed away since it became empty and >1 window existed
    expect(saved.available[1].windows).toHaveLength(1)
    expect(saved.available[1].windows[0].tabs.map((t) => t.url)).toEqual(['https://c.com'])
    // both moved tabs landed in target
    const targetTabCount = saved.available[2].windows.reduce((n, w) => n + w.tabs.length, 0)
    expect(targetTabCount).toBe(2)
    void qc
  })

  it('moves multiple windows from the same source group (windowIndex tiebreak comparator)', async () => {
    const nowOpen = createNowOpenGroup()
    const source = createGroup('src', 'Source')
    source.windows = [
      win([tab(1, 'https://a.com')]),
      win([tab(2, 'https://b.com')]),
      win([tab(3, 'https://c.com')]),
    ]
    const target = createGroup('tgt', 'Target')
    target.windows = []
    const state = makeState([nowOpen, source, target])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        items: [
          { type: 'window' as const, id: 'window-1-0' },
          { type: 'window' as const, id: 'window-1-2' },
        ],
        targetGroupIndex: 2,
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows).toHaveLength(1)
    expect(saved.available[2].windows).toHaveLength(2)
    void qc
  })
})

// ─── useBulkStar ────────────────────────────────────────────────────────────────

describe('useBulkStar', () => {
  it('stars selected windows and re-sorts starred windows first', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const g = createGroup('g1', 'Work')
    g.windows = [win([tab(1, 'https://a.com')]), win([tab(2, 'https://b.com')])]
    const state = makeState([nowOpen, g])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ items: [{ type: 'window' as const, id: 'window-1-1' }], starred: true })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows[0].tabs[0].url).toBe('https://b.com')
    expect(saved.available[1].windows[0].starred).toBe(true)
    void qc
  })

  it('stars selected non-permanent groups', async () => {
    const nowOpen = createNowOpenGroup()
    const g = createGroup('g1', 'Work')
    const state = makeState([nowOpen, g])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ items: [{ type: 'group' as const, id: 'group-1' }], starred: true })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].starred).toBe(true)
    void qc
  })

  it('never stars the permanent Now Open group even if targeted', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ items: [{ type: 'group' as const, id: 'group-0' }], starred: true })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[0].starred).toBeFalsy()
    void qc
  })

  it('exits selection mode on success', async () => {
    const nowOpen = createNowOpenGroup()
    const g = createGroup('g1', 'Work')
    const state = makeState([nowOpen, g])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    useUIStore.setState({ ...UI_RESET, selectionMode: true })

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ items: [{ type: 'group' as const, id: 'group-1' }], starred: true })
    })

    expect(useUIStore.getState().selectionMode).toBe(false)
    void qc
  })

  it('is a no-op when items array is empty', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useBulkStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ items: [], starred: true })
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
    void qc
  })
})

// ─── useToggleGroupStar ───────────────────────────────────────────────────────

/**
 * useToggleGroupStar — toggles starred flag and re-sorts groups into three zones:
 * Now Open (permanent, always index 0), starred, then unstarred.
 * Tests verify: starring moves group before unstarred; unstarring moves group after starred;
 * Now Open invariant (permanent stays at index 0) is upheld after every sort.
 */
describe('useToggleGroupStar', () => {
  it('sorts newly starred groups before unstarred groups (Now Open stays at index 0)', async () => {
    const nowOpen = createNowOpenGroup()

    const groupA = createGroup('a', 'A')
    groupA.starred = false

    const groupB = createGroup('b', 'B')
    groupB.starred = false

    const groupC = createGroup('c', 'C')
    groupC.starred = false

    const state = makeState([nowOpen, groupA, groupB, groupC])
    // Active group = groupA at index 1
    state.active = { id: groupA.id, index: 1 }
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    // Pre-seed cache so qc.getQueryData works for internal calls
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleGroupStar(), { wrapper })

    // Star groupC (currently at index 3)
    await act(async () => {
      await result.current.mutateAsync(3)
    })

    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const saved_groups = saved.available

    // Now Open must remain at index 0
    expect(saved_groups[0].permanent).toBe(true)

    // groupC (now starred) must appear before groupA and groupB (unstarred)
    const groupCIndex = saved_groups.findIndex((g) => g.id === 'c')
    const groupAIndex = saved_groups.findIndex((g) => g.id === 'a')
    const groupBIndex = saved_groups.findIndex((g) => g.id === 'b')

    expect(groupCIndex).toBe(1) // starred → moves to front of rest
    expect(groupCIndex).toBeLessThan(groupAIndex)
    expect(groupCIndex).toBeLessThan(groupBIndex)
  })

  it('un-starring a group moves it after groups that remain unstarred', async () => {
    const nowOpen = createNowOpenGroup()

    // unstarred comes BEFORE starred in rest so that after un-starring, the
    // formerly-starred group falls after unstarred in the sorted result.
    const unstarred = createGroup('unstarred', 'Unstarred')
    unstarred.starred = false

    const starred = createGroup('starred', 'Starred')
    starred.starred = true

    const state = makeState([nowOpen, unstarred, starred])
    state.active = { id: starred.id, index: 2 }
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleGroupStar(), { wrapper })

    // Un-star 'starred' group at index 2
    await act(async () => {
      await result.current.mutateAsync(2)
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState

    // Now Open still at 0
    expect(saved.available[0].permanent).toBe(true)
    // The formerly-starred group is now at the end (after 'unstarred')
    const starredIdx = saved.available.findIndex((g) => g.id === 'starred')
    const unstarredIdx = saved.available.findIndex((g) => g.id === 'unstarred')
    expect(starredIdx).toBeGreaterThan(unstarredIdx)
  })

  it('Now Open is always kept at index 0 after sort', async () => {
    const nowOpen = createNowOpenGroup()
    const g1 = createGroup('g1', 'One')
    g1.starred = false
    const g2 = createGroup('g2', 'Two')
    g2.starred = false

    const state = makeState([nowOpen, g1, g2])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleGroupStar(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(2) // star g2
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[0].permanent).toBe(true)
    expect(saved.available[0].name).toBe('Now Open')
  })
})

// ─── useMoveTab ───────────────────────────────────────────────────────────────

/**
 * useMoveTab — moves or copies a tab between groups, with special handling for Now Open.
 * Tests cover: copy:true leaves source intact and stamps id:0 on the copy (so delete guards
 * won't close the live browser tab); copy:false removes from source; ogImage is fetched via
 * content script for live tabs and carried through; sendMessage failures yield undefined ogImage.
 */
describe('useMoveTab', () => {
  it('copy:true — source group unchanged, target gains a copy with id:0', async () => {
    const nowOpen = createNowOpenGroup()
    const liveTab = tab(99, 'https://live.com', 'Live')
    nowOpen.windows = [win([liveTab])]

    const savedGroup = createGroup('g1', 'Saved')
    savedGroup.windows = []

    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        fromGroupIndex: 0,
        fromWindowIndex: 0,
        fromTabIndex: 0,
        toGroupIndex: 1,
        copy: true,
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState

    // Source (Now Open) still has the original tab with original id
    expect(saved.available[0].windows[0].tabs).toHaveLength(1)
    expect(saved.available[0].windows[0].tabs[0].id).toBe(99)

    // Target gains a copy with id:0
    const targetTabs = saved.available[1].windows.flatMap((w) => w.tabs)
    expect(targetTabs).toHaveLength(1)
    expect(targetTabs[0].url).toBe('https://live.com')
    expect(targetTabs[0].id).toBe(0)

    void qc
  })

  it('copy:false (default) — tab removed from source, target gains tab with original id', async () => {
    const nowOpen = createNowOpenGroup()
    const sourceGroup = createGroup('src', 'Source')
    const sourceTab = tab(42, 'https://source.com', 'Source')
    sourceGroup.windows = [win([sourceTab])]

    const targetGroup = createGroup('tgt', 'Target')
    targetGroup.windows = []

    const state = makeState([nowOpen, sourceGroup, targetGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        fromGroupIndex: 1,
        fromWindowIndex: 0,
        fromTabIndex: 0,
        toGroupIndex: 2,
        // copy defaults to false
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState

    // Source window is empty (tab removed)
    const sourceTabs = saved.available[1].windows.flatMap((w) => w.tabs)
    expect(sourceTabs).toHaveLength(0)

    // Target has the tab with its original id
    const targetTabs = saved.available[2].windows.flatMap((w) => w.tabs)
    expect(targetTabs).toHaveLength(1)
    expect(targetTabs[0].id).toBe(42)

    void qc
  })

  it('copy:true — ogImage populated from sendMessage when source is a live Now Open tab', async () => {
    const nowOpen = createNowOpenGroup()
    const liveTab = tab(99, 'https://live.com', 'Live')
    nowOpen.windows = [win([liveTab])]

    const savedGroup = createGroup('g1', 'Saved')
    savedGroup.windows = []

    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.tabs.sendMessage.mockResolvedValue({ ogImage: 'https://live.com/og.png' })

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        fromGroupIndex: 0,
        fromWindowIndex: 0,
        fromTabIndex: 0,
        toGroupIndex: 1,
        copy: true,
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const destTab = saved.available[1].windows.flatMap((w) => w.tabs)[0]
    expect(destTab.ogImage).toBe('https://live.com/og.png')
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(99, { type: 'GET_PAGE_META' })

    void qc
  })

  it('copy:false — ogImage populated from sendMessage when moving a live tab between saved groups', async () => {
    const nowOpen = createNowOpenGroup()
    const sourceGroup = createGroup('src', 'Source')
    // id>0 simulates a live tab in a saved group
    const liveTab = tab(55, 'https://src.com', 'Src')
    sourceGroup.windows = [win([liveTab])]

    const targetGroup = createGroup('tgt', 'Target')
    targetGroup.windows = []

    const state = makeState([nowOpen, sourceGroup, targetGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.tabs.sendMessage.mockResolvedValue({ ogImage: 'https://src.com/og.png' })

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        fromGroupIndex: 1,
        fromWindowIndex: 0,
        fromTabIndex: 0,
        toGroupIndex: 2,
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const destTab = saved.available[2].windows.flatMap((w) => w.tabs)[0]
    expect(destTab.ogImage).toBe('https://src.com/og.png')

    void qc
  })

  it('ogImage is undefined when sendMessage throws (e.g. chrome:// pages)', async () => {
    const nowOpen = createNowOpenGroup()
    const liveTab = tab(77, 'https://live.com', 'Live')
    nowOpen.windows = [win([liveTab])]

    const savedGroup = createGroup('g1', 'Saved')
    savedGroup.windows = []

    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.tabs.sendMessage.mockRejectedValue(new Error('Cannot access chrome:// URL'))

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useMoveTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        fromGroupIndex: 0,
        fromWindowIndex: 0,
        fromTabIndex: 0,
        toGroupIndex: 1,
        copy: true,
      })
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const destTab = saved.available[1].windows.flatMap((w) => w.tabs)[0]
    expect(destTab.ogImage).toBeUndefined()

    void qc
  })
})

// ─── useDeleteTab ─────────────────────────────────────────────────────────────

/**
 * useDeleteTab — removes a tab from a group, conditionally closing it in Chrome.
 * Core invariant: tabs with `id:0` (saved copies from useMoveTab copy:true) must
 * never trigger `chrome.tabs.remove` even if their URL happens to appear in Now Open.
 * Tabs with a real numeric id are only closed if their URL is live in Now Open.
 */
describe('useDeleteTab', () => {
  it('does NOT call chrome.tabs.remove when the tab has id:0', async () => {
    const nowOpen = createNowOpenGroup()
    // Put the same URL in Now Open so getNowOpenUrls would return it
    nowOpen.windows = [win([tab(1, 'https://copied.com', 'Copied')])]

    const savedGroup = createGroup('g1', 'Saved')
    // Tab with id:0 — copied tab guard
    savedGroup.windows = [win([{ id: 0, url: 'https://copied.com', title: 'Copy', pinned: false }])]

    const state = makeState([nowOpen, savedGroup])
    // Seed both the cache (for getQueryData) and the mock (for fetchQuery)
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 0 })
    })

    // id:0 is falsy — the guard `if (tab?.id)` must not call remove
    expect(chromeMock.tabs.remove).not.toHaveBeenCalled()

    void qc
  })

  it('calls chrome.tabs.remove for a tab with a real id that is live in Now Open', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [win([tab(77, 'https://live.com', 'Live')])]

    const savedGroup = createGroup('g1', 'Saved')
    savedGroup.windows = [win([tab(77, 'https://live.com', 'Live')])]

    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useDeleteTab(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 1, windowIndex: 0, tabIndex: 0 })
    })

    expect(chromeMock.tabs.remove).toHaveBeenCalledWith(77)

    void qc
  })
})

// ─── useGroupDndHandlers ──────────────────────────────────────────────────────

/** Minimal DragEndEvent shim for testing onDragEnd directly. */
function dragEvent(activeId: string, overId: string): DragEndEvent {
  return { active: { id: activeId, data: { current: undefined }, rect: { initial: null, translated: null } }, over: { id: overId, data: { current: undefined }, rect: { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 } }, collisions: [], delta: { x: 0, y: 0 }, activatorEvent: new Event('pointerdown') } as unknown as DragEndEvent
}

/**
 * useGroupDndHandlers — drag-and-drop reordering of groups across starred/unstarred zones.
 * Dropping a group into the starred zone promotes it (starred:true); into the unstarred zone
 * demotes it (starred:false). Dragging within the same zone keeps the starred flag unchanged.
 * Dragging the permanent Now Open group is always a no-op.
 */
describe('useGroupDndHandlers', () => {
  it('promotes an unstarred group to starred when dropped into the starred zone', async () => {
    const nowOpen = createNowOpenGroup()

    const starredA = createGroup('sa', 'StarredA')
    starredA.starred = true

    const unstarredB = createGroup('ub', 'UnstarredB')
    unstarredB.starred = false

    const state = makeState([nowOpen, starredA, unstarredB])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    // Drag unstarredB (index 2) over starredA (index 1)
    await act(async () => {
      await result.current.onDragEnd(dragEvent('group-2', 'group-1'))
    })

    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const moved = saved.available.find((g) => g.id === 'ub')!
    expect(moved.starred).toBe(true)
    // Must land before any unstarred group (Now Open excluded)
    const unstarredIdx = saved.available.findIndex((g) => g.id === 'ub')
    const otherUnstarred = saved.available.filter((g) => !g.starred && !g.permanent)
    expect(otherUnstarred.every((g) => saved.available.indexOf(g) > unstarredIdx)).toBe(true)

    void qc
  })

  it('demotes a starred group to unstarred when dropped into the unstarred zone', async () => {
    const nowOpen = createNowOpenGroup()

    const starredA = createGroup('sa', 'StarredA')
    starredA.starred = true

    const unstarredB = createGroup('ub', 'UnstarredB')
    unstarredB.starred = false

    const state = makeState([nowOpen, starredA, unstarredB])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    // Drag starredA (index 1) over unstarredB (index 2)
    await act(async () => {
      await result.current.onDragEnd(dragEvent('group-1', 'group-2'))
    })

    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const moved = saved.available.find((g) => g.id === 'sa')!
    expect(moved.starred).toBe(false)
    // Must land after all starred groups
    const movedIdx = saved.available.indexOf(moved)
    const allStarred = saved.available.filter((g) => g.starred)
    expect(allStarred.every((g) => saved.available.indexOf(g) < movedIdx)).toBe(true)

    void qc
  })

  it('keeps a starred group starred when reordered within the starred zone', async () => {
    const nowOpen = createNowOpenGroup()

    const starredA = createGroup('sa', 'StarredA')
    starredA.starred = true

    const starredB = createGroup('sb', 'StarredB')
    starredB.starred = true

    const state = makeState([nowOpen, starredA, starredB])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    // Drag starredB (index 2) over starredA (index 1) — swap within starred zone
    await act(async () => {
      await result.current.onDragEnd(dragEvent('group-2', 'group-1'))
    })

    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const moved = saved.available.find((g) => g.id === 'sb')!
    expect(moved.starred).toBe(true)
    // starredB now before starredA
    const idxB = saved.available.findIndex((g) => g.id === 'sb')
    const idxA = saved.available.findIndex((g) => g.id === 'sa')
    expect(idxB).toBeLessThan(idxA)

    void qc
  })

  it('does not mutate state when dragging the permanent Now Open group', async () => {
    const nowOpen = createNowOpenGroup()
    const g1 = createGroup('g1', 'One')
    g1.starred = false

    const state = makeState([nowOpen, g1])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    // Try to drag Now Open (index 0)
    await act(async () => {
      await result.current.onDragEnd(dragEvent('group-0', 'group-1'))
    })

    expect(saveGroupsState).not.toHaveBeenCalled()

    void qc
  })
})

// ─── useWindowDndHandlers ─────────────────────────────────────────────────────

/**
 * useWindowDndHandlers (same-group) — drag-and-drop reordering of windows within a single group.
 * Mirrors group DnD zone semantics: dragging into the starred zone promotes the window,
 * dragging into the unstarred zone demotes it. After the drop, `sortWindowsByStarred` re-sorts.
 */
describe('useWindowDndHandlers (same-group)', () => {
  it('promotes an unstarred window to starred when dropped onto a starred window', async () => {
    const nowOpen = createNowOpenGroup()

    const g1 = createGroup('g1', 'Work')
    const starredWin = createWindow([tab(1, 'https://a.com')], 'StarredWin', false, true)
    const unstarredWin = createWindow([tab(2, 'https://b.com')], 'UnstarredWin', false, false)
    g1.windows = [starredWin, unstarredWin]

    const state = makeState([nowOpen, g1])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    // groupIndex = 1 (g1)
    const { result } = renderHook(() => useWindowDndHandlers(1), { wrapper })

    // Drag unstarredWin (window-1-1) over starredWin (window-1-0) within same group
    await act(async () => {
      await result.current.onDragEnd(dragEvent('window-1-1', 'window-1-0'))
    })

    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const savedWindows = saved.available[1].windows
    // The moved window must now be starred
    const movedWin = savedWindows.find((w) => w.id === unstarredWin.id)!
    expect(movedWin.starred).toBe(true)
    // After sortWindowsByStarred, starred windows come first
    const movedIdx = savedWindows.indexOf(movedWin)
    const unstarredAfter = savedWindows.filter((w) => !w.starred)
    expect(unstarredAfter.every((w) => savedWindows.indexOf(w) > movedIdx)).toBe(true)

    void qc
  })

  it('demotes a starred window to unstarred when dropped onto an unstarred window', async () => {
    const nowOpen = createNowOpenGroup()

    const g1 = createGroup('g1', 'Work')
    const starredWin = createWindow([tab(1, 'https://a.com')], 'StarredWin', false, true)
    const unstarredWin = createWindow([tab(2, 'https://b.com')], 'UnstarredWin', false, false)
    g1.windows = [starredWin, unstarredWin]

    const state = makeState([nowOpen, g1])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useWindowDndHandlers(1), { wrapper })

    // Drag starredWin (window-1-0) over unstarredWin (window-1-1)
    await act(async () => {
      await result.current.onDragEnd(dragEvent('window-1-0', 'window-1-1'))
    })

    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const savedWindows = saved.available[1].windows
    const movedWin = savedWindows.find((w) => w.id === starredWin.id)!
    expect(movedWin.starred).toBe(false)
    // After sort, it must appear after all starred windows
    const movedIdx = savedWindows.indexOf(movedWin)
    const stillStarred = savedWindows.filter((w) => w.starred)
    expect(stillStarred.every((w) => savedWindows.indexOf(w) < movedIdx)).toBe(true)

    void qc
  })

  it('moves a window into a different group (sidebar combine), clearing focused/starred', async () => {
    const nowOpen = createNowOpenGroup()
    const g1 = createGroup('g1', 'Source')
    const movingWin = { ...createWindow([tab(1, 'https://a.com')], 'Moving', false, true), focused: true }
    g1.windows = [movingWin]
    const g2 = createGroup('g2', 'Target')
    g2.windows = []
    const state = makeState([nowOpen, g1, g2])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useWindowDndHandlers(1), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(dragEvent('window-1-0', 'group-2'))
    })

    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows).toHaveLength(0)
    expect(saved.available[2].windows).toHaveLength(1)
    expect(saved.available[2].windows[0].focused).toBe(false)
    expect(saved.available[2].windows[0].starred).toBe(false)
    void qc
  })

  it('is a no-op when active and over ids are identical', async () => {
    const nowOpen = createNowOpenGroup()
    const g1 = createGroup('g1', 'Work')
    g1.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([nowOpen, g1])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useWindowDndHandlers(1), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(dragEvent('window-1-0', 'window-1-0'))
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
    void qc
  })

  it('is a no-op when the dragged item is not a window', async () => {
    const nowOpen = createNowOpenGroup()
    const g1 = createGroup('g1', 'Work')
    g1.windows = [win([tab(1, 'https://a.com')])]
    const state = makeState([nowOpen, g1])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useWindowDndHandlers(1), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(dragEvent('group-1', 'window-1-0'))
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
    void qc
  })

  it('is a no-op when there is no cached GroupsState', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useWindowDndHandlers(1), { wrapper })

    await act(async () => {
      await result.current.onDragEnd(dragEvent('window-1-0', 'window-1-1'))
    })

    expect(saveGroupsState).not.toHaveBeenCalled()
  })
})

// ─── useCurrentTabs ───────────────────────────────────────────────────────────

/** Build a minimal chrome.windows.Window */
function chromeWindow(id: number): chrome.windows.Window {
  return { id, type: 'normal', focused: false, incognito: false, alwaysOnTop: false } as chrome.windows.Window
}

/** Build a minimal chrome.tabs.Tab */
function chromeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1, index: 0, pinned: false, highlighted: false, windowId: 1,
    active: true, incognito: false, selected: false, discarded: false,
    autoDiscardable: true, groupId: -1, title: 'Tab', url: 'https://example.com',
    ...overrides,
  } as chrome.tabs.Tab
}

/**
 * useCurrentTabs — hook that keeps Now Open in sync with live Chrome tabs.
 * Tests verify: chromeGroup metadata is attached when a tab belongs to a Chrome tab group;
 * ungrouped tabs (groupId=-1) have no chromeGroup; updates go via setQueryData (not invalidate)
 * so the UI never flickers due to a cache miss.
 */
describe('useCurrentTabs', () => {
  it('sets chromeGroup on Now Open tab when groupId matches a Chrome tab group', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([
      chromeTab({ id: 10, windowId: 1, groupId: 5, title: 'Docs', url: 'https://docs.com' }),
    ])
    chromeMock.tabGroups.query.mockResolvedValue([
      { id: 5, title: 'Work', color: 'blue', windowId: 1, collapsed: false },
    ])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    // Let async sync settle
    await act(async () => {})

    const cached = qc.getQueryData<typeof state>(GROUPS_QUERY_KEY)
    const firstTab = cached?.available[0]?.windows[0]?.tabs[0]
    expect(firstTab?.chromeGroup).toEqual({ id: 5, name: 'Work', color: 'blue' })

    unmount()
  })

  it('leaves chromeGroup undefined when tab groupId is -1', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([
      chromeTab({ id: 11, windowId: 1, groupId: -1, title: 'Plain', url: 'https://plain.com' }),
    ])
    chromeMock.tabGroups.query.mockResolvedValue([])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    const cached = qc.getQueryData<typeof state>(GROUPS_QUERY_KEY)
    const firstTab = cached?.available[0]?.windows[0]?.tabs[0]
    expect(firstTab?.chromeGroup).toBeUndefined()

    unmount()
  })

  it('updates the query cache directly via setQueryData (not invalidateQueries)', async () => {
    const nowOpen = createNowOpenGroup()
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([])

    const { qc, wrapper } = makeWrapper()
    const setQueryDataSpy = vi.spyOn(qc, 'setQueryData')
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    expect(setQueryDataSpy).toHaveBeenCalledWith(GROUPS_QUERY_KEY, expect.any(Object))
    expect(invalidateSpy).not.toHaveBeenCalled()

    unmount()
  })
})

// ─── useGroupDndHandlers — sequential drag (cache-read invariant) ─────────────

/**
 * useGroupDndHandlers — sequential drag regression test.
 * Catches a prior bug where the second drag read stale state from IDB (sorted by updatedAt)
 * instead of the TanStack Query cache, mis-placing the dragged group at index 1.
 * Two sequential drags must each use the post-previous-drag cache state, not IDB.
 */
describe('useGroupDndHandlers — sequential drag', () => {
  it('group drag maintains order across two sequential drags (regression: cache not IDB)', async () => {
    // Seed: [NowOpen, GroupA*, GroupB*, GroupC, GroupD]
    const nowOpen = createNowOpenGroup()

    const groupA = createGroup('a', 'GroupA')
    groupA.starred = true

    const groupB = createGroup('b', 'GroupB')
    groupB.starred = true

    const groupC = createGroup('c', 'GroupC')
    groupC.starred = false

    const groupD = createGroup('d', 'GroupD')
    groupD.starred = false

    const state1 = makeState([nowOpen, groupA, groupB, groupC, groupD])

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state1)
    const { result } = renderHook(() => useGroupDndHandlers(), { wrapper })

    // ── Drag 1: GroupD (index 4) → onto GroupB (index 2, starred) ─────────────
    // Expected result: GroupD becomes starred, zone-sorted to
    //   [NowOpen, GroupA*, GroupD*, GroupB*, GroupC]
    await act(async () => {
      await result.current.onDragEnd(dragEvent('group-4', 'group-2'))
    })

    const afterDrag1 = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const dIdx1 = afterDrag1.available.findIndex((g) => g.id === 'd')
    const cIdx1 = afterDrag1.available.findIndex((g) => g.id === 'c')
    // GroupD is now starred and sits before GroupC (unstarred)
    expect(afterDrag1.available[dIdx1].starred).toBe(true)
    expect(dIdx1).toBeLessThan(cIdx1)

    // ── Update cache to reflect post-drag-1 state (simulates React Query update) ─
    qc.setQueryData(GROUPS_QUERY_KEY, afterDrag1)
    vi.clearAllMocks()
    ;(saveGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    // ── Drag 2: GroupC (now at index 4) → onto GroupB (index 3, starred) ──────
    // Expected: GroupC becomes starred, zone-sorted to
    //   [NowOpen, GroupA*, GroupD*, GroupC*, GroupB*]
    // Old IDB-sort bug would mis-place GroupC at index 1 (by updatedAt).
    await act(async () => {
      await result.current.onDragEnd(dragEvent('group-4', 'group-3'))
    })

    const afterDrag2 = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    const cIdx2 = afterDrag2.available.findIndex((g) => g.id === 'c')
    const bIdx2 = afterDrag2.available.findIndex((g) => g.id === 'b')

    // GroupC is now starred and placed before GroupB (it was dropped onto GroupB)
    expect(afterDrag2.available[cIdx2].starred).toBe(true)
    expect(cIdx2).toBeLessThan(bIdx2)
    // GroupC must NOT have jumped to index 1 (old updatedAt-sort bug)
    expect(cIdx2).toBeGreaterThan(1)
    // Now Open remains at index 0
    expect(afterDrag2.available[0].permanent).toBe(true)

    void qc
  })
})

// ─── useToggleWindowIncognito ─────────────────────────────────────────────────

/**
 * useToggleWindowIncognito — toggles incognito for a window, with different behavior per context.
 * For Now Open windows: opens a real new Chrome window in (in)cognito and closes the old one.
 * For saved groups: only flips the flag in IndexedDB, never touches the browser.
 * Restricted URLs (chrome://, about:) are always filtered from the new window's URL list.
 */
describe('useToggleWindowIncognito', () => {
  /** Build a Now Open window with given tabs and incognito flag. */
  function nowOpenWindow(id: number, tabs: ReturnType<typeof tab>[], incognito = false): ExtWindow {
    return { id, tabs, incognito, focused: false }
  }

  it('calls chrome.windows.create with incognito:true and the tab URLs for a Now Open window', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [nowOpenWindow(42, [tab(1, 'https://a.com'), tab(2, 'https://b.com')])]

    const state = makeState([nowOpen])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleWindowIncognito(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 })
    })

    expect(chromeMock.windows.create).toHaveBeenCalledWith({
      incognito: true,
      url: ['https://a.com', 'https://b.com'],
      focused: true,
    })
  })

  it('calls chrome.windows.remove with the old window ID for a Now Open window', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [nowOpenWindow(42, [tab(1, 'https://a.com')])]

    const state = makeState([nowOpen])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleWindowIncognito(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 })
    })

    expect(chromeMock.windows.remove).toHaveBeenCalledWith(42)
  })

  it('filters out restricted URLs (chrome://, about:) from the chrome.windows.create call', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [nowOpenWindow(10, [
      tab(1, 'chrome://newtab'),
      tab(2, 'about:blank'),
      tab(3, 'https://example.com'),
    ])]

    const state = makeState([nowOpen])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleWindowIncognito(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 })
    })

    expect(chromeMock.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: ['https://example.com'] })
    )
  })

  it('does NOT call chrome.windows.create for a saved group — only updates IndexedDB', async () => {
    const nowOpen = createNowOpenGroup()
    const savedGroup = createGroup('g1', 'Work')
    savedGroup.windows = [{ ...nowOpenWindow(99, [tab(1, 'https://work.com')]), incognito: false }]

    const state = makeState([nowOpen, savedGroup])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)

    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleWindowIncognito(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 1, windowIndex: 0 })
    })

    expect(chromeMock.windows.create).not.toHaveBeenCalled()
    expect(chromeMock.windows.remove).not.toHaveBeenCalled()
    expect(saveGroupsState).toHaveBeenCalled()
    const saved = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls[0][0] as GroupsState
    expect(saved.available[1].windows[0].incognito).toBe(true)
  })

  it('calls chrome.windows.create with incognito:false when toggling an incognito window off', async () => {
    const nowOpen = createNowOpenGroup()
    // Start incognito: true — toggling off should produce incognito: false
    nowOpen.windows = [nowOpenWindow(77, [tab(1, 'https://a.com')], true)]

    const state = makeState([nowOpen])
    const { qc, wrapper } = makeWrapper()
    qc.setQueryData(GROUPS_QUERY_KEY, state)
    const { result } = renderHook(() => useToggleWindowIncognito(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ groupIndex: 0, windowIndex: 0 })
    })

    expect(chromeMock.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ incognito: false })
    )
  })
})
