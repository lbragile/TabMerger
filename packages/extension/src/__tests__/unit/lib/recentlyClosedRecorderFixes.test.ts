import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RECENTLY_CLOSED_LIMITS,
  RECENTLY_CLOSED_MAX_FAVICON_LENGTH,
  RECENTLY_CLOSED_PLAN_TIMEOUT_MS,
  RECENTLY_CLOSED_UNPIN_GRACE_MS,
} from '@tabmerger/shared'

// Recorder fixes: recording never waits on the plan lookup, a window's quiet mark outlives
// windows.onRemoved, Chrome's un-pin-before-close keeps the pinned flag, and private tabs and huge
// icons never reach the snapshot cache.

const h = vi.hoisted(() => ({
  add: vi.fn(),
  prune: vi.fn(),
  purge: vi.fn(),
  notify: vi.fn(),
  remember: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({ getSetting: vi.fn(async (_k: string, d: unknown) => d), setSetting: vi.fn() }))
vi.mock('@/lib/recentlyClosedDb', () => ({
  addRecentlyClosedEntry: h.add,
  pruneRecentlyClosed: h.prune,
  purgeClearedRecentlyClosed: h.purge,
  notifyRecentlyClosedChanged: h.notify,
  getRememberClosedTabs: h.remember,
  migrateRememberClosedTabs: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } } }))
vi.mock('@/lib/entitlementTier', () => ({ fetchTier: vi.fn() }))

import { createRecentlyClosedRecorder } from '@/lib/recentlyClosedRecorder'
import { pinnedAtClose, quietCloseWindowKey, snapshotFromTab } from '@/lib/recentlyClosed'

let clock = 1_800_000_000_000
let session: Map<string, unknown>
let openTabs: chrome.tabs.Tab[]

const liveTab = (id: number, over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab =>
  ({ id, windowId: 1, index: id, url: `https://t${id}.test/`, title: `T${id}`, pinned: false, incognito: false, groupId: -1, ...over }) as chrome.tabs.Tab

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  clock = 1_800_000_000_000
  session = new Map()
  openTabs = [liveTab(1, { pinned: true }), liveTab(2)]
  ;(globalThis as { chrome?: unknown }).chrome = {
    tabs: { query: vi.fn(async () => openTabs), get: vi.fn() },
    storage: {
      session: {
        get: vi.fn(async (keys: null | string[]) =>
          keys === null ? Object.fromEntries(session) : Object.fromEntries(keys.filter((k) => session.has(k)).map((k) => [k, session.get(k)]))
        ),
        set: vi.fn(async (items: Record<string, unknown>) => Object.entries(items).forEach(([k, v]) => session.set(k, v))),
        remove: vi.fn(async (keys: string | string[]) => [keys].flat().forEach((k) => session.delete(k))),
      },
    },
  }
  h.add.mockReset().mockResolvedValue(true)
  h.prune.mockReset().mockResolvedValue({ deleted: 0, nextPurgeAt: null })
  h.purge.mockReset().mockResolvedValue({ deleted: 0, nextPurgeAt: null })
  h.notify.mockReset()
  h.remember.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const make = (resolvePlan: () => Promise<'free' | 'pro' | 'unknown'>) =>
  createRecentlyClosedRecorder({ now: () => clock, resolvePlan, newId: () => 'id' })

describe('the plan lookup never holds up a recording', () => {
  it('records at once with the Pro limits while the lookup hangs, and gives up on it after the timeout', async () => {
    const r = make(() => new Promise(() => {}))
    await r.ready
    await r.onRemoved(2, { windowId: 1, isWindowClosing: false })
    await vi.waitFor(() => expect(h.add).toHaveBeenCalledTimes(1))
    expect(h.add.mock.calls[0][1]).toEqual(RECENTLY_CLOSED_LIMITS.pro)
    expect(h.prune).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RECENTLY_CLOSED_PLAN_TIMEOUT_MS + 10)
    await r.idle()
    // timed out: unknown, so nothing is trimmed to the Free limits
    expect(h.prune).not.toHaveBeenCalled()
    r.dispose()
  })

  it('the start sweep falls back to the Pro limits after the timeout', async () => {
    const r = make(() => new Promise(() => {}))
    await r.ready
    const sweeping = r.sweep()
    await vi.advanceTimersByTimeAsync(RECENTLY_CLOSED_PLAN_TIMEOUT_MS + 10)
    await sweeping
    expect(h.prune).toHaveBeenCalledWith(RECENTLY_CLOSED_LIMITS.pro, clock)
    r.dispose()
  })

  it('a timed-out lookup is not remembered: the next one asks again', async () => {
    const resolvePlan = vi.fn<() => Promise<'free' | 'pro' | 'unknown'>>().mockReturnValueOnce(new Promise(() => {})).mockResolvedValue('free')
    const r = make(resolvePlan)
    await r.ready
    const first = r.sweep()
    await vi.advanceTimersByTimeAsync(RECENTLY_CLOSED_PLAN_TIMEOUT_MS + 10)
    await first
    await r.sweep()
    expect(resolvePlan).toHaveBeenCalledTimes(2)
    expect(h.prune).toHaveBeenLastCalledWith(RECENTLY_CLOSED_LIMITS.free, clock)
    r.dispose()
  })
})

describe("a window's quiet mark outlives windows.onRemoved", () => {
  it('a tab whose onRemoved comes AFTER windows.onRemoved is still quiet', async () => {
    session.set(quietCloseWindowKey(1), clock - 100)
    const r = make(async () => 'pro')
    await r.ready
    await r.onWindowRemoved(1)
    expect(session.has(quietCloseWindowKey(1))).toBe(true)
    await r.onRemoved(2, { windowId: 1, isWindowClosing: true })
    expect(r.lastSkip).toBe('quiet')
    await vi.advanceTimersByTimeAsync(2000)
    await r.idle()
    expect(h.add).not.toHaveBeenCalled()
    r.dispose()
  })
})

describe('Chrome un-pins a window’s pinned tabs right before closing it', () => {
  it('a window closed within the grace period keeps the pinned flag', async () => {
    const r = make(async () => 'pro')
    await r.ready
    await r.onUpdated(1, { pinned: false }, liveTab(1, { pinned: false }))
    expect(r.snapshots.get(1)).toMatchObject({ pinned: false, unpinnedAt: clock })
    clock += 200
    await r.onRemoved(1, { windowId: 1, isWindowClosing: true })
    await r.onRemoved(2, { windowId: 1, isWindowClosing: true })
    await r.onWindowRemoved(1)
    await r.idle()
    expect(h.add.mock.calls[0][0].tabs).toEqual([
      { url: 'https://t1.test/', title: 'T1', pinned: true },
      { url: 'https://t2.test/', title: 'T2' },
    ])
    r.dispose()
  })

  it('a tab un-pinned by the user well before it closed stays unpinned', async () => {
    const r = make(async () => 'pro')
    await r.ready
    await r.onUpdated(1, { pinned: false }, liveTab(1, { pinned: false }))
    // a title change later keeps the remembered un-pin time
    await r.onUpdated(1, { title: 'New' }, liveTab(1, { pinned: false, title: 'New' }))
    expect(r.snapshots.get(1)?.unpinnedAt).toBe(clock)
    clock += RECENTLY_CLOSED_UNPIN_GRACE_MS + 1
    await r.onRemoved(1, { windowId: 1, isWindowClosing: false })
    await r.idle()
    expect(h.add.mock.calls[0][0].tabs[0].pinned).toBeUndefined()
    r.dispose()
  })

  it('pinnedAtClose: only within the grace period, never before the un-pin', () => {
    const snap = { url: 'https://a.test', title: 'a', pinned: false, windowId: 1, incognito: false, index: 0, unpinnedAt: 1000 }
    expect(pinnedAtClose(snap, 1000 + RECENTLY_CLOSED_UNPIN_GRACE_MS)).toBe(true)
    expect(pinnedAtClose(snap, 1001 + RECENTLY_CLOSED_UNPIN_GRACE_MS)).toBe(false)
    expect(pinnedAtClose(snap, 999)).toBe(false)
    expect(pinnedAtClose({ ...snap, unpinnedAt: undefined }, 1000)).toBe(false)
    expect(pinnedAtClose({ ...snap, pinned: true }, 0)).toBe(true)
  })
})

describe('what reaches the snapshot cache', () => {
  it('private tabs are never snapshotted', async () => {
    expect(snapshotFromTab(liveTab(5, { incognito: true }))).toBeNull()
    openTabs = [liveTab(1), liveTab(9, { incognito: true })]
    const r = make(async () => 'pro')
    await r.ready
    expect([...r.snapshots.keys()]).toEqual([1])
    await r.onCreated(liveTab(10, { incognito: true }))
    expect(r.snapshots.has(10)).toBe(false)
    r.dispose()
  })

  it('a huge inline favicon is not kept; a normal one is', () => {
    const huge = `data:image/png;base64,${'A'.repeat(RECENTLY_CLOSED_MAX_FAVICON_LENGTH)}`
    expect(snapshotFromTab(liveTab(1, { favIconUrl: huge }))?.favIconUrl).toBeUndefined()
    expect(snapshotFromTab(liveTab(1, { favIconUrl: 'https://x.test/f.ico' }))?.favIconUrl).toBe('https://x.test/f.ico')
  })
})
