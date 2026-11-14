import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENTLY_CLOSED_MESSAGE } from '@tabmerger/shared'

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  add: vi.fn(),
  prune: vi.fn(),
  purge: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({ getSetting: h.getSetting, setSetting: h.setSetting }))
vi.mock('@/lib/recentlyClosedDb', () => ({
  addRecentlyClosedEntry: h.add,
  pruneRecentlyClosed: h.prune,
  purgeClearedRecentlyClosed: h.purge,
  notifyRecentlyClosedChanged: h.notify,
  getRememberClosedTabs: vi.fn().mockResolvedValue(true),
  migrateRememberClosedTabs: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } } }))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: vi.fn() }))

import { createRecentlyClosedRecorder, registerRecentlyClosed } from '@/lib/recentlyClosedRecorder'

const NOW = 1_800_000_000_000
const liveTab = (id: number, windowId: number, index: number): chrome.tabs.Tab =>
  ({ id, windowId, index, url: `https://t${id}.test/`, title: `T${id}`, pinned: false, incognito: false, groupId: -1 }) as chrome.tabs.Tab

let openTabs: chrome.tabs.Tab[]
type Listener = (...args: any[]) => unknown
let events: Record<string, Listener[]>
const ev = (name: string) => ({ addListener: (l: Listener) => (events[name] ??= []).push(l) })

function installChrome(opts: { tabGroups: boolean }) {
  events = {}
  const c: Record<string, unknown> = {
    tabs: {
      onCreated: ev('created'),
      onUpdated: ev('updated'),
      onReplaced: ev('replaced'),
      onAttached: ev('attached'),
      onMoved: ev('moved'),
      onRemoved: ev('removed'),
      query: vi.fn(async (q: { windowId?: number }) => openTabs.filter((t) => q.windowId === undefined || t.windowId === q.windowId)),
      get: vi.fn(),
    },
    windows: { onRemoved: ev('windowRemoved') },
    storage: { session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } },
    runtime: { id: 'ext', getURL: () => 'chrome-extension://ext/', onMessage: ev('message') },
  }
  if (opts.tabGroups) c.tabGroups = { query: vi.fn().mockResolvedValue([]), get: vi.fn(), onUpdated: ev('groupUpdated') }
  ;(globalThis as { chrome?: unknown }).chrome = c
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  openTabs = [liveTab(1, 1, 0), liveTab(2, 1, 1), liveTab(3, 1, 2)]
  h.getSetting.mockReset().mockImplementation(async (_k: string, d: unknown) => d)
  h.setSetting.mockReset().mockResolvedValue(undefined)
  h.add.mockReset().mockResolvedValue(true)
  h.prune.mockReset().mockResolvedValue({ deleted: 0, nextPurgeAt: null })
  h.purge.mockReset().mockResolvedValue({ deleted: 0, nextPurgeAt: null })
  h.notify.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('onMoved re-index', () => {
  it('re-reads the window tab order after a move (debounced) so a closed window keeps the tabs in their on-screen order', async () => {
    installChrome({ tabGroups: true })
    let n = 0
    const r = createRecentlyClosedRecorder({ now: () => NOW, resolvePlan: async () => 'pro', newId: () => `id${++n}` })
    await r.ready
    // the user drags tab 3 to the front
    openTabs = [liveTab(3, 1, 0), liveTab(1, 1, 1), liveTab(2, 1, 2)]
    await r.onMoved(3, { windowId: 1 })
    // debounced: nothing re-read yet
    expect(r.snapshots.get(3)?.index).toBe(2)
    await vi.advanceTimersByTimeAsync(400)
    await r.idle()
    expect([...r.snapshots].map(([id, s]) => [id, s.index]).sort()).toEqual([[1, 1], [2, 2], [3, 0]])

    for (const id of [1, 2, 3]) await r.onRemoved(id, { windowId: 1, isWindowClosing: true })
    await r.onWindowRemoved(1)
    await r.idle()
    expect(h.add.mock.calls[0][0].tabs.map((t: { url: string }) => t.url)).toEqual(['https://t3.test/', 'https://t1.test/', 'https://t2.test/'])
    r.dispose()
  })

  it('several quick moves cause one re-read, and an invalid window id causes none', async () => {
    installChrome({ tabGroups: true })
    const r = createRecentlyClosedRecorder({ now: () => NOW, resolvePlan: async () => 'pro' })
    await r.ready
    ;(chrome.tabs.query as ReturnType<typeof vi.fn>).mockClear()
    await r.onMoved(1, { windowId: 1 })
    await r.onMoved(2, { windowId: 1 })
    await r.onMoved(2, { windowId: -1 })
    await vi.advanceTimersByTimeAsync(400)
    await r.idle()
    expect(chrome.tabs.query).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 1 })
    r.dispose()
  })
})

describe('registerRecentlyClosed wiring', () => {
  it('returns null (and registers nothing) without the tabs API', () => {
    ;(globalThis as { chrome?: unknown }).chrome = {}
    expect(registerRecentlyClosed()).toBeNull()
  })

  it('subscribes to every tab, window and tab-group event and forwards them to the recorder', async () => {
    installChrome({ tabGroups: true })
    const r = registerRecentlyClosed()!
    expect(r).not.toBeNull()
    for (const name of ['created', 'updated', 'replaced', 'attached', 'moved', 'removed', 'windowRemoved', 'groupUpdated', 'message']) {
      expect(events[name], name).toHaveLength(1)
    }
    await r.ready
    // the worker sweeps once the cache is ready
    await vi.advanceTimersByTimeAsync(0)
    await r.idle()
    expect(h.prune).toHaveBeenCalledTimes(1)

    events.created[0](liveTab(7, 1, 3))
    events.updated[0](7, { title: 'New' }, { ...liveTab(7, 1, 3), title: 'New' })
    events.attached[0](7, { newWindowId: 1, newPosition: 0 })
    events.groupUpdated[0]({ id: 5, title: 'G', color: 'red' })
    events.moved[0](7, { windowId: 1 })
    await r.idle()
    expect(r.snapshots.get(7)?.title).toBe('New')

    events.removed[0](1, { windowId: 1, isWindowClosing: false })
    await r.idle()
    expect(h.add).toHaveBeenCalledTimes(1)
    expect(h.add.mock.calls[0][0].tabs[0].url).toBe('https://t1.test/')

    events.removed[0](2, { windowId: 1, isWindowClosing: true })
    events.windowRemoved[0](1)
    await r.idle()
    expect(h.add).toHaveBeenCalledTimes(2)
    r.dispose()
  })

  it('a CLEARED message from the extension own page purges; from a content script or other messages it does not', async () => {
    installChrome({ tabGroups: true })
    const r = registerRecentlyClosed()!
    await r.ready
    await r.idle()
    h.purge.mockClear()
    const onMessage = events.message[0]
    onMessage({ type: 'OTHER' }, { id: 'ext', url: 'chrome-extension://ext/popup.html' })
    onMessage(null, { id: 'ext', url: 'chrome-extension://ext/popup.html' })
    onMessage({ type: RECENTLY_CLOSED_MESSAGE.CLEARED }, { id: 'ext', url: 'https://web.test/page' })
    onMessage({ type: RECENTLY_CLOSED_MESSAGE.CLEARED }, { id: 'other', url: 'chrome-extension://ext/popup.html' })
    await r.idle()
    expect(h.purge).not.toHaveBeenCalled()
    onMessage({ type: RECENTLY_CLOSED_MESSAGE.CLEARED }, { id: 'ext', url: 'chrome-extension://ext/popup.html' })
    await r.idle()
    expect(h.purge).toHaveBeenCalledTimes(1)
    r.dispose()
  })

  it('Firefox without chrome.tabGroups (or optional events): registers the rest, seeds and records without groups', async () => {
    installChrome({ tabGroups: false })
    const tabs = chrome.tabs as unknown as Record<string, unknown>
    delete tabs.onReplaced
    delete tabs.onAttached
    delete tabs.onMoved
    ;(chrome as unknown as { windows?: unknown }).windows = undefined
    const r = registerRecentlyClosed()!
    expect(r).not.toBeNull()
    expect(events.groupUpdated).toBeUndefined()
    expect(events.replaced).toBeUndefined()
    expect(events.moved).toBeUndefined()
    expect(events.windowRemoved).toBeUndefined()
    expect(events.removed).toHaveLength(1)
    await r.ready
    // a tab in a browser tab group is still seeded and recorded (just without the group)
    expect([...r.snapshots.keys()]).toEqual([1, 2, 3])
    events.removed[0](1, { windowId: 1, isWindowClosing: false })
    await r.idle()
    expect(h.add.mock.calls[0][0].tabs[0]).toEqual({ url: 'https://t1.test/', title: 'T1' })
    // a tab update that changes group does not look the group up
    events.updated[0](2, { groupId: 4 }, { ...liveTab(2, 1, 1), groupId: 4 })
    await r.idle()
    expect(r.snapshots.get(2)?.tabGroup).toBeUndefined()
    r.dispose()
  })
})
