/**
 * Branch-coverage batch for useCurrentTabs.ts's internal syncNowOpen/backfillOgImages logic,
 * exercised through the public useCurrentTabs() hook: error catch path, tabGroups.query
 * unavailable fallback, extra-permanent-group stripping, no-permanent-group early return,
 * own-extension-page filtering, ogImage carryover vs backfill, and note carryover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useCurrentTabs } from '@/hooks/useCurrentTabs'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { GroupsState, Tab } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: vi.fn(),
}))

// mocked per-test so we can flip `tier` across a rerender to exercise the tierRef fix
const mockUseEntitlements = vi.fn()
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => mockUseEntitlements(),
}))

vi.mock('@/lib/deviceSessions', () => ({
  pushDeviceSession: vi.fn(),
}))

const chromeMock = {
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onMoved: { addListener: vi.fn(), removeListener: vi.fn() },
    onDetached: { addListener: vi.fn(), removeListener: vi.fn() },
    onAttached: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  windows: {
    getAll: vi.fn(),
    onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabGroups: { query: vi.fn() },
  runtime: { id: 'test-ext-id' },
}
globalThis.chrome = chromeMock as unknown as typeof chrome

import { saveGroupsState, getGroupsState } from '@/lib/localDb'
import { pushDeviceSession } from '@/lib/deviceSessions'

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

function makeState(groups: GroupsState['available']): GroupsState {
  return { active: { id: groups[0].id, index: 0 }, available: groups }
}

function chromeWindow(id: number): chrome.windows.Window {
  return { id, type: 'normal', focused: false, incognito: false, alwaysOnTop: false } as chrome.windows.Window
}
function chromeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1, index: 0, pinned: false, highlighted: false, windowId: 1,
    active: true, incognito: false, selected: false, discarded: false,
    autoDiscardable: true, groupId: -1, title: 'Tab', url: 'https://example.com',
    ...overrides,
  } as chrome.tabs.Tab
}

beforeEach(() => {
  vi.clearAllMocks()
  chromeMock.windows.getAll.mockResolvedValue([])
  chromeMock.tabs.query.mockResolvedValue([])
  chromeMock.tabGroups.query.mockResolvedValue([])
  chromeMock.tabs.sendMessage.mockResolvedValue({})
  ;(saveGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  mockUseEntitlements.mockReturnValue({ tier: 'free' })
})

describe('useCurrentTabs — tier closure regression', () => {
  it('pushes the CURRENT tier (not the mount-time tier) on a later tab event', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([chromeTab({ id: 10, windowId: 1 })])

    mockUseEntitlements.mockReturnValue({ tier: 'free' })
    const { wrapper } = makeWrapper()
    const { rerender, unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    // Initial mount sync — subscription query hasn't resolved yet, tier is still 'free'.
    await act(async () => {})
    expect(pushDeviceSession).toHaveBeenCalledWith(expect.anything(), 'free')

    // Subscription resolves; component rerenders with the real tier.
    mockUseEntitlements.mockReturnValue({ tier: 'pro' })
    rerender()

    const handleChange = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0]
    await act(async () => { await handleChange() })

    expect(pushDeviceSession).toHaveBeenLastCalledWith(expect.anything(), 'pro')
    // Listeners were registered exactly once — the tab-event effect must not have re-run.
    expect(chromeMock.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1)
    unmount()
  })
})

describe('syncNowOpen — error handling', () => {
  it('logs and does not throw when chrome.tabs.query rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.tabs.query.mockRejectedValue(new Error('boom'))

    const { wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    expect(consoleSpy).toHaveBeenCalledWith('[useCurrentTabs] sync error', expect.any(Error))
    unmount()
    consoleSpy.mockRestore()
  })
})

describe('syncNowOpen — tabGroups.query unavailable', () => {
  it('falls back to an empty group list when chrome.tabGroups.query is not a function', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([chromeTab({ id: 10, windowId: 1 })])
    // Simulate tabGroups API unavailable (e.g. Firefox)
    const original = chromeMock.tabGroups.query
    // @ts-expect-error intentionally deleting to simulate unavailability
    delete chromeMock.tabGroups.query

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    expect(cached?.available[0].windows[0].tabs).toHaveLength(1)

    chromeMock.tabGroups.query = original
    unmount()
  })
})

describe('syncNowOpen — permanent group guards', () => {
  it('does not update the cache when no permanent group exists in IDB', async () => {
    const state = makeState([createGroup('a', 'A')]) // no permanent group
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.tabs.query.mockResolvedValue([])

    const { qc, wrapper } = makeWrapper()
    const setQueryDataSpy = vi.spyOn(qc, 'setQueryData')
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    expect(setQueryDataSpy).not.toHaveBeenCalled()
    unmount()
  })

  it('strips extra permanent groups beyond the first one', async () => {
    const nowOpen1 = createNowOpenGroup()
    const nowOpen2 = { ...createNowOpenGroup(), id: 'dupe-permanent' }
    const state = makeState([nowOpen1, nowOpen2])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.tabs.query.mockResolvedValue([])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    expect(cached?.available.filter((g) => g.permanent)).toHaveLength(1)
    unmount()
  })
})

describe('syncNowOpen — own-extension page filtering and tab windowId guard', () => {
  it('excludes tabs whose URL starts with this extension\'s own page prefix', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([
      chromeTab({ id: 10, windowId: 1, url: 'chrome-extension://test-ext-id/popup.html' }),
      chromeTab({ id: 11, windowId: 1, url: 'https://real.com' }),
    ])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    const urls = cached?.available[0].windows[0].tabs.map((t: Tab) => t.url)
    expect(urls).toEqual(['https://real.com'])
    unmount()
  })

  it('skips tabs with an undefined windowId when grouping by window', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([
      chromeTab({ id: 20, windowId: undefined as unknown as number, url: 'https://orphan.com' }),
    ])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    // orphan tab dropped, and the window itself has 0 tabs so it's filtered out entirely
    expect(cached?.available[0].windows).toHaveLength(0)
    unmount()
  })

  it('filters out windows that end up with zero tabs after own-extension filtering', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1), chromeWindow(2)])
    chromeMock.tabs.query.mockResolvedValue([
      chromeTab({ id: 30, windowId: 2, url: 'https://kept.com' }),
      // window 1 has no tabs at all
    ])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    expect(cached?.available[0].windows).toHaveLength(1)
    unmount()
  })
})

describe('syncNowOpen — ogImage/note carryover', () => {
  it('carries forward a previously-fetched ogImage and note for a matching URL', async () => {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = [{
      id: 1, incognito: false, focused: false,
      tabs: [{ id: 10, url: 'https://a.com', title: 'A', favIconUrl: '', pinned: false, ogImage: 'https://og.com/prev.png', note: 'remember' }],
    }]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([chromeTab({ id: 10, windowId: 1, url: 'https://a.com' })])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    const t = cached?.available[0].windows[0].tabs[0]
    expect(t?.ogImage).toBe('https://og.com/prev.png')
    expect(t?.note).toBe('remember')
    unmount()
  })

  it('backfills ogImage via chrome.tabs.sendMessage for a tab with no prior ogImage', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([chromeTab({ id: 10, windowId: 1, url: 'https://new.com' })])
    chromeMock.tabs.sendMessage.mockResolvedValue({ ogImage: 'https://og.com/fresh.png' })

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})
    // backfill runs as a fire-and-forget follow-up; flush microtasks again
    await act(async () => {})

    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(10, { type: 'GET_PAGE_META' })
    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    expect(cached?.available[0].windows[0].tabs[0].ogImage).toBe('https://og.com/fresh.png')
    unmount()
  })

  it('does not persist when the backfill fetch returns no ogImages', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([chromeTab({ id: 10, windowId: 1, url: 'https://new.com' })])
    chromeMock.tabs.sendMessage.mockRejectedValue(new Error('no receiver'))

    const { wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})
    await act(async () => {})

    // First saveGroupsState call is the initial sync; ensure no *additional* backfill save happened
    const callCountAfterSync = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls.length
    expect(callCountAfterSync).toBe(1)
    unmount()
  })
})

describe('syncNowOpen — starred flag and order carryover (regression)', () => {
  it('preserves a starred Now Open window\'s starred flag across a tab-event re-sync', async () => {
    const nowOpen = createNowOpenGroup()
    // Previously synced state: window 2 was starred by the user via drag/star toggle
    nowOpen.windows = [
      { id: 1, incognito: false, focused: false, starred: false, tabs: [{ id: 10, url: 'https://a.com', title: 'A', favIconUrl: '', pinned: false }] },
      { id: 2, incognito: false, focused: false, starred: true, tabs: [{ id: 20, url: 'https://b.com', title: 'B', favIconUrl: '', pinned: false }] },
    ]
    const state = makeState([nowOpen])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1), chromeWindow(2)])
    chromeMock.tabs.query.mockResolvedValue([
      chromeTab({ id: 10, windowId: 1, url: 'https://a.com' }),
      chromeTab({ id: 20, windowId: 2, url: 'https://b.com' }),
    ])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    // Initial mount sync, then simulate a chrome.tabs.onUpdated event re-sync (e.g. favicon load)
    await act(async () => {})
    const handleChange = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0]
    await act(async () => { await handleChange() })

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    const windowById = new Map(cached?.available[0].windows.map((w) => [w.id, w]))
    expect(windowById.get(2)?.starred).toBe(true)
    // Starred window zone-clamped to the front, same as sortWindowsByStarred elsewhere
    expect(cached?.available[0].windows[0].id).toBe(2)
    unmount()
  })
})
