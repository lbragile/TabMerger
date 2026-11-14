import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENTLY_CLOSED_LIMITS, RECENTLY_CLOSED_STORAGE_KEYS, RECENTLY_CLOSED_WINDOW_FLUSH_MS } from '@tabmerger/shared'

const mockGetSetting = vi.hoisted(() => vi.fn())
const mockSetSetting = vi.hoisted(() => vi.fn())
const mockAdd = vi.hoisted(() => vi.fn())
const mockPrune = vi.hoisted(() => vi.fn())
const mockPurge = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())
const mockGetSession = vi.hoisted(() => vi.fn())
const mockFetchTier = vi.hoisted(() => vi.fn())

vi.mock('@/lib/localDb', () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }))
vi.mock('@/lib/recentlyClosedDb', () => ({
  addRecentlyClosedEntry: mockAdd,
  pruneRecentlyClosed: mockPrune,
  purgeClearedRecentlyClosed: mockPurge,
  notifyRecentlyClosedChanged: mockNotify,
}))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mockGetSession } } }))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: mockFetchTier }))

import { createRecentlyClosedRecorder, resolveRecentlyClosedPlan } from '@/lib/recentlyClosedRecorder'
import { quietCloseTabKey, quietCloseWindowKey } from '@/lib/recentlyClosed'
import { APP_SETTINGS_KEY, AUTO_SAVE_TIER_SEEN_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys'

const NOW = 1_800_000_000_000
let session: Map<string, unknown>
let settings: Record<string, unknown>
let openTabs: chrome.tabs.Tab[]

const liveTab = (id: number, over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab =>
  ({ id, windowId: 1, index: id, url: `https://t${id}.test/`, title: `T${id}`, pinned: false, incognito: false, groupId: -1, ...over }) as chrome.tabs.Tab

function installChrome() {
  ;(globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      query: vi.fn(async (q: { windowId?: number }) => openTabs.filter((t) => q.windowId === undefined || t.windowId === q.windowId)),
      get: vi.fn(async (id: number) => openTabs.find((t) => t.id === id)),
    },
    tabGroups: {
      query: vi.fn(async () => [{ id: 9, title: 'Work', color: 'blue' }]),
      get: vi.fn(async (id: number) => ({ id, title: 'Grp', color: 'red' })),
    },
    storage: {
      session: {
        get: vi.fn(async (keys: null | string[]) => {
          if (keys === null) return Object.fromEntries(session)
          return Object.fromEntries(keys.filter((k) => session.has(k)).map((k) => [k, session.get(k)]))
        }),
        set: vi.fn(async (items: Record<string, unknown>) => Object.entries(items).forEach(([k, v]) => session.set(k, v))),
        remove: vi.fn(async (keys: string | string[]) => [keys].flat().forEach((k) => session.delete(k))),
      },
    },
    runtime: { id: 'ext', onMessage: { addListener: vi.fn() } },
  }
}

function makeRecorder(plan: 'free' | 'pro' | 'unknown' = 'pro') {
  let n = 0
  return createRecentlyClosedRecorder({ now: () => NOW, resolvePlan: async () => plan, newId: () => `id${++n}` })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  session = new Map()
  settings = {}
  openTabs = [liveTab(1), liveTab(2), liveTab(3, { windowId: 2, index: 0 })]
  installChrome()
  mockGetSetting.mockReset().mockImplementation(async (key: string, fallback: unknown) => (key in settings ? settings[key] : fallback))
  mockSetSetting.mockReset().mockResolvedValue(undefined)
  mockAdd.mockReset().mockResolvedValue(true)
  mockPrune.mockReset().mockResolvedValue({ deleted: 0, nextPurgeAt: null })
  mockPurge.mockReset().mockResolvedValue({ deleted: 0, nextPurgeAt: null })
  mockNotify.mockReset()
  mockGetSession.mockReset().mockResolvedValue({ data: { session: null } })
  mockFetchTier.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

const written = () => mockAdd.mock.calls.map((c) => c[0])

describe('snapshot cache', () => {
  it('seeds from the open tabs when session storage is empty, with tab groups', async () => {
    openTabs[0] = liveTab(1, { groupId: 9 })
    const r = makeRecorder()
    await r.ready
    expect([...r.snapshots.keys()]).toEqual([1, 2, 3])
    expect(r.snapshots.get(1)?.tabGroup).toEqual({ title: 'Work', color: 'blue' })
    r.dispose()
  })

  it('restores from session storage after a worker restart (no query)', async () => {
    session.set(RECENTLY_CLOSED_STORAGE_KEYS.snapshots, { '42': { url: 'https://kept.test', title: 'K', pinned: false, windowId: 7, incognito: false, index: 0 } })
    const r = makeRecorder()
    await r.ready
    expect([...r.snapshots.keys()]).toEqual([42])
    expect(chrome.tabs.query).not.toHaveBeenCalled()
    r.dispose()
  })

  it('mirrors the cache to session storage, debounced', async () => {
    const r = makeRecorder()
    await r.ready
    await vi.advanceTimersByTimeAsync(600)
    const stored = session.get(RECENTLY_CLOSED_STORAGE_KEYS.snapshots) as Record<string, unknown>
    expect(Object.keys(stored)).toEqual(['1', '2', '3'])
    r.dispose()
  })

  it('updates on real changes only, re-keys replaced tabs and follows attached tabs', async () => {
    const r = makeRecorder()
    await r.ready
    await r.onUpdated(1, { status: 'loading' }, liveTab(1, { title: 'ignored' }))
    expect(r.snapshots.get(1)?.title).toBe('T1')
    await r.onUpdated(1, { title: 'New' }, liveTab(1, { title: 'New' }))
    expect(r.snapshots.get(1)?.title).toBe('New')
    await r.onUpdated(2, { groupId: 5 }, liveTab(2, { groupId: 5 }))
    expect(r.snapshots.get(2)?.tabGroup).toEqual({ title: 'Grp', color: 'red' })

    openTabs.push(liveTab(10, { title: 'Prerendered' }))
    await r.onReplaced(10, 1)
    expect(r.snapshots.has(1)).toBe(false)
    expect(r.snapshots.get(10)?.title).toBe('Prerendered')

    await r.onAttached(2, { newWindowId: 4, newPosition: 3 })
    expect(r.snapshots.get(2)).toMatchObject({ windowId: 4, index: 3 })

    await r.onTabGroupUpdated({ id: 5, title: 'Renamed', color: 'green' } as chrome.tabGroups.TabGroup)
    expect(r.snapshots.get(2)?.tabGroup).toEqual({ title: 'Renamed', color: 'green' })

    await r.onCreated(liveTab(11))
    expect(r.snapshots.has(11)).toBe(true)
    r.dispose()
  })
})

describe('recording', () => {
  it('records a single closed tab as a tab entry with the plan limits', async () => {
    const r = makeRecorder('free')
    await r.ready
    await r.onRemoved(1, { windowId: 1, isWindowClosing: false })
    await r.idle()
    expect(written()).toEqual([{ id: 'id1', closedAt: NOW, kind: 'tab', tabs: [{ url: 'https://t1.test/', title: 'T1' }] }])
    expect(mockAdd.mock.calls[0][1]).toEqual(RECENTLY_CLOSED_LIMITS.free)
    expect(mockNotify).toHaveBeenCalled()
    expect(r.snapshots.has(1)).toBe(false)
    r.dispose()
  })

  it('an unknown plan prunes with the Pro limits', async () => {
    const r = makeRecorder('unknown')
    await r.ready
    await r.onRemoved(1, { windowId: 1, isWindowClosing: false })
    await r.idle()
    expect(mockAdd.mock.calls[0][1]).toEqual(RECENTLY_CLOSED_LIMITS.pro)
    r.dispose()
  })

  it.each([
    ['the setting is off', () => (settings[APP_SETTINGS_KEY] = { rememberClosedTabs: false }), 1, 'off'],
    ['the tab is private', () => (openTabs[0] = liveTab(1, { incognito: true })), 1, 'incognito'],
    ['the page is a browser page', () => (openTabs[0] = liveTab(1, { url: 'chrome://newtab/' })), 1, 'not-recordable'],
    ['TabMerger closed it quietly', () => session.set(quietCloseTabKey(1), NOW - 1000), 1, 'quiet'],
    ['TabMerger closed its window quietly', () => session.set(quietCloseWindowKey(1), NOW - 1000), 1, 'quiet'],
    ['the tab was never seen', () => {}, 99, 'unknown-tab'],
  ] as const)('skips when %s', async (_label, arrange, tabId, reason) => {
    arrange()
    const r = makeRecorder()
    await r.ready
    await r.onRemoved(tabId, { windowId: 1, isWindowClosing: false })
    await r.idle()
    expect(r.lastSkip).toBe(reason)
    expect(mockAdd).not.toHaveBeenCalled()
    r.dispose()
  })

  it('a quiet mark is consumed, and an expired one is ignored', async () => {
    session.set(quietCloseTabKey(1), NOW - 1000)
    session.set(quietCloseTabKey(2), NOW - 31_000)
    const r = makeRecorder()
    await r.ready
    // the expired mark is dropped at start
    expect(session.has(quietCloseTabKey(2))).toBe(false)
    await r.onRemoved(1, { windowId: 1, isWindowClosing: false })
    expect(session.has(quietCloseTabKey(1))).toBe(false)
    await r.onRemoved(2, { windowId: 1, isWindowClosing: false })
    await r.idle()
    expect(written().map((e) => e.tabs[0].url)).toEqual(['https://t2.test/'])
    r.dispose()
  })

  it('collapses a closing window into ONE window entry on windows.onRemoved, in tab order', async () => {
    const r = makeRecorder()
    await r.ready
    await r.onRemoved(2, { windowId: 1, isWindowClosing: true })
    await r.onRemoved(1, { windowId: 1, isWindowClosing: true })
    expect(mockAdd).not.toHaveBeenCalled()
    await r.onWindowRemoved(1)
    await r.idle()
    expect(written()).toHaveLength(1)
    expect(written()[0]).toMatchObject({ kind: 'window', tabs: [{ url: 'https://t1.test/' }, { url: 'https://t2.test/' }] })
    r.dispose()
  })

  it('flushes a window 1 s after its last close when windows.onRemoved never comes', async () => {
    const r = makeRecorder()
    await r.ready
    await r.onRemoved(1, { windowId: 1, isWindowClosing: true })
    await r.onRemoved(2, { windowId: 1, isWindowClosing: true })
    await vi.advanceTimersByTimeAsync(RECENTLY_CLOSED_WINDOW_FLUSH_MS + 10)
    await r.idle()
    expect(written()).toHaveLength(1)
    expect(written()[0].kind).toBe('window')
    r.dispose()
  })

  it('a closing window with one tab becomes a tab entry', async () => {
    const r = makeRecorder()
    await r.ready
    await r.onRemoved(3, { windowId: 2, isWindowClosing: true })
    await r.onWindowRemoved(2)
    await r.idle()
    expect(written()[0].kind).toBe('tab')
    r.dispose()
  })

  it('sweeps at start: prunes for the plan and schedules the cleared-entry delete', async () => {
    mockPrune.mockResolvedValue({ deleted: 2, nextPurgeAt: NOW + 5000 })
    mockPurge.mockResolvedValue({ deleted: 1, nextPurgeAt: null })
    const r = makeRecorder('free')
    await r.ready
    await r.sweep()
    expect(mockPrune).toHaveBeenCalledWith(RECENTLY_CLOSED_LIMITS.free, NOW)
    expect(mockNotify).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5100)
    await r.idle()
    expect(mockPurge).toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledTimes(2)
    r.dispose()
  })

  it('onCleared purges what is due and schedules the rest', async () => {
    mockPurge.mockResolvedValueOnce({ deleted: 0, nextPurgeAt: NOW + 10_000 }).mockResolvedValue({ deleted: 3, nextPurgeAt: null })
    const r = makeRecorder()
    await r.ready
    await r.onCleared()
    expect(mockPurge).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_100)
    await r.idle()
    expect(mockPurge).toHaveBeenCalledTimes(2)
    r.dispose()
  })
})

describe('resolveRecentlyClosedPlan', () => {
  it('nobody signed in on a store no account owns is Free', async () => {
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('free')
  })

  it('signed out with an account still in the store uses the remembered answer, else unknown', async () => {
    settings[LAST_USER_ID_KEY] = 'u1'
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('unknown')
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW }
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('free')
  })

  it('signed in: the remembered answer without a request, else the server, remembered', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    settings[LAST_USER_ID_KEY] = 'u1'
    mockFetchTier.mockResolvedValue('pro_ai')
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('pro')
    expect(mockSetSetting).toHaveBeenCalledWith(AUTO_SAVE_TIER_SEEN_KEY, { tier: 'pro_ai', at: NOW })
    settings[AUTO_SAVE_TIER_SEEN_KEY] = { tier: 'free', at: NOW }
    mockFetchTier.mockClear()
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('free')
    expect(mockFetchTier).not.toHaveBeenCalled()
  })

  it('a failed check or an account mismatch is unknown (Pro limits)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    mockFetchTier.mockResolvedValue(null)
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('unknown')
    settings[LAST_USER_ID_KEY] = 'someone-else'
    await expect(resolveRecentlyClosedPlan(NOW)).resolves.toBe('unknown')
  })
})
