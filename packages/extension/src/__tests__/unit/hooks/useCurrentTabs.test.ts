/**
 * Branch-coverage batch for useCurrentTabs.ts's internal syncNowOpen logic, exercised
 * through the public useCurrentTabs() hook: error catch path, tabGroups.query unavailable
 * fallback, extra-permanent-group stripping, no-permanent-group early return, own-extension-page
 * filtering, ogImage/note carryover. There is no content script, so ogImage is only ever
 * carried forward from a prior value — never backfilled via chrome.tabs.sendMessage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useCurrentTabs, NOW_OPEN_SYNC_DELAY_MS } from '@/hooks/useCurrentTabs'
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { GroupsState, Tab } from '@/lib/types'

vi.mock('@/lib/localDb', async () => (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
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

import { saveGroupsState, getGroupsState, updateGroupsState } from '@/lib/localDb'
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
    await act(async () => { handleChange(); await new Promise((r) => setTimeout(r, NOW_OPEN_SYNC_DELAY_MS + 50)) })

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

  it('leaves ogImage undefined for a tab with no prior ogImage (no content script to backfill from)', async () => {
    const state = makeState([createNowOpenGroup()])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockResolvedValue(state)
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockResolvedValue([chromeTab({ id: 10, windowId: 1, url: 'https://new.com' })])

    const { qc, wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useCurrentTabs(), { wrapper })

    await act(async () => {})

    // Dead content-script backfill path was removed — sendMessage is never called by this hook.
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    expect(cached?.available[0].windows[0].tabs[0].ogImage).toBeUndefined()
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
    await act(async () => { handleChange(); await new Promise((r) => setTimeout(r, NOW_OPEN_SYNC_DELAY_MS + 50)) })

    const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    const windowById = new Map(cached?.available[0].windows.map((w) => [w.id, w]))
    expect(windowById.get(2)?.starred).toBe(true)
    // Starred window zone-clamped to the front, same as sortWindowsByStarred elsewhere
    expect(cached?.available[0].windows[0].id).toBe(2)
    unmount()
  })
})

describe('useCurrentTabs — tab event bursts are coalesced into one Now Open write', () => {
  /** A stored state the mocked write path reads and replaces, like IndexedDB would. */
  let stored: GroupsState
  let liveTitle: string

  beforeEach(() => {
    vi.useFakeTimers()
    const saved = createGroup('saved', 'Saved')
    saved.windows = [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, url: 'https://saved.com', title: 'Saved', favIconUrl: '', pinned: false }] }]
    stored = makeState([createNowOpenGroup(), saved])
    ;(getGroupsState as ReturnType<typeof vi.fn>).mockImplementation(async () => stored)
    ;(saveGroupsState as ReturnType<typeof vi.fn>).mockImplementation(async (s: GroupsState) => { stored = s })
    liveTitle = 'title 0'
    chromeMock.windows.getAll.mockResolvedValue([chromeWindow(1)])
    chromeMock.tabs.query.mockImplementation(async () => [chromeTab({ id: 10, windowId: 1, title: liveTitle })])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Mounts the hook, lets the immediate mount pass finish, and returns the onUpdated listener. */
  async function mount() {
    const { qc, wrapper } = makeWrapper()
    const view = renderHook(() => useCurrentTabs(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(saveGroupsState).toHaveBeenCalledTimes(1) // the mount pass is not delayed
    ;(saveGroupsState as ReturnType<typeof vi.fn>).mockClear()
    const onUpdated = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0] as () => void
    return { qc, onUpdated, ...view }
  }
  const nowOpenTitle = (s: GroupsState | undefined) => s?.available[0].windows[0]?.tabs[0]?.title

  it('a burst of events gives one write holding the latest browser state', async () => {
    const { qc, onUpdated, unmount } = await mount()

    for (let i = 1; i <= 10; i++) {
      liveTitle = `title ${i}`
      onUpdated()
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    }
    expect(saveGroupsState).not.toHaveBeenCalled() // still collecting the burst
    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS) })

    expect(saveGroupsState).toHaveBeenCalledTimes(1)
    expect(nowOpenTitle(stored)).toBe('title 10')
    expect(nowOpenTitle(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY))).toBe('title 10')
    unmount()
  })

  it('a title changing every 40 ms is not starved: writes keep landing, about one per delay, and end on the latest', async () => {
    const { onUpdated, unmount } = await mount()

    const duration = 2000
    for (let t = 40; t <= duration; t += 40) {
      liveTitle = `title ${t}`
      onUpdated()
      await act(async () => { await vi.advanceTimersByTimeAsync(40) })
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS) })

    const writes = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls.length
    expect(writes).toBeGreaterThan(1) // a reset-on-every-event debounce would write once, at the very end
    expect(writes).toBeLessThanOrEqual(Math.ceil(duration / NOW_OPEN_SYNC_DELAY_MS) + 1) // vs 50 events
    expect(nowOpenTitle(stored)).toBe(`title ${duration}`)
    unmount()
  })

  it('events during a pass in flight queue exactly one more pass, which reads the latest state', async () => {
    const { onUpdated, unmount } = await mount()

    // Hold the next browser query open, so the pass started by the first event stays in flight
    let release!: () => void
    chromeMock.tabs.query.mockImplementationOnce(() => new Promise((resolve) => {
      const seen = liveTitle
      release = () => resolve([chromeTab({ id: 10, windowId: 1, title: seen })])
    }))
    liveTitle = 'stale'
    onUpdated()
    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS) })

    // Three more bursts while that pass waits: each fires its timer, all fold into one re-run
    for (const title of ['b', 'c', 'latest']) {
      liveTitle = title
      onUpdated()
      await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS) })
    }
    expect(saveGroupsState).not.toHaveBeenCalled()
    expect(chromeMock.tabs.query).toHaveBeenCalledTimes(2) // mount + the held pass, no parallel pass

    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0) })

    const titles = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls.map(([s]) => nowOpenTitle(s as GroupsState))
    expect(titles).toEqual(['stale', 'latest'])
    unmount()
  })

  it('a user mutation is stored right away while a burst is pending, and the mirror write keeps it', async () => {
    const { onUpdated, unmount } = await mount()

    liveTitle = 'after burst'
    onUpdated()
    onUpdated()

    // The drop: a write to a saved group, made while the burst's pass is still waiting
    let done = false
    await act(async () => {
      await updateGroupsState((s) => ({
        ...s,
        available: s.available.map((g) => (g.id === 'saved' ? { ...g, name: 'Dropped', pendingSync: true } : g))
      }))
      done = true
    })
    expect(done).toBe(true)
    expect(saveGroupsState).toHaveBeenCalledTimes(1) // only the user's write: no mirror write queued ahead of it
    expect(stored.available[1].name).toBe('Dropped')

    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS) })
    expect(saveGroupsState).toHaveBeenCalledTimes(2)
    expect(stored.available[1].name).toBe('Dropped') // the mirror pass re-read the store and kept it
    expect(nowOpenTitle(stored)).toBe('after burst')
    unmount()
  })

  it('unmount flushes a pending pass to IndexedDB without touching the cache', async () => {
    const { qc, onUpdated, unmount } = await mount()
    const cachedBefore = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)

    liveTitle = 'closing'
    onUpdated()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(saveGroupsState).toHaveBeenCalledTimes(1)
    expect(nowOpenTitle(stored)).toBe('closing')
    expect(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)).toBe(cachedBefore)
    // No timer left behind to fire a second write later
    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS * 2) })
    expect(saveGroupsState).toHaveBeenCalledTimes(1)
  })

  it('unmount with nothing pending writes nothing', async () => {
    const { unmount } = await mount()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS * 2) })
    expect(saveGroupsState).not.toHaveBeenCalled()
  })

  /** Starts a pass whose browser query is held open, so it is in flight until `release()`. */
  async function holdAPass(onUpdated: () => void) {
    let release!: () => void
    chromeMock.tabs.query.mockImplementationOnce(() => new Promise((resolve) => {
      const seen = liveTitle
      release = () => resolve([chromeTab({ id: 10, windowId: 1, title: seen })])
    }))
    liveTitle = 'in flight'
    onUpdated()
    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS) })
    return () => release()
  }

  it('unmount during a pass with a timer armed: one more IndexedDB write, no cache update, no device push', async () => {
    const { qc, onUpdated, unmount } = await mount()
    ;(pushDeviceSession as ReturnType<typeof vi.fn>).mockClear()
    const setQueryData = vi.spyOn(qc, 'setQueryData')
    const release = await holdAPass(onUpdated)

    liveTitle = 'latest'
    onUpdated() // arms the timer while the pass is in flight
    unmount() // flush: the pass is running, so this becomes its one re-run
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS * 2) })

    const titles = (saveGroupsState as ReturnType<typeof vi.fn>).mock.calls.map(([s]) => nowOpenTitle(s as GroupsState))
    expect(titles).toEqual(['in flight', 'latest'])
    expect(setQueryData).not.toHaveBeenCalled()
    expect(pushDeviceSession).not.toHaveBeenCalled()
  })

  it('unmount during a pass with no timer armed: the pass stores to IndexedDB but leaves the cache alone', async () => {
    const { qc, onUpdated, unmount } = await mount()
    ;(pushDeviceSession as ReturnType<typeof vi.fn>).mockClear()
    const cachedBefore = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)
    const release = await holdAPass(onUpdated)

    unmount()
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(NOW_OPEN_SYNC_DELAY_MS * 2) })

    expect(saveGroupsState).toHaveBeenCalledTimes(1)
    expect(nowOpenTitle(stored)).toBe('in flight')
    expect(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)).toBe(cachedBefore)
    expect(pushDeviceSession).not.toHaveBeenCalled()
  })
})
